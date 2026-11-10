// C design section 3.2: four denial classes observed in the alibaba-easy a2-a8 batches. These tests cover the
// diagnostic detail added for `read path` and `binding lapsed`, the fixed hint added for `artifact source`, and
// confirm the four recorded `http.request` timeout args never trip argument-bound validation offline (the real
// denials were the live request missing its deadline, not an out-of-range argument; see the design note).
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { ControlService } from '../../apps/launcher/src/control-service.js';

const services: ControlService[] = [];
afterAll(async () => { await Promise.all(services.map(s => s.stopAll('test end'))); });

async function fixture(expiresAt = Date.now() + 60000, target?: string) {
  const root = await mkdtemp(join(tmpdir(), 'c-denial-detail-'));
  const materialsDir = join(root, 'X/materials'); await mkdir(materialsDir, { recursive: true });
  const workdir = join(root, 'opencode'); await mkdir(workdir, { recursive: true });
  const skillRoot = join(workdir, 'config/opencode/skills'); await mkdir(skillRoot, { recursive: true });
  const roles = new Map<string, string>();
  const client = { session: {
    get: async ({ sessionID }: { sessionID: string }) => ({ data: { id: sessionID, parentID: 'root', agent: roles.get(sessionID) } }),
    children: async () => ({ data: [] }), abort: async () => ({ data: true }),
    messages: async () => ({ data: [] }),
  } };
  const service = new ControlService({ runId: 'c-denial', client: client as never, budget: { maxModelCalls: 100, maxObservableTokens: 100000 },
    expiresAt, workdir, skillRoot,
    challenges: [{ id: 'X', title: null, target: target ? { protocol: 'http' as const, url: target, host: '127.0.0.1', port: Number(new URL(target).port) } : null, reachability: null, materials: [], materialsDir }] });
  services.push(service); service.bindRoot('root');
  let n = 0;
  const exec = (sid: string, tool: string, args: object = {}) => service.handle(sid, 'tool.execute', { tool, args, callID: `c${++n}` });
  const before = (sid: string, tool: string, args: object = {}) => service.handle(sid, 'tool.before', { tool, args, callID: `b${++n}` });
  async function bind(sid: string, role = 'domain-solver', challenge = 'X') {
    roles.set(sid, role);
    await exec('root', 'challenge.assign', { role, challenge });
    const callID = `t${++n}`;
    await service.handle('root', 'tool.before', { tool: 'task', callID, args: { subagent_type: role, background: true } });
    await service.handle('root', 'tool.after', { tool: 'task', callID, metadata: { sessionId: sid }, output: 'running' });
    await service.handle(sid, 'chat.message', { agent: role });
  }
  // Roles outside CHALLENGE_ROLES (e.g. `reference`, `recovery-critic`) are dispatched without a declared
  // challenge, same as the production dispatch table.
  async function bindPlain(sid: string, role: string) {
    roles.set(sid, role);
    const callID = `t${++n}`;
    await service.handle('root', 'tool.before', { tool: 'task', callID, args: { subagent_type: role, background: true } });
    await service.handle('root', 'tool.after', { tool: 'task', callID, metadata: { sessionId: sid }, output: 'running' });
    await service.handle(sid, 'chat.message', { agent: role });
  }
  await bind('solver');
  return { root, workdir, skillRoot, service, exec, before, bind, bindPlain };
}

