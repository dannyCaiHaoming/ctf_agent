import {describe, expect, it} from 'vitest';
import {mkdtempSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
import {ControlService} from '../../apps/launcher/src/control-service.js';
import {workbookView, workbookBase, workbookDelta, coordinatorView as coordinatorProjection} from '../../apps/launcher/src/workbook.js';

// Team-decision design §6.1: workbook entries, supersede rules, fold, caps and injection. Synthetic data only.
const HEADER = '[CTF investigation context]\n';
const SECRET = 'synthetic-control-secret-0123456789';
const RUN_SECRET = 'synthetic-run-redaction-9876543210';
const ROLES: Record<string, string> = {recon: 'recon', 'solver-a': 'domain-solver', 'solver-b': 'domain-solver', engineer: 'engineer', verifier: 'verifier'};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workbook-')), materials = join(root, 'workspace/X/materials');
  mkdirSync(materials, {recursive: true});
  const store = new ExperienceStore(join(root, 'experience.sqlite'), [SECRET]);
  const client = {session: {get: async ({sessionID}: any) => ({data: {id: sessionID, parentID: 'root'}}), messages: async () => ({data: []}), children: async () => ({data: []}), abort: async () => ({data: true})}};
  // Half a minute off a whole minute: remaining_min (part of the Coordinator view version) cannot change during a test.
  const service = new ControlService({client: client as never, runId: 'A', experienceStore: store, workdir: join(root, 'opencode'), skillRoot: join(root, 'skills'), expiresAt: Date.now() + 30 * 60000 + 30000,
    budget: {maxModelCalls: 50, maxObservableTokens: 10000, maxToolJobs: 3}, redactions: [RUN_SECRET],
    challenges: [{id: 'X', title: null, target: null, reachability: null, materials: [], materialsDir: materials}, {id: 'Y', title: null, target: null, reachability: null, materials: [], materialsDir: materials}]});
  service.bindRoot('root');
  for (const [id, role] of Object.entries(ROLES)) {
    service.bindings.set(id, {sessionID: id, role: role as never, parentID: 'root', via: 'dispatch', scope: 'run', expiresAt: Date.now() + 60000, state: 'active', boundAt: Date.now(), challengeId: 'X'});
    (service as any).executions.set(`ex-${id}`, {ref: `ex-${id}`, childID: id, role, state: 'running', run: 'A', parent: 'root', challengeId: 'X', delivered: true, source: {status: 'conflict'}});
  }
  service.bindings.set('recon-y', {sessionID: 'recon-y', role: 'recon', parentID: 'root', via: 'dispatch', scope: 'run', expiresAt: Date.now() + 60000, state: 'active', boundAt: Date.now(), challengeId: 'Y'});
  let n = 0;
  const note = (session: string, args: Record<string, unknown>) => service.handle(session, 'tool.execute', {tool: 'recon.note', callID: `n${++n}`, messageID: `m${n}`, args}) as Promise<any>;
  return {root, store, service, note};
}
function seed(store: ExperienceStore, count: number, session = 'recon') {
  for (let i = 0; i < count; i++) {
    const scope = {run: 'A', challenge: 'X', session, call: `${session}-c${i}`, message: `${session}-m${i}`};
    store.start(scope, 'workspace.read', {path: `materials/f${i}`});
    store.finish(scope, 'completed', {data: `r${i}`});
  }
}
const body = (text: string) => { expect(text.startsWith(HEADER)).toBe(true); return JSON.parse(text.slice(HEADER.length)); };
const prepare = (service: ControlService, session: string, input: Record<string, unknown>) => service.handle(session, 'context.prepare', input) as Promise<any>;
const texts = (view: any, slot: string) => view.slots[slot].map((e: any) => e.text);

