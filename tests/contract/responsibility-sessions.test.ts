import { describe, expect, it, vi } from 'vitest';
import { ResponsibilityRegistry } from '../../packages/supervisor/src/index.js';

const ref = { hash: 'a'.repeat(64), size: 3, path: '/artifacts/a' };
const payload = () => ({ responsibility: 'domain_solver', revision: 0, consumed_snapshot_sequence: 0, input_refs: [ref], dependency_versions: [], status: 'completed', outputs: [{ kind: 'decision', statement: 'Probe', basis_refs: [ref] }], observation_refs: [ref], evidence_refs: [], assumptions: [], rejected_assumptions: [], unresolved_questions: [], next_action: 'Replay', failure_code: null, actual_cost: { wall_clock_ms: 0, model_calls: 0, tool_jobs: 0, observable_tokens: 0, monetary_cost: 0 } });
const task = (task_id = 'solver', responsibility_set = ['target_recon', 'strategy', 'domain_solver']) => ({ task_id, attempt_id: 'attempt', run_id: 'run', challenge_id: 'challenge', responsibility_set, lease: { lease_id: `${task_id}-lease`, expires_at: '2030-01-01T00:00:00.000Z' } });
function setup() {
  const verifyArtifact = vi.fn(async () => true as const);
  const registry = new ResponsibilityRegistry({ verifyArtifact, now: () => 1000 });
  registry.createTask(task());
  const context = registry.createReasoningContext();
  registry.bindSession({ session_id: 'solver-session', task_id: 'solver', context });
  return { registry, context, verifyArtifact };
}
const host = { session_id: 'solver-session', lease_id: 'solver-lease' };

