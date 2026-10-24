import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from '../../apps/launcher/src/launch.js';
import { loadReleaseProfile } from '../../apps/cli/src/composition/releaseProfile.js';

const TEST_SECRET = 'test-provider-credential-0123456789';
let root: string;
let counter = 0;

beforeAll(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'run-prep-')));
  process.env.RUN_PREP_TEST_KEY = TEST_SECRET;
  await writeFile(join(root, 'opencode.json'), JSON.stringify({ model: 'test/model', provider: { test: { npm: '@ai-sdk/openai-compatible', options: { apiKey: '{env:RUN_PREP_TEST_KEY}' }, models: { model: {} } } } }));
});
afterAll(async () => { delete process.env.RUN_PREP_TEST_KEY; await rm(root, { recursive: true, force: true }); });

/** Writes a profile (optionally with a challenge list) in a fresh directory and returns launch() against it. */
async function attempt(list: unknown, files: Record<string, string | Buffer> = {}, profileExtra: Record<string, unknown> = { challenges: 'challenges.json' }) {
  const dir = join(root, `case${counter++}`);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) { await mkdir(join(dir, name, '..'), { recursive: true }); await writeFile(join(dir, name), content); }
  if (list !== undefined) await writeFile(join(dir, 'challenges.json'), typeof list === 'string' ? list : JSON.stringify(list));
  await writeFile(join(dir, 'profile.json'), JSON.stringify({ profileId: 'test', opencode: { configPath: '../opencode.json' }, reference: { enabled: false },
    budget: { wallClockMs: 1000, maxSteps: 1, maxToolJobs: 1, maxObservableTokens: 1000 }, os: { platform: 'macos' }, ...profileExtra }));
  const runsRoot = join(dir, 'runs');
  const result = await launch({ profile: join(dir, 'profile.json'), runsRoot, runId: 'r1', deadlineMs: 1000 }).then(() => undefined, e => e as Error);
  return { dir, runDir: join(runsRoot, 'r1'), error: result };
}

async function expectBlocked(list: unknown, files: Record<string, string | Buffer> = {}, pattern: RegExp = /./, profileExtra?: Record<string, unknown>) {
  const r = await attempt(list, files, profileExtra);
  expect(r.error?.message).toMatch(/^blocked_configuration: /);
  expect(r.error?.message).toMatch(pattern);
  // OpenCode never started: its working directory is untouched and the reason is on record.
  expect(await readdir(join(r.runDir, 'opencode'))).toEqual([]);
  expect(JSON.parse(await readFile(join(r.runDir, 'evidence', 'run-prep-rejection.json'), 'utf8')).reason).toMatch(pattern);
  expect(await readdir(join(r.runDir, 'workspace'))).toEqual([]);
  return r;
}

const free = () => new Promise<number>(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });

