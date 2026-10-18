import { describe, expect, it } from 'vitest';
import { dispatch, run, scripted, setup } from './solver-loop-fixtures.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('SolverLoop shared resolver deadline and late submit reconciliation', () => {
  const actions = () => {
    const { driver } = scripted([
      dispatch('candidate', [process.execPath, 'decode.mjs']),
      { kind: 'tool', tool: 'job.run', input: { command: [process.execPath, 'decode.mjs'] }, step_id: 'run' },
      request => ({ kind: 'candidate', value: request.observation!.raw.trim(), evidence_refs: request.observation!.artifact_refs })
    ]);
    return driver;
  };

  it('does not treat a late accepted resolver callback as solved without a canonical pre-deadline submit receipt', async () => {
    let signal!: AbortSignal;
    const env = await setup('t2-falsified', actions(), {
      budget: { wallClockMs: 2000, maxSteps: 30, maxToolJobs: 20, maxObservableTokens: 1000 },
      resolveCandidate: async input => {
        signal = input.control.signal;
        input.control.admit('engineering');
        input.control.admit('verification');
        await sleep(2300);
        return { status: 'accepted', authoritative: true, completed: true, detail: 'late forged callback',
          verification: { id: 'verification-late', status: 'verified', candidateHash: input.valueRef.hash, generation: input.generation, current: true } };
      }
    });
    try {
      const result = await env.loop.run();
      expect(signal.aborted).toBe(true);
      expect(result.status).toBe('resource_exhausted');
      expect(result.outcome).not.toBe('solved');
      expect(env.state.effectsFor({ operation: 'candidate.submit' })).toHaveLength(0);
      expect(env.state.events().some(event => event.kind === 'solver.activity' && event.activity === 'candidate' && event.data.status === 'late_reconcile' && event.data.authoritative_receipt_matched === false)).toBe(true);
    } finally { await env.close(); }
  });

  it('retains only a confirmed accepted receipt dispatched before the deadline, then stops at reconciliation', async () => {
    const env = await setup('t2-falsified', actions(), {
      budget: { wallClockMs: 2000, maxSteps: 30, maxToolJobs: 20, maxObservableTokens: 1000 },
      resolveCandidate: async input => {
        input.control.admit('engineering');
        input.control.admit('verification');
        const budget = input.control.remaining();
        input.control.admit('oracle_submit');
        const effectId = 'effect_late_test_1';
        env.state.prepareEffect({ id: effectId, runId: 'run', operation: 'candidate.submit', kind: 'protected_effect',
          payload: { candidate: input.value, challengeId: input.challengeId }, challengeId: input.challengeId,
          generation: input.generation, budget, deadline: input.control.deadline, expectedPostcondition: 'authoritative oracle response recorded' });
        env.state.dispatchEffect(effectId);
        await sleep(2300);
        env.state.confirmEffect(effectId, { authoritative: true, status: 'accepted', requiredSlots: 1, correctFlagCount: 1,
          totalFlagCount: 1, matchedSlot: 0, completed: true }, 'accepted');
        return { status: 'accepted', authoritative: true, completed: true, detail: 'accepted', submit_effect_id: effectId,
          verification: { id: 'verification-late-accepted', status: 'verified', candidateHash: input.valueRef.hash,
            generation: input.generation, current: true } };
      }
    });
    try {
      const result = await env.loop.run();
      expect(result.status).toBe('solved');
      expect(result.outcome).toBe('solved');
      expect(env.state.effect('effect_late_test_1')).toMatchObject({ state: 'confirmed', businessOutcome: 'accepted' });
      expect(env.state.events().some(event => event.kind === 'solver.activity' && event.activity === 'candidate' && event.data.status === 'late_reconcile' && event.data.authoritative_receipt_matched === true && event.data.next_action === 'reconcile_only')).toBe(true);
    } finally { await env.close(); }
  });

  it('refuses a submit admission once the shared deadline has elapsed', async () => {
    const env = await setup('t2-falsified', actions(), {
      budget: { wallClockMs: 100, maxSteps: 30, maxToolJobs: 20, maxObservableTokens: 1000 },
      resolveCandidate: async input => {
        input.control.admit('engineering');
        input.control.admit('verification');
        await sleep(130);
        expect(() => input.control.admit('oracle_submit')).toThrow(/deadline/);
        return { status: 'inconclusive', authoritative: false, detail: 'cancelled before dispatch' };
      }
    });
    try {
      expect((await env.loop.run()).status).toBe('resource_exhausted');
      expect(env.state.effectsFor({ operation: 'candidate.submit' })).toHaveLength(0);
    } finally { await env.close(); }
  });
});