describe('challenge workbook entries (team-decision §6.1)', () => {
  it('accepts every slot and rejects malformed entries', async () => {
    const {store, note} = fixture();
    await note('recon', {slot: 'facts', text: 'service answers on the documented entry', scope: 'staging only'});
    await note('recon', {slot: 'hypotheses', text: 'input reaches the parser unchanged', status: 'open'});
    await note('recon', {slot: 'refuted', text: 'default credentials do not apply'});
    await note('recon', {slot: 'questions', text: 'which component handles uploads?'});
    await note('solver-a', {slot: 'candidate', text: 'candidate material in a published artifact'});
    const stored = store.allRecords('A', 'X').map(r => r.note_json);
    expect(stored.map(n => [n.slot, n.status ?? null])).toEqual([['facts', null], ['hypotheses', 'open'], ['refuted', null], ['questions', 'open'], ['candidate', 'proposed']]);
    await expect(note('recon', {slot: 'facts', text: 'x'.repeat(301)})).rejects.toThrow('exceeds 300 characters');
    await expect(note('recon', {slot: 'hypotheses', text: 'missing status'})).rejects.toThrow('require status');
    await expect(note('recon', {slot: 'hypotheses', text: 'bad status', status: 'maybe'})).rejects.toThrow('status must be one of');
    await expect(note('recon', {slot: 'facts', text: 'fact with status', status: 'open'})).rejects.toThrow('take no status');
    await expect(note('recon', {kind: 'handoff', slot: 'facts', text: 'handoff entry'})).rejects.toThrow('must be a decision');
    await expect(note('recon', {text: 'text without slot'})).rejects.toThrow('require slot');
    store.close();
  });

  it('lets only the Domain Solver write candidate entries', async () => {
    const {store, service, note} = fixture();
    await expect(note('recon', {slot: 'candidate', text: 'recon candidate'})).rejects.toThrow('candidate entries are written by the Domain Solver only');
    await expect(coordinatorNote(service, {challenge: 'X', slot: 'candidate', text: 'coordinator candidate'})).rejects.toThrow('can only write questions');
    await expect(note('solver-a', {slot: 'candidate', text: 'solver candidate'})).resolves.toHaveProperty('id');
    store.close();
  });

  it('refuses unbound related_ids and evidence_refs with actionable messages', async () => {
    const {store, note} = fixture();
    await expect(note('solver-a', {slot: 'facts', text: 'fact with a shortened ref', evidence_refs: ['b962d132']})).rejects.toThrow('evidence_refs must be complete refs');
    await expect(note('recon', {observation: 'decision with a foreign record', related_ids: [999]})).rejects.toThrow('related_ids 999 is not a record of this challenge');
    store.close();
  });

  it('cleans secrets and flag forms from entry text on write', async () => {
    const {store, note} = fixture();
    await note('recon', {slot: 'facts', text: `token ${SECRET} and flag{synthetic} seen at https://a.example.test`});
    const text = store.allRecords('A', 'X')[0].note_json.text as string;
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('flag{synthetic}');
    store.close();
  });

  it('supersedes by role across sessions, never across roles, slots or challenges, and only an active entry', async () => {
    const {store, note} = fixture();
    const s1 = await note('solver-a', {slot: 'hypotheses', text: 'first guess', status: 'open'});
    const s2 = await note('solver-b', {slot: 'hypotheses', text: 'first guess supported', status: 'supported', supersedes: s1.id});
    await expect(note('solver-b', {slot: 'hypotheses', text: 'fork', status: 'open', supersedes: s1.id})).rejects.toThrow(`active entry is ${s2.id}`);
    const r1 = await note('recon', {slot: 'facts', text: 'recon fact'});
    await expect(note('solver-a', {slot: 'facts', text: 'solver rewrites recon', supersedes: r1.id})).rejects.toThrow(`related_ids [${r1.id}]`);
    await expect(note('solver-a', {slot: 'refuted', text: 'solver retires recon fact', supersedes: r1.id})).rejects.toThrow('its own role');
    await expect(note('recon', {slot: 'hypotheses', text: 'recon rewrites solver', status: 'open', supersedes: s2.id})).rejects.toThrow('its own role');
    // hypotheses -> refuted and facts -> refuted (same role, any session) are the only cross-slot supersedes.
    const s3 = await note('solver-a', {slot: 'refuted', text: 'guess refuted by the second experiment', supersedes: s2.id});
    const f1 = await note('solver-a', {slot: 'facts', text: 'solver fact'});
    await expect(note('solver-a', {slot: 'questions', text: 'fact turned into question', supersedes: f1.id})).rejects.toThrow('only hypotheses and facts may be superseded by a refuted entry');
    await expect(note('solver-b', {slot: 'refuted', text: 'fact retired', status: 'refuted', supersedes: f1.id})).rejects.toThrow('take no status; omit it');
    const f2 = await note('solver-b', {slot: 'refuted', text: 'earlier solver fact did not hold', supersedes: f1.id});
    const after = workbookView(store.allRecords('A', 'X'), 'domain-solver', {goal: {challenge: 'X', materials: [], submission: null}, candidate_host: {packages: [], completions: []}}).view as any;
    expect(after.slots.facts.map((e: any) => e.id)).not.toContain(f1.id);
    expect(after.slots.refuted.map((e: any) => e.id)).toContain(f2.id);
    const y = await note('recon-y', {slot: 'facts', text: 'other challenge'});
    await expect(note('recon', {slot: 'facts', text: 'cross challenge', supersedes: y.id})).rejects.toThrow('workbook entry of this challenge');
    // Read-time annotation; stored rows unchanged.
    const page = store.records('A', 'X', {kind: 'decision', limit: 40});
    const by = Object.fromEntries(page.records.map((r: any) => [r.id, r.superseded_by]));
    expect([by[s1.id], by[s2.id], by[s3.id]]).toEqual([s2.id, s3.id, null]);
    expect(store.allRecords('A', 'X').some((r: any) => 'superseded_by' in r)).toBe(false);
    store.close();
  });

  it('admits the Solver for workbook entries only; Engineer and Verifier cannot write; Recon decisions and handoffs unchanged', async () => {
    const {store, note} = fixture();
    await expect(note('solver-a', {observation: 'plain decision'})).rejects.toThrow('solver notes must be workbook entries');
    await expect(note('solver-a', {kind: 'handoff', observation: 'handoff'})).rejects.toThrow('solver notes must be workbook entries');
    await expect(note('engineer', {slot: 'candidate', text: 'engineer entry'})).rejects.toThrow('tool not permitted');
    await expect(note('verifier', {slot: 'facts', text: 'verifier entry'})).rejects.toThrow('tool not permitted');
    await expect(note('recon', {observation: 'plain recon decision'})).resolves.toHaveProperty('id');
    store.close();
  });
});