describe('run preparation (behaviour 1: rejections)', () => {
  it('rejects missing challenges field, missing file and empty list', async () => {
    await expectBlocked(undefined, {}, /no challenges field/, {});
    await expectBlocked(undefined, {}, /does not exist/, { challenges: 'nope.json' });
    await expectBlocked({ challenges: [] }, {}, /empty/);
  });
  it('rejects unknown fields, bad or duplicate ids and inputless challenges', async () => {
    await expectBlocked({ challenges: [{ id: 'a', statement: 'x y', scope: 'z' }] }, {}, /unknown fields/);
    await expectBlocked({ challenges: [{ id: '../x', statement: 'x y' }] }, {}, /invalid challenge id/);
    await expectBlocked({ challenges: [{ id: 'a', statement: 'x y' }, { id: 'a', statement: 'x y' }] }, {}, /duplicate challenge id/);
    await expectBlocked({ challenges: [{ id: 'a', title: 'only a title' }] }, {}, /at least one of/);
  });
  it('rejects missing paths, directory and symbolic-link materials', async () => {
    await expectBlocked({ challenges: [{ id: 'a', materials: ['missing.bin'] }] }, {}, /does not exist/);
    await expectBlocked({ challenges: [{ id: 'a', statementFile: 'missing.md' }] }, {}, /does not exist/);
    await expectBlocked({ challenges: [{ id: 'a', materials: ['dir'] }] }, { 'dir/f': 'x' }, /regular file/);
    const dir = join(root, `case${counter}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'real.bin'), 'x');
    await symlink(join(dir, 'real.bin'), join(dir, 'link.bin'));
    await expectBlocked({ challenges: [{ id: 'a', materials: ['link.bin'] }] }, {}, /symbolic link/);
  });
  it('rejects duplicate, reserved and dot-prefixed material names', async () => {
    await expectBlocked({ challenges: [{ id: 'a', materials: ['x/f.bin', 'y/f.bin'] }] }, { 'x/f.bin': '1', 'y/f.bin': '2' }, /duplicate or reserved/);
    await expectBlocked({ challenges: [{ id: 'a', materials: ['x/statement.md'] }] }, { 'x/statement.md': '1' }, /duplicate or reserved/);
    await expectBlocked({ challenges: [{ id: 'a', statement: 'has text', materials: ['x/Statement.MD'] }] }, { 'x/Statement.MD': '1' }, /duplicate or reserved/);
    await expectBlocked({ challenges: [{ id: 'a', materials: ['.hidden'] }] }, { '.hidden': '1' }, /must not start with/);
  });
  it('rejects materials and statements containing a control credential', async () => {
    await expectBlocked({ challenges: [{ id: 'a', materials: ['m.txt'] }] }, { 'm.txt': `key=${TEST_SECRET}` }, /control credential found in m\.txt/);
    await expectBlocked({ challenges: [{ id: 'a', statement: `use ${TEST_SECRET} to log in` }] }, {}, /control credential found in statement\.md/);
  });
  it('rejects an unreachable target (closed local port) within the timeout and records it', async () => {
    const port = await free();
    const started = Date.now();
    const r = await expectBlocked({ reachabilityTimeoutMs: 1500, challenges: [{ id: 'a', target: { protocol: 'tcp', host: '127.0.0.1', port } }] }, {}, /unreachable.*a/);
    expect(Date.now() - started).toBeLessThan(5000);
    const evidence = JSON.parse(await readFile(join(r.runDir, 'evidence', 'challenges.json'), 'utf8'));
    expect(evidence.challenges[0].reachability).toMatchObject({ reachable: false, timeoutMs: 1500 });
  });
});

describe('statement fields', () => {
  it('rejects statement and statementFile together', async () => {
    await expectBlocked({ challenges: [{ id: 'a', statement: 'text', statementFile: 's.md' }] }, { 's.md': 'x' }, /mutually exclusive/);
  });
  it('rejects a missing or symbolic-link statementFile', async () => {
    await expectBlocked({ challenges: [{ id: 'a', statementFile: 'nope.md' }] }, {}, /statement file does not exist/);
    const dir = join(root, `case${counter}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'real.md'), 'x');
    await symlink(join(dir, 'real.md'), join(dir, 'link.md'));
    await expectBlocked({ challenges: [{ id: 'a', statementFile: 'link.md' }] }, {}, /symbolic link/);
  });
  it('writes path-like statement text verbatim and copies statementFile byte for byte', async () => {
    const { prepareRun } = await import('../../apps/launcher/src/run-prep.js');
    const dir = join(root, 'statements');
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from([0x23, 0xff, 0x00, 0x0a, 0x7f]);
    await writeFile(join(dir, 'file.md'), bytes);
    await writeFile(join(dir, 'challenges.json'), JSON.stringify({ challenges: [
      { id: 'url', statement: 'http://x/y' }, { id: 'path', statement: 'a/b.md' }, { id: 'file', statementFile: 'file.md' }] }));
    const workspace = join(dir, 'workspace'); const evidence = join(dir, 'evidence');
    await mkdir(workspace); await mkdir(evidence);
    await prepareRun({ challengesPath: join(dir, 'challenges.json'), workspace, evidence, secrets: [] });
    const read = (id: string) => readFile(join(workspace, id, 'materials', 'statement.md'));
    expect((await read('url')).toString()).toBe('http://x/y');
    expect((await read('path')).toString()).toBe('a/b.md');
    expect(await read('file')).toEqual(bytes);
  });
});

