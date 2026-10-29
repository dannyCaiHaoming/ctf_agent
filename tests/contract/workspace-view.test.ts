import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tool } from '@opencode-ai/plugin';
import type { ToolResult } from '@opencode-ai/plugin/tool';
import { ControlService, ROLES, type Role } from '../../apps/launcher/src/control-service.js';
import type { ArtifactPublisher } from '../../apps/launcher/src/artifact-tools.js';
import { startControlRpc } from '../../apps/launcher/src/control-rpc.js';
import { createCtfAgentHooks } from '../../apps/opencode-plugin/src/index.js';
import * as workspace from '../../apps/launcher/src/workspace-tools.js';

// Valid synthetic 1x1 images, with no challenge answer or model invocation.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
const jpeg = Buffer.from('/9j/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD4vooor+Uz/fw//9k=', 'base64');
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const workspaceRoles: Role[] = ['recon', 'domain-solver', 'engineer', 'verifier'];
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-view-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const challenges = await Promise.all(['X', 'Y'].map(async id => {
    const materialsDir = join(dir, id, 'materials');
    await mkdir(materialsDir, { recursive: true });
    await writeFile(join(materialsDir, 'image.bin'), png);
    return { id, title: null, target: null, reachability: null, materials: [], materialsDir };
  }));
  const roles = new Map<string, Role>();
  const client = { session: {
    get: async ({ sessionID }: { sessionID: string }) => ({ data: { id: sessionID, parentID: 'root', agent: roles.get(sessionID) } }),
    children: async () => ({ data: [] }), messages: async () => ({ data: [] }), abort: async () => ({ data: true })
  } };
  const service = new ControlService({ client: client as never, runId: 'view-test', challenges,
    budget: { maxModelCalls: 100, maxObservableTokens: 100000 }, expiresAt: Date.now() + 60000,
    workdir: join(dir, 'opencode'), skillRoot: join(dir, 'skills'), redactions: ['PRIVATE_SENTINEL'] });
  cleanup.push(() => service.stopAll('test cleanup'));
  service.bindRoot('root');
  let call = 0;
  const exec = (sid: string, name: string, args: object = {}, signal?: AbortSignal) =>
    service.handle(sid, 'tool.execute', { tool: name, args, callID: `c${++call}` }, signal);
  async function bind(role: Role, id = role as string, challenge = 'X', version?: string) {
    roles.set(id, role);
    if (workspaceRoles.includes(role)) await exec('root', 'challenge.assign', { role, challenge, ...(version ? { version } : {}) });
    const callID = `dispatch-${++call}`;
    await service.handle('root', 'tool.before', { tool: 'task', callID, args: { subagent_type: role, background: true } });
    await service.handle('root', 'tool.after', { tool: 'task', callID, metadata: { sessionId: id }, output: 'running' });
    await service.handle(id, 'chat.message', { agent: role });
  }
  await bind('domain-solver'); await bind('engineer');
  const roots = { materialsDir: challenges[0]!.materialsDir, workDir: join(dir, 'X/work/domain-solver'), publishedDir: join(dir, 'X/published') };
  async function publish(bytes = png) {
    await exec('domain-solver', 'workspace.write', { path: 'work/image.bin', content: bytes.toString('base64'), encoding: 'base64' });
    return await exec('domain-solver', 'artifact.publish', { source: 'file', path: 'work/image.bin' }) as { ref: string; path: string };
  }
  return { dir, service, exec, bind, roots, publish };
}

function expectImage(result: ToolResult, path: string, mime: string, bytes: Buffer) {
  expect(typeof result).toBe('object');
  const value = result as Exclude<ToolResult, string>;
  expect(JSON.parse(value.output)).toEqual({ path, mime, sha256: digest(bytes), size: bytes.length });
  expect(value.attachments).toEqual([{ type: 'file', mime, url: `data:${mime};base64,${bytes.toString('base64')}` }]);
  expect(Buffer.from(value.attachments![0]!.url.split(',')[1]!, 'base64')).toEqual(bytes);
}

