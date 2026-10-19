import { describe, expect, it, vi } from 'vitest';
import { SolverFailure, type SolverAction } from '@ctf/supervisor';
import { dispatch, run, scripted, setup } from './solver-loop-fixtures.js';

const patch: SolverAction = { kind: 'tool', tool: 'workspace.patch', input: { path: 'solve.mjs', find: ".toString('utf8');", replace: ".toString('utf8'));" } };
const malformed = { kind: 'invalid' } as unknown as SolverAction;

describe('Task 3 review repair and acceptance boundaries', () => {
  it('normalizes the common node alias to the host executable before job authorization', async () => {
    const command = ['node', 'solve.mjs'];
    const authorized: string[][] = [];
    const { driver } = scripted([dispatch('decode', command, 0), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      { kind: 'stop', reason: 'normalized command observed' }]);
    const env = await setup('t1-script-error', driver, {
      authorizeCommand: candidate => {
        authorized.push([...candidate]);
        if (candidate[0] !== process.execPath) throw new Error('local node fixture commands only');
      }
    });
    try {
      await env.loop.run();
      expect(authorized).toEqual([[process.execPath, 'solve.mjs']]);
    } finally { await env.close(); }
  });
  it('repairs one missing positional argument in the same admitted step and reruns host command policy', async () => {
    const original = [process.execPath, 'target.mjs'];
    const corrected = [...original, '2+2'];
    const authorized: string[][] = [];
    const { driver, requests } = scripted([
      dispatch('expression', original), { kind: 'tool', tool: 'job.run', input: { command: original }, step_id: 'run' },
      request => { expect(request.observation!.raw).toContain('expression argument required'); return { kind: 'tool', tool: 'job.run', input: { command: corrected }, step_id: 'run' }; },
      { kind: 'stop', reason: 'corrected local invocation observed' }
    ]);
    const env = await setup('t2-falsified', driver, { authorizeCommand: command => { authorized.push([...command]); } });
    try {
      await env.loop.run();
      const experiment = env.loop.hypotheses.experiment('e-expression');
      expect(experiment.status).toBe('succeeded');
      expect(experiment.plan.procedure[0]!.input).toEqual({ command: original });
      expect(experiment.events).toHaveLength(2);
      expect(new Set(experiment.events.map(event => event.fingerprint)).size).toBe(1);
      expect(authorized).toEqual([original, corrected]);
      expect(requests.every(request => request.phase === 'solver')).toBe(true);
      const repair = env.state.events().find(event => event.kind === 'solver.activity' && event.activity === 'repair');
      expect(repair).toMatchObject({ data: { original_input: { command: original }, corrected_input: { command: corrected }, failed_receipt_id: experiment.events[0]!.id, failure_code: 'tool_invocation_error' } });
    } finally { await env.close(); }
  });
  it('shares the single allowance across malformed representation and failed-step correction', async () => {
    const { driver } = scripted([dispatch(), run, malformed, patch,
      request => request.phase === 'strategy' ? { kind: 'stop', reason: 'one shared repair spent' } : run,
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs })]);
    const env = await setup('t1-script-error', driver);
    try {
      const result = await env.loop.run();
      expect(result.status).toBe('no_route');
      expect(env.loop.hypotheses.experiment('e-decode').activities.filter(activity => activity.kind === 'repair')).toHaveLength(1);
      const events = env.state.events().filter(event => event.kind === 'solver.activity');
      expect(events.filter(event => event.activity === 'repair')).toHaveLength(1);
      expect(events.filter(event => event.activity === 'tool.result' && event.data.tool === 'job.run')).toHaveLength(1);
      expect((await env.runtime.workspace('solver').read('solve.mjs')).toString()).toContain(".toString('utf8');");
    } finally { await env.close(); }
  });
  it('binds a syntax repair to the original failed receipt despite a successful patch observation', async () => {
    const { driver } = scripted([dispatch(), run, patch, run, { kind: 'stop', reason: 'repaired' }]);
    const env = await setup('t1-script-error', driver);
    try {
      await env.loop.run();
      const failed = env.loop.hypotheses.experiment('e-decode').events[0]!;
      const repair = env.state.events().find(event => event.kind === 'solver.activity' && event.activity === 'repair');
      expect(repair).toMatchObject({ data: { failure_code: 'tool_invocation_error', failed_receipt_id: failed.id, raw_refs: failed.artifact_refs } });
    } finally { await env.close(); }
  });
  it.each(['revocation', 'deadline'] as const)('rejects candidate acceptance after %s during real artifact verification', async failure => {
    const command = [process.execPath, 'decode.mjs'];
    let arm = false;
    const { driver } = scripted([dispatch('decode', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => { arm = true; return { kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs }; }]);
    const env = await setup('t2-falsified', driver);
    const verify = env.artifacts.verify.bind(env.artifacts);
    vi.spyOn(env.artifacts, 'verify').mockImplementation(async ref => {
      await verify(ref);
      if (arm) { arm = false; if (failure === 'revocation') env.registry.revokeLease('solver', 'lease'); else vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20000); }
      return true;
    });
    try {
      expect((await env.loop.run()).status).toBe(failure === 'revocation' ? 'blocked' : 'resource_exhausted');
      expect(env.state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'candidate')).toHaveLength(0);
    } finally { vi.restoreAllMocks(); await env.close(); }
  });
  it('prevents semantic state mutation when authority is revoked during the trusted semantic check', async () => {
    const command = [process.execPath, 'target.mjs', '2+2'];
    const { driver } = scripted([dispatch('expression', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => ({ kind: 'conclude', verdict: 'rejected', rationale: 'actual literal parser response', evidence_refs: request.observation!.artifact_refs })]);
    const env = await setup('t2-falsified', driver, { validateProgress: async () => {
      env.registry.revokeLease('solver', 'lease');
      return { substantiation: 'literal response after independently verified evidence' };
    } });
    try {
      expect((await env.loop.run()).status).toBe('blocked');
      expect(env.loop.hypotheses.hypothesis('expression').state).toBe('testing');
      expect(env.loop.hypotheses.progressRecords()).toHaveLength(0);
      expect(env.loop.hypotheses.experiment('e-expression').conclusion).toBe(null);
    } finally { await env.close(); }
  });
  it.each([
    [process.execPath, 'decode.mjs', '2+2'],
    [process.execPath, 'target.mjs', '--eval=arbitrary'],
    [process.execPath, 'target.mjs', '2+2', 'another-argument'],
    ['other-executable', 'target.mjs', '2+2']
  ])('rejects route/method or unbounded argv replacement as local parameter repair: %j', async (...corrected) => {
    const original = [process.execPath, 'target.mjs'];
    const authorized: string[][] = [];
    const { driver } = scripted([dispatch('expression', original), { kind: 'tool', tool: 'job.run', input: { command: original }, step_id: 'run' },
      { kind: 'tool', tool: 'job.run', input: { command: corrected }, step_id: 'run' }, { kind: 'stop', reason: 'invalid correction denied' }]);
    const env = await setup('t2-falsified', driver, { authorizeCommand: command => { authorized.push([...command]); } });
    try {
      await env.loop.run(); expect(authorized).toEqual([original]);
      expect(env.loop.hypotheses.experiment('e-expression').events).toHaveLength(1);
    } finally { await env.close(); }
  });
  it('enforces host policy again on an otherwise bounded corrected invocation', async () => {
    const original = [process.execPath, 'target.mjs']; const corrected = [...original, '2+2'];
    const authorized: string[][] = [];
    const { driver } = scripted([dispatch('expression', original), { kind: 'tool', tool: 'job.run', input: { command: original }, step_id: 'run' },
      { kind: 'tool', tool: 'job.run', input: { command: corrected }, step_id: 'run' }, { kind: 'stop', reason: 'scope_denied observed after bounded repair' }]);
    const env = await setup('t2-falsified', driver, { authorizeCommand: command => {
      authorized.push([...command]); if (command.length === 3) throw new SolverFailure('scope_denied', 'corrected argument is outside host policy');
    } });
    try {
      expect((await env.loop.run()).status).toBe('no_route'); expect(authorized).toEqual([original, corrected]);
      expect(env.loop.hypotheses.experiment('e-expression').events[1]!.failure_code).toBe('scope_denied');
    } finally { await env.close(); }
  });
  it('does not let an auxiliary repair authorize a retry of the failed procedure', async () => {
    const { driver } = scripted([dispatch(), run, { kind: 'tool', tool: 'workspace.read', input: { path: 'missing-material' } }, patch,
      request => request.phase === 'strategy' ? { kind: 'stop', reason: 'shared allowance consumed by auxiliary error' } : run]);
    const env = await setup('t1-script-error', driver);
    try {
      expect((await env.loop.run()).status).toBe('no_route');
      expect(env.loop.hypotheses.experiment('e-decode').events).toHaveLength(1);
      expect(env.loop.hypotheses.experiment('e-decode').activities).toEqual([{ kind: 'repair', repair_kind: 'auxiliary', reason: 'auxiliary correction using retained raw failure' }]);
    } finally { await env.close(); }
  });
  it('rechecks candidate authority after awaited value publication before canonical acceptance', async () => {
    const command = [process.execPath, 'decode.mjs']; let arm = false;
    const { driver } = scripted([dispatch('decode', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => { arm = true; return { kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs }; }]);
    const env = await setup('t2-falsified', driver);
    const publish = env.artifacts.publish.bind(env.artifacts);
    vi.spyOn(env.artifacts, 'publish').mockImplementation(async bytes => {
      const ref = await publish(bytes); if (arm) { arm = false; env.registry.revokeLease('solver', 'lease'); } return ref;
    });
    try {
      expect((await env.loop.run()).status).toBe('blocked');
      expect(env.state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'candidate')).toHaveLength(0);
    } finally { vi.restoreAllMocks(); await env.close(); }
  });
  it('does not mutate semantic progress or conclusions after a deadline crosses during substantiation', async () => {
    const command = [process.execPath, 'target.mjs', '2+2'];
    const { driver } = scripted([dispatch('expression', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => ({ kind: 'conclude', verdict: 'rejected', rationale: 'literal output', evidence_refs: request.observation!.artifact_refs })]);
    const env = await setup('t2-falsified', driver, { validateProgress: async () => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 20000); return { substantiation: 'actual literal response' };
    } });
    try {
      expect((await env.loop.run()).status).toBe('resource_exhausted');
      expect(env.loop.hypotheses.progressRecords()).toHaveLength(0);
      expect(env.loop.hypotheses.experiment('e-expression').conclusion).toBe(null);
    } finally { vi.restoreAllMocks(); await env.close(); }
  });
});