describe('supervisor task/session responsibilities', () => {
  it('injects identity and permits multiple authorized responsibilities in one session', async () => {
    const { registry, verifyArtifact } = setup();
    for (const responsibility of ['target_recon', 'strategy', 'domain_solver']) {
      const result = await registry.submit(host, { ...payload(), responsibility });
      expect(result).toMatchObject({ task_id: 'solver', attempt_id: 'attempt', responsibility });
      expect(Object.isFrozen(result.outputs)).toBe(true);
    }
    expect(verifyArtifact).toHaveBeenCalled();
  });
  it('rejects out-of-set submission and every model-supplied identity', async () => {
    const { registry } = setup();
    await expect(registry.submit(host, { ...payload(), responsibility: 'verification' })).rejects.toThrow(/responsibility/);
    for (const key of ['task_id', 'attempt_id', 'challenge_id', 'run_id', 'session_id', 'responsibility_set']) {
      await expect(registry.submit(host, { ...payload(), [key]: 'forged' })).rejects.toThrow();
    }
    await expect(registry.submit({ ...host, session_id: 'unbound' }, payload())).rejects.toThrow(/unbound/);
    await expect(registry.submit({ ...host, lease_id: 'wrong' }, payload())).rejects.toThrow(/lease/);
  });
  it('cannot expand or reassign tasks/sessions, including mutation through returned objects', () => {
    const { registry, context } = setup();
    expect(() => registry.createTask({ ...task(), responsibility_set: ['verification'] })).toThrow(/exists/);
    expect(() => registry.createTask({ ...task(), challenge_id: 'other' })).toThrow(/exists/);
    registry.createTask(task('other'));
    expect(() => registry.bindSession({ session_id: 'solver-session', task_id: 'other', context })).toThrow(/exists/);
    const binding = registry.binding('solver-session');
    expect(() => (binding.responsibility_set as string[]).push('verification')).toThrow();
    expect(() => Object.assign(binding, { challenge_id: 'other', task_id: 'other', lease_id: 'wrong' })).toThrow();
    expect(registry.binding('solver-session')).toMatchObject({ run_id: 'run', challenge_id: 'challenge', task_id: 'solver', responsibility_set: ['target_recon', 'strategy', 'domain_solver'], lease_id: 'solver-lease' });
  });
  it('copies task input before storing it', () => {
    const registry = new ResponsibilityRegistry({ verifyArtifact: async () => true, now: () => 1000 });
    const input = task();
    registry.createTask(input);
    input.challenge_id = 'forged';
    input.responsibility_set.push('verification');
    input.lease.lease_id = 'forged';
    registry.bindSession({ session_id: 's', task_id: 'solver', context: registry.createReasoningContext() });
    expect(registry.binding('s')).toMatchObject({ challenge_id: 'challenge', lease_id: 'solver-lease', responsibility_set: ['target_recon', 'strategy', 'domain_solver'] });
  });
  it.each([false, true])('rejects shared Solver/Verifier context in either creation order (verifier first: %s)', verifierFirst => {
    const registry = new ResponsibilityRegistry({ verifyArtifact: async () => true, now: () => 1000 });
    registry.createTask(task());
    registry.createTask(task('verifier', ['verification']));
    const context = registry.createReasoningContext();
    const first = verifierFirst ? 'verifier' : 'solver';
    const second = verifierFirst ? 'solver' : 'verifier';
    registry.bindSession({ session_id: 's1', task_id: first, context });
    expect(() => registry.bindSession({ session_id: 's2', task_id: second, context })).toThrow(/context/);
    registry.bindSession({ session_id: 's3', task_id: second, context: registry.createReasoningContext() });
    const reused = registry.contextForSession('s3');
    expect(() => registry.bindSession({ session_id: 'new-session-of-first-task', task_id: first, context: reused })).toThrow(/context/);
  });
  it('rejects forged context handles and handles issued by another registry', () => {
    const { registry, context } = setup();
    expect(() => registry.bindSession({ session_id: 'forged', task_id: 'solver', context: { ...context } })).toThrow(/context/);
    const other = new ResponsibilityRegistry({ verifyArtifact: async () => true });
    expect(() => registry.bindSession({ session_id: 'foreign', task_id: 'solver', context: other.createReasoningContext() })).toThrow(/context/);
  });
  it('rejects verification mixed with other task permissions and malformed binding fields', () => {
    const { registry } = setup();
    expect(() => registry.createTask(task('bad', ['verification', 'domain_solver']))).toThrow();
    expect(() => registry.createTask({ ...task('bad'), attempt_id: '' })).toThrow();
    expect(() => registry.bindSession({ session_id: '', task_id: 'solver', context: registry.createReasoningContext() })).toThrow();
    const extraIdentity = { session_id: 'forged-binding', task_id: 'solver', context: registry.createReasoningContext(), challenge_id: 'other-challenge' };
    expect(() => registry.bindSession(extraIdentity)).toThrow();
  });
  it('renews only the bound lease and fails closed after expiry or revocation', async () => {
    let now = 1000;
    const registry = new ResponsibilityRegistry({ verifyArtifact: async () => true, now: () => now });
    registry.createTask({ ...task(), lease: { lease_id: 'solver-lease', expires_at: new Date(2000).toISOString() } });
    registry.bindSession({ session_id: host.session_id, task_id: 'solver', context: registry.createReasoningContext() });
    expect(() => registry.renewLease('solver', 'wrong', new Date(4000).toISOString())).toThrow(/lease/);
    registry.renewLease('solver', host.lease_id, new Date(3000).toISOString());
    now = 2500;
    await expect(registry.submit(host, payload())).resolves.toMatchObject({ task_id: 'solver' });
    now = 3000;
    await expect(registry.submit(host, payload())).rejects.toThrow(/expired/);
    expect(() => registry.renewLease('solver', host.lease_id, new Date(4000).toISOString())).toThrow(/expired/);
    now = 2500;
    registry.revokeLease('solver', host.lease_id);
    await expect(registry.submit(host, payload())).rejects.toThrow(/revoked/);
  });
  it('validates immutable bytes and rechecks the lease after asynchronous artifact validation', async () => {
    const { registry, verifyArtifact } = setup();
    verifyArtifact.mockRejectedValueOnce(new Error('artifact hash mismatch'));
    await expect(registry.submit(host, payload())).rejects.toThrow(/hash mismatch/);
    verifyArtifact.mockImplementationOnce(async () => { registry.revokeLease('solver', host.lease_id); return true; });
    await expect(registry.submit(host, payload())).rejects.toThrow(/revoked/);
  });
});
