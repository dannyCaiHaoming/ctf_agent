import {describe, expect, it} from 'vitest';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {investigationView} from '../../apps/launcher/src/investigation-context.js';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
import {ControlService} from '../../apps/launcher/src/control-service.js';

const HEADER = '[CTF investigation context]\n';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'recon-context-')), materials = join(root, 'workspace/X/materials');
  mkdirSync(materials, {recursive: true});
  const store = new ExperienceStore(join(root, 'experience.sqlite'));
  const client = {session: {get: async ({sessionID}: any) => ({data: {id: sessionID, parentID: 'root'}}), messages: async () => ({data: []}), children: async () => ({data: []}), abort: async () => ({data: true})}};
  const service = new ControlService({client: client as never, runId: 'A', experienceStore: store, workdir: join(root, 'opencode'), skillRoot: join(root, 'skills'), expiresAt: Date.now() + 60000,
    budget: {maxModelCalls: 50, maxObservableTokens: 10000, maxToolJobs: 3}, challenges: [{id: 'X', title: null, target: null, reachability: null, materials: [], materialsDir: materials}]});
  service.bindRoot('root');
  for (const id of ['recon', 'recon-b']) {
    service.bindings.set(id, {sessionID: id, role: 'recon', parentID: 'root', via: 'dispatch', scope: 'run', expiresAt: Date.now() + 60000, state: 'active', boundAt: Date.now(), challengeId: 'X'});
    (service as any).executions.set(`ex-${id}`, {ref: `ex-${id}`, childID: id, role: 'recon', state: 'running', run: 'A', parent: 'root', challengeId: 'X', delivered: true, source: {status: 'conflict'}});
  }
  return {root, store, service};
}
function seed(store: ExperienceStore, count: number, size = 16, session = 'recon') {
  for (let i = 0; i < count; i++) {
    const scope = {run: 'A', challenge: 'X', session, call: `${session}-c${i}`, message: `${session}-m${i}`};
    store.start(scope, 'workspace.read', {path: `materials/f${i}`});
    store.finish(scope, 'completed', {data: `r${i}:` + 'x'.repeat(size)});
  }
}
const body = (text: string) => { expect(text.startsWith(HEADER)).toBe(true); return JSON.parse(text.slice(HEADER.length)); };
const prepare = (service: ControlService, session: string, input: Record<string, unknown>) => service.handle(session, 'context.prepare', input) as Promise<any>;

