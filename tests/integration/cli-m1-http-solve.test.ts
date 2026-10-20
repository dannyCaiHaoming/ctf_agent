import { describe, expect, it } from 'vitest';
import { solve } from '../../apps/cli/src/commands/solve.js';
import { createLocalHttpCandidateResolver } from '../../apps/cli/src/commands/localHttpCandidateResolver.js';

describe('local HTTP entry configuration', () => {
  it('retains the resolver and requires an explicit target instead of automatic startup', async () => {
    expect(createLocalHttpCandidateResolver).toBeTypeOf('function');
    await expect(solve({ target: 'auto', startLocalTarget: true, profile: {
      profileId: 't1', solverMode: 'm1', opencode: { configPath: '/not-read.json' }, reference: { enabled: false },
      budget: { wallClockMs: 10000, maxSteps: 20, maxToolJobs: 10, maxObservableTokens: 10000 }, os: { platform: 'macos' }
    } })).rejects.toThrow(/an authorized target URL is required/);
  });
});
