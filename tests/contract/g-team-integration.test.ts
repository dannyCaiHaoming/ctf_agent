import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlService } from '../../apps/launcher/src/control-service.js';
import { prepareRun } from '../../apps/launcher/src/run-prep.js';
import { readMaterial } from '../../apps/launcher/src/intake-tools.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const f of cleanup.splice(0).reverse()) await f(); });
async function fixture() {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), 'g-team-')));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'evidence'));
  await writeFile(join(dir, 'binary.bin'), Buffer.from([0, 255, 1, 2, 3, 4, 5, 6, 7]));
  await writeFile(join(dir, 'challenges.json'), JSON.stringify({ challenges: [{ id: 'X', statement: 'a'.repeat(32767) + '界'.repeat(20), materials: ['binary.bin'] }] }));
  const challenges = await prepareRun({ challengesPath: join(dir, 'challenges.json'), workspace: join(dir, 'workspace'), evidence: join(dir, 'evidence'), secrets: [] });
  const sessions: Record<string, { parentID: string; agent: string }> = {};
  const client = { session: { get: async ({ sessionID }: { sessionID: string }) => ({ data: { id: sessionID, ...sessions[sessionID] } }),
    messages: async () => ({ data: [] }), children: async () => ({ data: [] }), abort: async () => ({ data: true }) } };
  const c = new ControlService({ client: client as never, budget: { maxModelCalls: 100, maxObservableTokens: 10000 }, expiresAt: Date.now() + 60000,
    workdir: join(dir, 'opencode'), skillRoot: join(dir, 'skills'), challenges });
  c.bindRoot('root'); cleanup.push(() => c.stopAll('cleanup'));
  async function bind(id: string, role: string) {
    sessions[id] = { parentID: 'root', agent: role };
    if (['recon', 'domain-solver', 'engineer', 'verifier'].includes(role)) await c.handle('root', 'tool.execute', { tool: 'challenge.assign', args: { challenge: 'X', role } });
    await c.handle('root', 'tool.before', { tool: 'task', callID: `dispatch-${id}`, args: { subagent_type: role } });
    await c.handle(id, 'chat.message', { agent: role });
  }
  let n = 0;
  async function execute(id: string, tool: string, args: Record<string, unknown> = {}) {
    const callID = `call-${++n}`;
    await c.handle(id, 'tool.before', { tool: `ctf_${tool.replaceAll('.', '_')}`, callID, args });
    return c.handle(id, 'tool.execute', { tool, callID, args });
  }
  return { c, dir, challenges, bind, execute };
}

// Missing first-bind preparation or a common work root breaks real E materials and session isolation.
it('E prepareRun binds the real materials and prepares separate work before first admission', async () => {
  const { c, dir, challenges, bind, execute } = await fixture();
  await bind('intake', 'intake');
  expect(await execute('intake', 'challenge.list')).toMatchObject({ challenges: [{ id: 'X' }] });
  await bind('solver', 'domain-solver'); await bind('engineer', 'engineer');
  expect(challenges[0]!.materialsDir).toBe(join(dir, 'workspace/X/materials'));
  for (const id of ['solver', 'engineer']) {
    expect(c.bindings.get(id)).toMatchObject({ challengeId: 'X' });
    expect((await stat(join(dir, 'workspace/X/work', id))).isDirectory()).toBe(true);
    await expect(c.handle(id, 'model.call', { agent: id === 'solver' ? 'domain-solver' : 'engineer' })).resolves.toHaveProperty('admitNo');
  }
  await execute('solver', 'workspace.write', { path: 'work/private.txt', content: 'solver only' });
  await execute('engineer', 'workspace.write', { path: 'work/private.txt', content: 'engineer only' });
  expect(await readFile(join(dir, 'workspace/X/work/solver/private.txt'), 'utf8')).toBe('solver only');
  expect(await execute('engineer', 'workspace.read', { path: 'work/private.txt' })).toMatchObject({ text: 'engineer only' });
  await expect(execute('engineer', 'workspace.read', { path: 'work/../solver/private.txt' })).rejects.toThrow('workspace path');
  await expect(execute('engineer', 'workspace.read', { path: join(dir, 'workspace/X/work/solver/private.txt') })).rejects.toThrow('workspace path');
  for (const path of ['materials/statement.md', 'published/fake.txt']) await expect(execute('engineer', 'workspace.write', { path, content: 'no' })).rejects.toThrow();
});