describe('workbook fold and caps', () => {
  it('gives full text to the newest entries per slot, shortens older ones instead of omitting them, and hides closed entries', async () => {
    const {store, note} = fixture();
    const facts = [];
    for (let i = 0; i < 21; i++) facts.push(await note('recon', {slot: 'facts', text: `fact ${i}`}));
    const q = await note('recon', {slot: 'questions', text: 'open question'});
    await note('recon', {slot: 'questions', text: 'answered question', status: 'answered', supersedes: q.id});
    const c = await note('solver-a', {slot: 'candidate', text: 'candidate'});
    await note('solver-a', {slot: 'candidate', text: 'withdrawn candidate', status: 'withdrawn', supersedes: c.id});
    const host = {goal: {challenge: 'X', materials: [], submission: null}, candidate_host: {packages: [], completions: []}};
    const {view, omitted_ids, short_ids} = workbookView(store.allRecords('A', 'X'), 'domain-solver', host);
    expect(texts(view, 'facts')).toHaveLength(21);
    expect((view as any).slots.facts[0]).toMatchObject({id: facts[0].id, slot: 'facts', role: 'recon', text: 'fact 0…', truncated: true, evidence_refs_count: 0});
    expect(texts(view, 'facts')[1]).toBe('fact 1');
    expect(omitted_ids).toEqual([]);
    expect(short_ids).toEqual([facts[0].id]);
    expect(view.coverage.full_ids).toHaveLength(20);
    expect(view.slots.questions).toEqual([]);
    expect(view.slots.candidate).toEqual([]);
    expect(view.coverage.complete).toBe(true);
    // A short row expands by id.
    expect(store.records('A', 'X', {ids: [facts[0].id]}).records[0].note_json.text).toBe('fact 0');
    store.close();
  });

  it('under total-cap pressure shortens the oldest facts and refuted routes first and omits nothing while short rows fit', async () => {
    const {store, note} = fixture();
    const ids = [];
    for (let i = 0; i < 20; i++) ids.push((await note('recon', {slot: 'facts', text: `${i}:` + 'f'.repeat(280)})).id);
    for (let i = 0; i < 20; i++) ids.push((await note('recon', {slot: 'refuted', text: `${i}:` + 'r'.repeat(280), scope: 'synthetic scope'})).id);
    const host = {goal: {challenge: 'X', materials: [], submission: null}, candidate_host: {packages: [], completions: []}};
    const result = workbookView(store.allRecords('A', 'X'), 'recon', host);
    expect(result.chars).toBeLessThanOrEqual(12000);
    expect(result.omitted_ids).toEqual([]);
    expect(result.short_ids.length).toBeGreaterThan(0);
    // By age only: the shortened ids are exactly the oldest ones.
    expect(result.short_ids).toEqual(ids.slice(0, result.short_ids.length));
    const shortRefuted = (result.view as any).slots.refuted.find((e: any) => e.truncated);
    if (shortRefuted) expect(shortRefuted.scope_truncated).toBe(true);
    for (const e of (result.view as any).slots.facts.filter((x: any) => x.truncated)) expect(Array.from(e.text).length).toBe(81);
    store.close();
  });

  it('drops short facts before any open hypothesis or question, and keeps a ninth open hypothesis as a short row', async () => {
    const {store, note} = fixture();
    const facts: number[] = [], hyps: number[] = [], questions: number[] = [];
    for (let i = 0; i < 150; i++) facts.push((await note('recon', {slot: 'facts', text: `${i}:` + 'f'.repeat(280)})).id);
    for (let i = 0; i < 9; i++) hyps.push((await note('recon', {slot: 'hypotheses', text: `${i}:` + 'h'.repeat(280), status: 'open'})).id);
    for (let i = 0; i < 3; i++) await note('recon', {slot: 'hypotheses', text: `s${i}:` + 'h'.repeat(280), status: 'supported'});
    for (let i = 0; i < 8; i++) questions.push((await note('recon', {slot: 'questions', text: `${i}:` + 'q'.repeat(280)})).id);
    const host = {goal: {challenge: 'X', materials: [], submission: null}, candidate_host: {packages: [], completions: []}};
    const result = workbookView(store.allRecords('A', 'X'), 'recon', host);
    expect(result.chars).toBeLessThanOrEqual(12000);
    expect(result.omitted_ids.length).toBeGreaterThan(0);
    expect(result.omitted_ids.every(id => facts.includes(id))).toBe(true);
    // Oldest facts go first.
    expect(result.omitted_ids).toEqual(facts.slice(0, result.omitted_ids.length));
    for (const id of [...hyps, ...questions]) expect(result.included_ids).toContain(id);
    expect(result.capacity_shortfall).toBeUndefined();
    expect((result.view as any).coverage.capacity_shortfall).toBeUndefined();
    store.close();
  });

  it('drops a protected entry only as a named capacity shortfall when even short rows cannot fit', async () => {
    const {store, note} = fixture();
    const hyps = [];
    for (let i = 0; i < 300; i++) hyps.push((await note('recon', {slot: 'hypotheses', text: `${i}:` + 'h'.repeat(200), status: 'open'})).id);
    const host = {goal: {challenge: 'X', materials: [], submission: null}, candidate_host: {packages: [], completions: []}};
    const result = workbookView(store.allRecords('A', 'X'), 'recon', host);
    const coverage = (result.view as any).coverage;
    expect(result.chars).toBeLessThanOrEqual(12000);
    expect(result.capacity_shortfall).toBe(true);
    expect(coverage.capacity_shortfall).toBe(true);
    expect(coverage.protected_omitted_ids).toEqual(result.omitted_ids);
    expect(result.omitted_ids).toEqual(hyps.slice(0, result.omitted_ids.length));
    expect(coverage.full_ids).toEqual([]);
    store.close();
  });

  it('keeps a fourth proposed candidate for the Solver as a short row', async () => {
    const {store, note} = fixture();
    const cands = [];
    for (let i = 0; i < 4; i++) cands.push((await note('solver-a', {slot: 'candidate', text: `candidate ${i} in a ref`})).id);
    const host = {goal: {challenge: 'X', materials: [], submission: null}, candidate_host: {packages: [], completions: []}};
    const result = workbookView(store.allRecords('A', 'X'), 'domain-solver', host);
    expect(result.included_ids).toEqual(cands);
    expect(result.short_ids).toEqual([cands[0]]);
    expect(result.omitted_ids).toEqual([]);
    store.close();
  });

  it('carries a full-to-short change of an older entry in the entry delta', async () => {
    const {store, note} = fixture();
    const host = {goal: {challenge: 'X', materials: [], submission: null}, candidate_host: {packages: [], completions: []}};
    const facts: number[] = [];
    for (let i = 0; i < 20; i++) facts.push((await note('recon', {slot: 'facts', text: `fact ${i}`})).id);
    const hash = (v: unknown) => JSON.stringify(v);
    const before = workbookView(store.allRecords('A', 'X'), 'domain-solver', host).view;
    const added = (await note('recon', {slot: 'facts', text: 'fact 20'})).id;
    const after = workbookView(store.allRecords('A', 'X'), 'domain-solver', host).view;
    const d: any = workbookDelta(after, workbookBase(after, hash), workbookBase(before, hash));
    expect(d.upserted.map((e: any) => e.id).sort((a: number, b: number) => a - b)).toEqual([facts[0], added]);
    expect(d.upserted.find((e: any) => e.id === facts[0])).toMatchObject({truncated: true});
    expect(d.removed).toEqual([]);
    store.close();
  });

  it('builds role views: Engineer sees only candidates; Recon sees no candidate slot; no role repeats the publication catalog', async () => {
    const {store, note} = fixture();
    await note('recon', {slot: 'facts', text: 'fact'});
    await note('solver-a', {slot: 'candidate', text: 'candidate'});
    const host = {goal: {challenge: 'X', materials: ['statement.md'], submission: null}, candidate_host: {packages: ['p1'], completions: []}};
    const engineer = workbookView(store.allRecords('A', 'X'), 'engineer', host).view as any;
    expect(Object.keys(engineer.slots)).toEqual(['candidate']);
    expect(engineer).toHaveProperty('candidate_host');
    expect(engineer).not.toHaveProperty('goal');
    const recon = workbookView(store.allRecords('A', 'X'), 'recon', host).view as any;
    expect(Object.keys(recon.slots)).toEqual(['facts', 'hypotheses', 'refuted', 'questions']);
    expect(recon).not.toHaveProperty('candidate_host');
    for (const v of [engineer, recon, workbookView(store.allRecords('A', 'X'), 'domain-solver', host).view as any]) expect(v).not.toHaveProperty('materials');
    store.close();
  });
});