describe('C design section 3.2 item 1: read path denial carries rootTag diagnostics, never widens access', () => {
  it('classifies materials/work/published-looking sandbox paths and skill-adjacent paths, never allowing them', async () => {
    const { workdir, before, service } = await fixture();
    for (const [sub, tag] of [['materials/statement.md', 'materials'], ['work/ses_x/note.txt', 'work'],
      ['published/abc.bin', 'published'], ['config/opencode/skills/x/SKILL.md', 'skill']] as const) {
      const err = await before('solver', 'read', { filePath: join(workdir, sub) }).catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe('denied: read path. read is limited to the Skill directory; '
        + 'for materials/work/published use workspace.read (or workspace.list/workspace.search/workspace.view) with a path rooted at materials/, work/ or published/.');
      const record = service.audit.at(-1)!;
      expect(record.detail).toMatchObject({ error: `rootTag=${tag} path=${join(workdir, sub)}` });
    }
  });
  it('classifies a wholly unrelated host path as outside', async () => {
    const { before, service } = await fixture();
    await before('solver', 'read', { filePath: '/opt/synthetic/outside.txt' }).catch((e: Error) => e);
    expect(service.audit.at(-1)!.detail).toMatchObject({ error: 'rootTag=outside path=/opt/synthetic/outside.txt' });
  });
  it('a real file inside the Skill root is still allowed', async () => {
    const { skillRoot, before } = await fixture();
    await writeFile(join(skillRoot, 'note.md'), 'hi');
    await expect(before('solver', 'read', { filePath: join(skillRoot, 'note.md') })).resolves.toMatchObject({ allowed: true });
  });
  it('a role with no workspace.* grant (e.g. reference, recovery-critic) gets a different hint, never told to use workspace.read', async () => {
    const { workdir, before, bindPlain } = await fixture();
    await bindPlain('ref', 'reference');
    const err = await before('ref', 'read', { filePath: join(workdir, 'materials/statement.md') }).catch((e: Error) => e);
    expect((err as Error).message).toBe('denied: read path. read is limited to the Skill directory; '
      + 'your role has no workspace.* grant and no other file access to materials/work/published.');
  });
});

describe('C design section 3.2 item 2: artifact.read on an unpublished ref is a model mistake, not a registration gap', () => {
  it('a ref string the model invented in its own notes was never published and is refused with a fixed hint', async () => {
    const { exec } = await fixture();
    await expect(exec('solver', 'artifact.read', { ref: '3e374c14-707c-4c07-8efe-a39e535a1a16' }))
      .rejects.toThrow('denied: artifact source. ref must be a value actually returned by a prior artifact.publish (or package.publish) call '
        + 'in this run and challenge; a ref-looking string written in a note, handoff or your own reasoning is not one.');
  });
  it('registering the ref via artifact.publish first makes the same ref readable', async () => {
    const { exec, workdir } = await fixture();
    await mkdir(join(workdir, '../X/work/solver'), { recursive: true });
    await writeFile(join(workdir, '../X/work/solver/out.txt'), 'evidence');
    const published = await exec('solver', 'artifact.publish', { source: 'file', path: 'work/out.txt' }) as { ref: string };
    await expect(exec('solver', 'artifact.read', { ref: published.ref })).resolves.toMatchObject({ ref: published.ref });
  });
});

describe('C design section 3.2 item 3: the 4 recorded http.request timeout denials were deadline races, not bad arguments', () => {
  it('the recorded timeout_ms values (absent, absent, 20000, 20000), with a synthetic request, all pass argument validation against a fast target', async () => {
    const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const target = `http://127.0.0.1:${port}`;
    try {
      const { exec, workdir } = await fixture(Date.now() + 60000, target);
      await mkdir(join(workdir, '../X/work/solver'), { recursive: true });
      for (const timeout_ms of [undefined, undefined, 20000, 20000]) {
        const result = await exec('solver', 'http.request', { method: 'POST', url: `${target}/synthetic`,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ probe: 'synthetic' }),
          ...(timeout_ms === undefined ? {} : { timeout_ms }) }) as { status: number };
        expect(result.status).toBe(200); // reached the target; no `tool timeout` or `timeout` denial from these arguments
      }
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
});

describe('C design section 3.2 item 4: binding lapsed at the run deadline is expected, and now self-documents in the audit', () => {
  it('a call denied exactly at expiresAt records the race in the audit detail, never in the model-visible message', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const expiresAt = Date.now() + 1000;
      const { exec, service } = await fixture(expiresAt);
      vi.setSystemTime(expiresAt);
      const err = await exec('solver', 'workspace.list', {}).catch((e: Error) => e);
      expect((err as Error).message).toBe('denied: binding lapsed');
      const record = service.audit.at(-1)!;
      expect(record.allow).toBe(false);
      expect(record.reason).toBe('denied: binding lapsed');
      expect((record.detail as { error?: string }).error).toBe(`expiresAt=${expiresAt} now=${expiresAt}`);
    } finally { vi.useRealTimers(); }
  });
});
