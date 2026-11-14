import {describe, expect, it} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
import {ControlService} from '../../apps/launcher/src/control-service.js';
import {loadReleaseProfile, effectiveContext} from '../../apps/cli/src/composition/releaseProfile.js';

// Recon redesign §4 "索引按需讀取": index summary, repeat hints and the context run settings. Synthetic data only.
const HEADER = '[CTF investigation context]\n';
type Context = {index: 'summary' | 'full'; workbook: boolean};
function fixture(context?: Context) {
  const root = mkdtempSync(join(tmpdir(), 'index-summary-')), materials = join(root, 'workspace/X/materials');
  mkdirSync(materials, {recursive: true});
  const store = new ExperienceStore(join(root, 'experience.sqlite'));
  const client = {session: {get: async ({sessionID}: any) => ({data: {id: sessionID, parentID: 'root'}}), messages: async () => ({data: []}), children: async () => ({data: []}), abort: async () => ({data: true})}};
  const service = new ControlService({...(context ? {context} : {}), client: client as never, runId: 'A', experienceStore: store, workdir: join(root, 'opencode'), skillRoot: join(root, 'skills'),
    expiresAt: Date.now() + 30 * 60000 + 30000, budget: {maxModelCalls: 50, maxObservableTokens: 10000, maxToolJobs: 3},
    challenges: [{id: 'X', title: null, target: null, reachability: null, materials: [], materialsDir: materials}]});
  service.bindRoot('root');
  for (const [id, role] of Object.entries({recon: 'recon', 'solver-a': 'domain-solver', 'solver-b': 'domain-solver'})) {
    service.bindings.set(id, {sessionID: id, role: role as never, parentID: 'root', via: 'dispatch', scope: 'run', expiresAt: Date.now() + 60000, state: 'active', boundAt: Date.now(), challengeId: 'X'});
    (service as any).executions.set(`ex-${id}`, {ref: `ex-${id}`, childID: id, role, state: 'running', run: 'A', parent: 'root', challengeId: 'X', delivered: true, source: {status: 'conflict'}});
  }
  let n = 0;
  const step = (session: string, tool: string, args: unknown, role = session === 'recon' ? 'recon' : 'domain-solver') => {
    const scope = {run: 'A', challenge: 'X', session, role, call: `${session}-c${++n}`, message: `${session}-m${n}`};
    store.start(scope, tool, args);
    store.finish(scope, 'completed', {data: `r${n}`});
  };
  const note = (session: string, args: Record<string, unknown>) => service.handle(session, 'tool.execute', {tool: 'recon.note', callID: `n${++n}`, messageID: `nm${n}`, args}) as Promise<any>;
  return {root, store, service, step, note};
}
const body = (text: string) => { expect(text.startsWith(HEADER)).toBe(true); return JSON.parse(text.slice(HEADER.length)); };
const prepare = (service: ControlService, session: string, input: Record<string, unknown>) => service.handle(session, 'context.prepare', input) as Promise<any>;

describe('context run settings', () => {
  const profile = (context?: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), 'profile-')), path = join(dir, 'p.json');
    writeFileSync(path, JSON.stringify({profileId: 'p', opencode: {configPath: 'oc.json'}, reference: {enabled: false}, os: {platform: 'macos'},
      budget: {wallClockMs: 1, maxSteps: 1, maxToolJobs: 1, maxObservableTokens: 1}, ...(context === undefined ? {} : {context})}));
    return loadReleaseProfile(path);
  };
  it('defaults to summary with the workbook on and accepts explicit values', async () => {
    expect(effectiveContext((await profile()).context)).toEqual({index: 'summary', workbook: true});
    expect(effectiveContext((await profile({index: 'full', workbook: false})).context)).toEqual({index: 'full', workbook: false});
    expect(effectiveContext((await profile({workbook: false})).context)).toEqual({index: 'summary', workbook: false});
  });
  it('rejects unknown keys and values', async () => {
    for (const bad of [{index: 'none'}, {workbook: 'yes'}, {index: 'full', extra: 1}, []])
      await expect(profile(bad)).rejects.toThrow('invalid context settings');
  });
});