describe('workbook injection', () => {
  it('a new Solver session sees upstream entries beyond recent steps and a 200-entry index', async () => {
    const {store, service, note} = fixture();
    await note('recon', {slot: 'facts', text: 'upstream fact from recon'});
    await note('solver-a', {slot: 'questions', text: 'question left by the previous solver'});
    seed(store, 205, 'recon');
    const payload = body((await prepare(service, 'solver-b', {messageID: 'u1', placement: 'chat.message'})).text);
    expect(payload.mode).toBe('full');
    expect(payload.recent).toEqual([]);
    // Default index mode is summary: the 200-entry index is not inlined, the summary counts every step.
    expect(payload).not.toHaveProperty('index');
    expect(payload.index_summary.total).toBe(207);
    expect(texts(payload.workbook, 'facts')).toEqual(['upstream fact from recon']);
    expect(texts(payload.workbook, 'questions')).toEqual(['question left by the previous solver']);
    expect(payload.workbook.goal.challenge).toBe('X');
    store.close();
  });

  it('lists a published artifact once, in state.publications, not again in the workbook', async () => {
    const {root, store, service, note} = fixture();
    await note('recon', {slot: 'facts', text: 'fact'});
    mkdirSync(join(root, 'workspace/X/work/recon'), {recursive: true});
    writeFileSync(join(root, 'workspace/X/work/recon/baseline'), 'baseline bytes');
    const p = await service.handle('recon', 'tool.execute', {tool: 'artifact.publish', callID: 'p1', messageID: 'mp1', args: {source: 'file', path: 'work/baseline'}}) as any;
    const payload = body((await prepare(service, 'solver-b', {messageID: 'u1', placement: 'chat.message'})).text);
    expect(payload.state.publications.map((x: any) => x.ref)).toEqual([p.ref]);
    expect(payload.workbook).not.toHaveProperty('materials');
    expect(JSON.stringify(payload.workbook)).not.toContain(p.ref);
    store.close();
  });

  it('delta carries the workbook only when it changed; compaction and unknown versions return the full workbook', async () => {
    const {store, service, note} = fixture();
    await note('recon', {slot: 'facts', text: 'first fact'});
    const first = await prepare(service, 'solver-a', {messageID: 'u1', placement: 'chat.message'});
    seed(store, 2, 'solver-a');
    const toolOnly = await prepare(service, 'solver-a', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c1', visibleVersion: first.version});
    expect(body(toolOnly.text)).not.toHaveProperty('workbook');
    const added = await note('solver-a', {slot: 'facts', text: 'second fact'});
    const changed = body((await prepare(service, 'solver-a', {messageID: 'u1', placement: 'tool.execute.after', callID: 'c2', visibleVersion: toolOnly.version})).text);
    expect(changed.mode).toBe('delta');
    // Entry-level delta: only the new entry and the changed coverage, not the whole workbook again.
    expect(changed.workbook).toMatchObject({mode: 'entries', removed: []});
    expect(changed.workbook.upserted.map((e: any) => [e.slot, e.text])).toEqual([['facts', 'second fact']]);
    expect(changed.workbook).not.toHaveProperty('slots');
    expect(changed.workbook).not.toHaveProperty('goal');
    await note('solver-a', {slot: 'facts', text: 'second fact, narrowed', supersedes: added.id});
    const compacted = body((await prepare(service, 'solver-a', {placement: 'compacting'})).text);
    expect(compacted.mode).toBe('full');
    expect(texts(compacted.workbook, 'facts')).toEqual(['first fact', 'second fact, narrowed']);
    expect(body((await prepare(service, 'solver-a', {messageID: 'u2', placement: 'chat.message', visibleVersion: 'unknown'})).text).workbook).toBeDefined();
    store.close();
  });

  it('audits the presented workbook ids and fails closed when the fold cannot be built', async () => {
    const {store, service, note} = fixture();
    const fact = await note('recon', {slot: 'facts', text: 'audited fact'});
    const projection = await prepare(service, 'engineer', {messageID: 'u1', placement: 'chat.message'});
    expect(body(projection.text).workbook.slots).toEqual({candidate: []});
    const solver = await prepare(service, 'solver-a', {messageID: 's1', placement: 'chat.message'});
    await service.handle('solver-a', 'model.call', {agent: 'domain-solver', provider: 'stub', model: 'scripted', messageID: 's1', contextDeliveries: [{version: solver.version, placement: 'chat.message', messageID: 's1'}]});
    const presented = service.audit.filter(a => a.op === 'context.presented' && a.sessionID === 'solver-a').at(-1)!.detail as any;
    expect(presented.workbook).toMatchObject({sent: 'full', included_ids: [fact.id], omitted_ids: []});
    // Verifier receives no projection at all.
    await expect(prepare(service, 'verifier', {messageID: 'v1', placement: 'chat.message'})).resolves.toEqual({});
    store.db.exec('ALTER TABLE recon_turns RENAME TO recon_turns_hidden');
    await expect(prepare(service, 'solver-a', {messageID: 's2', placement: 'chat.message'})).rejects.toThrow();
    await expect(service.handle('solver-a', 'model.call', {agent: 'domain-solver', provider: 'stub', model: 'scripted', messageID: 's2', contextDeliveries: []})).rejects.toThrow(/context projection/);
    store.db.exec('ALTER TABLE recon_turns_hidden RENAME TO recon_turns');
    store.close();
  });

  it('end to end through the product plugin: a Recon entry reaches the next Solver request', async () => {
    const {vi} = await import('vitest');
    const {createCtfAgentHooks} = await import('../../apps/opencode-plugin/src/index.js');
    const {store, service} = fixture();
    const mocked = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      try { return new Response(JSON.stringify({result: await service.handle(b.sessionID, b.operation, b.input)}), {status: 200}); }
      catch (error) { return new Response(JSON.stringify({error: String((error as Error).message)}), {status: 403}); }
    });
    try {
      const h = createCtfAgentHooks({controlUrl: 'http://127.0.0.1:12345', controlToken: 'x'.repeat(40), tools: ['recon.note', 'recon.read']});
      const entry = await service.handle('recon', 'tool.execute', {tool: 'recon.note', callID: 'e1', messageID: 'rm1', args: {slot: 'hypotheses', text: 'hypothesis handed to the solver', status: 'open'}}) as any;
      const output: any = {message: {id: 'su1'}, parts: [{id: 'p', type: 'text', text: 'dispatch'}]};
      await h['chat.message']!({sessionID: 'solver-a', agent: 'domain-solver', messageID: 'su1'} as never, output);
      const appended = body(output.parts.at(-1).text);
      expect(appended.workbook.slots.hypotheses).toEqual([expect.objectContaining({id: entry.id, role: 'recon', status: 'open', text: 'hypothesis handed to the solver'})]);
      await h['chat.params']!({sessionID: 'solver-a', agent: 'domain-solver', message: {id: 'su1'}, model: {providerID: 'stub', id: 'scripted'}} as never, {} as never);
      const presented = service.audit.filter(a => a.op === 'context.presented' && a.sessionID === 'solver-a').map(a => a.detail as any);
      expect(presented.at(-1).workbook.included_ids).toEqual([entry.id]);
    } finally { mocked.mockRestore(); store.close(); }
  });

  it('episode sources keep the Solver as author of its entries', async () => {
    const {store, service, note} = fixture();
    const entry = await note('solver-a', {slot: 'facts', text: 'solver authored fact'});
    const inputs = await service.learningInputs();
    const sources = inputs.flatMap((e: any) => e.input?.sources ?? []);
    const source = sources.find((s: any) => s.ref === `recon:${entry.id}`);
    expect(source?.content?.role).toBe('domain-solver');
    store.close();
  });
});

