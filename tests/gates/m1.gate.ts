import { describe, expect, it } from 'vitest';
import { dispatch, scripted, setup } from '../integration/solver-loop-fixtures.js';

describe('M1 deterministic gate', () => {
  it('walks trajectory 1 through first failed execution, raw stderr, bounded repair, and successful rerun', async () => {
    const command = ['node', 'solve.mjs'];
    const patch = { kind: 'tool', tool: 'workspace.patch', input: { path: 'solve.mjs', find: ".toString('utf8');", replace: ".toString('utf8'));" } } as const;
    const runStep = { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' } as const;
    const { driver } = scripted([
      dispatch('decode', command, 1),
      runStep,
      patch,
      runStep,
      { kind: 'stop', reason: 'golden path completed' }
    ]);
    const env = await setup('t1-script-error', driver);
    try {
      await env.loop.run();
      const toolResults = env.state.events().flatMap(event =>
        event.kind === 'solver.activity' && event.activity === 'tool.result' && event.data.tool === 'job.run' ? [event] : []);
      expect(toolResults).toHaveLength(2);
      const observations = toolResults.map(event => (event.data as { observation: { outcome: string; raw: string } }).observation);
      expect(observations[0]!.outcome).toBe('failure');
      expect(observations[0]!.raw).toContain('SyntaxError');
      expect(observations[1]!.outcome).toBe('success');
      expect(observations[1]!.raw).toContain('flag{local_repair}');
      const experiment = env.loop.hypotheses.experiment('e-decode');
      expect(experiment.status).toBe('succeeded');
      expect(experiment.events.map(event => event.outcome)).toEqual(['failure', 'success']);
    } finally { await env.close(); }
  });

  it('presets dispatch and first failed execution without letting the harness repair the script', async () => {
    const command = ['node', 'solve.mjs'];
    const dispatchAction = dispatch('decode', command, 1);
    const firstRun = { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' } as const;
    const patch = { kind: 'tool', tool: 'workspace.patch', input: { path: 'solve.mjs', find: ".toString('utf8');", replace: ".toString('utf8'));" } } as const;
    const { driver } = scripted([patch, firstRun, { kind: 'stop', reason: 'preset path completed' }]);
    const env = await setup('t1-script-error', driver, { preset: { dispatch: dispatchAction, firstRun } });
    try {
      await env.loop.run();
      const driverCalls = env.state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'driver.call');
      expect(driverCalls).toHaveLength(3);
      const toolResults = env.state.events().flatMap(event =>
        event.kind === 'solver.activity' && event.activity === 'tool.result' && event.data.tool === 'job.run' ? [event] : []);
      expect(toolResults).toHaveLength(2);
      const observations = toolResults.map(event => (event.data as { observation: { outcome: string; raw: string } }).observation);
      expect(observations[0]!.outcome).toBe('failure');
      expect(observations[0]!.raw).toContain('SyntaxError');
      expect(observations[1]!.outcome).toBe('success');
      expect(observations[1]!.raw).toContain('flag{local_repair}');
      expect(env.loop.hypotheses.experiment('e-decode').status).toBe('succeeded');
    } finally { await env.close(); }
  });
});
