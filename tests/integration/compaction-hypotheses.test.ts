import { describe, expect, it } from 'vitest';
import { HypothesisManager } from '@ctf/supervisor';
import { experiment, ref, setup } from '../contract/hypothesis-fixtures.js';

function restore(set: ReturnType<typeof setup>, input: unknown = set.manager.exportSnapshot()) {
  return HypothesisManager.restoreSnapshot(input, { verifyArtifact: async () => true,
    resolveRuntimeEvent: async id => { const event = set.events.get(id); if (!event) throw new Error('missing original runtime event'); return event; },
    validateProgress: async () => { throw new Error('no new semantic authority was provided'); } });
}
describe('full HypothesisManager restart state', () => {
  it('preserves shared repair allowance, receipt deduplication, no-progress windows and Critic once-only state', async () => {
    const set = setup(); set.manager.startExperiment(experiment());
    await set.event('failed', 'e1', 'failure', 'output_parse_error');
    set.manager.recordActivity('e1', { kind: 'repair', repair_kind: 'tool', reason: 'correct original failed decoder' });
    await set.event('failed-again', 'e1', 'failure', 'output_parse_error');
    const running = await restore(set);
    expect(running.exportSnapshot()).toEqual(set.manager.exportSnapshot());
    expect(() => running.recordActivity('e1', { kind: 'repair', repair_kind: 'auxiliary', reason: 'try to reset allowance' })).toThrow(/budget/);
    await expect(running.recordRuntimeEvent('failed')).rejects.toThrow(/consumed/);
    set.manager.completeExperiment('e1'); expect(set.manager.finishWindow().consecutive_no_progress).toBe(1);
    set.manager.startExperiment(experiment('e2'), { reason: 'new local discriminator required', basis_refs: [ref('f')] });
    await set.event('done', 'e2'); set.manager.completeExperiment('e2');
    expect(set.manager.finishWindow().request).toBe('strategy');
    set.manager.strategyReplanned('change representation after two completed windows'); set.manager.requestRecoveryCritic('remaining ambiguity');
    const restored = await restore(set);
    expect(restored.exportSnapshot()).toEqual(set.manager.exportSnapshot());
    expect(restored.finishWindow()).toMatchObject({ completed_experiments: [], consecutive_no_progress: 2 });
    expect(() => restored.requestRecoveryCritic('again after restart')).toThrow(/at most once/);
  });

  it('retains progress reductions/evidence dedup and rejects changed/missing original receipts', async () => {
    const set = setup(); set.manager.startExperiment(experiment()); await set.event('done'); set.manager.completeExperiment('e1');
    await set.manager.recordProgress({ kind: 'search_space_reduction', experiment_id: 'e1', scope: 'candidate keys', measure: 'count', before: 100, after: 20, rationale: 'checked original output', evidence_refs: [ref('b')] }); set.manager.finishWindow();
    const restored = await restore(set);
    expect(restored.exportSnapshot()).toEqual(set.manager.exportSnapshot());
    const data = set.manager.exportSnapshot(); data.fingerprints = [];
    await expect(restore(set, data)).rejects.toThrow(/fingerprint history/);
    const original = set.events.get('done') as any; set.events.set('done', { ...original, artifact_refs: [ref('c')] });
    await expect(restore(set)).rejects.toThrow(/canonical runtime event mismatch/);
    set.events.delete('done'); await expect(restore(set)).rejects.toThrow(/missing original runtime/);
  });

  it('refuses to export a transition that is still awaiting a host receipt', async () => {
    let release: () => void = () => {};
    const set = setup({ resolveRuntimeEvent: async () => { await new Promise<void>(resolve => { release = resolve; }); throw new Error('receipt unavailable'); } });
    set.manager.startExperiment(experiment()); const pending = set.manager.recordRuntimeEvent('pending');
    expect(() => set.manager.exportSnapshot()).toThrow(/in-flight/);
    await Promise.resolve(); release(); await expect(pending).rejects.toThrow(/unavailable/);
    expect(() => set.manager.exportSnapshot()).not.toThrow();
  });
});