/** Inserts a raw slotted decision without write-time cleaning, to test presentation-time cleaning and per-entry failure. */
function rawEntry(store: ExperienceStore, challenge: string, note: unknown, role = 'recon', updatedAt = Date.now()) {
  const sequence = Number((store.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM recon_turns WHERE run_id=? AND challenge_id=?').get('A', challenge) as any).n);
  store.db.prepare(`INSERT INTO recon_turns(step_id,run_id,challenge_id,session_id,role,sequence,kind,note_json,status,original_complete,created_at,updated_at) VALUES(?,?,?,?,?,?,'decision',?,'completed',1,?,?)`)
    .run(`raw-${challenge}-${sequence}`, 'A', challenge, `raw-${role}`, role, sequence, JSON.stringify(note), updatedAt, updatedAt);
  return Number((store.db.prepare('SELECT MAX(id) AS id FROM recon_turns').get() as any).id);
}
const coordinatorNote = (service: ControlService, args: Record<string, unknown>, call = `c${Math.random()}`) =>
  service.handle('root', 'tool.execute', {tool: 'recon.note', callID: call, messageID: `m-${call}`, args}) as Promise<any>;
const coordinatorView = async (service: ControlService, input: Record<string, unknown> = {messageID: 'cu1', placement: 'chat.message'}) => {
  const projection = await prepare(service, 'root', input);
  return {projection, payload: projection.text ? body(projection.text) : undefined};
};
const section = (payload: any, challenge: string) => payload.workbook.challenges.find((c: any) => c.challenge === challenge);

describe('Coordinator workbook writes', () => {
  it('writes questions for a named challenge of this run and nothing else', async () => {
    const {store, service, note} = fixture();
    const q = await coordinatorNote(service, {challenge: 'X', slot: 'questions', text: 'which input path is still untested?'});
    const row = store.allRecords('A', 'X').find(r => Number(r.id) === q.id)!;
    expect([row.role, row.challenge_id, row.note_json.slot, row.note_json.challenge]).toEqual(['coordinator', 'X', 'questions', undefined]);
    await expect(coordinatorNote(service, {slot: 'questions', text: 'no challenge'})).rejects.toThrow('must name a challenge of this run');
    await expect(coordinatorNote(service, {challenge: 'Z', slot: 'questions', text: 'unknown challenge'})).rejects.toThrow('must name a challenge of this run');
    for (const args of [{slot: 'facts', text: 'fact'}, {slot: 'hypotheses', text: 'h', status: 'open'}, {slot: 'refuted', text: 'r'}, {slot: 'candidate', text: 'c'}, {observation: 'plain'}, {kind: 'handoff', slot: 'questions', text: 'handoff'}])
      await expect(coordinatorNote(service, {challenge: 'X', ...args})).rejects.toThrow('can only write questions');
    await expect(note('recon', {challenge: 'X', slot: 'facts', text: 'recon names a challenge'})).rejects.toThrow('challenge is bound by the host');
    await expect(note('solver-a', {challenge: 'X', slot: 'facts', text: 'solver names a challenge'})).rejects.toThrow('challenge is bound by the host');
    store.close();
  });

  it('supersedes any role\'s question; nobody else crosses roles; never across challenges or slots', async () => {
    const {store, service, note} = fixture();
    const rq = await note('recon', {slot: 'questions', text: 'recon question'});
    const sq = await note('solver-a', {slot: 'questions', text: 'solver question'});
    await expect(coordinatorNote(service, {challenge: 'X', slot: 'questions', text: 'recon question answered', status: 'answered', supersedes: rq.id})).resolves.toHaveProperty('id');
    const cq = await coordinatorNote(service, {challenge: 'X', slot: 'questions', text: 'solver question reordered', supersedes: sq.id});
    await expect(note('recon', {slot: 'questions', text: 'recon rewrites coordinator', supersedes: cq.id})).rejects.toThrow('its own role');
    await expect(note('solver-a', {slot: 'questions', text: 'solver rewrites coordinator', supersedes: cq.id})).rejects.toThrow('its own role');
    const fact = await note('recon', {slot: 'facts', text: 'recon fact'});
    await expect(coordinatorNote(service, {challenge: 'X', slot: 'questions', text: 'fact as question', supersedes: fact.id})).rejects.toThrow();
    await expect(coordinatorNote(service, {challenge: 'Y', slot: 'questions', text: 'cross challenge', supersedes: cq.id})).rejects.toThrow('workbook entry of this challenge');
    store.close();
  });
});

describe('Coordinator workbook view', () => {
  it('cleans text again at presentation: run redactions, flag forms and values added after the write', async () => {
    const {store, service, note} = fixture();
    rawEntry(store, 'X', {kind: 'decision', slot: 'questions', text: `raw ${RUN_SECRET} flag{synthetic} Cookie: session=abc Authorization: Bearer tok123`, status: 'open'});
    await note('recon', {slot: 'hypotheses', text: 'later-secret-value-4455 flows into the template', status: 'open'});
    store.addRedactions(['later-secret-value-4455']);
    const {projection} = await coordinatorView(service);
    for (const leaked of [RUN_SECRET, 'flag{synthetic}', 'later-secret-value-4455', 'session=abc', 'tok123']) expect(projection.text).not.toContain(leaked);
    store.close();
  });

  it('presents whitelisted fields only: one-line facts, no candidate text, no scope, index or state', async () => {
    const {store, service, note} = fixture();
    const fact = await note('recon', {slot: 'facts', text: 'f'.repeat(200), scope: 'scope stays out'});
    await note('recon', {slot: 'hypotheses', text: 'h'.repeat(250), status: 'open'});
    await note('solver-a', {slot: 'candidate', text: 'candidate text must not reach the coordinator'});
    await note('solver-a', {slot: 'questions', text: 'q'.repeat(250)});
    const {projection, payload} = await coordinatorView(service);
    const x = section(payload, 'X');
    expect(x.slots.facts[0].text).toHaveLength(120);
    expect(payload.workbook.coverage.truncated_ids).toEqual([fact.id]);
    expect(x.slots.hypotheses[0].text).toHaveLength(250);
    expect(x.slots.questions[0].text).toHaveLength(250);
    expect(x.slots.candidate[0]).toEqual({id: expect.any(Number), role: 'domain-solver', status: 'proposed', evidence_refs: []});
    expect(projection.text).not.toContain('candidate text must not reach');
    expect(projection.text).not.toContain('scope stays out');
    expect(projection.text).not.toContain('related_ids');
    for (const key of ['index', 'recent', 'state', 'experience']) expect(payload).not.toHaveProperty(key);
    expect(x).toMatchObject({submission: expect.any(Object), packages: [], completions: [], executions: expect.objectContaining({'domain-solver': {total: 2, running: 2}})});
    expect(payload.workbook.remaining_min).toEqual(expect.any(Number));
    store.close();
  });

  it('carries cleaned evidence refs with hypotheses, not with questions', async () => {
    const {store, service} = fixture();
    const ref = '0b7e4c1a-6f2d-4e8b-9a35-1c2d3e4f5a6b';
    const h = rawEntry(store, 'X', {kind: 'decision', slot: 'hypotheses', text: 'supported by a published response', status: 'supported', evidence_refs: [ref, `leak-${RUN_SECRET}`]});
    const q = rawEntry(store, 'X', {kind: 'decision', slot: 'questions', text: 'which layer refused it', status: 'open', evidence_refs: [ref]});
    const {projection, payload} = await coordinatorView(service);
    const x = section(payload, 'X');
    const hyp = x.slots.hypotheses.find((e: any) => e.id === h);
    expect(hyp.evidence_refs).toHaveLength(2);
    expect(hyp.evidence_refs[0]).toBe(ref);
    expect(projection.text).not.toContain(RUN_SECRET);
    expect(x.slots.questions.find((e: any) => e.id === q)).not.toHaveProperty('evidence_refs');
    store.close();
  });

  it('omits an entry that cannot be assembled and keeps the others', async () => {
    const {store, service, note} = fixture();
    const good = await note('recon', {slot: 'facts', text: 'good fact'});
    const bad = rawEntry(store, 'X', {kind: 'decision', slot: 'facts', text: {not: 'a string'}});
    const {payload} = await coordinatorView(service);
    expect(section(payload, 'X').slots.facts.map((e: any) => e.id)).toEqual([good.id]);
    expect(payload.workbook.coverage.failed_ids).toEqual([bad]);
    expect(payload.workbook.coverage.failed_reasons[bad]).toBe('assembly_failed');
    store.close();
  });

  it('lists only challenges with executions or entries; shortens first and collapses the least recently updated challenge only when short rows do not fit', async () => {
    const {store, service} = fixture();
    let {payload} = await coordinatorView(service);
    expect(payload.workbook.challenges.map((c: any) => c.challenge)).toEqual(['X']);
    const t = Date.now();
    for (let i = 0; i < 20; i++) rawEntry(store, 'X', {kind: 'decision', slot: 'questions', text: `${i}:` + 'x'.repeat(280)}, 'recon', t - 10000);
    for (let i = 0; i < 20; i++) rawEntry(store, 'Y', {kind: 'decision', slot: 'questions', text: `${i}:` + 'y'.repeat(280)}, 'recon', t);
    for (const [c, at] of [['X', t - 10000], ['Y', t]] as const) for (let i = 0; i < 8; i++) rawEntry(store, c, {kind: 'decision', slot: 'hypotheses', text: `${i}:` + 'h'.repeat(280), status: 'open'}, 'recon', at);
    ({payload} = await coordinatorView(service, {messageID: 'cu2', placement: 'chat.message'}));
    // Short rows fit: both challenges stay open and nothing is omitted.
    expect(payload.workbook.coverage.collapsed).toEqual([]);
    expect(payload.workbook.coverage.omitted_ids).toEqual([]);
    expect(payload.workbook.coverage.short_ids.length).toBeGreaterThan(0);
    expect(JSON.stringify(payload.workbook).length).toBeLessThanOrEqual(8000);
    for (let i = 0; i < 120; i++) rawEntry(store, 'X', {kind: 'decision', slot: 'facts', text: `${i}:` + 'x'.repeat(200)}, 'recon', t - 10000);
    for (let i = 0; i < 120; i++) rawEntry(store, 'Y', {kind: 'decision', slot: 'facts', text: `${i}:` + 'y'.repeat(200)}, 'recon', t);
    ({payload} = await coordinatorView(service, {messageID: 'cu3', placement: 'chat.message'}));
    expect(section(payload, 'X')).toMatchObject({collapsed: true, active: expect.objectContaining({questions: 20, hypotheses: 8})});
    expect(payload.workbook.coverage.collapsed).toEqual(['X']);
    expect(JSON.stringify(payload.workbook).length).toBeLessThanOrEqual(8000);
    store.close();
  });

  it('a single challenge over the cap is never collapsed: short rows first, then only the oldest facts are omitted', async () => {
    const {store, service} = fixture();
    const questions: number[] = [], hyps: number[] = [], facts: number[] = [];
    for (let i = 0; i < 20; i++) questions.push(rawEntry(store, 'X', {kind: 'decision', slot: 'questions', text: `${i}:` + 'q'.repeat(280)}));
    for (let i = 0; i < 8; i++) hyps.push(rawEntry(store, 'X', {kind: 'decision', slot: 'hypotheses', text: `${i}:` + 'h'.repeat(280), status: 'open'}));
    for (let i = 0; i < 200; i++) facts.push(rawEntry(store, 'X', {kind: 'decision', slot: 'facts', text: `${i}:` + 'f'.repeat(280)}));
    const {payload} = await coordinatorView(service);
    const coverage = payload.workbook.coverage;
    expect(section(payload, 'X').collapsed).toBeUndefined();
    expect(coverage.omitted_ids.length).toBeGreaterThan(0);
    expect(coverage.omitted_ids).toEqual(facts.slice(0, coverage.omitted_ids.length));
    for (const id of [...questions, ...hyps]) expect([...coverage.full_ids, ...coverage.short_ids]).toContain(id);
    expect(coverage.capacity_shortfall).toBeUndefined();
    // Coordinator short rows carry no text.
    const shortQuestion = section(payload, 'X').slots.questions.find((e: any) => coverage.short_ids.includes(e.id));
    expect(shortQuestion).toEqual({id: shortQuestion.id, role: 'recon'});
    expect(JSON.stringify(payload.workbook).length).toBeLessThanOrEqual(8000);
    store.close();
  });

  it('keeps cleaned evidence refs on short hypothesis rows of the Coordinator view', () => {
    const rows = Array.from({length: 12}, (_, i) => ({id: i + 1, sequence: i + 1, role: 'recon', kind: 'decision', updated_at: i,
      note_json: {slot: 'hypotheses', status: 'open', text: `h${i}`, evidence_refs: [`artifact:x${i}`]}}));
    const {view, short_ids} = coordinatorProjection([{id: 'X', rows, host: {submission: null, packages: [], completions: [], executions: {}}}], 10, t => t) as any;
    expect(short_ids).toEqual([1, 2, 3, 4]);
    expect(view.challenges[0].slots.hypotheses[0]).toEqual({id: 1, role: 'recon', status: 'open', evidence_refs: ['artifact:x0']});
  });
});

describe('Coordinator workbook injection', () => {
  it('sends entry deltas on change, unchanged otherwise, full on compaction; failures block only the Coordinator', async () => {
    const {store, service, note} = fixture();
    const first = await prepare(service, 'root', {messageID: 'cu1', placement: 'chat.message'});
    expect(body(first.text).mode).toBe('full');
    expect(await prepare(service, 'root', {placement: 'tool.execute.after', callID: 't1', visibleVersion: first.version})).toEqual({version: first.version, unchanged: true});
    const q = await note('solver-a', {slot: 'questions', text: 'new solver question'});
    const changed = body((await prepare(service, 'root', {placement: 'tool.execute.after', callID: 't2', visibleVersion: first.version})).text);
    expect(changed).toMatchObject({mode: 'delta', base_version: first.version, workbook: {mode: 'entries', removed: []}});
    expect(changed.workbook.upserted).toEqual([expect.objectContaining({id: q.id, challenge: 'X', slot: 'questions', text: 'new solver question'})]);
    expect(changed.workbook).not.toHaveProperty('remaining_min');
    await prepare(service, 'root', {placement: 'compacting'});
    expect(service.audit.filter(a => a.op === 'context.presented' && a.sessionID === 'root').at(-1)).toMatchObject({detail: {challenge: null, mode: 'full', delivery: 'compaction_context', workbook: {included_ids: [q.id]}}});
    await service.handle('root', 'model.call', {agent: 'coordinator', provider: 'stub', model: 'scripted', messageID: 'cu1', contextDeliveries: [{version: first.version, placement: 'chat.message', messageID: 'cu1'}]});
    expect(service.audit.filter(a => a.op === 'context.presented' && a.sessionID === 'root' && (a.detail as any).placement === 'chat.message')).toHaveLength(1);
    store.db.exec('ALTER TABLE recon_turns RENAME TO recon_turns_hidden');
    await expect(prepare(service, 'root', {messageID: 'cu2', placement: 'chat.message'})).rejects.toThrow();
    await expect(service.handle('root', 'model.call', {agent: 'coordinator', provider: 'stub', model: 'scripted', messageID: 'cu2', contextDeliveries: []})).rejects.toThrow(/context projection/);
    store.db.exec('ALTER TABLE recon_turns_hidden RENAME TO recon_turns');
    store.close();
  });

  it('end to end through the product plugin: a Solver question reaches the Coordinator, is answered, and leaves the next Solver view', async () => {
    const {vi} = await import('vitest');
    const {createCtfAgentHooks} = await import('../../apps/opencode-plugin/src/index.js');
    const {store, service} = fixture();
    const mocked = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      try { return new Response(JSON.stringify({result: await service.handle(b.sessionID, b.operation, b.input)}), {status: 200}); }
      catch (error) { return new Response(JSON.stringify({error: String((error as Error).message)}), {status: 403}); }
    });
    try {
      const h = createCtfAgentHooks({controlUrl: 'http://127.0.0.1:12345', controlToken: 'x'.repeat(40), tools: ['recon.note', 'recon.read']});
      const q = await service.handle('solver-a', 'tool.execute', {tool: 'recon.note', callID: 'sq', messageID: 'sm', args: {slot: 'questions', text: 'does the parser accept nested input?'}}) as any;
      const toolOutput = {title: 't', output: 'native', metadata: {}};
      await h['tool.execute.after']!({sessionID: 'root', tool: 'task', callID: 'task1', args: {}}, toolOutput);
      const coordinator = body(toolOutput.output.slice('native\n'.length));
      expect(section(coordinator, 'X').slots.questions).toEqual([expect.objectContaining({id: q.id, role: 'domain-solver', text: 'does the parser accept nested input?'})]);
      await coordinatorNote(service, {challenge: 'X', slot: 'questions', text: 'answered by the last solver round', status: 'answered', supersedes: q.id});
      const output: any = {message: {id: 'su9'}, parts: [{id: 'p', type: 'text', text: 'dispatch'}]};
      await h['chat.message']!({sessionID: 'solver-b', agent: 'domain-solver', messageID: 'su9'} as never, output);
      expect(body(output.parts.at(-1).text).workbook.slots.questions).toEqual([]);
    } finally { mocked.mockRestore(); store.close(); }
  });
});