describe('Recon investigation context (design §4)', () => {
  it('walks the complete mechanical index through the store cursor', () => {
    const {store} = fixture();
    seed(store, 45);
    const seen: number[] = [];
    let cursor: string | undefined, pages = 0;
    do {
      const page = investigationView(store, 'A', 'X', {cursor, limit: 7});
      pages++;
      expect(page.coverage.returned).toBeLessThanOrEqual(7);
      for (const entry of page.index) expect(entry).toMatchObject({step_id: expect.any(String), cursor: `${entry.sequence}:${entry.id}`, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), result_complete: expect.any(Boolean)});
      seen.push(...page.index.map((entry: any) => entry.id));
      cursor = page.coverage.next_cursor ?? undefined;
    } while (cursor);
    const ids = store.records('A', 'X').index.map(entry => entry.id);
    expect(pages).toBe(7);
    expect(seen).toEqual(ids);
    // Index cursors are the same tokens recon.read accepts.
    expect(store.records('A', 'X', {cursor: investigationView(store, 'A', 'X', {limit: 7}).coverage.next_cursor!}).records[0]!.id).toBe(ids[7]);
    store.close();
  });

  it('projects every step without recency, decision or byte-budget selection', async () => {
    const {store, service} = fixture();
    seed(store, 60, 7000);
    for (let i = 0; i < 10; i++) store.note({run: 'A', challenge: 'X', session: 'recon', call: `note${i}`}, {kind: 'decision', assessment: `judgment ${i}`}, () => true);
    const first = await prepare(service, 'recon', {messageID: 'u1', placement: 'chat.message'});
    const payload = body(first.text);
    expect(payload.mode).toBe('full');
    expect(payload.index.entries.map((entry: any) => entry.id)).toEqual(store.records('A', 'X').index.map(entry => entry.id));
    expect(payload.index.coverage).toMatchObject({total: 70, complete: true});
    expect(first.text).not.toContain('"preview"');
    expect(first.text).not.toContain('"truncated":true');
    // Recent complete steps are a fixed tail rule and carry complete call arguments with complete results.
    const stored = store.allRecords('A', 'X');
    for (const step of payload.recent) {
      const row = stored.find(r => r.id === step.id)!;
      expect(step.status).not.toBe('running');
      if (step.kind === 'tool') { expect(step.args).toEqual(row.args_json); expect(step.result).toEqual(row.result_json); }
    }
    store.close();
  });

  it('pages an oversized index mechanically and keeps earlier steps reachable', async () => {
    const {store, service} = fixture();
    seed(store, 260);
    const payload = body((await prepare(service, 'recon', {messageID: 'u1', placement: 'chat.message'})).text);
    const ids = store.records('A', 'X').index.map(entry => entry.id);
    const shown = payload.index.entries.map((entry: any) => entry.id);
    expect(shown).toEqual(ids.slice(ids.length - shown.length));
    expect(payload.index.coverage).toMatchObject({total: 260, complete: false, earlier: ids.length - shown.length});
    const reached: number[] = [];
    let cursor: string | undefined;
    do { const page = investigationView(store, 'A', 'X', {cursor, limit: 200}); reached.push(...page.index.map((e: any) => e.id)); cursor = page.coverage.next_cursor ?? undefined; } while (cursor);
    expect(reached).toEqual(ids);
    store.close();
  });

  it('keeps in-flight calls out of recent pairs and exposes current state', async () => {
    const {store, service} = fixture();
    seed(store, 3);
    store.start({run: 'A', challenge: 'X', session: 'recon', call: 'running', message: 'mr'}, 'job.run', {argv: ['true']});
    const payload = body((await prepare(service, 'recon', {messageID: 'u1', placement: 'chat.message'})).text);
    const running = store.allRecords('A', 'X').find(r => r.call_id === 'running')!;
    expect(payload.recent.map((step: any) => step.id)).not.toContain(running.id);
    for (const step of payload.recent) expect(step).toHaveProperty('result');
    expect(payload.state.in_flight.record_ids).toEqual([running.id]);
    expect(payload.state).toMatchObject({publications: expect.any(Array), budget: expect.objectContaining({max_model_calls: 50}), closure: expect.any(Object), handoff: expect.any(Object), process_storage: {state: 'available'}});
    expect(payload.state.gaps).toContain('decision not recorded');
    expect(payload).toHaveProperty('current_question');
    expect(payload).toHaveProperty('experience');
    store.close();
  });

  it('appends only the state delta relative to the visible version and skips the same version', async () => {
    const {store, service} = fixture();
    seed(store, 5);
    const first = await prepare(service, 'recon', {messageID: 'u1', placement: 'chat.message'});
    const same = await prepare(service, 'recon', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c', visibleVersion: first.version});
    expect(same).toEqual({version: first.version, unchanged: true});
    seed(store, 1, 16, 'later');
    const next = await prepare(service, 'recon', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c', visibleVersion: first.version});
    expect(next.version).not.toBe(first.version);
    const delta = body(next.text);
    expect(delta).toMatchObject({mode: 'delta', base_version: first.version});
    expect(delta.index.entries.map((entry: any) => entry.session_id)).toEqual(['later']);
    expect(delta.index.coverage.total).toBe(6);
    // An unknown visible version (e.g. after compaction or restart) yields the full projection.
    expect(body((await prepare(service, 'recon', {messageID: 'u2', placement: 'chat.message', visibleVersion: 'unknown'})).text).mode).toBe('full');
    store.close();
  });

  it('delta carries only changed state fields and publication items; merged deltas equal the full projection', async () => {
    const {store, service} = fixture();
    seed(store, 3);
    const pubs: any[] = [{ref: 'pub:a', source: {run: 'A', challenge: 'X', kind: 'file', sessionID: 'recon'}, sha256: 'a'.repeat(64), size: 1}, {ref: 'pub:b', source: {run: 'A', challenge: 'X', kind: 'file', sessionID: 'recon'}, sha256: 'b'.repeat(64), size: 2}];
    (service as any).publicationSnapshot = () => pubs;
    const mergeState = (state: any, change: any) => {
      const next = {...state};
      for (const [k, v] of Object.entries<any>(change)) {
        if (k === 'publications') {
          const byRef = new Map<string, any>(state.publications.map((p: any) => [p.ref, p]));
          for (const r of v.removed) byRef.delete(r);
          for (const p of v.upserted) byRef.set(p.ref, p);
          next.publications = [...byRef.values()];
        } else next[k] = v;
      }
      return next;
    };
    const first = await prepare(service, 'recon', {messageID: 'u1', placement: 'chat.message'});
    const fullFirst = body(first.text);
    let state = fullFirst.state, visible = first.version;
    // Only the budget changes (a model call is admitted): the delta state holds budget alone, no experience block.
    (service as any).admitted += 1;
    let next = await prepare(service, 'recon', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c1', visibleVersion: visible});
    let delta = body(next.text);
    expect(Object.keys(delta.state)).toEqual(['budget']);
    expect(delta).not.toHaveProperty('experience');
    state = mergeState(state, delta.state); visible = next.version;
    // One publication added, one changed, then one removed.
    pubs.push({ref: 'pub:c', source: {run: 'A', challenge: 'X', kind: 'file', sessionID: 'recon'}, sha256: 'c'.repeat(64), size: 3});
    pubs[0] = {...pubs[0], sha256: 'd'.repeat(64)};
    next = await prepare(service, 'recon', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c2', visibleVersion: visible});
    delta = body(next.text);
    expect(Object.keys(delta.state)).toEqual(['publications']);
    expect(delta.state.publications.upserted.map((p: any) => p.ref)).toEqual(['pub:a', 'pub:c']);
    expect(delta.state.publications.removed).toEqual([]);
    state = mergeState(state, delta.state); visible = next.version;
    pubs.splice(1, 1);
    next = await prepare(service, 'recon', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c3', visibleVersion: visible});
    delta = body(next.text);
    expect(delta.state.publications).toEqual({upserted: [], removed: ['pub:b']});
    state = mergeState(state, delta.state);
    const full = body((await prepare(service, 'recon', {messageID: 'u2', placement: 'chat.message'})).text);
    expect(full.mode).toBe('full');
    expect(state).toEqual(full.state);
    expect(full.experience).not.toHaveProperty('signals');
    expect(full.experience).toHaveProperty('lessons');
    store.close();
  });

  it('sends the experience block only when the presented lesson set changes; signals go to the audit', async () => {
    const {store, service} = fixture();
    seed(store, 2);
    let set = [{id: 'L1', version: 1}];
    (store as any).search = () => ({results: set.map(l => ({id: l.id, version: l.version}))});
    (store as any).lessonSummary = (id: string, version: number) => ({id, version, title: `card ${id}`});
    store.note({run: 'A', challenge: 'X', session: 'recon', call: 'n0'}, {kind: 'decision', assessment: 'probing alpha endpoint'}, () => true);
    const first = await prepare(service, 'recon', {messageID: 'u1', placement: 'chat.message'});
    expect(body(first.text).experience.lessons.map((l: any) => l.id)).toEqual(['L1']);
    // New observations/decisions change retrieval signals but not the lesson set: no experience block.
    store.note({run: 'A', challenge: 'X', session: 'recon', call: 'n1'}, {kind: 'decision', assessment: 'testing bravo parameter'}, () => true);
    let next = await prepare(service, 'recon', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c1', visibleVersion: first.version});
    expect(body(next.text)).not.toHaveProperty('experience');
    expect(next.text).not.toContain('"signals"');
    // Lesson set changes: the next delta carries the new block.
    set = [{id: 'L1', version: 1}, {id: 'L2', version: 1}];
    store.note({run: 'A', challenge: 'X', session: 'recon', call: 'n2'}, {kind: 'decision', assessment: 'trying charlie cookie'}, () => true);
    next = await prepare(service, 'recon', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c2', visibleVersion: next.version});
    expect(body(next.text).experience.lessons.map((l: any) => l.id)).toEqual(['L1', 'L2']);
    const detail = (service as any).contextPrepared.get('recon');
    const last = [...detail.values()].at(-1);
    expect(last.experience_refs).toEqual(['lesson:L1@1', 'lesson:L2@1']);
    expect(last.retrieval).toMatchObject({query: expect.any(String), signals: expect.any(Array)});
    store.close();
  });

  it('blocks the outbound model request after a projection failure until a projection succeeds', async () => {
    const {store, service} = fixture();
    seed(store, 2);
    store.db.exec('ALTER TABLE recon_turns RENAME TO recon_turns_hidden');
    await expect(prepare(service, 'recon', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c'})).rejects.toThrow();
    await expect(service.handle('recon', 'model.call', {agent: 'recon', provider: 'stub', model: 'scripted', messageID: 'u1', contextDeliveries: []})).rejects.toThrow(/context projection/);
    store.db.exec('ALTER TABLE recon_turns_hidden RENAME TO recon_turns');
    // Another session is not affected by this session's failure.
    await expect(service.handle('recon-b', 'model.call', {agent: 'recon', provider: 'stub', model: 'scripted', messageID: 'b1', contextDeliveries: []})).resolves.toHaveProperty('maxOutputTokens');
    const ok = await prepare(service, 'recon', {messageID: 'u2', placement: 'chat.message'});
    await expect(service.handle('recon', 'model.call', {agent: 'recon', provider: 'stub', model: 'scripted', messageID: 'u2', contextDeliveries: [{version: ok.version, placement: 'chat.message', messageID: 'u2'}]})).resolves.toHaveProperty('maxOutputTokens');
    store.close();
  });

  it('audits actual delivery with reconstructable identity, hash, bytes and range', async () => {
    const {store, service} = fixture();
    seed(store, 4);
    const projection = await prepare(service, 'recon', {messageID: 'u1', placement: 'chat.message'});
    const payload = body(projection.text);
    expect(service.audit.some(a => a.op === 'context.presented')).toBe(false); // prepared is not presented
    await service.handle('recon', 'model.call', {agent: 'recon', provider: 'stub', model: 'scripted', messageID: 'u1', contextDeliveries: [{version: projection.version, placement: 'chat.message', messageID: 'u1'}]});
    const presented = service.audit.filter(a => a.op === 'context.presented');
    expect(presented).toHaveLength(1);
    expect(presented[0]).toMatchObject({sessionID: 'recon', allow: true, detail: {
      session: 'recon', messageID: 'u1', challenge: 'X', version: projection.version, mode: 'full', placement: 'chat.message',
      record_ids: payload.index.entries.map((entry: any) => entry.id), recent_ids: payload.recent.map((step: any) => step.id),
      coverage: payload.index.coverage, sha256: createHash('sha256').update(projection.text).digest('hex'), bytes: Buffer.byteLength(projection.text, 'utf8')}});
    // Another session cannot claim delivery of this session's projection.
    await expect(service.handle('recon-b', 'model.call', {agent: 'recon', provider: 'stub', model: 'scripted', messageID: 'b1', contextDeliveries: [{version: projection.version, placement: 'chat.message', messageID: 'b1'}]})).rejects.toThrow(/context delivery/);
    // Compaction context is recorded as handed to native compaction when prepared for it.
    await prepare(service, 'recon', {placement: 'compacting'});
    expect(service.audit.filter(a => a.op === 'context.presented').at(-1)).toMatchObject({detail: {placement: 'compacting', mode: 'full', delivery: 'compaction_context'}});
    store.close();
  });

  it('product plugin hooks and host service: append-only, audited, isolated and fail-closed end to end', async () => {
    const {vi} = await import('vitest');
    const {createCtfAgentHooks} = await import('../../apps/opencode-plugin/src/index.js');
    const {store, service} = fixture();
    seed(store, 3);
    const mocked = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      try { return new Response(JSON.stringify({result: await service.handle(b.sessionID, b.operation, b.input)}), {status: 200}); }
      catch (error) { return new Response(JSON.stringify({error: String((error as Error).message)}), {status: 403}); }
    });
    try {
      const h = createCtfAgentHooks({controlUrl: 'http://127.0.0.1:12345', controlToken: 'x'.repeat(40), tools: ['recon.note', 'recon.read']});
      const message = async (sessionID: string, id: string) => { const output: any = {message: {id}, parts: [{id: 'p', type: 'text', text: 'dispatch'}]}; await h['chat.message']!({sessionID, agent: 'recon', messageID: id} as never, output); return output; };
      const params = (sessionID: string, id: string) => h['chat.params']!({sessionID, agent: 'recon', message: {id}, model: {providerID: 'stub', id: 'scripted'}} as never, {} as never);
      const first = await message('recon', 'u1');
      const appended = first.parts.at(-1).text as string;
      expect(body(appended)).toMatchObject({mode: 'full', index: {coverage: {total: 3, complete: true}}});
      // The time facts are in the text actually appended to the outbound message, not only in hook results.
      // The fixture execution has no dispatch time, so elapsed is unknown (null) while the call count is known (0).
      expect(body(appended).state.budget).toEqual(expect.objectContaining({remaining_min: expect.any(Number), turn_elapsed_min: null, turn_model_calls: 0}));
      seed(store, 1, 16, 'job');
      const toolOutput = {title: 't', output: 'native', metadata: {}};
      await h['tool.execute.after']!({sessionID: 'recon', tool: 'ctf_workspace_read', callID: 'c1', args: {}}, toolOutput);
      const delta = toolOutput.output.slice('native\n'.length);
      expect(body(delta)).toMatchObject({mode: 'delta', index: {entries: [expect.objectContaining({session_id: 'job'})]}});
      await params('recon', 'u1');
      const presented = service.audit.filter(a => a.op === 'context.presented').map(a => a.detail as any);
      expect(presented.map(d => [d.placement, d.mode, d.sha256, d.bytes])).toEqual([
        ['chat.message', 'full', createHash('sha256').update(appended).digest('hex'), Buffer.byteLength(appended)],
        ['tool.execute.after', 'delta', createHash('sha256').update(delta).digest('hex'), Buffer.byteLength(delta)]]);
      // Session B sees its own full projection regardless of A's visible version.
      expect(body((await message('recon-b', 'b1')).parts.at(-1).text).mode).toBe('full');
      // Messages are not touched by transform even with Recon tools enabled.
      const history = [{info: {id: 'u1', sessionID: 'recon', role: 'user'}, parts: [...first.parts]}];
      const snapshot = structuredClone(history);
      await h['experimental.chat.messages.transform']!({}, {messages: history} as never);
      expect(history).toEqual(snapshot);
      // Projection failure: the hook throws and the next outbound request is refused, only for that session.
      store.db.exec('ALTER TABLE recon_turns RENAME TO recon_turns_hidden');
      await expect(h['tool.execute.after']!({sessionID: 'recon', tool: 'ctf_workspace_read', callID: 'c2', args: {}}, {title: 't', output: 'native', metadata: {}})).rejects.toThrow();
      await expect(params('recon', 'u1')).rejects.toThrow(/context projection/);
      await expect(params('recon-b', 'b1')).resolves.toBeUndefined();
      store.db.exec('ALTER TABLE recon_turns_hidden RENAME TO recon_turns');
    } finally { mocked.mockRestore(); store.close(); }
  });

  it('budget carries whole-minute time facts and per-turn model calls of the running execution only', async () => {
    for (const mode of ['background', 'sync'] as const) {
      const {store, service} = fixture();
      const s = service as any, t = Date.now();
      s.options.expiresAt = t + 21.5 * 60000;
      for (const id of ['recon', 'recon-b']) Object.assign(s.executions.get(`ex-${id}`), {mode, dispatchedAt: t - 3.5 * 60000});
      const budget = async (session: string) => body((await prepare(service, session, {messageID: 'u1', placement: 'chat.message'})).text).state.budget;
      expect(await budget('recon')).toMatchObject({remaining_min: 21, turn_elapsed_min: 3, turn_model_calls: 0, expires_at: s.options.expiresAt});
      await service.handle('recon', 'model.call', {agent: 'recon'});
      await service.handle('recon', 'model.call', {agent: 'recon'});
      await service.handle('recon-b', 'model.call', {agent: 'recon'});
      // Another child's calls are not counted; the global counter still sees all three.
      expect(await budget('recon')).toMatchObject({turn_model_calls: 2, admitted_model_calls: 3});
      expect(await budget('recon-b')).toMatchObject({turn_model_calls: 1});
      // Continuation of the same child is a new execution: the turn restarts and the old count is not carried.
      s.executions.get('ex-recon').state = 'completed';
      s.executions.set('ex-recon-2', {...s.executions.get('ex-recon'), ref: 'ex-recon-2', state: 'running', dispatchedAt: Date.now(), modelCalls: undefined});
      expect(await budget('recon')).toMatchObject({turn_elapsed_min: 0, turn_model_calls: 0});
      await service.handle('recon', 'model.call', {agent: 'recon'});
      expect(await budget('recon')).toMatchObject({turn_model_calls: 1});
      expect(s.executions.get('ex-recon').modelCalls).toBe(2);
      // No running execution, or an ambiguous one: unknown, never 0.
      s.executions.get('ex-recon-2').state = 'completed';
      expect(await budget('recon')).toMatchObject({remaining_min: 21, turn_elapsed_min: null, turn_model_calls: null});
      s.executions.set('ex-recon-3', {...s.executions.get('ex-recon-b'), ref: 'ex-recon-3'});
      expect(await budget('recon-b')).toMatchObject({turn_elapsed_min: null, turn_model_calls: null});
      store.close();
    }
  });

  it('time facts do not change the context version within the same minute', async () => {
    const {store, service} = fixture();
    const s = service as any;
    // Mid-minute values on both clocks, so the 20 ms below cannot cross a minute boundary.
    s.options.expiresAt = Date.now() + 10.5 * 60000;
    s.executions.get('ex-recon').dispatchedAt = Date.now() - 30000;
    const first = await prepare(service, 'recon', {messageID: 'u1', placement: 'chat.message'});
    await new Promise(r => setTimeout(r, 20));
    expect(await prepare(service, 'recon', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c1', visibleVersion: first.version})).toEqual({version: first.version, unchanged: true});
    store.close();
  });

  it('keeps R3 recon.read navigation intact', async () => {
    const {store, service} = fixture();
    seed(store, 30);
    const page = await service.handle('recon', 'tool.execute', {tool: 'recon.read', callID: 'r', messageID: 'm', args: {limit: 5}}) as any;
    expect(page.index).toHaveLength(30);
    expect(page.next_cursor).toBe(page.index[4].cursor);
    store.close();
  });
});
