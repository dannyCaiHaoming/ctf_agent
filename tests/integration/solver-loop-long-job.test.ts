import { describe, expect, it } from 'vitest';
import { dispatch, scripted, setup } from './solver-loop-fixtures.js';

describe('SolverLoop durable long-job continuation', () => {
  it('waits on the host terminal event, claims the saved continuation, then resumes the same experiment', async () => {
    const command = [process.execPath, '-e', 'setTimeout(()=>process.stdout.write("flag{sample}\\n"),250)'];
    const { driver, requests } = scripted([
      dispatch('decode', command),
      { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => ({ kind: 'conclude', verdict: 'supported', rationale: 'retained output matches the expected framed value', evidence_refs: request.observation!.artifact_refs }),
      { kind: 'stop', reason: 'fixture complete' }
    ]);
    const env = await setup('t2-falsified', driver);
    try {
      const running = env.loop.run();
      const until = Date.now() + 1500;
      while (!env.state.events().some(event => event.kind === 'solver.activity' && event.activity === 'job.watch') && Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const beforeTerminal = env.state.events().filter(event => event.kind === 'solver.activity');
      expect(beforeTerminal.some(event => event.activity === 'job.watch')).toBe(true);
      expect(beforeTerminal.some(event => event.activity === 'progress.window')).toBe(false);
      expect(requests).toHaveLength(2); // no model polling while the managed job is running

      const result = await running;
      expect(result.status).toBe('no_route');
      const events = env.state.events().filter(event => event.kind === 'solver.activity');
      const watch = events.find(event => event.kind === 'solver.activity' && event.activity === 'job.watch');
      const resumed = events.find(event => event.kind === 'solver.activity' && event.activity === 'job.continuation');
      expect(watch?.data.continuation_ref).toBe(resumed?.data.continuation_ref);
      expect(resumed?.data.terminal_state).toBe('completed');
      expect(events.filter(event => event.activity === 'driver.call')).toHaveLength(4);
      expect(events.findIndex(event => event.activity === 'job.continuation'))
        .toBeLessThan(events.findIndex(event => event.activity === 'tool.result' && event.data.tool === 'job.run'));
    } finally { await env.close(); }
  });
});
