import { describe, expect, it } from 'vitest';
import type { SolverAction, SolverRequest } from '../legacy/solver-loop.js';
import { dispatch, scripted, setup } from './solver-loop-fixtures.js';

const command = [process.execPath, 'decode.mjs'];
const execute: SolverAction = { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' };
const inconclusive = (request: SolverRequest): SolverAction => ({ kind: 'conclude', verdict: 'inconclusive', rationale: 'successful output does not resolve this mechanism', evidence_refs: request.observation!.artifact_refs });

describe('Solver experiment windows close after semantic assessment', () => {
  it('lets a second successful experiment register its candidate before any no-progress diversion', async () => {
    const { driver, requests } = scripted([
      dispatch('first', command), execute, inconclusive,
      dispatch('second', command.map(value => value === 'decode.mjs' ? './decode.mjs' : value)),
      { ...execute, input: { command: [process.execPath, './decode.mjs'] } },
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs })
    ]);
    const env = await setup('t2-falsified', driver);
    try {
      expect((await env.loop.run()).status).toBe('candidate_only');
      expect(requests.at(-1)!.phase).toBe('solver');
      expect(env.state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'strategy.request')).toHaveLength(0);
    } finally { await env.close(); }
  });
  it('requests Strategy after two explicitly inconclusive completed experiments', async () => {
    const secondCommand = [process.execPath, './decode.mjs'];
    const { driver, requests } = scripted([
      dispatch('first', command), execute, inconclusive, dispatch('second', secondCommand),
      { ...execute, input: { command: secondCommand } }, inconclusive,
      { kind: 'stop', reason: 'no more runnable routes' }
    ]);
    const env = await setup('t2-falsified', driver);
    try {
      expect((await env.loop.run()).status).toBe('no_route');
      expect(requests[5]!.phase).toBe('solver');
      expect(requests[6]!.phase).toBe('strategy');
    } finally { await env.close(); }
  });
  it('does not let first-window evidence mask the next two no-progress experiments', async () => {
    const secondCommand = [process.execPath, './decode.mjs'];
    const thirdCommand = [process.execPath, 'target.mjs', '2+2'];
    const { driver, requests } = scripted([
      dispatch('decode', command), execute,
      request => ({ kind: 'conclude', verdict: 'supported', rationale: 'local decoder produced framed material', evidence_refs: request.observation!.artifact_refs }),
      dispatch('second', secondCommand), { ...execute, input: { command: secondCommand } }, inconclusive,
      dispatch('third', thirdCommand), { ...execute, input: { command: thirdCommand } }, inconclusive,
      { kind: 'stop', reason: 'no more runnable routes' }
    ]);
    const env = await setup('t2-falsified', driver);
    try {
      expect((await env.loop.run()).status).toBe('no_route');
      expect(requests[9]!.phase).toBe('strategy');
      expect(env.loop.hypotheses.progressRecords()).toHaveLength(1);
    } finally { await env.close(); }
  });
});
