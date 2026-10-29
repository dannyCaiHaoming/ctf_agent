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
  tokens: { input: 400, output: 150, reasoning: 50 }, parentID: `user-${sessionID}`, finish: 'stop', time: { created: 2, completed: 3 } }, parts: [{ type: 'text', text: SECRET }] });
const user = (id: string) => ({ info: { id: `user-${id}`, role: 'user', time: { created: 1 } },
  parts: id === 'root' ? [{ type: 'tool', tool: 'task', callID: 'dispatch', state: { metadata: { sessionId: 'child' } } }] : [] });
let rootSequence: unknown[][] | undefined;
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
      if (sessionID === 'root' && rootSequence) return { data: rootSequence[Math.min(reads++, rootSequence.length - 1)] };
      if (sessionID === 'root' && ++reads >= 3 && (mode === 'usage' || mode === 'missing')) throw error('usage failed');
      if ((mode === 'messages' && sessionID === 'child') || (mode === 'unbound-missing' && sessionID === 'other')) throw error('child messages failed');
      if (mode === 'zeroed' && reads >= 3 && sessionID === 'root') return { data: [user(sessionID), { ...msg(sessionID), info: { ...msg(sessionID).info, tokens: { input: 0, output: 0, reasoning: 0 }, error: { name: 'MessageAbortedError' } } }] };
      return { data: sessionID === 'other' && mode !== 'unbound' ? [] : mode === 'missing' ? [] : [user(sessionID), msg(sessionID)] };
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
  rootSequence = undefined; mode = ''; reads = 0; childGets = 0; fake.failWrite = '';
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
async function run(failInStart = false, deadlineMs?: number) {
  return launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run', deadlineMs, onStarted: async ({ rootId }) => {
    const opts = config.plugin[0]![1];
    const hooks = createCtfAgentHooks({ ...opts, tools: [] });
    await hooks['chat.params']!({ sessionID: rootId, agent: 'coordinator', model: { providerID: 'fake', id: 'model' } } as never, { maxOutputTokens: 1000 } as never);
    await fetch(opts.controlUrl, { method: 'POST', headers: { authorization: `Bearer ${opts.controlToken}` },
      body: JSON.stringify({ sessionID: rootId, operation: 'tool.execute', input: { tool: 'challenge.assign', args: { role: 'recon', challenge: 'offline' } } }) });
    await hooks['tool.execute.before']!({ sessionID: rootId, tool: 'task', callID: 'dispatch' }, { args: { subagent_type: 'recon' } });
    if (mode !== 'pending') {
      await hooks['chat.message']!({ sessionID: 'child', agent: 'recon' } as never, {} as never);
      if (mode === 'recon-cap') {
        const turn = () => hooks['chat.params']!({ sessionID: 'child', agent: 'recon', model: { providerID: 'fake', id: 'model' } } as never, { maxOutputTokens: 1000 } as never);
        await turn(); await turn();
        await expect(hooks['tool.execute.before']!({ sessionID: 'child', tool: 'ctf_job_run', callID: 'pre-cap' }, { args: { argv: ['true'] } })).resolves.toBeUndefined();
        await turn();
        await expect(hooks['tool.execute.before']!({ sessionID: 'child', tool: 'ctf_job_run', callID: 'closure' }, { args: { argv: ['true'] } })).rejects.toThrow('recon closure: exploration disabled');
        await turn(); await turn();
        await expect(turn()).rejects.toThrow(/recon closure.*exhausted/);
      }
      const output = {title:'done', output:'native terminal', metadata:{parentSessionId:rootId, sessionId:'child'}};
      await hooks['tool.execute.after']!({ sessionID: rootId, tool: 'task', callID: 'dispatch', args: {} }, output);
      if (mode === 'recon-cap') expect(output.output).toContain('recon closure: model-call budget exhausted');
    }
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
describe('launch failure evidence with SDK stand-in only', () => {
  it('wires optional profile recon budgets through launch into real host admission and plugin denial messages', async () => {
    mode = 'recon-cap';
    const path = join(dir, 'profile.json'), profile = JSON.parse(await readFile(path, 'utf8'));
    profile.budget.reconMaxModelCalls = 5; profile.budget.reconClosureReserve = 2;
    await writeFile(path, JSON.stringify(profile));
    expect(await run()).toMatchObject({ code: 0, status: 'completed' });
    const executions = await json('evidence/task-executions.json');
    expect(executions[0]).toMatchObject({ role: 'recon', state: 'cancelled', recon: { admittedTurns: 5, state: 'exhausted' }, resultFacts: { completeness: 'unknown' } });
    const audit = await json('evidence/control-audit.json');
    expect(audit.filter((r: { op: string }) => r.op === 'recon.admitted')).toHaveLength(5);
    expect(audit.some((r: { op: string }) => r.op === 'tool.registered')).toBe(false);
  });
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
    expect(await json('evidence/messages-root.json')).toHaveLength(2);
    if (fault === 'export') expect(await json('evidence/messages-other.json')).toEqual([]);
    const sessions = await json('evidence/sessions.json');
    expect(sessions.find((s: { id: string }) => s.id === 'child').status).toBe('busy');
  });
  it('does not settle while a dispatch remains pending', async () => {
    mode = 'pending';
    expect((await run(false, 20)).status).toBe('deadline_exceeded');
    expect((await json('state/run.json')).rootResult.completeness).toBe('complete');
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
    expect(await json('evidence/messages-root.json')).toHaveLength(2);
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
  it('marks the run failed when the final progress report cannot be written but keeps existing evidence', async () => {
    fake.failWrite = '/progress.md';
    expect(await run()).toMatchObject({ code: 1, status: 'failed' });
    expect(await json('evidence/assets.json')).toHaveProperty('productRevision');
    expect(await readFile(join(dir, 'runs/run/progress.jsonl'), 'utf8')).not.toContain(SECRET);
    const record = await json('state/run.json');
    expect(record.status).toBe('failed');
    expect(JSON.stringify(record.timeline)).toContain('injected write failure');
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

describe('root final report provenance', () => {
  const assistant = (finish: string, text: string, extra = {}) => ({ ...msg('root'), info: { ...msg('root').info, finish, ...extra }, parts: [{ type: 'text', text }] });
  it.each<[string, string, string, string, Record<string, unknown>?]>([
    ['length', '', 'incomplete', 'length'], ['length', 'partial', 'incomplete', 'length'],
    ['stop', 'unsolved', 'complete', 'stop'], ['stop', '  ', 'incomplete', 'missing_text'],
    ['other', 'text', 'unknown', 'unknown_finish'], ['stop', 'partial', 'unknown', 'not_completed', { time: { created: 2 } }],
    ['tool-calls', 'partial', 'incomplete', 'tool_calls'],
  ])('records %s report with text %s', async (finish, text, completeness, reason, extra = {}) => {
    rootSequence = [[user('root'), assistant(finish, text, extra)]];
    const waiting = reason === 'not_completed' || reason === 'tool_calls';
    const result = await launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run', deadlineMs: waiting ? 20 : 10000 });
    expect(result.status).toBe(waiting ? 'deadline_exceeded' : 'completed');
    const record = await json('state/run.json');
    expect(record.rootResult).toMatchObject({ userMessageID: 'user-root', assistantMessageID: 'msg-root', finish, completeness, reason });
    const report = await readFile(join(dir, 'runs/run/progress.md'), 'utf8');
    expect(report).toContain(`Report completeness: **${completeness}**`);
    expect(report).toContain('evidence/messages-root.json');
    expect(report).not.toContain('partial');
  });
  it.each(['new-user', 'wrong-parent', 'tie', 'missing-id', 'missing-created', 'historical'])('does not settle uncertain %s provenance', async fault => {
    const latest = assistant('stop', 'new', fault === 'historical' ? { id: 'new', time: { created: 4 } } : fault === 'wrong-parent' ? { parentID: 'other' } : fault === 'missing-id' ? { id: undefined } : fault === 'missing-created' ? { time: { completed: 3 } } : {});
    rootSequence = [[user('root'), ...(fault === 'historical' ? [assistant('stop', 'old')] : []), latest,
      ...(fault === 'new-user' ? [{ info: { id: 'new-user', role: 'user', time: { created: 5 } } }] : []),
      ...(fault === 'tie' ? [assistant('stop', 'tie', { id: 'tie' })] : [])]];
    expect((await launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run', deadlineMs: 20 })).status).toBe('deadline_exceeded');
    expect((await json('state/run.json')).rootResult.completeness).toBe('unknown');
  });
  it('restarts idle confirmation when source changes and freezes before cleanup', async () => {
    const first = assistant('stop', 'first');
    const second = assistant('stop', 'second', { id: 'second', time: { created: 4, completed: 5 } });
    rootSequence = [[first, user('root')], [first, user('root')], [second, user('root'), first], [second, user('root'), first], [first, second, user('root')], [first, second, user('root')],
      [user('root'), assistant('stop', '', { id: 'second', time: { created: 4, completed: 5 }, error: { name: 'MessageAbortedError' } })]];
    expect((await launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run' })).status).toBe('completed');
    // Three rounds each read usage then idle; only the seventh read is the post-stop export.
    expect(reads).toBe(7);
    expect((await json('evidence/messages-root.json'))).toMatchObject([
      { info: { id: 'user-root', role: 'user' } },
      { info: { id: 'second', error: { name: 'MessageAbortedError' } }, parts: [{ type: 'text', text: '' }] }
    ]);
    expect((await json('state/run.json')).rootResult).toMatchObject({ assistantMessageID: 'second', completeness: 'complete', textChars: 6, hasError: false, exportedSourceMatches: false });
  });
  it('accepts uniquely parent-linked messages created within the same millisecond', async () => {
    rootSequence = [[user('root'), assistant('stop', 'unsolved', { time: { created: 1, completed: 3 } })]];
    expect((await launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run', deadlineMs: 1500 })).status).toBe('completed');
    expect((await json('state/run.json')).rootResult.completeness).toBe('complete');
  });
  it('preserves a real APIError as failure even without completed metadata', async () => {
    rootSequence = [[user('root'), assistant('stop', '', { time: { created: 2 }, error: { name: 'APIError' } })]];
    expect((await launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run', deadlineMs: 20 })).status).toBe('failed');
    expect((await json('state/run.json')).rootResult).toMatchObject({ hasError: true, completeness: 'incomplete', reason: 'error' });
  });
  it('marks unavailable exported root evidence unknown without inventing a path', async () => {
    fake.failWrite = '/messages-root.json';
    rootSequence = [[user('root'), assistant('stop', 'unsolved')]];
    expect((await launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run' })).status).toBe('failed');
    expect((await json('state/run.json')).rootResult).toMatchObject({ completeness: 'unknown', reason: 'export_unavailable', evidence: null });
  });

  it('does not invent a pre-stop snapshot when budget cleanup already began', async () => {
    const path = join(dir, 'profile.json');
    const profile = JSON.parse(await readFile(path, 'utf8')); profile.budget.maxObservableTokens = 1;
    await writeFile(path, JSON.stringify(profile));
    rootSequence = [[user('root'), assistant('stop', 'cleanup text')]];
    expect((await launch({ profile: path, runsRoot: join(dir, 'runs'), runId: 'run' })).status).toBe('budget_exceeded');
    expect((await json('state/run.json')).rootResult).toMatchObject({ completeness: 'unknown', reason: 'snapshot_unavailable' });
  });

  it('does not hide a historical real abort behind a later normal report', async () => {
    rootSequence = [[user('root'), assistant('stop', 'old', { id: 'old', time: { created: 1, completed: 2 }, error: { name: 'MessageAbortedError' } }), assistant('stop', 'unsolved')]];
    expect((await launch({ profile: join(dir, 'profile.json'), runsRoot: join(dir, 'runs'), runId: 'run' })).status).toBe('failed');
    expect((await json('state/run.json')).rootResult.completeness).toBe('complete');
  });

});
