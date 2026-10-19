import { describe, expect, it } from 'vitest';
import { dispatch, run, scripted, setup } from './solver-loop-fixtures.js';

describe('deterministic Solver trajectories with real local tools (deferred live Gate)', () => {
  it('feeds full raw syntax error to the same Solver and performs a bounded local repair', async () => {
    const { driver, requests } = scripted([
      dispatch(), { kind: 'tool', tool: 'workspace.read', input: { path: 'solve.mjs' } }, run,
      request => {
        expect(request.observation?.raw).toContain('SyntaxError: missing ) after argument list');
        expect(request.observation?.raw).toContain('Node.js');
        expect(request.phase).toBe('solver');
        return { kind: 'tool', tool: 'workspace.patch', input: { path: 'solve.mjs', find: ".toString('utf8');", replace: ".toString('utf8'));" } };
      }, run,
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs })
    ]);
    const env = await setup('t1-script-error', driver);
    try {
      const result = await env.loop.run();
      expect(result.status).toBe('candidate_only');
      expect(result.candidate?.value).toBe('flag{local_repair}');
      const events = env.state.events().filter(event => event.kind === 'solver.activity');
      expect(events.filter(event => event.activity === 'strategy.request')).toHaveLength(0);
      expect(events.filter(event => event.activity === 'repair')).toHaveLength(1);
      expect(events.filter(event => event.activity === 'tool.result' && event.data.tool === 'job.run')).toHaveLength(2);
      expect(new Set(events.map(event => `${event.taskId}/${event.sessionId}/${event.attemptId}`))).toEqual(new Set(['solver/session/attempt']));
      expect(requests.every(request => request.binding.task_id === 'solver' && request.binding.session_id === 'session')).toBe(true);
      expect(env.loop.hypotheses.experiment('e-decode').activities).toHaveLength(1);
      expect((await env.runtime.workspace('solver').read('solve.mjs')).toString()).toContain('// Preserve this script');
    } finally { await env.close(); }
  });
  it('saves effective falsification then switches to a different route without retrying the rejected premise', async () => {
    const command = [process.execPath, 'target.mjs', '2+2'];
    const { driver, requests } = scripted([
      dispatch('expression', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => ({ kind: 'conclude', verdict: 'rejected', rationale: 'parser reports literal mode and preserves expression', evidence_refs: request.observation!.artifact_refs }),
      request => { expect(request.phase).toBe('strategy'); return dispatch('decode', [process.execPath, 'decode.mjs']); },
      { kind: 'tool', tool: 'job.run', input: { command: [process.execPath, 'decode.mjs'] }, step_id: 'run' },
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs })
    ]);
    const env = await setup('t2-falsified', driver);
    try {
      expect((await env.loop.run()).status).toBe('candidate_only');
      expect(env.loop.hypotheses.hypothesis('expression').state).toBe('rejected');
      const refs = env.loop.hypotheses.hypothesis('expression').contradicting_refs;
      expect(refs).toHaveLength(1);
      expect((await env.artifacts.read(refs[0]!)).toString()).toBe('{"mode":"literal","value":"2+2"}\n');
      expect(requests.filter(request => request.phase === 'strategy')).toHaveLength(1);
      const events = env.state.events().filter(event => event.kind === 'solver.activity');
      expect(events.filter(event => event.activity === 'strategy.switch')).toHaveLength(1);
      expect(events.filter(event => event.activity === 'tool.result' && event.data.tool === 'job.run')).toHaveLength(2);
    } finally { await env.close(); }
  });

  it('feeds an authoritative oracle rejection back to the same Solver and only finishes on a current accepted result', async () => {
    const first = [process.execPath, 'target.mjs', '2+2'];
    const second = [process.execPath, 'decode.mjs'];
    const { driver, requests } = scripted([
      dispatch('wrong-slot', first), { kind: 'tool', tool: 'job.run', input: { command: first }, step_id: 'run' },
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs }),
      request => {
        expect(request.phase).toBe('solver');
        expect(request.observation?.tool).toBe('candidate.resolve');
        expect(request.observation?.raw).toContain('slot was rejected');
        return dispatch('correct-slot', second);
      }, { kind: 'tool', tool: 'job.run', input: { command: second }, step_id: 'run' },
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs })
    ]);
    let resolutions = 0;
    const env = await setup('t2-falsified', driver, { resolveCandidate: async input => {
      input.control.admit('engineering'); input.control.admit('verification'); input.control.admit('oracle_submit');
      resolutions++;
      expect(input.challengeId).toBe('challenge');
      expect(input.valueRef.hash).toMatch(/^[a-f0-9]{64}$/);
      const verification = { id: `verification-${resolutions}`, status: 'verified' as const, candidateHash: input.valueRef.hash,
        generation: input.generation, current: true };
      return resolutions === 1
        ? { status: 'rejected', authoritative: true, detail: 'oracle says the slot was rejected', evidence_refs: [input.valueRef], verification }
        : { status: 'accepted', authoritative: true, completed: true, detail: 'authoritative challenge completion', evidence_refs: [input.valueRef], verification };
    } });
    try {
      const result = await env.loop.run();
      expect(result.status).toBe('solved');
      expect(result.outcome).toBe('solved');
      expect(resolutions).toBe(2);
      expect(requests[3]?.observation?.raw).toContain('slot was rejected');
      const candidateEvents = env.state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'candidate');
      expect(candidateEvents.some(event => event.kind === 'solver.activity' && event.data.status === 'rejected')).toBe(true);
      expect(candidateEvents.some(event => event.kind === 'solver.activity' && event.data.status === 'accepted')).toBe(true);
    } finally { await env.close(); }
  });

  it('retains authoritative partial acceptance and does not report solved before all slots complete', async () => {
    const command = [process.execPath, 'target.mjs', '2+2'];
    const { driver } = scripted([
      dispatch('first-slot', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs }),
      request => { expect(request.observation?.tool).toBe('candidate.resolve'); return { kind: 'stop', reason: 'remaining slot needs another route' }; }
    ]);
    const env = await setup('t2-falsified', driver, { resolveCandidate: async input => {
      input.control.admit('engineering'); input.control.admit('verification'); input.control.admit('oracle_submit');
      return { status: 'partial', authoritative: true,
      completed: false, correct_flag_count: 1, total_flag_count: 2, detail: 'one of two required slots accepted',
      verification: { id: 'verification-partial', status: 'verified', candidateHash: input.valueRef.hash, generation: input.generation, current: true } };
    } });
    try {
      const result = await env.loop.run();
      expect(result.status).toBe('partial');
      expect(result.outcome).toBe('partial');
      expect(result.solve_state).not.toBe('finished');
    } finally { await env.close(); }
  });

  it('fails closed when a resolver claims acceptance without a current byte and generation bound verification', async () => {
    const command = [process.execPath, 'target.mjs', '2+2'];
    const { driver } = scripted([
      dispatch('candidate', command), { kind: 'tool', tool: 'job.run', input: { command }, step_id: 'run' },
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs }),
      request => { expect(request.observation?.raw).toContain('current verification'); return { kind: 'stop', reason: 'no verified candidate' }; }
    ]);
    const env = await setup('t2-falsified', driver, { resolveCandidate: async input => {
      input.control.admit('engineering'); input.control.admit('verification'); input.control.admit('oracle_submit');
      return { status: 'accepted', authoritative: true, completed: true, detail: 'forged accepted result' };
    } });
    try {
      const result = await env.loop.run();
      expect(result.status).toBe('no_route');
      expect(result.outcome).not.toBe('solved');
    } finally { await env.close(); }
  });
});
