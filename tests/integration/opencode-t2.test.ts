import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArtifactStore } from '@ctf/artifacts';
import { StateStore } from '@ctf/state';
import { ToolRuntime } from '@ctf/runtime';
import { ResponsibilityRegistry } from '@ctf/supervisor';
import { OpenCodeTask } from '../../apps/cli/src/commands/openCodeTask.js';

export const evaluation = {
  claim: 'The parser evaluates arithmetic expressions.', prediction: 'expression_evaluates',
  falsifier: 'A successful response returns the expression unchanged as literal data.',
  command: ['node', 'target.mjs', '7*6']
};
export const alternative = {
  claim: 'The independent payload contains an encoded result.', prediction: 'other',
  falsifier: 'The independent decoder cannot produce a result.', command: ['node', 'decode.mjs'],
  route_reason: 'The observed literal response rejects evaluation; investigate the separate payload instead.'
};

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'opencode-t2-host-'));
  const state = new StateStore(join(root, 'state'), 'run_t2');
  const artifacts = new ArtifactStore(join(root, 'artifacts-store'));
  const runtime = new ToolRuntime(artifacts, join(root, 'workspaces'), 'run_t2', 'challenge_t2');
  const deadline = new Date(Date.now() + 30000).toISOString();
  const registry = new ResponsibilityRegistry({ verifyArtifact: async ref => { await artifacts.verify(ref); return true; } });
  registry.createTask({ run_id: 'run_t2', challenge_id: 'challenge_t2', task_id: 'task_solver', attempt_id: 'attempt_t2',
    responsibility_set: ['strategy', 'domain_solver'], lease: { lease_id: 'lease_t2', expires_at: deadline } });
  registry.bindSession({ session_id: 'ses_t2', task_id: 'task_solver', context: registry.createReasoningContext() });
  runtime.registerTaskLease({ taskId: 'task_solver', sessionId: 'ses_t2', leaseId: 'lease_t2', expiresAt: deadline });
  for (const path of ['target.mjs', 'decode.mjs', 'payload.txt']) {
    await runtime.workspace('task_solver').patch(path, (await readFile(`fixtures/trajectories/t2-falsified/${path}`)).toString());
  }
  const task = new OpenCodeTask({ state, artifacts, runtime, registry, sessionID: 'ses_t2', deadline,
    budget: { wallClockMs: 30000, maxSteps: 100, maxToolJobs: 20, maxObservableTokens: 20000 },
    controller: new AbortController(), secrets: [], trajectory: 't2',
    resolveCandidate: async () => { throw new Error('direct host tests do not submit candidates'); } });
  cleanup.push(async () => { await runtime.dispose(); state.close(); await rm(root, { recursive: true, force: true }); });
  const call = (name: string, args: unknown) => task.tool(name, args) as Promise<Record<string, any>>;
  const deliver = (result: unknown, sessionID = 'ses_t2', type = 'tool') => task.control('ses_t2', 'model.input', [
    { info: { sessionID }, parts: [type === 'tool'
      ? { type, state: { status: 'completed', output: JSON.stringify(result) } }
      : { type: 'text', text: JSON.stringify(result) }] }
  ]);
  return { task, state, artifacts, call, deliver };
}