describe('run preparation (behaviours 2-6)', () => {
  it('rejects the whole run when one of several challenges is invalid and leaves no workspace', async () => {
    await expectBlocked({ challenges: [{ id: 'good', statement: 'a fine statement' }, { id: 'bad', materials: ['missing'] }] }, {}, /does not exist/);
  });

  describe('with a listening local server', () => {
    let server: Server; let port: number; let received = 0;
    beforeAll(async () => {
      server = createServer(socket => { socket.on('data', d => { received += d.length; }); socket.on('error', () => {}); });
      await new Promise<void>(res => server.listen(0, '127.0.0.1', res));
      port = (server.address() as { port: number }).port;
    });
    afterAll(() => new Promise<void>(res => server.close(() => res())));

    it('pins materials read-only with evidence and checks a listening target without sending bytes', async () => {
      const bytes = Buffer.from([0, 1, 2, 255, 254, 10, 13]);
      // A successful launch() would start OpenCode, so the success path drives prepareRun, the function launch() calls.
      const { prepareRun } = await import('../../apps/launcher/src/run-prep.js');
      const dir = join(root, 'direct');
      await mkdir(join(dir, 'in'), { recursive: true });
      await writeFile(join(dir, 'in', 'blob.bin'), bytes);
      await writeFile(join(dir, 'in', 'note.md'), 'file statement');
      await writeFile(join(dir, 'challenges.json'), JSON.stringify({ challenges: [
        { id: 'web', title: 'Web', statementFile: 'in/note.md', materials: ['in/blob.bin'], target: { protocol: 'http', url: `http://127.0.0.1:${port}/` } },
        { id: 'offline', statement: 'inline statement' }
      ] }));
      const workspace = join(dir, 'workspace'); const evidence = join(dir, 'evidence');
      await mkdir(workspace); await mkdir(evidence);
      await prepareRun({ challengesPath: join(dir, 'challenges.json'), workspace, evidence, secrets: [TEST_SECRET] });
      await new Promise(r => setTimeout(r, 100));
      expect(received).toBe(0); // behaviour 5: nothing was sent

      expect((await readdir(join(workspace, 'web', 'materials'))).sort()).toEqual(['blob.bin', 'statement.md']);
      expect(await readFile(join(workspace, 'web', 'materials', 'blob.bin'))).toEqual(bytes);
      expect(await readFile(join(workspace, 'web', 'materials', 'statement.md'), 'utf8')).toBe('file statement');
      expect(await readdir(join(workspace, 'offline', 'materials'))).toEqual(['statement.md']);
      expect(await readFile(join(workspace, 'offline', 'materials', 'statement.md'), 'utf8')).toBe('inline statement');
      for (const f of ['web/materials/blob.bin', 'web/materials/statement.md', 'offline/materials/statement.md']) {
        expect((await stat(join(workspace, f))).mode & 0o222).toBe(0);
      }
      const evidenceJson = JSON.parse(await readFile(join(evidence, 'challenges.json'), 'utf8'));
      const web = evidenceJson.challenges.find((c: { id: string }) => c.id === 'web');
      expect(web.materials.find((m: { name: string }) => m.name === 'blob.bin')).toMatchObject({
        source: join(dir, 'in', 'blob.bin'), sha256: createHash('sha256').update(bytes).digest('hex') });
      expect(web.reachability).toMatchObject({ reachable: true });
      expect(Date.parse(web.reachability.checkedAt)).not.toBeNaN();
      expect(JSON.stringify(evidenceJson)).not.toContain(TEST_SECRET);
    });
  });

  it('keeps pinned materials out of the OpenCode working directory and keeps the existing working-directory checks', async () => {
    const dir = join(root, 'workdir');
    await mkdir(join(dir, 'runs', 'r1', 'opencode', '.opencode'), { recursive: true });
    await writeFile(join(dir, 'challenges.json'), JSON.stringify({ challenges: [{ id: 'a', statement: 'x y' }] }));
    await writeFile(join(dir, 'profile.json'), JSON.stringify({ profileId: 't', opencode: { configPath: '../opencode.json' }, challenges: 'challenges.json', reference: { enabled: false },
      budget: { wallClockMs: 1000, maxSteps: 1, maxToolJobs: 1, maxObservableTokens: 1000 }, os: { platform: 'macos' } }));
    await expect(launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'r1' })).rejects.toThrow(/contains \.opencode\//);
    await rm(join(dir, 'runs', 'r1', 'opencode', '.opencode'), { recursive: true });
    await writeFile(join(dir, 'runs', 'r1', 'opencode', 'stray'), 'x');
    await expect(launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'r1' })).rejects.toThrow(/not empty/);
  });
});

describe('release profile', () => {
  it('resolves challenges relative to the profile and the shipped example parses', async () => {
    const profile = await loadReleaseProfile(join(__dirname, '..', '..', 'config', 'release-profile.volcano-coding.example.json'));
    expect(profile.challenges).toBe(join(__dirname, '..', '..', 'config', 'challenges.example.json'));
    const { loadChallengeList } = await import('../../apps/launcher/src/challenges.js');
    expect((await loadChallengeList(profile.challenges!)).challenges.map(c => c.id)).toEqual(['offline-example']);
  });
});
