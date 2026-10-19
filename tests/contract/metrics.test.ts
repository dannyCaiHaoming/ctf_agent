import { describe, expect, it } from 'vitest';
import { EventDeltaSchema, type EventDelta } from '@ctf/contracts';
import { aggregateM1RunMetrics } from '@ctf/reporting';

// Frozen projection contract; these fixtures do not claim current OpenCode metric integration.
function event(activity: string, ms: number, data: Record<string, unknown> = {}): EventDelta {
  return EventDeltaSchema.parse({ kind: 'solver.activity', runId: 'run', challengeId: 'challenge', taskId: 'solver',
    sessionId: 'fixture-session', attemptId: 'attempt', activity, data, at: new Date(ms).toISOString() });
}
const call = (ms: number) => event('driver.call', ms, { phase: 'solver',
  usage: { provenance: 'deterministic', input_tokens: 1, output_tokens: 1, model_calls: 0 } });

describe('frozen canonical metrics projection, independent of the retired model loop', () => {
  it('recomputes event-backed usage and exact durations while exposing missing sources', () => {
    const events = [event('started', 0), call(1), event('experiment.started', 2), call(3),
      event('tool.started', 4, { receipt_id: 'r1', tool: 'job.run' }),
      event('tool.result', 9, { receipt_id: 'r1', tool: 'job.run', observation: { outcome: 'success' } }),
      call(11), event('checkpoint', 12)];
    const metrics = aggregateM1RunMetrics(events);
    expect(metrics).toMatchObject({ complete: true, timeToFirstExperimentMs: { state: 'observed', value: 2 },
      toolActions: { state: 'observed', value: { count: 1, maximumConsecutive: 1 } },
      toolErrors: { state: 'observed', value: 0 }, repairAttempts: { state: 'observed', value: 0 },
      strategyFallbacks: { state: 'observed', value: 0 }, toolWaitMs: { state: 'observed', value: { total: 5, byTool: { 'job.run': 5 } } },
      resultToNextDriverMs: { state: 'observed', value: [2] }, repairSuccesses: { state: 'unavailable' },
      candidateLifecycleMs: { state: 'observed', value: { engineeringMs: { state: 'not_observed' } } },
      artifactPublishAndHashIo: { state: 'unavailable' }, compactionRecovery: { state: 'unavailable' } });
    expect(metrics.modelUsageByPhase.solver).toEqual({ state: 'observed', value: {
      calls: 3, modelCalls: 0, inputTokens: 3, outputTokens: 3, provenance: 'deterministic' } });
    expect(aggregateM1RunMetrics(events.filter(e => !(e.kind === 'solver.activity' && e.activity === 'tool.started'))).toolWaitMs.state).toBe('unavailable');
  });

  it('distinguishes an empty completed run from incomplete evidence and missing usage', () => {
    const events = [event('started', 0), event('checkpoint', 10)];
    expect(aggregateM1RunMetrics(events).timeToFirstExperimentMs.state).toBe('not_observed');
    const incomplete = aggregateM1RunMetrics(events.slice(0, 1));
    expect(incomplete.complete).toBe(false);
    expect(incomplete.timeToFirstExperimentMs.state).toBe('unavailable');
    expect(incomplete.toolErrors.state).toBe('unavailable');
    expect(aggregateM1RunMetrics([events[0]!, event('driver.call', 1, { phase: 'solver' }), events[1]!])
      .modelUsageByPhase.solver?.state).toBe('unavailable');
  });

  it('retains two-candidate lifecycle timing without running a second Agent framework', () => {
    const events: EventDelta[] = [event('started', 0)];
    for (const [index, id] of ['first', 'second'].entries()) {
      const at = 10 + index * 20;
      const stage = (ms: number, name: string, state: string) => event('candidate.stage', ms, { candidate_id: id, stage: name, state });
      events.push(stage(at, 'candidate', 'produced'), stage(at + 1, 'engineering', 'started'), stage(at + 3, 'engineering', 'completed'),
        stage(at + 4, 'verification', 'started'), stage(at + 7, 'verification', 'completed'),
        stage(at + 8, 'oracle_submit', 'started'), stage(at + 12, 'oracle_submit', 'completed'),
        event('candidate', at + 13, { candidate_id: id, status: index ? 'accepted' : 'partial', authoritative: true }));
    }
    events.push(event('checkpoint', 50));
    expect(aggregateM1RunMetrics(events).candidateLifecycleMs).toMatchObject({ state: 'observed', value: {
      engineeringMs: { state: 'observed', value: [2, 2] }, verificationMs: { state: 'observed', value: [3, 3] },
      oracleSubmitMs: { state: 'observed', value: [4, 4] }, candidateToAcceptanceMs: { state: 'observed', value: [13, 13] }
    } });
  });
});
