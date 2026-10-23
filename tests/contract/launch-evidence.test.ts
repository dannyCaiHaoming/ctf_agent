import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCtfAgentHooks } from '../../apps/opencode-plugin/src/index.js';

const fake = vi.hoisted(() => ({ start: vi.fn(), failWrite: '' }));
vi.mock('@ctf/opencode-bridge', async importOriginal => ({ ...await importOriginal<object>(), startManagedOpenCode: fake.start }));
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return { ...fs, writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
    if (fake.failWrite && String(args[0]).endsWith(fake.failWrite)) throw new Error('injected write failure');
    return fs.writeFile(...args);
  } };
});
import { launch } from '../../apps/launcher/src/launch.js';

const SECRET = 'fictional-evidence-key-0123456789';
const msg = (sessionID: string) => ({ info: { id: `msg-${sessionID}`, sessionID, role: 'assistant', agent: 'coordinator',
  tokens: { input: 400, output: 150, reasoning: 50 }, time: { completed: 1 } }, parts: [{ type: 'text', text: SECRET }] });
let dir: string;
let mode: string;
let reads: number;
let childGets: number;
let config: { plugin: Array<[string, { controlUrl: string; controlToken: string }]> };
let client: ReturnType<typeof makeClient>;
let close: ReturnType<typeof vi.fn>;
const error = (text: string) => new Error(`${text}: ${SECRET}`);
function makeClient() {
  return { app: { agents: async () => ({ data: [] }), skills: async () => ({ data: [] }) }, session: {
    create: async () => ({ data: { id: 'root' } }),
    promptAsync: async () => ({}),
    get: async ({ sessionID }: { sessionID: string }) => {
      if (sessionID === 'child' && ++childGets > 1 && mode === 'export') throw error('child export failed');
      return { data: { id: sessionID, parentID: sessionID === 'root' ? undefined : 'root', agent: 'recon', title: sessionID } };
    },
    children: async ({ sessionID }: { sessionID: string }) => {
      if (mode === 'children') throw error('children failed');
      return { data: sessionID === 'root' ? [{ id: 'child' }, ...(['export', 'abort', 'unbound', 'unbound-missing'].includes(mode) ? [{ id: 'other' }] : [])] : [] };
    },
    messages: async ({ sessionID }: { sessionID: string }) => {
      if (sessionID === 'root' && ++reads >= 3 && (mode === 'usage' || mode === 'missing')) throw error('usage failed');
      if ((mode === 'messages' && sessionID === 'child') || (mode === 'unbound-missing' && sessionID === 'other')) throw error('child messages failed');
      if (mode === 'zeroed' && reads >= 3 && sessionID === 'root') return { data: [{ ...msg(sessionID), info: { ...msg(sessionID).info, tokens: { input: 0, output: 0, reasoning: 0 }, error: { name: 'MessageAbortedError' } } }] };
      return { data: sessionID === 'other' && mode !== 'unbound' ? [] : mode === 'missing' ? [] : [msg(sessionID)] };
    },
    status: async () => { if (mode === 'status') throw error('status failed'); return { data: { root: { type: 'idle' }, child: { type: 'busy' } } }; },
    abort: vi.fn(async ({ sessionID }: { sessionID: string }) => {
      if (mode === 'abort' && sessionID === 'child') throw error('abort failed');
      return { data: true };
    })
  } };
}
beforeEach(async () => {
  dir = realpathSync(await mkdtemp(join(tmpdir(), 'launch-evidence-')));
  mode = ''; reads = 0; childGets = 0; fake.failWrite = '';
  process.env.LAUNCH_EVIDENCE_TEST_KEY = SECRET;
  await writeFile(join(dir, 'opencode.json'), JSON.stringify({ model: 'fake/model', provider: { fake: {
    npm: '@ai-sdk/openai-compatible', options: { apiKey: '{env:LAUNCH_EVIDENCE_TEST_KEY}', baseURL: 'http://127.0.0.1:1' }, models: { model: {} }
  } } }));
  await writeFile(join(dir, 'challenges.json'), JSON.stringify({ challenges: [{ id: 'offline', statement: 'fixture' }] }));
  await writeFile(join(dir, 'profile.json'), JSON.stringify({ profileId: 'test', opencode: { configPath: 'opencode.json' }, challenges: 'challenges.json', reference: { enabled: false },
    budget: { wallClockMs: 10000, maxSteps: 10, maxToolJobs: 1, maxObservableTokens: 10000 }, os: { platform: 'macos' } }));
  client = makeClient(); close = vi.fn(async () => { if (mode === 'close') throw error('close failed'); });
  fake.start.mockImplementation(async (options: { config: typeof config }) => { config = options.config; return { client, close, version: 'fake-sdk-1' }; });
});
afterEach(async () => { fake.failWrite = ''; delete process.env.LAUNCH_EVIDENCE_TEST_KEY; await rm(dir, { recursive: true, force: true }); });
async function run(failInStart = false) {
  return launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run', onStarted: async ({ rootId }) => {
    const opts = config.plugin[0]![1];
    const hooks = createCtfAgentHooks({ ...opts, tools: [] });
    await hooks['chat.params']!({ sessionID: rootId, agent: 'coordinator', model: { providerID: 'fake', id: 'model' } } as never, { maxOutputTokens: 1000 } as never);
    await hooks['tool.execute.before']!({ sessionID: rootId, tool: 'task', callID: 'dispatch' }, { args: { subagent_type: 'recon' } });
    await hooks['chat.message']!({ sessionID: 'child', agent: 'recon' } as never, {} as never);
    if (failInStart) throw error('original run failed');
  } });
}
const json = async (name: string) => JSON.parse(await readFile(join(dir, 'runs/run', name), 'utf8'));
async function checkEvidence() {
  for (const name of ['bindings.json', 'admissions.json', 'control-audit.json', 'assets.json', 'sessions.json']) await json(`evidence/${name}`);
  expect((await json('evidence/admissions.json')).some((r: { allow: boolean }) => r.allow)).toBe(true);
  for (const folder of ['state', 'evidence']) for (const name of await readdir(join(dir, 'runs/run', folder))) {
    expect(await readFile(join(dir, 'runs/run', folder, name), 'utf8')).not.toContain(SECRET);
  }
  return json('state/run.json');
}
describe('launch failure evidence with SDK stand-in only', () => {
  it('keeps normal success and complete reported usage', async () => {
    expect(await run()).toMatchObject({ code: 0, status: 'completed' });
    const record = await checkEvidence();
    expect(record.usageTotal).toMatchObject({ availability: 'reported', input_tokens: 800, output_tokens: 300, reasoning_tokens: 100, lowerBound: false });
    expect(record.opencodeVersion).toBe('fake-sdk-1');
  });
  it('retains admitted calls and known usage after SDK read failure', async () => {
    mode = 'usage';
    expect(await run()).toMatchObject({ code: 1, status: 'failed' });
    const record = await checkEvidence();
    expect(record.usageTotal.input_tokens).toBeGreaterThanOrEqual(400);
    expect(record.usageTotal.lowerBound).toBe(true);
    expect(JSON.stringify(record.timeline)).toContain('usage failed');
  });
  it.each(['children', 'export'])('continues other bound sessions after %s failure', async fault => {
    mode = fault;
    expect(await run()).toMatchObject({ code: 1, status: 'failed' });
    const record = await checkEvidence();
    expect(JSON.stringify(record.timeline)).toContain(fault === 'children' ? 'children failed' : 'child export failed');
    expect(await json('evidence/messages-root.json')).toHaveLength(1);
    if (fault === 'export') expect(await json('evidence/messages-other.json')).toEqual([]);
    const sessions = await json('evidence/sessions.json');
    expect(sessions.find((s: { id: string }) => s.id === 'child').status).toBe('busy');
  });
  it('keeps original and close errors plus memory evidence', async () => {
    mode = 'close';
    expect(await run(true)).toMatchObject({ code: 1, status: 'failed' });
    const record = await checkEvidence();
    expect(JSON.stringify(record.timeline)).toContain('original run failed');
    expect(JSON.stringify(record.timeline)).toContain('close failed');
    expect(record.model).toBe('fake/model');
    expect(record.configSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('records real per-session abort results and continues remaining aborts', async () => {
    mode = 'abort';
    expect(await run()).toMatchObject({ code: 1, status: 'failed' });
    await checkEvidence();
    expect(client.session.abort.mock.calls.map(([p]) => p.sessionID)).toContain('other');
    const audit = await json('evidence/control-audit.json');
    expect(audit.some((r: { op: string; sessionID: string; allow: boolean }) => r.op === 'aborted' && r.sessionID === 'child' && !r.allow)).toBe(true);
    expect(audit.some((r: { op: string; allow: boolean; detail?: { sessions?: string[] } }) => r.op === 'aborted' && r.allow && r.detail?.sessions?.includes('child'))).toBe(false);
  });
  it('does not fabricate messages or idle status when export reads fail', async () => {
    mode = 'messages';
    expect(await run()).toMatchObject({ code: 1, status: 'failed' });
    const record = await checkEvidence();
    expect(record.usageTotal.lowerBound).toBe(true);
    expect(await readdir(join(dir, 'runs/run/evidence'))).not.toContain('messages-child.json');
    expect(await json('evidence/messages-root.json')).toHaveLength(1);
    mode = 'status';
    // Use another output directory for a separate failed-status run.
    await rm(join(dir, 'runs'), { recursive: true }); reads = 0; childGets = 0;
    expect(await run()).toMatchObject({ code: 1, status: 'failed' });
    const sessions = await json('evidence/sessions.json');
    expect(sessions.every((s: { status: string }) => s.status === 'unavailable')).toBe(true);
  });
  it('keeps retained message consumption in the actual run file after abort zeroes it', async () => {
    mode = 'zeroed';
    expect(await run()).toMatchObject({ code: 1, status: 'failed' });
    const record = await checkEvidence();
    expect(record.usageTotal).toMatchObject({ input_tokens: 800, output_tokens: 300, reasoning_tokens: 100, lowerBound: true });
  });
  it('marks completely missing usage unavailable in the run file', async () => {
    mode = 'missing';
    expect(await run(true)).toMatchObject({ code: 1, status: 'failed' });
    const record = await checkEvidence();
    expect(record.usageTotal).toMatchObject({ availability: 'unavailable', lowerBound: true });
  });
  it('includes known SDK descendant usage even if the descendant never bound', async () => {
    mode = 'unbound';
    expect(await run()).toMatchObject({ code: 0, status: 'completed' });
    const record = await checkEvidence();
    expect(record.usageTotal).toMatchObject({ input_tokens: 1200, output_tokens: 450, reasoning_tokens: 150 });
  });
  it('marks total as a lower bound if an unbound descendant export fails', async () => {
    mode = 'unbound-missing';
    expect(await run()).toMatchObject({ code: 1, status: 'failed' });
    const record = await checkEvidence();
    expect(record.usageTotal).toMatchObject({ input_tokens: 800, lowerBound: true });
    expect(await readdir(join(dir, 'runs/run/evidence'))).not.toContain('messages-other.json');
  });
  it('continues evidence writes and records a single-file write failure', async () => {
    fake.failWrite = '/admissions.json';
    expect(await run()).toMatchObject({ code: 1, status: 'failed' });
    expect(await json('evidence/assets.json')).toHaveProperty('productRevision');
    expect(await json('evidence/control-audit.json')).not.toHaveLength(0);
    const record = await json('state/run.json');
    expect(record.status).toBe('failed');
    expect(JSON.stringify(record.timeline)).toContain('injected write failure');
  });
});
