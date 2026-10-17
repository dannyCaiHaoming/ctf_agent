import { describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadReleaseProfile } from '../../apps/cli/src/composition/releaseProfile.js';

const root = resolve(import.meta.dirname, '../..');

describe('M0 workspace bootstrap', () => {
  it('has clean-checkout scripts and a lockfile', async () => {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.scripts).toMatchObject({ typecheck: expect.any(String), 'test:deterministic': expect.any(String), 'gate:m0': expect.any(String), cli: expect.any(String), build: expect.any(String) });
    await expect(access(resolve(root, 'package-lock.json'))).resolves.toBeUndefined();
    expect(await readFile(resolve(root, '.nvmrc'), 'utf8')).toContain('24');
  });

  it('loads a valid profile and rejects missing fields and secrets', async () => {
    await expect(loadReleaseProfile(resolve(root, 'config/release-profile.example.json'))).resolves.toMatchObject({ profileId: 'm0-smoke' });
    await expect(loadReleaseProfile(resolve(root, 'config/release-profile.schema.json'))).rejects.toThrow();
    const secretPath = resolve(root, 'node_modules/.tmp-secret-profile.json');
    await (await import('node:fs/promises')).writeFile(secretPath, JSON.stringify({ profileId: 'bad', model: { provider: 'openai', id: 'x' }, reference: { enabled: false }, budget: { wallClockMs: 1, maxSteps: 1, maxToolJobs: 1, maxObservableTokens: 1 }, os: { platform: 'macos' }, apiKey: 'bad' }));
    await expect(loadReleaseProfile(secretPath)).rejects.toThrow(/unknown|secret/i);
  });
});

describe('local secret storage', () => {
  it('ignores .env while keeping a tracked example', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    await expect(run('git', ['check-ignore', '-v', '.env'], { cwd: root })).resolves.toMatchObject({ stdout: expect.stringContaining('.env') });
    await expect(access(resolve(root, '.env.example'))).resolves.toBeUndefined();
  });

  it('loads non-comment entries without exposing values', async () => {
    const { loadLocalEnv } = await import('../../apps/cli/src/composition/localEnv.js');
    const { mkdtemp, writeFile } = await import('node:fs/promises');
    const dir = await mkdtemp(join(tmpdir(), 'local-env-'));
    const path = resolve(dir, '.env');
    await writeFile(path, '# secret file\nTEST_LOCAL_ENV_VALUE=abc\n');
    delete process.env.TEST_LOCAL_ENV_VALUE;
    await expect(loadLocalEnv(path)).resolves.toMatchObject({ loaded: true, entries: 1 });
    expect(process.env.TEST_LOCAL_ENV_VALUE).toBe('abc');
    delete process.env.TEST_LOCAL_ENV_VALUE;
  });
});
