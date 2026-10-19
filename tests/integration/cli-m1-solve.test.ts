import { describe, expect, it } from 'vitest';
import { solve } from '../../apps/cli/src/commands/solve.js';
import type { ReleaseProfile } from '../../apps/cli/src/composition/releaseProfile.js';

const budget = { wallClockMs: 10000, maxSteps: 20, maxToolJobs: 10, maxObservableTokens: 10000 };
describe('retired direct-provider CLI route', () => {
  it('rejects old JSON-action profiles instead of silently using ProviderSolverDriver', async () => {
    const profile: ReleaseProfile = { profileId: 'legacy', solverMode: 'm1',
      model: { provider: 'stub', id: 'legacy' }, reference: { enabled: true }, budget, os: { platform: 'macos' } };
    await expect(solve({ target: 'http://127.0.0.1', profile })).rejects.toThrow(/opencode.configPath/);
  });
  it('rejects --allow-stub on OpenCode profiles before creating a session or reading credentials', async () => {
    const profile: ReleaseProfile = { profileId: 'opencode', solverMode: 'm1', opencode: { configPath: '/not-read.json' },
      reference: { enabled: false }, budget, os: { platform: 'macos' } };
    await expect(solve({ target: 'http://127.0.0.1', profile, allowStub: true })).rejects.toThrow(/allow-stub is retired/);
  });
});
