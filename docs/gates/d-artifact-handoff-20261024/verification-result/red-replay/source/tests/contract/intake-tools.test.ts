import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlService } from '../../apps/launcher/src/control-service.js';
import { PAGE_BYTES } from '../../apps/launcher/src/intake-tools.js';
import type { PreparedChallenge } from '../../apps/launcher/src/run-prep.js';

let root: string;
let challenges: PreparedChallenge[];
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const big = ('行 line of text\n'.repeat(5000)); // multi-byte, well over one page
const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3, 4, 5]);

beforeAll(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'intake-tools-')));
  const dirs: Record<string, Record<string, string | Buffer>> = {
    web: { 'statement.md': 'find the flag\n', 'big.txt': big, 'blob.bin': binary },
    other: { 'statement.md': 'second' }
  };
  challenges = [];
  for (const [id, files] of Object.entries(dirs)) {
    const dir = join(root, id, 'materials');
    await mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) { await writeFile(join(dir, name), content); await chmod(join(dir, name), 0o444); }
    challenges.push({ id, title: id === 'web' ? 'Web one' : null, target: id === 'web' ? { protocol: 'tcp', host: '127.0.0.1', port: 9 } : null,
      reachability: id === 'web' ? { checkedAt: '2026-10-23T00:00:00.000Z', reachable: true, timeoutMs: 3000 } : null,
      materials: Object.entries(files).map(([name, c]) => ({ name, sha256: sha(c), bytes: Buffer.byteLength(c) })), materialsDir: dir });
  }
  await mkdir(join(root, 'outside'), { recursive: true });
  await writeFile(join(root, 'outside', 'secret.txt'), 'outside');
  await symlink(join(root, 'outside', 'secret.txt'), join(root, 'web', 'materials', 'link-out.txt'));
  await symlink(join(root, 'outside'), join(root, 'web', 'materials', 'dir-link'));
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

function service(roles: Record<string, string> = { kid: 'intake' }) {
  const sessions = Object.fromEntries(Object.entries(roles).map(([id, agent]) => [id, { parentID: 'root', agent }]));
  const client = { session: { get: async ({ sessionID }: { sessionID: string }) => ({ data: { id: sessionID, ...sessions[sessionID] } }),
    children: async () => ({ data: [] }), messages: async () => ({ data: [] }), abort: async () => ({ data: true }) } };
  const s = new ControlService({ client: client as never, budget: { maxModelCalls: 10, maxObservableTokens: 1000 }, expiresAt: Date.now() + 60000,
    workdir: '/nonexistent', skillRoot: '/nonexistent', challenges });
  s.bindRoot('root');
  return s;
}
async function bind(s: ControlService, id: string, role: string) {
  if (['recon', 'domain-solver', 'engineer', 'verifier'].includes(role)) await s.handle('root', 'tool.execute', { tool: 'challenge.assign', args: { role, challenge: 'web' } });
  await s.handle('root', 'tool.before', { tool: 'task', callID: `c-${id}`, args: { subagent_type: role } });
  await s.handle(id, 'chat.message', { agent: role });
}
const read = (s: ControlService, args: object, who = 'kid') => s.handle(who, 'tool.execute', { tool: 'challenge.read', args });

describe('intake tools: role and challenge limits (criteria 1, 2)', () => {
  it('denies non-intake roles at tool.before and, when visibility is wrong, at tool.execute', async () => {
    const s = service({ r: 'recon' });
    await bind(s, 'r', 'recon');
    for (const tool of ['ctf_challenge_list', 'ctf_challenge_read']) await expect(s.handle('r', 'tool.before', { tool, callID: 'x', args: { id: 'web', path: 'statement.md' } })).rejects.toThrow('denied: tool not permitted');
    await expect(s.handle('r', 'tool.execute', { tool: 'challenge.list', args: {} })).rejects.toThrow('denied: tool not permitted');
    await expect(read(s, { id: 'web', path: 'statement.md' }, 'r')).rejects.toThrow('denied: tool not permitted');
    await expect(s.handle('root', 'tool.execute', { tool: 'challenge.list', args: {} })).rejects.toThrow('denied: tool not permitted'); // coordinator
  });
  it('allows intake and refuses a challenge id outside this run in both layers', async () => {
    const s = service();
    await bind(s, 'kid', 'intake');
    await s.handle('kid', 'tool.before', { tool: 'ctf_challenge_list', callID: 'a', args: {} });
    await s.handle('kid', 'tool.before', { tool: 'ctf_challenge_read', callID: 'b', args: { id: 'web', path: 'statement.md' } });
    for (const id of ['nope', '../web', 7, undefined]) {
      await expect(s.handle('kid', 'tool.before', { tool: 'ctf_challenge_read', callID: 'c', args: { id, path: 'statement.md' } })).rejects.toThrow('denied: challenge id');
      await expect(read(s, { id, path: 'statement.md' })).rejects.toThrow('denied: challenge id');
    }
  });
  it('denies solver managed tools to Intake and refuses unknown tools', async () => {
    const s = service();
    await bind(s, 'kid', 'intake');
    await expect(s.handle('kid', 'tool.execute', { tool: 'workspace.read', args: {} })).rejects.toThrow('denied: tool not permitted');
    await expect(s.handle('kid', 'tool.execute', { tool: 'unknown.managed', args: {} })).rejects.toThrow('denied: no managed tools');
  });
});