// Divergent page/cursor/binary handling would make Intake and Solver see different pinned evidence.
it('E and G read the same UTF-8 pages and binary signature and reject escaping links', async () => {
  const { dir, challenges, bind, execute } = await fixture(); await bind('solver', 'domain-solver');
  for (const path of ['statement.md', 'binary.bin']) {
    let cursor: string | undefined;
    do {
      const e = await readMaterial(challenges, { id: 'X', path, cursor });
      const g = await execute('solver', 'workspace.read', { path: `materials/${path}`, cursor }) as Record<string, unknown>;
      const { id: _id, path: _path, ...expected } = e;
      expect(g).toEqual({ path: `materials/${path}`, ...expected });
      cursor = 'nextCursor' in e ? e.nextCursor ?? undefined : undefined;
    } while (cursor);
  }
  await expect(readMaterial(challenges, { id: 'X', path: 'statement.md', cursor: '32768' })).rejects.toThrow('cursor');
  await expect(execute('solver', 'workspace.read', { path: 'materials/statement.md', cursor: '32768' })).rejects.toThrow('cursor');
  await symlink(join(dir, 'binary.bin'), join(challenges[0]!.materialsDir, 'escape'));
  await expect(readMaterial(challenges, { id: 'X', path: 'escape' })).rejects.toThrow('material path');
  await expect(execute('solver', 'workspace.read', { path: 'materials/escape' })).rejects.toThrow('workspace path');
});

// C must deny direct execution as well as hook visibility; Verifier keeps local recomputation only.
it('enforces all nine roles at both hooks and execution, with independent Verifier work', async () => {
  const { bind, execute, c } = await fixture();
  for (const role of ['intake', 'reference', 'strategy', 'recovery-critic']) {
    await bind(role, role);
    for (const tool of ['workspace.write', 'job.run', 'http.request']) {
      await expect(execute(role, tool, { path: 'work/x', content: 'no', argv: [process.execPath, '-e', ''], url: 'http://127.0.0.1:1' })).rejects.toThrow('tool not permitted');
      await expect(c.handle(role, 'tool.execute', { tool, callID: `bypass-${role}-${tool}`, args: {} })).rejects.toThrow('tool not permitted');
    }
  }
  for (const role of ['recon', 'domain-solver', 'engineer', 'verifier']) {
    await bind(role, role);
    await execute(role, 'workspace.write', { path: 'work/own.txt', content: role });
    expect(await execute(role, 'workspace.read', { path: 'work/own.txt' })).toMatchObject({ text: role });
    const result = await execute(role, 'job.run', { argv: [process.execPath, '-e', 'console.log(6*7)'], timeout_ms: 3000 });
    expect(result).toMatchObject({ state: 'exited', exitCode: 0 });
    if (role === 'engineer' || role === 'verifier') {
      await expect(execute(role, 'http.request', { url: 'http://127.0.0.1:1' })).rejects.toThrow('tool not permitted');
      await expect(c.handle(role, 'tool.execute', { tool: 'http.request', callID: `direct-${role}`, args: {} })).rejects.toThrow('tool not permitted');
    }
  }
  await expect(execute('root', 'workspace.write', { path: 'work/x', content: 'no' })).rejects.toThrow('tool not permitted');
  await expect(execute('verifier', 'workspace.read', { path: 'work/../domain-solver/own.txt' })).rejects.toThrow('workspace path');
});