describe('workbook entry-level delta', () => {
  it('merging entry deltas onto the first full view rebuilds every later full view', async () => {
    const {store, service, note} = fixture();
    const merge = (view: any, d: any) => {
      const next = structuredClone(view);
      for (const id of d.removed) for (const slot of Object.keys(next.slots)) next.slots[slot] = next.slots[slot].filter((e: any) => e.id !== id);
      for (const e of d.upserted) {
        for (const slot of Object.keys(next.slots)) next.slots[slot] = next.slots[slot].filter((x: any) => x.id !== e.id);
        next.slots[e.slot] = [...next.slots[e.slot], e].sort((a: any, b: any) => a.id - b.id);
      }
      for (const k of Object.keys(d)) if (!['mode', 'upserted', 'removed'].includes(k)) next[k] = d[k];
      return next;
    };
    const sortSlots = (view: any) => ({...view, slots: Object.fromEntries(Object.entries(view.slots).map(([k, v]: any) => [k, [...v].sort((a: any, b: any) => a.id - b.id)]))});
    const first = await prepare(service, 'solver-a', {messageID: 'u1', placement: 'chat.message'});
    let view = body(first.text).workbook, visible = first.version, step = 0;
    const h = await note('recon', {slot: 'hypotheses', text: 'guess', status: 'open'});
    const q = await note('recon', {slot: 'questions', text: 'question'});
    for (const write of [
      () => note('solver-a', {slot: 'facts', text: 'fact one'}),
      () => note('recon', {slot: 'refuted', text: 'guess refuted', supersedes: h.id}),
      () => coordinatorNote(service, {challenge: 'X', slot: 'questions', text: 'answered', status: 'answered', supersedes: q.id}),
      () => note('solver-a', {slot: 'candidate', text: 'candidate in a ref'}),
    ]) {
      await write();
      const next = await prepare(service, 'solver-a', {placement: 'tool.execute.after', callID: `d${++step}`, visibleVersion: visible});
      const d = body(next.text);
      expect(d.mode).toBe('delta');
      view = merge(view, d.workbook);
      const full = body((await prepare(service, 'solver-a', {placement: 'compacting'})).text).workbook;
      expect(sortSlots(view)).toEqual(sortSlots(full));
      visible = next.version;
    }
    store.close();
  });

  it('sends far less than the whole workbook per change once the workbook is large', async () => {
    const {store, service, note} = fixture();
    for (let i = 0; i < 15; i++) await note('recon', {slot: 'facts', text: `${i}:` + 'f'.repeat(250)});
    const first = await prepare(service, 'solver-a', {messageID: 'u1', placement: 'chat.message'});
    const fullChars = JSON.stringify(body(first.text).workbook).length;
    await note('solver-a', {slot: 'facts', text: 'one more fact'});
    const d = body((await prepare(service, 'solver-a', {placement: 'tool.execute.after', callID: 'x', visibleVersion: first.version})).text).workbook;
    expect(d.upserted).toHaveLength(1);
    expect(JSON.stringify(d).length).toBeLessThan(fullChars / 5);
    store.close();
  });
});

