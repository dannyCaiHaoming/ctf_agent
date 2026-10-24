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
      if (sessionID === 'root' && mode === 'latest-unfinished') return { data: [msg(sessionID), { ...msg(sessionID), info: { ...msg(sessionID).info, id: 'newest', time: { created: 2 } }, parts: [] }] };
      if (sessionID === 'root' && mode === 'metadata-missing') return { data: [{ ...msg(sessionID), info: { ...msg(sessionID).info, time: {} }, parts: [] }] };
      if (sessionID === 'root' && mode === 'root-error') return { data: [{ ...msg(sessionID), info: { ...msg(sessionID).info, error: { name: 'APIError' } } }] };
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
    budget: { wallClockMs: 1500, maxSteps: 10, maxToolJobs: 1, maxObservableTokens: 10000 }, os: { platform: 'macos' } }));
  client = makeClient(); close = vi.fn(async () => { if (mode === 'close') throw error('close failed'); });
  fake.start.mockImplementation(async (options: { config: typeof config }) => { config = options.config; return { client, close, version: 'fake-sdk-1' }; });
});
afterEach(async () => { fake.failWrite = ''; delete process.env.LAUNCH_EVIDENCE_TEST_KEY; await rm(dir, { recursive: true, force: true }); });
async function run(failInStart = false) {
  return launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run', onStarted: async ({ rootId }) => {
    const opts = config.plugin[0]![1];
    const hooks = createCtfAgentHooks({ ...opts, tools: [] });
    await hooks['chat.params']!({ sessionID: rootId, agent: 'coordinator', model: { providerID: 'fake', id: 'model' } } as never, { maxOutputTokens: 1000 } as never);
    await fetch(opts.controlUrl, { method: 'POST', headers: { authorization: `Bearer ${opts.controlToken}` },
      body: JSON.stringify({ sessionID: rootId, operation: 'tool.execute', input: { tool: 'challenge.assign', args: { role: 'recon', challenge: 'offline' } } }) });
    await hooks['tool.execute.before']!({ sessionID: rootId, tool: 'task', callID: 'dispatch' }, { args: { subagent_type: 'recon' } });
    if (mode !== 'pending-task') await hooks['chat.message']!({ sessionID: 'child', agent: 'recon' } as never, {} as never);
    if (failInStart) throw error('original run failed');
  } });
}
const json = async (name: string) => JSON.parse(await readFile(join(dir, 'runs/run', name), 'utf8'));
async function checkEvidence() {
  for (const name of ['bindings.json', 'admissions.json', 'control-audit.json', 'assets.json', 'sessions.json']) await json(`evidence/${name}`);
  const progressJsonl = await readFile(join(dir, 'runs/run/progress.jsonl'), 'utf8');
  const progressMarkdown = await readFile(join(dir, 'runs/run/progress.md'), 'utf8');
  expect(progressJsonl.trim().split('\n').length).toBeGreaterThan(0);
  expect(progressMarkdown).toContain('## Recovery Critic 判斷');
  expect(progressJsonl).not.toContain(SECRET);
  expect(progressMarkdown).not.toContain(SECRET);
  expect((await json('evidence/admissions.json')).some((r: { allow: boolean }) => r.allow)).toBe(true);
  for (const folder of ['state', 'evidence']) for (const name of await readdir(join(dir, 'runs/run', folder))) {
    expect(await readFile(join(dir, 'runs/run', folder, name), 'utf8')).not.toContain(SECRET);
  }
  return json('state/run.json');
}

describe('temporary root completeness SDK stand-in', () => {
  it.each([
    ['latest-unfinished', 'completed', 0],
    ['pending-task', 'deadline_exceeded', 1],
    ['metadata-missing', 'deadline_exceeded', 1],
    ['root-error', 'failed', 1],
    ['unknown-finish', 'completed', 0]
  ])('%s', async (fault, status, code) => {
    mode = String(fault);
    const result = await run();
    expect(result).toMatchObject({status, code});
    const record=await json('state/run.json');
    console.log(JSON.stringify({mode, result, stopReason: record.stopReason, admitted: record.admittedModelCalls}));
  });
});