describe('workspace.view plumbing only (no model visibility or reading claim)', () => {
  it.each([{ bytes: png, mime: 'image/png', name: 'image.jpg' }, { bytes: jpeg, mime: 'image/jpeg', name: 'image.png' }])(
    'detects $mime content independently of extension and preserves exact bytes', async ({ bytes, mime, name }) => {
      const f = await fixture();
      await writeFile(join(f.roots.workDir, name), bytes);
      expect(await workspace.viewWorkspace(f.roots, { path: `work/${name}` })).toEqual({ mime, bytes, sha256: digest(bytes), size: bytes.length });
      expectImage(await f.exec('domain-solver', 'workspace.view', { path: `work/${name}` }) as ToolResult, `work/${name}`, mime, bytes);
      const p = await f.publish(bytes);
      expectImage(await f.exec('engineer', 'workspace.view', { path: p.path }) as ToolResult, p.path, mime, bytes);
    }
  );

  it('preserves the structured attachment through real control RPC and plugin execute', async () => {
    const f = await fixture();
    const rpc = await startControlRpc((id, op, input, signal) => f.service.handle(id, op, input, signal)); cleanup.push(rpc.close);
    const hooks = createCtfAgentHooks({ controlUrl: rpc.url, controlToken: rpc.token, tools: ['workspace.view', 'workspace.read'] });
    const args = { path: 'materials/image.bin' };
    const context = { sessionID: 'domain-solver', abort: new AbortController().signal } as never;
    await expect(hooks.tool!.ctf_workspace_view!.execute(args, context)).rejects.toThrow('missing trusted call');
    await hooks['tool.execute.before']!({ sessionID: 'domain-solver', tool: 'ctf_workspace_view', callID: 'plugin-view' }, { args });
    expectImage(await hooks.tool!.ctf_workspace_view!.execute(args, context), args.path, 'image/png', png);
    await expect(hooks.tool!.ctf_workspace_view!.execute(args, context)).rejects.toThrow('missing trusted call');
    // Existing non-image managed results retain their JSON text contract.
    const readArgs = { path: 'materials/image.bin' };
    await hooks['tool.execute.before']!({ sessionID: 'domain-solver', tool: 'ctf_workspace_read', callID: 'plugin-read' }, { args: readArgs });
    const read = await hooks.tool!.ctf_workspace_read!.execute(readArgs, context) as Exclude<ToolResult, string>;
    expect(read.attachments).toBeUndefined(); expect(JSON.parse(read.output)).toMatchObject({ size: png.length });
  });

  it('refuses non-images despite an image suffix and refuses oversized local or fixed bytes', async () => {
    const f = await fixture();
    for (const bytes of [Buffer.from('not an image'), Buffer.alloc(0), Buffer.from([0x89, 0x50, 0x4e]), Buffer.from('<svg/>')]) {
      await writeFile(join(f.roots.workDir, 'fake.png'), bytes);
      await expect(f.exec('domain-solver', 'workspace.view', { path: 'work/fake.png' })).rejects.toThrow('denied: image type');
    }
    const large = Buffer.concat([png, Buffer.alloc(1048577 - png.length)]);
    await writeFile(join(f.roots.workDir, 'large'), large);
    await expect(f.exec('domain-solver', 'workspace.view', { path: 'work/large' })).rejects.toThrow('denied: image size');
    await expect(workspace.viewWorkspace(f.roots, { path: 'published/large.bin' }, [{ path: 'published/large.bin', bytes: large }])).rejects.toMatchObject({ code: 'image size' });
  });

  it('bounds base64 inflation at the inclusive 1 MiB source boundary and redacts path metadata', async () => {
    const f = await fixture(); const bytes = Buffer.concat([png, Buffer.alloc(1048576 - png.length)]);
    await writeFile(join(f.roots.workDir, 'PRIVATE_SENTINEL.png'), bytes);
    const result = await f.exec('domain-solver', 'workspace.view', { path: 'work/PRIVATE_SENTINEL.png' }) as Exclude<ToolResult, string>;
    expectImage(result, 'work/<redacted>.png', 'image/png', bytes);
    expect(result.output).not.toContain(f.dir);
    expect(result.attachments![0]!.url.length).toBe(22 + 1398104);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(1398104 + 4096);
  });

  it('rejects malformed paths, directories, remote/data URLs, symlinks and sibling work access', async () => {
    const f = await fixture();
    await writeFile(join(f.dir, 'outside.png'), png);
    await symlink(join(f.dir, 'outside.png'), join(f.roots.workDir, 'escape'));
    await symlink(join(f.roots.materialsDir, 'image.bin'), join(f.roots.workDir, 'inside-link'));
    await symlink(f.roots.materialsDir, join(f.roots.workDir, 'linked-dir'));
    for (const path of [undefined, null, 1, '', '.', 'image.bin', '/tmp/image.png', f.dir,
      '../outside.png', 'work/../engineer/image.bin', 'work//image.bin', 'work/./image.bin', 'work\\image.bin', 'work/a\0.png',
      'work', 'materials', 'published', 'work/escape', 'work/inside-link', 'work/linked-dir/image.bin',
      'https://example.com/image.png', `data:image/png;base64,${png.toString('base64')}`]) {
      await expect(f.exec('domain-solver', 'workspace.view', { path })).rejects.toThrow('denied');
    }
    await expect(workspace.viewWorkspace({ ...f.roots, materialsDir: join(f.roots.workDir, 'linked-dir') }, { path: 'materials/image.bin' })).rejects.toBeInstanceOf(workspace.WorkspaceRefused);
    await expect(f.exec('domain-solver', 'workspace.view', { path: 'materials/image.bin', url: 'https://example.com' })).rejects.toThrow('denied');
  });

  it('uses registered same-run/challenge snapshots and refuses unregistered, tampered or symlinked publications', async () => {
    const f = await fixture(); const p = await f.publish();
    await writeFile(join(f.roots.publishedDir, 'unregistered.bin'), png);
    for (const path of ['published/unregistered.bin', 'published/sub/image.bin', 'published/.bin']) {
      await expect(f.exec('engineer', 'workspace.view', { path })).rejects.toThrow('denied');
    }
    await expect(workspace.viewWorkspace(f.roots, { path: 'published/unregistered.bin' }, [])).rejects.toBeInstanceOf(workspace.WorkspaceRefused);
    await f.bind('engineer', 'other', 'Y');
    await expect(f.exec('other', 'workspace.view', { path: p.path })).rejects.toThrow('denied');
    const g = await fixture();
    await expect(g.exec('engineer', 'workspace.view', { path: p.path })).rejects.toThrow('denied');
    // Still an image: rejection must come from snapshot integrity, not MIME detection.
    await writeFile(join(f.dir, 'X', p.path), jpeg);
    await expect(f.exec('engineer', 'workspace.view', { path: p.path })).rejects.toThrow('denied');
    await rm(join(f.dir, 'X', p.path));
    await symlink(join(f.roots.materialsDir, 'image.bin'), join(f.dir, 'X', p.path));
    await expect(f.exec('engineer', 'workspace.view', { path: p.path })).rejects.toThrow('denied');
  });

  it('grants exactly the read/search workspace roles in both host gates and role configuration', async () => {
    const f = await fixture(); const p = await f.publish();
    const pkg = await f.exec('engineer', 'package.publish', { candidate: { ref: p.ref, start: 0, end: 1 }, files: [], extraction: 'synthetic byte', premises: [] }) as { version: string };
    await f.bind('recon'); await f.bind('verifier', 'verifier', 'X', pkg.version);
    for (const role of ['intake', 'reference', 'strategy', 'recovery-critic'] as const) await f.bind(role);
    const config = JSON.parse(await readFile(new URL('../../product/opencode/opencode.json', import.meta.url), 'utf8'));
    for (const role of ROLES) {
      const id = role === 'coordinator' ? 'root' : role;
      const permission = config.agent[role].permission;
      expect(permission.ctf_workspace_view === 'allow').toBe(workspaceRoles.includes(role));
      expect(permission.ctf_workspace_view).toBe(permission.ctf_workspace_read);
      expect(permission.ctf_workspace_view).toBe(permission.ctf_workspace_search);
      for (const name of ['workspace.read', 'workspace.search', 'workspace.view']) {
        const precheck = f.service.handle(id, 'tool.before', { tool: `ctf_${name.replace('.', '_')}`, callID: `gate-${name}`, args: { path: 'materials/image.bin' } });
        if (workspaceRoles.includes(role)) await expect(precheck).resolves.toMatchObject({ allowed: true });
        else await expect(precheck).rejects.toThrow('denied');
      }
      const call = f.exec(id, 'workspace.view', { path: 'materials/image.bin' });
      if (workspaceRoles.includes(role)) expectImage(await call as ToolResult, 'materials/image.bin', 'image/png', png);
      else await expect(call).rejects.toThrow('denied');
    }
    await f.service.revoke('domain-solver');
    await expect(f.exec('domain-solver', 'workspace.view', { path: p.path })).rejects.toThrow('denied');
    const aborted = new AbortController(); aborted.abort();
    await expect(f.exec('engineer', 'workspace.view', { path: p.path }, aborted.signal)).rejects.toThrow('denied');
  });

  it('does not deliver an attachment if the caller cancels during published snapshot resolution', async () => {
    const f = await fixture(); const p = await f.publish(); const abort = new AbortController();
    const publisher = (f.service as unknown as { publications: ArtifactPublisher }).publications;
    const original = publisher.bytes.bind(publisher);
    publisher.bytes = async (...args: Parameters<ArtifactPublisher['bytes']>) => {
      const fixed = await original(...args);
      abort.abort(); // exact phase: authorized bytes resolved, attachment not yet constructed
      return fixed;
    };
    await expect(f.exec('engineer', 'workspace.view', { path: p.path }, abort.signal)).rejects.toThrow('denied: cancelled');
    expect(f.service.resourceSnapshot().at(-1)).toMatchObject({ tool: 'workspace.view', state: 'settled', result: 'cancelled' });
  });

  it('exposes exactly one required root-qualified path in the plugin schema', () => {
    const hooks = createCtfAgentHooks({ controlUrl: 'http://127.0.0.1:43210/control', controlToken: 'x'.repeat(40), tools: ['workspace.view'] });
    const definition = hooks.tool!.ctf_workspace_view!;
    expect(Object.keys(definition.args)).toEqual(['path']);
    const schema = tool.schema.object(definition.args);
    expect(schema.safeParse({ path: 'materials/image.bin' }).success).toBe(true);
    for (const path of [undefined, null, '.', 'work', 'file.png', '/tmp/a', 'work/../a', 'work/./a', 'work//a', 'data:image/png;base64,abc', 'https://example.com/a']) {
      expect(schema.safeParse({ path }).success).toBe(false);
    }
  });
});
