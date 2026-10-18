import { describe, expect, it } from 'vitest';
import type { SolverAction } from '@ctf/supervisor';
import { declaration, dispatch, plan, scripted, setup } from './solver-loop-fixtures.js';

describe('host abandonment after representation repair exhaustion', () => {
  it.each([false, true])('allows Strategy to change route without inventing runtime activity (one real step: %s)', async started => {
    const first = [process.execPath, 'target.mjs', '2+2'];
    const second = [process.execPath, 'decode.mjs'];
    const malformed = { kind: 'unrecognized-action', raw: 'malformed representation tail' } as unknown as SolverAction;
    const firstPlan = { ...plan('old-experiment', 'old', first), procedure: [
      { id: 'first', tool: 'job.run', input: { command: first } },
      { id: 'second', tool: 'job.run', input: { command: second } }
    ] };
    const { driver, requests } = scripted([
      { kind: 'dispatch', hypothesis: declaration('old'), experiment: firstPlan },
      ...(started ? [{ kind: 'tool' as const, tool: 'job.run' as const, input: { command: first }, step_id: 'first' }] : []),
      malformed, malformed,
      request => { expect(request.phase).toBe('strategy'); return dispatch('decode', second); },
      { kind: 'tool', tool: 'job.run', input: { command: second }, step_id: 'run' },
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs })
    ]);
    const env = await setup('t2-falsified', driver);
    try {
      expect((await env.loop.run()).status).toBe('candidate_only');
      const abandoned = env.loop.hypotheses.experiment('old-experiment');
      expect(abandoned.status).toBe('abandoned');
      expect(abandoned.events).toHaveLength(started ? 1 : 0);
      expect(abandoned.conclusion).toMatchObject({ verdict: 'inconclusive', rationale: 'representation repair budget exhausted' });
      expect(() => env.loop.hypotheses.completeExperiment('old-experiment')).toThrow(/completed/);
      expect(requests.filter(request => request.phase === 'strategy')).toHaveLength(1);
      const events = env.state.events().filter(event => event.kind === 'solver.activity');
      expect(events.filter(event => event.activity === 'experiment.abandoned')).toHaveLength(1);
      const windows = events.filter(event => event.activity === 'progress.window').map(event => event.data.window as { completed_experiments: string[] });
      expect(windows.flatMap(window => window.completed_experiments)).not.toContain('old-experiment');
      expect(env.loop.hypotheses.hypothesis('old').contradicting_refs).toHaveLength(0);
    } finally { await env.close(); }
  });
});
