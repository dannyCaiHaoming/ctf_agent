import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '@ctf/state';
import { Coordinator, PlatformService } from '@ctf/platform';
import { MultiFlagContinuation } from '@ctf/supervisor';
import { createT6Oracle } from '../../fixtures/trajectories/t6-multiflag/oracle.js';

const roots: string[] = []; const states: StateStore[] = [];
afterEach(async () => { for (const state of states.splice(0)) state.close(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'multiflag-continuation-')); roots.push(root);
  const state = new StateStore(join(root, 'state'), 'multiflag-run'); states.push(state);
  const coordinator = new Coordinator(new PlatformService(state, createT6Oracle()), 'multiflag-run' as never);
  const continuation = new MultiFlagContinuation(state, (input, generation) => coordinator.submitCandidate({ ...input, challengeId: input.challengeId as never, task: input.task as never, lease: input.lease as never, generation }));
  return { state, continuation };
}
const base = { challengeId: 't6-two-slots' as never, task: 'solver' as never, lease: 'lease-t6' as never, maxCandidates: 5 };

describe('authoritative multi-flag partial continuation', () => {
  it('saves each accepted slot immediately and continues until all required slots are accepted', async () => {
    const { state, continuation } = await setup(); let resumes = 0;
    const result = await continuation.run({ ...base, firstCandidate: 'puzzle{first}', nextCandidate: async (progress, previous) => {
      resumes++; expect(previous.businessOutcome).toBe('accepted');
      expect(progress).toMatchObject({ acceptedSlots: [0], correctFlagCount: 1, totalFlagCount: 2, progressState: 'partial' });
      expect(state.multiFlagProgress('t6-two-slots')).toEqual(progress); // first slot durable before resuming
      return 'puzzle{second}';
    } });
    expect(resumes).toBe(1);
    expect(result).toMatchObject({ outcome: 'completed', progress: { acceptedSlots: [0, 1], correctFlagCount: 2, totalFlagCount: 2, progressState: 'completed' } });
    expect(result.submissions).toHaveLength(2);
    expect(state.multiFlagProgress('t6-two-slots')?.progressState).toBe('completed');
  });

  it('keeps a one-slot acceptance partial and never reports solved', async () => {
    const { state, continuation } = await setup();
    const result = await continuation.run({ ...base, firstCandidate: 'puzzle{first}', nextCandidate: async progress => {
      expect(state.multiFlagProgress('t6-two-slots')).toEqual(progress); return undefined;
    } });
    expect(result.outcome).toBe('partial');
    expect(result.progress).toMatchObject({ acceptedSlots: [0], correctFlagCount: 1, totalFlagCount: 2, progressState: 'partial' });
  });

  it('recognizes duplicate accepted flags without double scoring and rejects regressions', async () => {
    const { state, continuation } = await setup();
    const first = await continuation.run({ ...base, firstCandidate: 'puzzle{first}', nextCandidate: async () => undefined });
    expect(first.outcome).toBe('partial');
    const second = await continuation.run({ ...base, firstCandidate: 'puzzle{first}', nextCandidate: async progress => {
      expect(progress).toMatchObject({ acceptedSlots: [0], correctFlagCount: 1, totalFlagCount: 2 }); return 'puzzle{second}';
    } });
    expect(second.outcome).toBe('completed');
    expect(second.submissions[0]!.businessOutcome).toBe('duplicate');
    expect(state.multiFlagProgress('t6-two-slots')?.acceptedSlots).toEqual([0, 1]);
    expect(() => state.recordAcceptedFlag({ challengeId: 't6-two-slots', slot: 1,
      candidateHash: createHash('sha256').update('other').digest('hex'), correctFlagCount: 1, totalFlagCount: 2, completed: false })).toThrow(/another candidate|regressed/);
  });

  it('returns inconclusive when an oracle omits authoritative slot/count data', async () => {
    const { state } = await setup();
    const continuation = new MultiFlagContinuation(state, async () => ({ effectId: 'e', businessOutcome: 'accepted',
      result: { authoritative: true, status: 'accepted', requiredSlots: 2 } }));
    await expect(continuation.run({ ...base, firstCandidate: 'puzzle{first}', nextCandidate: async () => undefined })).resolves.toMatchObject({ outcome: 'inconclusive' });
  });
});