describe('Coordinator entry-level delta', () => {
  it('merging Coordinator deltas onto the first full view rebuilds every later full view', async () => {
    const {store, service, note} = fixture();
    const merge = (view: any, d: any) => {
      const next = structuredClone(view);
      const drop = (id: number) => { for (const c of next.challenges) if (c.slots) for (const k of Object.keys(c.slots)) c.slots[k] = c.slots[k].filter((e: any) => e.id !== id); };
      for (const id of d.removed) drop(id);
      next.challenges = next.challenges.filter((c: any) => !(d.removed_challenges ?? []).includes(c.challenge));
      for (const h of d.challenges ?? []) {
        const i = next.challenges.findIndex((c: any) => c.challenge === h.challenge);
        const slots = h.collapsed ? undefined : (i >= 0 && next.challenges[i].slots) || {facts: [], hypotheses: [], refuted: [], questions: [], candidate: []};
        const merged = slots ? {...h, slots} : h;
        if (i >= 0) next.challenges[i] = merged; else next.challenges.push(merged);
      }
      for (const {challenge, slot, ...e} of d.upserted) {
        drop(e.id);
        const c = next.challenges.find((x: any) => x.challenge === challenge);
        c.slots[slot] = [...c.slots[slot], e].sort((a: any, b: any) => a.id - b.id);
      }
      for (const k of ['remaining_min', 'coverage']) if (k in d) next[k] = d[k];
      return next;
    };
    const norm = (view: any) => ({...view, challenges: [...view.challenges].sort((a: any, b: any) => a.challenge.localeCompare(b.challenge)).map((c: any) => c.slots ? {...c, slots: Object.fromEntries(Object.entries(c.slots).map(([k, v]: any) => [k, [...v].sort((a: any, b: any) => a.id - b.id)]))} : c)});
    const first = await prepare(service, 'root', {messageID: 'cu1', placement: 'chat.message'});
    let view = body(first.text).workbook, visible = first.version, step = 0;
    const h = await note('recon', {slot: 'hypotheses', text: 'guess', status: 'open'});
    const q = await note('solver-a', {slot: 'questions', text: 'question'});
    for (const write of [
      () => note('recon', {slot: 'facts', text: 'f'.repeat(200)}),
      () => note('recon', {slot: 'refuted', text: 'guess refuted', supersedes: h.id}),
      () => coordinatorNote(service, {challenge: 'X', slot: 'questions', text: 'answered', status: 'answered', supersedes: q.id}),
      () => note('solver-a', {slot: 'candidate', text: 'candidate in a ref'}),
      () => note('recon-y', {slot: 'facts', text: 'second challenge appears'}),
    ]) {
      await write();
      const next = await prepare(service, 'root', {placement: 'tool.execute.after', callID: `cd${++step}`, visibleVersion: visible});
      const d = body(next.text);
      expect(d.mode).toBe('delta');
      view = merge(view, d.workbook);
      const full = body((await prepare(service, 'root', {placement: 'compacting'})).text).workbook;
      expect(norm(view)).toEqual(norm(full));
      visible = next.version;
    }
    store.close();
  });
});
