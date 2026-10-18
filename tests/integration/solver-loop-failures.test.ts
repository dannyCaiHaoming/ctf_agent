import { readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SolverFailure, solverDisposition, type SolverAction, type SolverDriver } from '@ctf/supervisor';
import { OutcomeSchema, SolveStateSchema } from '@ctf/contracts';
import { declaration, dispatch, plan, run, scripted, setup } from './solver-loop-fixtures.js';

describe('Solver local failure classification, authority and finite budgets', () => {
  it('maps every loop disposition into exact spec solve_state and outcome values without claiming solved', () => {
    for (const status of ['candidate_only', 'blocked', 'resource_exhausted', 'no_route'] as const) {
      const result = solverDisposition(status);
      expect(OutcomeSchema.parse(result.outcome)).not.toBe('solved');
      expect(SolveStateSchema.parse(result.solve_state)).toBe(result.solve_state);
    }
    expect(solverDisposition('blocked', 'scope_denied')).toEqual({ solve_state: 'blocked_capability', outcome: 'inconclusive' });
    expect(solverDisposition('blocked', 'blocked_data')).toEqual({ solve_state: 'blocked_data', outcome: 'inconclusive' });
    expect(solverDisposition('resource_exhausted', undefined, true).solve_state).toBe('deadline_exceeded');
  });
  it('escalates only after the original experiment repair allowance is exhausted', async () => {
    const { driver, requests } = scripted([dispatch(), run, run, request => {
      expect(request.phase).toBe('strategy');
      return { kind: 'stop', reason: 'no alternative route' };
    }]);
    const env = await setup('t1-script-error', driver);
    try {
      expect((await env.loop.run()).status).toBe('no_route');
      expect(requests[2]!.phase).toBe('solver');
      expect(env.loop.hypotheses.experiment('e-decode').activities.filter(activity => activity.kind === 'repair')).toHaveLength(1);
      expect(env.loop.hypotheses.hypothesis('decode').state).toBe('inconclusive');
      const events = env.state.events().filter(event => event.kind === 'solver.activity');
      expect(events.filter(event => event.activity === 'strategy.request')).toHaveLength(1);
      expect(events.filter(event => event.activity === 'tool.result' && event.data.tool === 'job.run')).toHaveLength(2);
    } finally { await env.close(); }
  });
  it.each(['scope_denied', 'blocked_data'] as const)('%s blocks without falsifying the mechanism or silently retrying', async code => {
    const { driver } = scripted([dispatch(), run]);
    const env = await setup('t1-script-error', driver, { authorizeCommand: () => { throw new SolverFailure(code, `host policy: ${code}`); } });
    try {
      expect(await env.loop.run()).toMatchObject({ status: 'blocked', reason: expect.stringContaining(code) });
      expect(env.loop.hypotheses.hypothesis('decode').state).toBe('inconclusive');
      expect(env.loop.hypotheses.hypothesis('decode').contradicting_refs).toHaveLength(0);
      expect(env.loop.hypotheses.experiment('e-decode').events).toHaveLength(1);
    } finally { await env.close(); }
  });
  it('rejects semantic refutation based on tool errors, then preserves the failed mechanism as inconclusive', async () => {
    const { driver } = scripted([dispatch('decode', undefined, 0), run, { kind: 'stop', reason: 'no route' }]);
    const env = await setup('t1-script-error', driver);
    try {
      await env.loop.run();
      await expect(env.loop.hypotheses.conclude('e-decode', { verdict: 'rejected', rationale: 'syntax means wrong mechanism', evidence_refs: env.loop.hypotheses.experiment('e-decode').events[0]!.artifact_refs })).rejects.toThrow();
      expect(env.loop.hypotheses.hypothesis('decode').state).toBe('inconclusive');
    } finally { await env.close(); }
  });
  it('requires host semantic substantiation of a successful falsification claim', async () => {
    const command = [process.execPath, 'target.mjs', '2+2'];
    const { driver, requests } = scripted([dispatch('expression', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => ({ kind: 'conclude', verdict: 'supported', rationale: 'incorrectly calls literal output evaluation', evidence_refs: request.observation!.artifact_refs }),
      { kind: 'stop', reason: 'claim rejected by host' }]);
    const env = await setup('t2-falsified', driver);
    try {
      expect((await env.loop.run()).status).toBe('no_route');
      expect(env.loop.hypotheses.hypothesis('expression').state).toBe('testing');
      expect(requests.at(-1)!.observation!.raw).toContain('does not substantiate');
      expect(env.loop.hypotheses.progressRecords()).toHaveLength(0);
    } finally { await env.close(); }
  });
  it('rejects whole-file replacement and retains the original workspace bytes', async () => {
    let original = '';
    const { driver } = scripted([{ kind: 'tool', tool: 'workspace.read', input: { path: 'solve.mjs' } }, request => {
      original = request.observation!.raw;
      return { kind: 'tool', tool: 'workspace.patch', input: { path: 'solve.mjs', find: original, replace: "console.log('invented');" } };
    }, { kind: 'stop', reason: 'bounded patch denied' }]);
    const env = await setup('t1-script-error', driver);
    try { await env.loop.run(); expect((await env.runtime.workspace('solver').read('solve.mjs')).toString()).toBe(original); }
    finally { await env.close(); }
  });
  it('rejects path escape through a symlink before reading outside material scope', async () => {
    const { driver } = scripted([{ kind: 'tool', tool: 'workspace.read', input: { path: 'escape' } }]);
    const env = await setup('t1-script-error', driver);
    await symlink(process.execPath, join(env.runtime.workspace('solver').path, 'escape'));
    try { expect((await env.loop.run()).status).toBe('blocked'); } finally { await env.close(); }
  });
  it('rejects gapped retained output rather than providing an incomplete transcript as evidence', async () => {
    const input = { command: [process.execPath, '-e', "process.stdout.write('x'.repeat(100000)); process.stderr.write('ERROR_TAIL')"], max_retained_bytes: 32 };
    const action: SolverAction = { kind: 'dispatch', hypothesis: declaration(), experiment: { ...plan(), procedure: [{ id: 'run', tool: 'job.run', input }] } };
    const { driver } = scripted([action, { kind: 'tool', tool: 'job.run', input, step_id: 'run' }]);
    const env = await setup('t1-script-error', driver);
    try {
      expect(await env.loop.run()).toMatchObject({ status: 'blocked', reason: expect.stringContaining('incomplete raw transcript') });
      expect(env.loop.hypotheses.experiment('e1').events[0]!.failure_code).toBe('blocked_data');
      expect(env.loop.hypotheses.hypothesis('decode').contradicting_refs).toHaveLength(0);
    } finally { await env.close(); }
  });
  it('feeds output larger than one read chunk and its actual error tail without truncation', async () => {
    const input = { command: [process.execPath, '-e', "process.stdout.write('x'.repeat(150000)); process.stderr.write('DIAGNOSTIC_TAIL'); process.exitCode=1"] };
    const { driver } = scripted([{ kind: 'dispatch', hypothesis: declaration(), experiment: { ...plan(), procedure: [{ id: 'run', tool: 'job.run', input }] } },
      { kind: 'tool', tool: 'job.run', input, step_id: 'run' }, request => {
        expect(request.observation!.raw).toHaveLength(150015);
        expect(request.observation!.raw).toContain('DIAGNOSTIC_TAIL');
        return { kind: 'stop', reason: 'raw observed' };
      }]);
    const env = await setup('t1-script-error', driver);
    try { expect((await env.loop.run()).status).toBe('no_route'); } finally { await env.close(); }
  });
  it.each(['model_transient', 'model_rate_limited'] as const)('counts %s attempts, respects Retry-After and stops at retry limit', async code => {
    let attempts = 0;
    const times: number[] = [];
    const driver: SolverDriver = { async decide() {
      attempts++; times.push(Date.now());
      throw new SolverFailure(code, 'raw provider failure', 15, { provenance: 'provider_reported', input_tokens: 3, output_tokens: 0, model_calls: 1 });
    } };
    const env = await setup('t1-script-error', driver, { maxModelRetries: 1 });
    try {
      expect((await env.loop.run()).status).toBe('resource_exhausted'); expect(attempts).toBe(2);
      expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(15);
      const events = env.state.events().filter(event => event.kind === 'solver.activity');
      expect(events.filter(event => event.activity === 'driver.call')).toHaveLength(2);
      expect(events.filter(event => event.activity === 'retry')).toHaveLength(1);
      expect(env.state.loadCheckpoint('run')!.usedBudget.maxObservableTokens).toBe(6);
    } finally { await env.close(); }
  });
  it('does not sleep or redispatch when Retry-After exceeds remaining deadline', async () => {
    let calls = 0;
    const env = await setup('t1-script-error', { async decide() { calls++; throw new SolverFailure('model_rate_limited', 'too many requests', 10000, { provenance: 'provider_reported', input_tokens: 1, output_tokens: 0, model_calls: 1 }); } });
    try { expect((await env.loop.run()).status).toBe('resource_exhausted'); expect(calls).toBe(1); } finally { await env.close(); }
  });
  it('fails closed on unavailable driver usage with exactly one canonical call record', async () => {
    let calls = 0;
    const env = await setup('t1-script-error', { async decide() { calls++; throw new Error('provider disconnected before usage receipt'); } });
    try {
      expect((await env.loop.run()).status).toBe('resource_exhausted'); expect(calls).toBe(1);
      expect(env.state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'driver.call')).toHaveLength(1);
    } finally { await env.close(); }
  });
  it('returns a fully retained output-parse error to the same driver within its local repair allowance', async () => {
    let calls = 0;
    const raw = 'invalid JSON response\n' + 'x'.repeat(70000) + '\nPARSER_ERROR_TAIL';
    const driver: SolverDriver = { async decide(request) {
      calls++;
      if (calls === 1) throw new SolverFailure('output_parse_error', raw, 0, { provenance: 'deterministic', input_tokens: 1, output_tokens: 1, model_calls: 0 });
      expect(request.observation!.raw).toBe(raw);
      expect(request.phase).toBe('solver');
      return { action: { kind: 'stop', reason: 'representation repaired' }, usage: { provenance: 'deterministic', input_tokens: 1, output_tokens: 1, model_calls: 0 } };
    } };
    const env = await setup('t1-script-error', driver);
    try {
      expect((await env.loop.run()).status).toBe('no_route');
      expect(env.state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'driver.call')).toHaveLength(2);
      expect(env.state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'strategy.request')).toHaveLength(0);
    } finally { await env.close(); }
  });
  it.each(['steps', 'tools', 'tokens'] as const)('honors the finite %s budget and writes a canonical checkpoint', async dimension => {
    const { driver } = scripted([dispatch(), { kind: 'tool', tool: 'workspace.read', input: { path: 'solve.mjs' } }, run]);
    const budget = { wallClockMs: 10000, maxSteps: dimension === 'steps' ? 1 : 10, maxToolJobs: dimension === 'tools' ? 1 : 10, maxObservableTokens: dimension === 'tokens' ? 1 : 100 };
    const env = await setup('t1-script-error', driver, { budget });
    try {
      expect((await env.loop.run()).status).toBe('resource_exhausted');
      expect(env.state.loadCheckpoint('run')!.nextAction).toContain('reprioritize');
    } finally { await env.close(); }
  });
  it('aborts a hanging driver at the wall deadline', async () => {
    let aborted = false;
    const env = await setup('t1-script-error', { async decide(_, control) { control.signal.addEventListener('abort', () => { aborted = true; }); return new Promise(() => {}); } }, { budget: { wallClockMs: 100, maxSteps: 10, maxToolJobs: 10, maxObservableTokens: 100 } });
    try { expect((await env.loop.run()).status).toBe('resource_exhausted'); expect(aborted).toBe(true); } finally { await env.close(); }
  });
  it('kills a local long-running process at the wall deadline and preserves its output', async () => {
    const command = [process.execPath, '-e', "process.stdout.write('started'); setInterval(()=>{},1000)"];
    const { driver } = scripted([dispatch('decode', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' }]);
    const env = await setup('t1-script-error', driver, { budget: { wallClockMs: 200, maxSteps: 10, maxToolJobs: 10, maxObservableTokens: 100 } });
    try {
      expect((await env.loop.run()).status).toBe('resource_exhausted');
      const receipt = env.loop.hypotheses.experiment('e-decode').events[0]!;
      expect(receipt.failure_code).toBe('resource_exhausted');
      expect((await env.artifacts.read(receipt.artifact_refs[0]!)).toString()).toBe('started');
    } finally { await env.close(); }
  });
  it('keeps model-visible challenge description free of fixture expected candidates', async () => {
    const { driver, requests } = scripted([{ kind: 'stop', reason: 'inspection only' }]);
    const env = await setup('t1-script-error', driver);
    try {
      await env.loop.run();
      expect(JSON.stringify(requests[0]!.challenge)).not.toContain('flag{');
      expect(await readFile(join(env.root, 'workspaces/solver/payload.txt'), 'utf8')).toMatch(/^[A-Za-z0-9+/=]+\s*$/);
    } finally { await env.close(); }
  });
});
