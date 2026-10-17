import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../../packages/state/src/index.js';
import { Coordinator, MockPlatformAdapter, PlatformService } from '../../packages/platform/src/index.js';

function setup(flag: string) {
  const state = new StateStore(join(tmpdir(), await0(), 'state'), 'run1');
  const platform = new PlatformService(state, new MockPlatformAdapter(flag));
  return { state, platform, coordinator: new Coordinator(platform, 'run1') };
}
function await0() { return Math.random().toString(36).slice(2); }

const intent = { intent: 'candidate.submit' as const, candidate: 'flag{right}', challengeId: 'c1', task: 't1', lease: 'l1' };

describe('platform and local oracle', () => {
  it('permits only coordinator submissions and records protected effects', async () => {
    const { state, platform } = setup('flag{right}');
    await expect(platform.executeIntent({ runId: 'run1', intent, actor: 'solver' })).rejects.toThrow(/Coordinator/);
    await expect(platform.executeIntent({ runId: 'run1', intent, actor: 'verifier' })).rejects.toThrow(/Coordinator/);
    const accepted = await platform.executeIntent({ runId: 'run1', intent, actor: 'coordinator' });
    expect(accepted.result).toEqual({ authoritative: true, status: 'accepted', requiredSlots: 1 });
    expect(state.isScopeUnknown('candidate.submit', 'c1')).toBe(false);
    state.close();
  });

  it('returns authoritative rejection and duplicate outcomes', async () => {
    const { state, coordinator } = setup('flag{right}');
    const rejected = await coordinator.submitCandidate({ candidate: 'flag{wrong}', challengeId: 'c1' as never, task: 't1' as never, lease: 'l1' as never });
    expect(rejected.businessOutcome).toBe('rejected');
    const duplicate = await coordinator.submitCandidate({ candidate: 'flag{wrong}', challengeId: 'c1' as never, task: 't1' as never, lease: 'l1' as never, generation: 2 });
    expect(duplicate.businessOutcome).toBe('duplicate');
    state.close();
  });
});
