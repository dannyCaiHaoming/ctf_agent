import { describe, expect, it } from 'vitest';
import { aggregateM1RunMetrics } from '@ctf/reporting';
import { dispatch, scripted, setup } from '../integration/solver-loop-fixtures.js';

describe('canonical M1 run metrics', () => {
  it('recomputes event-backed solver, usage, and tool wait metrics while exposing missing sources', async () => {
    const command = [process.execPath, '-e', 'process.stdout.write("flag{sample}\\n")'];
    const { driver } = scripted([dispatch('decode', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs })]);
    const env = await setup('t2-falsified', driver);
    try {
      await env.loop.run();
      const metrics = aggregateM1RunMetrics(env.state.events());
      expect(metrics).toMatchObject({ complete: true, timeToFirstExperimentMs: { state: 'observed' },
        toolActions: { state: 'observed', value: { count: 1, maximumConsecutive: 1 } },
        toolErrors: { state: 'observed', value: 0 }, repairAttempts: { state: 'observed', value: 0 },
        strategyFallbacks: { state: 'observed', value: 0 }, toolWaitMs: { state: 'observed' },
        resultToNextDriverMs: { state: 'observed' }, repairSuccesses: { state: 'unavailable' },
        candidateLifecycleMs: { state: 'observed', value: { engineeringMs: { state: 'not_observed' } } }, artifactPublishAndHashIo: { state: 'unavailable' },
        compactionRecovery: { state: 'unavailable' } });
      expect(metrics.modelUsageByPhase.solver).toMatchObject({ state: 'observed', value: { calls: 3, modelCalls: 0, provenance: 'deterministic' } });
    } finally { await env.close(); }
  });

  it('distinguishes a completed run with no experiment from an incomplete event stream', async () => {
    const { driver } = scripted([{ kind: 'stop', reason: 'no route' }]);
    const env = await setup('t2-falsified', driver);
    try {
      await env.loop.run();
      const events = env.state.events();
      expect(aggregateM1RunMetrics(events).timeToFirstExperimentMs.state).toBe('not_observed');
      const incomplete = aggregateM1RunMetrics(events.filter(event => !(event.kind === 'solver.activity' && event.activity === 'checkpoint')));
      expect(incomplete.complete).toBe(false);
      expect(incomplete.timeToFirstExperimentMs.state).toBe('unavailable');
      expect(incomplete.toolErrors.state).toBe('unavailable');
    } finally { await env.close(); }
  });
});