describe('trajectory 2 thin host evidence binding (no model)', () => {
  it('records successful execution as rejected mechanism, then preserves evidence and fingerprints', async () => {
    const f = await setup();
    expect((await f.call('hypothesis.propose', evaluation)).outcome).toBe('success');
    const probe = await f.call('job.run', { command: evaluation.command });
    expect(probe.exit_code).toBe(0);
    await f.deliver(probe);
    const conclusion = await f.call('hypothesis.conclude', { verdict: 'rejected', rationale: 'The literal value is 7*6, not an evaluated result.' });
    expect(conclusion.outcome).toBe('success');
    expect((await f.call('hypothesis.propose', alternative)).outcome).toBe('success');
    expect((await f.call('job.run', { command: alternative.command })).stdout).toBe('flag{changed_route}\n');
    f.task.finish();
    const checkpoint = f.state.loadCheckpoint('run_t2')!;
    expect(checkpoint.rejectedFingerprints).toHaveLength(1);
    const final = f.state.events().at(-1) as any;
    const snapshot = JSON.parse((await f.artifacts.read(final.data.hypothesis_snapshot_ref)).toString());
    expect(snapshot.hypotheses[0]).toMatchObject({ claim: evaluation.claim, state: 'rejected', contradicting_refs: [expect.objectContaining({ hash: expect.any(String) })] });
    expect(snapshot.experiments[0]).toMatchObject({ status: 'succeeded', conclusion: { verdict: 'rejected' } });
    expect(snapshot.experiments[0].plan.procedure[0].input.command).toEqual(evaluation.command);
    expect(snapshot.experiments[0].fingerprint).toBe(checkpoint.rejectedFingerprints[0]);
    expect(f.state.events().some((event: any) => event.activity === 'strategy.switch' && event.data.rationale === alternative.route_reason)).toBe(true);
  });

  it.each(['missing', 'modified', 'text', 'foreign', 'forged_receipt', 'incomplete'])('does not accept %s raw-output delivery as proof', async kind => {
    const f = await setup();
    await f.call('hypothesis.propose', evaluation);
    const probe = await f.call('job.run', { command: evaluation.command });
    if (kind === 'modified') await f.deliver({ ...probe, stdout: 'different raw bytes' });
    if (kind === 'forged_receipt') await f.deliver({ ...probe, receipt_id: 'receipt_foreign' });
    if (kind === 'incomplete') await f.deliver({ ...probe, complete: false });
    if (kind === 'text') await f.deliver(probe, 'ses_t2', 'text');
    if (kind === 'foreign') await expect(f.deliver(probe, 'ses_foreign')).rejects.toThrow(/session/);
    const result = await f.call('hypothesis.conclude', { verdict: 'rejected', rationale: 'The parser returns a literal.' });
    expect(result.outcome).toBe('failure');
    expect(result.error).toMatch(/delivered|input/);
    expect(f.state.events().some((event: any) => event.activity === 'hypothesis.conclusion')).toBe(false);
  });

  it('cannot reject a mechanism based on a failed tool execution', async () => {
    const f = await setup();
    await f.call('hypothesis.propose', { ...evaluation, command: ['node', 'target.mjs'] });
    const result = await f.call('job.run', { command: ['node', 'target.mjs'] });
    expect(result.exit_code).not.toBe(0); await f.deliver(result);
    const conclusion = await f.call('hypothesis.conclude', { verdict: 'rejected', rationale: 'This tool error disproves evaluation.' });
    expect(conclusion.outcome).toBe('failure');
    expect(conclusion.error).toMatch(/mechanism|successful/);
  });

  it.each(['(7*6)', '((7)*(6))', '(11 - (3 + 2))'])('accepts a valid parenthesized discriminator: %s', async expression => {
    const f = await setup();
    const command = ['node', 'target.mjs', expression];
    await f.call('hypothesis.propose', { ...evaluation, command });
    const probe = await f.call('job.run', { command });
    expect(probe.exit_code).toBe(0); await f.deliver(probe);
    const conclusion = await f.call('hypothesis.conclude', { verdict: 'rejected', rationale: `The successful output preserves ${expression} literally.` });
    expect(conclusion.outcome, conclusion.error).toBe('success');
    expect((await f.call('hypothesis.propose', alternative)).outcome).toBe('success');
    expect((await f.call('job.run', { command: alternative.command })).stdout).toBe('flag{changed_route}\n');
  });

  it.each(['(7*6', '7**)', 'process.exit(99)'])('does not treat invalid or non-arithmetic input as a discriminator: %s', async expression => {
    const f = await setup();
    const command = ['node', 'target.mjs', expression];
    await f.call('hypothesis.propose', { ...evaluation, command });
    const probe = await f.call('job.run', { command }); await f.deliver(probe);
    const conclusion = await f.call('hypothesis.conclude', { verdict: 'rejected', rationale: 'The output is literal.' });
    expect(conclusion.outcome).toBe('failure');
    expect(conclusion.error).toMatch(/discriminator|prediction/);
    expect(f.state.events().some((event: any) => event.activity === 'hypothesis.conclusion')).toBe(false);
  });

  it('validates every input session before committing any raw-delivery claim', async () => {
    const f = await setup(); await f.call('hypothesis.propose', evaluation);
    const probe = await f.call('job.run', { command: evaluation.command });
    const part = { type: 'tool', state: { status: 'completed', output: JSON.stringify(probe) } };
    await expect(f.task.control('ses_t2', 'model.input', [
      { info: { sessionID: 'ses_t2' }, parts: [part] }, { info: { sessionID: 'ses_foreign' }, parts: [part] }
    ])).rejects.toThrow(/session/);
    expect((await f.call('hypothesis.conclude', { verdict: 'rejected', rationale: 'literal' })).error).toMatch(/delivered/);
  });

  it.each(['runId', 'challengeId', 'taskId', 'sessionId'] as const)('does not consume a canonical receipt moved to another %s', async field => {
    const f = await setup(); await f.call('hypothesis.propose', evaluation);
    const append = f.state.appendEvent.bind(f.state);
    const spy = vi.spyOn(f.state, 'appendEvent').mockImplementation(event => {
      if (event.kind === 'solver.activity' && event.activity === 'tool.result' && event.data.tool === 'job.run' && event.data.receipt) {
        return append({ ...event, [field]: 'foreign_identity' });
      }
      return append(event);
    });
    try {
      const result = await f.call('job.run', { command: evaluation.command });
      expect(result.outcome).toBe('failure');
      // A foreign run is rejected even earlier by SQLite's run FK; other
      // bindings reach the host resolver and must not be consumed there.
      expect(result.error).toMatch(field === 'runId' ? /FOREIGN KEY constraint failed/ : /canonical runtime receipt missing/);
      expect(f.state.events().some((event: any) => event.activity === 'experiment.completed')).toBe(false);
    } finally { spy.mockRestore(); }
  });

  it('rejects an unsupported semantic conclusion even with delivered successful output', async () => {
    const f = await setup();
    await f.call('hypothesis.propose', { ...alternative, route_reason: undefined });
    const result = await f.call('job.run', { command: alternative.command }); await f.deliver(result);
    const conclusion = await f.call('hypothesis.conclude', { verdict: 'rejected', rationale: 'A flag output proves expression evaluation is false.' });
    expect(conclusion.outcome).toBe('failure');
    expect(conclusion.error).toMatch(/discriminator|prediction/);
  });

  it('binds the actual job to the prior proposal and refuses a post-hoc replacement', async () => {
    const f = await setup();
    await f.call('hypothesis.propose', evaluation);
    const mismatch = await f.call('job.run', { command: alternative.command });
    expect(mismatch.outcome).toBe('failure');
    expect(mismatch.error).toMatch(/declared|proposal/);
    await f.call('job.run', { command: evaluation.command });
    const replacement = await f.call('hypothesis.propose', alternative);
    expect(replacement.outcome).toBe('failure');
    expect(replacement.error).toMatch(/conclu/);
  });

  it('rejects forged receipt/identity fields and duplicate experiments under new host IDs', async () => {
    const f = await setup();
    expect((await f.call('hypothesis.propose', { ...evaluation, id: 'forged' })).outcome).toBe('failure');
    await f.call('hypothesis.propose', evaluation);
    const probe = await f.call('job.run', { command: evaluation.command }); await f.deliver(probe);
    expect((await f.call('hypothesis.conclude', { verdict: 'rejected', rationale: 'literal', receipt_id: 'foreign' })).outcome).toBe('failure');
    expect((await f.call('hypothesis.conclude', { verdict: 'rejected', rationale: 'Actual literal output falsifies evaluation.' })).outcome).toBe('success');
    await f.call('hypothesis.propose', { ...evaluation, claim: 'Renamed claim', command: ['node', './target.mjs', '7*6'], route_reason: 'Try the same input again.' });
    const repeat = await f.call('job.run', { command: ['node', './target.mjs', '7*6'] });
    expect(repeat.outcome).toBe('failure'); expect(repeat.error).toMatch(/fingerprint/);
  });

  it('does not accept a candidate without successful output or relax the T1 patch guard', async () => {
    const f = await setup();
    expect((await f.call('candidate.register', { value: 'flag{changed_route}' })).error).toMatch(/successful/);
    await f.call('hypothesis.propose', evaluation);
    const probe = await f.call('job.run', { command: evaluation.command }); await f.deliver(probe);
    expect((await f.call('workspace.patch', { path: 'target.mjs', find: "mode: 'literal'", replace: "mode: 'evaluated'" })).error).toMatch(/stderr/);
  });
});