describe('intake tools: reading (criteria 3, 4)', () => {
  it('refuses traversal, absolute paths, symbolic links and writes nothing', async () => {
    const s = service();
    await bind(s, 'kid', 'intake');
    const before = await readdir(join(root, 'web', 'materials'));
    for (const path of ['../other/materials/statement.md', '../../outside/secret.txt', '/etc/passwd', join(root, 'outside', 'secret.txt'), 'link-out.txt', 'dir-link/secret.txt', 'dir-link', '', '.', 'a//b', 'missing.txt', '..\\x'])
      await expect(read(s, { id: 'web', path })).rejects.toThrow(/^denied: material path$/);
    expect(await readdir(join(root, 'web', 'materials'))).toEqual(before);
    expect(sha(await readFile(join(root, 'web', 'materials', 'statement.md')))).toBe(challenges[0]!.materials.find(m => m.name === 'statement.md')!.sha256);
  });
  it('returns text verbatim and binary as size and signature', async () => {
    const s = service();
    await bind(s, 'kid', 'intake');
    expect(await read(s, { id: 'web', path: 'statement.md' })).toMatchObject({ text: 'find the flag\n', done: true, nextCursor: null, size: 14 });
    expect(await read(s, { id: 'web', path: 'blob.bin' })).toEqual({ id: 'web', path: 'blob.bin', size: 10, binary: true, signature: '7f454c4600010203' });
  });
  it('pages large text and the cursor chain rebuilds the original', async () => {
    const s = service();
    await bind(s, 'kid', 'intake');
    let text = '', cursor: string | undefined, pages = 0;
    for (;;) {
      const page = await read(s, { id: 'web', path: 'big.txt', ...(cursor ? { cursor } : {}) }) as { text: string; nextCursor: string | null; done: boolean };
      expect(Buffer.byteLength(page.text)).toBeLessThanOrEqual(PAGE_BYTES);
      text += page.text; pages++;
      if (page.nextCursor === null) { expect(page.done).toBe(true); break; }
      expect(page.done).toBe(false);
      cursor = page.nextCursor;
    }
    expect(pages).toBeGreaterThan(1);
    expect(text).toBe(big);
    await expect(read(s, { id: 'web', path: 'big.txt', cursor: 'abc' })).rejects.toThrow('denied: cursor');
    await expect(read(s, { id: 'web', path: 'big.txt', cursor: '99999999' })).rejects.toThrow('denied: cursor');
  });
});

describe('intake tools: listing (criterion 5)', () => {
  it('lists id, title, target, check time, materials and sha256 without host paths', async () => {
    const s = service();
    await bind(s, 'kid', 'intake');
    const result = await s.handle('kid', 'tool.execute', { tool: 'challenge.list', args: {} }) as { challenges: Array<Record<string, unknown>> };
    expect(result.challenges.map(c => c.id)).toEqual(['web', 'other']);
    expect(result.challenges[0]).toMatchObject({ title: 'Web one', target: { protocol: 'tcp', host: '127.0.0.1', port: 9 }, reachabilityCheckedAt: '2026-10-23T00:00:00.000Z' });
    expect(result.challenges[1]).toMatchObject({ target: '無網路目標', reachabilityCheckedAt: null });
    expect((result.challenges[0]!.materials as Array<{ name: string; sha256: string }>).find(m => m.name === 'big.txt')!.sha256).toBe(sha(big));
    expect(JSON.stringify(result)).not.toContain(root);
  });
});

describe('visibility configuration (criterion 6)', () => {
  it('allows the two tools for intake only', async () => {
    const config = JSON.parse(await readFile(join(__dirname, '..', '..', 'product', 'opencode', 'opencode.json'), 'utf8')) as { permission: Record<string, string>; agent: Record<string, { permission?: Record<string, string> }> };
    const tools = ['ctf_challenge_list', 'ctf_challenge_read'];
    for (const tool of tools) expect(config.permission[tool]).toBeUndefined();
    expect(config.permission['*']).toBe('deny');
    for (const [name, agent] of Object.entries(config.agent)) {
      if (agent.permission === undefined) continue;
      for (const tool of tools) expect(agent.permission[tool] === 'allow', `${name} ${tool}`).toBe(name === 'intake');
      if (name !== 'intake') expect(agent.permission['*']).toBe('deny');
    }
  });
});