describe('index summary projection', () => {
  it('replaces the index with a small mechanical summary at 158 steps', async () => {
    const {store, service, step} = fixture();
    for (let i = 0; i < 100; i++) step('recon', 'http.request', {url: `http://a.example.test/p${i}`});
    for (let i = 0; i < 58; i++) step('solver-a', 'workspace.read', {path: `work/f${i}`});
    const payload = body((await prepare(service, 'solver-b', {messageID: 'u1', placement: 'chat.message'})).text);
    expect(payload.mode).toBe('full');
    expect(payload).not.toHaveProperty('index');
    const summary = payload.index_summary;
    expect(JSON.stringify(summary).length).toBeLessThanOrEqual(2000);
    expect(summary.total).toBe(158);
    expect(summary.sessions.reduce((n: number, s: any) => n + s.steps, 0)).toBe(158);
    expect(summary.sessions.map((s: any) => [s.role, s.steps])).toEqual([['recon', 100], ['domain-solver', 58]]);
    expect(JSON.stringify(summary)).not.toContain('a.example.test');
    expect(JSON.stringify(summary)).not.toContain('work/f');
    expect(summary.first_cursor).toMatch(/^\d+:\d+$/);
    store.close();
  });

  it('hints repeats of the same tool and arguments once the step completes; different args, tools and notes do not count', async () => {
    const {store, service, step, note} = fixture();
    step('recon', 'http.request', {url: 'http://a.example.test/login'});
    const first = await prepare(service, 'solver-a', {messageID: 'u1', placement: 'chat.message'});
    step('solver-a', 'http.request', {url: 'http://a.example.test/login'});
    step('solver-a', 'http.request', {url: 'http://a.example.test/other'});
    step('solver-a', 'workspace.read', {url: 'http://a.example.test/login'});
    await note('recon', {observation: 'same note'});
    await note('recon', {observation: 'same note'});
    const next = body((await prepare(service, 'solver-a', {placement: 'tool.execute.after', callID: 't1', visibleVersion: first.version})).text);
    expect(next.mode).toBe('delta');
    expect(next).not.toHaveProperty('index');
    const records = store.allRecords('A', 'X');
    const [login, again] = records.filter(r => r.tool === 'http.request' && JSON.stringify(r.args_json).includes('/login'));
    expect(next.repeats).toEqual([{id: Number(again.id), repeat_of: [{id: Number(login.id), role: 'recon', status: 'completed'}]}]);
    // The same repeat is not announced again by the next delta.
    const later = body((await prepare(service, 'solver-a', {placement: 'tool.execute.after', callID: 't2', visibleVersion: (await prepare(service, 'solver-a', {placement: 'tool.execute.after', callID: 't1b', visibleVersion: first.version})).version})).text ?? HEADER + '{}');
    expect(later.repeats).toBeUndefined();
    store.close();
  });

  it('marks repeats among recent steps in the full projection and audits index mode and repeat ids', async () => {
    const {store, service, step} = fixture();
    step('recon', 'job.run', {argv: ['true']});
    step('solver-a', 'job.run', {argv: ['true']});
    const projection = await prepare(service, 'solver-a', {messageID: 'u1', placement: 'chat.message'});
    const payload = body(projection.text);
    const again = payload.recent.find((r: any) => r.tool === 'job.run');
    expect(again.repeat_of).toEqual([expect.objectContaining({role: 'recon', status: 'completed'})]);
    await service.handle('solver-a', 'model.call', {agent: 'domain-solver', provider: 'stub', model: 'scripted', messageID: 'u1', contextDeliveries: [{version: projection.version, placement: 'chat.message', messageID: 'u1'}]});
    const detail = service.audit.filter(a => a.op === 'context.presented').at(-1)!.detail as any;
    expect(detail).toMatchObject({index_mode: 'summary', record_ids: [], repeat_ids: [again.id], coverage: {total: 2}});
    store.close();
  });

  it('another session\'s new steps reach the delta only as a summary change, never as index entries', async () => {
    const {store, service, step} = fixture();
    step('solver-a', 'workspace.read', {path: 'work/a'});
    const first = await prepare(service, 'solver-a', {messageID: 'u1', placement: 'chat.message'});
    step('recon', 'workspace.read', {path: 'work/b'});
    const next = body((await prepare(service, 'solver-a', {placement: 'tool.execute.after', callID: 't1', visibleVersion: first.version})).text);
    expect(next).not.toHaveProperty('index');
    expect(next.index_summary.total).toBe(2);
    expect(JSON.stringify(next)).not.toContain('work/b');
    store.close();
  });

  it('full mode keeps the index and audits index_mode full', async () => {
    const {store, service, step} = fixture({index: 'full', workbook: true});
    step('recon', 'workspace.read', {path: 'work/a'});
    const projection = await prepare(service, 'solver-a', {messageID: 'u1', placement: 'chat.message'});
    const payload = body(projection.text);
    expect(payload.index.entries).toHaveLength(1);
    expect(payload).not.toHaveProperty('index_summary');
    await service.handle('solver-a', 'model.call', {agent: 'domain-solver', provider: 'stub', model: 'scripted', messageID: 'u1', contextDeliveries: [{version: projection.version, placement: 'chat.message', messageID: 'u1'}]});
    expect(service.audit.filter(a => a.op === 'context.presented').at(-1)!.detail).toMatchObject({index_mode: 'full', repeat_ids: []});
    store.close();
  });
});

describe('workbook switched off', () => {
  it('injects no workbook, refuses slotted writes, keeps plain Recon notes, and gives the Coordinator nothing', async () => {
    const {store, service, note} = fixture({index: 'summary', workbook: false});
    const first = await prepare(service, 'solver-a', {messageID: 'u1', placement: 'chat.message'});
    expect(body(first.text)).not.toHaveProperty('workbook');
    await expect(note('recon', {slot: 'facts', text: 'fact'})).rejects.toThrow('workbook disabled for this run');
    await expect(note('solver-a', {slot: 'facts', text: 'fact'})).rejects.toThrow('workbook disabled for this run');
    await expect(service.handle('root', 'tool.execute', {tool: 'recon.note', callID: 'c1', messageID: 'cm1', args: {challenge: 'X', slot: 'questions', text: 'q'}})).rejects.toThrow('workbook disabled for this run');
    await expect(note('recon', {observation: 'plain decision'})).resolves.toHaveProperty('id');
    const next = body((await prepare(service, 'solver-a', {placement: 'tool.execute.after', callID: 't1', visibleVersion: first.version})).text);
    expect(next).not.toHaveProperty('workbook');
    await expect(prepare(service, 'root', {messageID: 'cu1', placement: 'chat.message'})).resolves.toEqual({});
    store.close();
  });
});
