// Fixed decision-point harness (fixed decision-point diagnosis design §3.2, option C): one product role in one OpenCode
// session, with the real role files, Skills and CTF plugin, but a local fake control service instead of the launcher.
// The fake serves a synthetic workbook through the same view function the host uses (workbook.ts), keeps workbook
// writes in memory, serves synthetic materials, and answers every other tool with a fixed "not executed" result or a
// case-defined stub. No challenge, target, network tool or judge is involved.
//
// Usage:
//   npx tsx tests/manual/fixed-point-harness.mts <case.json> --variant <name> --out <dir> --mock
//   npx tsx tests/manual/fixed-point-harness.mts <case.json> --variant <name> --out <dir> \
//       --opencode-config <opencode.json> --allow-model [--max-model-calls 40] [--timeout-ms 600000]
//   --mock: scripted local provider, 0 model calls; checks the wiring (role prompt, context block, tool routing,
//           Skill discovery, same/new session) and exits non-zero if a check fails.
//   --allow-model: calls the provider of the given OpenCode config. Only inside an authorized experiment batch.
// <dir> must not exist and must be outside the repository: it receives transcript.json (tool calls, workbook writes,
// final texts; synthetic content only) and summary.json (counts).
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startManagedOpenCode, loadOpenCodeConfig } from '../../packages/opencode-bridge/src/server.js';
import { collectLayer, mergeAgentOptions } from '../../apps/launcher/src/launch.js';
import { MANAGED_TOOLS } from '../../apps/launcher/src/control-service.js';
import { workbookView, activeEntries, type WorkbookRole } from '../../apps/launcher/src/workbook.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const productDir = join(repoRoot, 'product');
const OPENCODE = process.env.OPENCODE_BIN ?? '/Users/caihaoming/.opencode/bin/opencode';

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const casePath = argv[0];
const variantName = value('--variant');
const outArg = value('--out');
const mock = flag('--mock');
const configPath = value('--opencode-config');
const maxModelCalls = Number(value('--max-model-calls') ?? 40);
const timeoutMs = Number(value('--timeout-ms') ?? 600000);
const fail = (message: string): never => { console.error(`fixed-point-harness: ${message}`); process.exit(2); };
if (!casePath || casePath.startsWith('--')) fail('usage: <case.json> --variant <name> --out <dir> (--mock | --opencode-config <path> --allow-model)');
if (!variantName) fail('--variant is required');
if (!outArg) fail('--out is required');
if (mock === Boolean(configPath)) fail('choose exactly one of --mock or --opencode-config');
if (configPath && !flag('--allow-model')) fail('--opencode-config calls a real model; add --allow-model only inside an authorized batch');
if (!Number.isInteger(maxModelCalls) || maxModelCalls < 1) fail('--max-model-calls must be a positive integer');
const out = resolve(outArg!);
if (existsSync(out)) fail('--out must not exist');
if (out === repoRoot || out.startsWith(repoRoot + sep)) fail('--out must be outside the repository');

// ---------- case ----------
interface Entry { id: number; role: string; slot: string; text: string; status?: string; scope?: string; evidence_refs?: string[]; related_ids?: number[]; supersedes?: number }
interface Stub { tool: string; match?: string; result: unknown }
interface Round { dispatch: string; session?: 'same' | 'new' }
interface Variant { dispatch?: string; dispatchAppend?: string; workbook?: Entry[]; rounds?: Round[]; note?: string; hint?: boolean }
interface Case {
  id: string; role: WorkbookRole; questions: string[]; materials: Record<string, string>; workbook: Entry[];
  rounds: Round[]; stubs?: Stub[]; variants: Record<string, Variant>; expected: { next_step: string; must_not: string[] };
}
const spec = JSON.parse(await readFile(resolve(casePath!), 'utf8')) as Case;
const variant = spec.variants?.[variantName!] ?? fail(`unknown variant ${variantName}; known: ${Object.keys(spec.variants ?? {}).join(', ')}`);
if (!['domain-solver', 'recon'].includes(spec.role)) fail('role must be domain-solver or recon');
const rounds: Round[] = (variant.rounds ?? spec.rounds).map((r, i) => ({
  ...r, dispatch: (i === 0 && variant.dispatch ? variant.dispatch : r.dispatch) + (i === 0 && variant.dispatchAppend ? `\n\n${variant.dispatchAppend}` : '')
}));
if (!rounds.length) fail('case has no rounds');

// ---------- in-memory workbook (host rules kept to what the views need) ----------
const STATUS: Record<string, string[]> = { hypotheses: ['open', 'supported', 'refuted'], questions: ['open', 'answered', 'dropped'], candidate: ['proposed', 'withdrawn'] };
let sequence = 0, nextId = 1000;
const rows: any[] = [];
const written = new Set<number>();
const addRow = (role: string, note: Record<string, unknown>, id?: number) => {
  const row = { id: id ?? nextId++, sequence: ++sequence, kind: 'decision', role, note_json: note, created_at: Date.now(), updated_at: Date.now() };
  rows.push(row); return row;
};
for (const e of [...spec.workbook, ...(variant.workbook ?? [])]) {
  const { id, role, ...note } = e; addRow(role, note, id); nextId = Math.max(nextId, id + 1);
}
const writeEntry = (role: string, args: any) => {
  const slot = String(args.slot ?? '');
  if (!slot) return { error: 'harness: only slotted workbook entries are recorded' };
  if (!['facts', 'hypotheses', 'refuted', 'questions', 'candidate'].includes(slot)) return { error: `slot must be one of facts, hypotheses, refuted, questions, candidate` };
  if (typeof args.text !== 'string' || !args.text || args.text.length > 300) return { error: 'text is required, at most 300 characters' };
  if (STATUS[slot] && !STATUS[slot]!.includes(args.status)) return { error: `status must be one of ${STATUS[slot]!.join('|')}` };
  if (args.supersedes !== undefined) {
    const active = activeEntries(rows).find(e => e.id === args.supersedes);
    if (!active) return { error: `supersedes ${args.supersedes} is not an active entry` };
    if (active.role !== role) return { error: 'only an entry of its own role can be superseded' };
  }
  const note: Record<string, unknown> = { slot, text: args.text };
  for (const k of ['status', 'scope', 'evidence_refs', 'related_ids', 'supersedes']) if (args[k] !== undefined) note[k] = args[k];
  const row = addRow(role, note);
  written.add(row.id);
  return { id: row.id, slot };
};

// ---------- recording ----------
const t0 = Date.now();
const events: any[] = [];
const record = (kind: string, detail: Record<string, unknown>) => events.push({ t_ms: Date.now() - t0, kind, ...detail });
let modelCalls = 0;
let roundIndex = 0;

// ---------- fake control service ----------
const token = randomBytes(32).toString('hex');
const runtimeDir = join(out, 'runtime');
const skillRoot = join(runtimeDir, 'config', 'opencode', 'skills');
const permissions = JSON.parse(await readFile(join(productDir, 'opencode', 'opencode.json'), 'utf8')).agent?.[spec.role]?.permission ?? {};
const work = new Map<string, string>();
const visible = new Map<string, string>();
const notExecuted = { harness: 'fixed decision point: this operation is not executed here', next: 'record the planned step and its expected observation in the workbook, then hand back' };
const stubFor = (tool: string, args: unknown) => (spec.stubs ?? []).find(s => (s.tool === tool || s.tool === '*') && (!s.match || new RegExp(s.match).test(JSON.stringify(args))))?.result;
// Candidate host hint (team-decision design §6.2): ids only, computed from roles, statuses, supersedes and the round
// boundary; the host never reads the entry text or judges whether an entry should change.
const roundStartSequences: number[] = [];
const unchangedOwnOpen = () => activeEntries(rows)
  .filter(e => e.role === spec.role && (e.slot === 'hypotheses' || e.slot === 'questions') && (e.status ?? 'open') === 'open' && e.sequence <= (roundStartSequences[roundIndex] ?? 0))
  .map(e => e.id);
const HINT_NOTE = 'Open hypotheses and questions your role wrote before this round that this round has not superseded yet. Supersede, refute or leave each open as the evidence says; the host does not judge them.';
const contextText = (role: WorkbookRole) => {
  const host = { goal: { challenge: spec.id, materials: Object.keys(spec.materials).map(n => `materials/${n}`), submission: { available: false } }, candidate_host: { packages: [], completions: [] } };
  const wb = workbookView(rows, role, host as never);
  const hint = variant.hint ? { own_open_unchanged_this_round: { ids: unchangedOwnOpen(), note: HINT_NOTE } } : {};
  const version = createHash('sha256').update(JSON.stringify([wb.view, hint])).digest('hex').slice(0, 16);
  const payload = { mode: 'full', version, current_question: { source: 'the native dispatch message of this session, kept unmodified in history', execution: null, role }, state: { publications: [] }, workbook: wb.view, ...hint };
  return { version, text: '[CTF investigation context]\n' + JSON.stringify(payload), hintIds: variant.hint ? hint.own_open_unchanged_this_round!.ids : null };
};
const toolExecute = (sessionID: string, tool: string, args: any) => {
  switch (tool) {
    case 'recon.note': return writeEntry(spec.role, args);
    case 'recon.read': return { records: activeEntries(rows).filter(e => !Array.isArray(args?.ids) || args.ids.includes(e.id)) };
    case 'workspace.list': return { entries: [...Object.keys(spec.materials).map(n => `materials/${n}`), ...[...work.keys()]] };
    case 'workspace.read': {
      const path = String(args?.path ?? '');
      const name = path.startsWith('materials/') ? path.slice('materials/'.length) : undefined;
      const text = name !== undefined ? spec.materials[name] : work.get(path);
      return text === undefined ? { error: `not found: ${path}` } : { path, content: text, nextCursor: null };
    }
    case 'workspace.write': {
      const path = String(args?.path ?? '');
      if (!path.startsWith('work/')) return { error: 'only work/ is writable' };
      work.set(path, String(args?.content ?? '')); return { path, bytes: Buffer.byteLength(String(args?.content ?? '')) };
    }
    default: return stubFor(tool, args) ?? notExecuted;
  }
};
const control = createServer((req: IncomingMessage, res: ServerResponse) => { void (async () => {
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c));
  const { sessionID, operation, input } = JSON.parse(Buffer.concat(chunks).toString());
  const reply = (result: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result })); };
  const deny = (error: string) => { res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error })); };
  switch (operation) {
    case 'context.prepare': {
      const c = contextText(spec.role);
      if (input?.placement !== 'compacting' && input?.visibleVersion === c.version) return reply({ version: c.version, unchanged: true });
      if (visible.get(sessionID) !== c.version) record('context', { round: roundIndex, session: sessionID, version: c.version, placement: input?.placement, entries: activeEntries(rows).length, activeIds: activeEntries(rows).map(e => e.id), hintIds: c.hintIds });
      visible.set(sessionID, c.version);
      return reply({ version: c.version, text: c.text });
    }
    case 'model.call':
      if (++modelCalls > maxModelCalls) { record('model.denied', { round: roundIndex, modelCalls }); return deny('denied: harness model-call budget exhausted'); }
      return reply({ maxOutputTokens: 32000 });
    case 'tool.before': {
      const tool = String(input?.tool ?? '');
      if (tool === 'read') {
        const p = resolve(String(input?.args?.filePath ?? ''));
        if (!(p === skillRoot || p.startsWith(skillRoot + sep))) { record('tool.denied', { round: roundIndex, tool, reason: 'read outside Skill root' }); return deny('denied: read is limited to installed Skills'); }
      } else if (tool !== 'skill' && permissions[tool] !== 'allow') { record('tool.denied', { round: roundIndex, tool }); return deny('denied: tool not permitted'); }
      record('tool.call', { round: roundIndex, session: sessionID, tool, args: input?.args ?? {} });
      return reply({ rpcTimeoutMs: 15000 });
    }
    case 'tool.execute': {
      const result = toolExecute(sessionID, String(input?.tool), input?.args ?? {});
      record('tool.result', { round: roundIndex, tool: input?.tool, result });
      return reply(result);
    }
    default: return reply({});
  }
})().catch(() => res.writeHead(500).end()); });
await new Promise<void>(done => control.listen(0, '127.0.0.1', done));
const controlUrl = `http://127.0.0.1:${(control.address() as any).port}/`;

// ---------- scripted provider (--mock) ----------
const mockRequests: Array<{ system: string; user: string; tools: string[] }> = [];
const mockServer = mock ? createServer((req, res) => { void (async () => {
  if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const text = (m: any) => typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((x: any) => x?.text ?? '').join('\n') : '';
  const messages: any[] = body.messages ?? [];
  const lastUser = messages.map(m => m.role).lastIndexOf('user');
  mockRequests.push({ system: messages.filter(m => m.role === 'system').map(text).join('\n'), user: messages.filter(m => m.role === 'user').map(text).join('\n'), tools: (body.tools ?? []).map((t: any) => t?.function?.name) });
  const step = messages.slice(lastUser + 1).filter(m => m.role === 'tool').length;
  // With the hint shown, the scripted note retires the first listed entry, so the hint and supersede metrics are exercised.
  const hinted = [...mockRequests.at(-1)!.user.matchAll(/"own_open_unchanged_this_round":\{"ids":\[([0-9,]*)\]/g)].at(-1)?.[1]?.split(',').filter(Boolean).map(Number) ?? [];
  const note = hinted.length ? { slot: 'refuted', text: 'mock: retired by the scripted provider', supersedes: hinted[0] } : { slot: 'hypotheses', text: 'mock hypothesis written by the scripted provider', status: 'open' };
  const plan: Array<[string, unknown] | null> = [['ctf_workspace_read', { path: `materials/${Object.keys(spec.materials)[0]}` }], ['skill', { name: 'python-runtime-diagnosis' }], ['ctf_recon_note', note], null];
  const call = plan[Math.min(step, plan.length - 1)];
  const base = { id: 'chatcmpl-' + randomUUID(), object: 'chat.completion.chunk', created: 1, model: 'scripted' };
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + randomUUID().slice(0, 8), type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } : { role: 'assistant', content: 'MOCK_HANDBACK' };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const v of [{ ...base, choices: [{ index: 0, delta, finish_reason: null }] }, { ...base, choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] }, { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }])
    res.write('data: ' + JSON.stringify(v) + '\n\n');
  res.end('data: [DONE]\n\n');
})().catch(() => res.writeHead(500).end()); }) : undefined;
if (mockServer) await new Promise<void>(done => mockServer.listen(0, '127.0.0.1', done));

// ---------- OpenCode config: product assets + plugin + provider ----------
await mkdir(join(runtimeDir, 'config', 'opencode'), { recursive: true });
const targets = new Map<string, string>();
for (const layer of [productDir, join(productDir, 'opencode')]) for (const item of await collectLayer(layer)) targets.set(item.target, item.source);
for (const [target, source] of targets) { const dest = join(runtimeDir, 'config', 'opencode', target); await mkdir(dirname(dest), { recursive: true }); await copyFile(source, dest); }
const baseConfig = JSON.parse(await readFile(join(productDir, 'opencode', 'opencode.json'), 'utf8')) as Record<string, any>;
let provider: Record<string, unknown>, model: string, environment: Record<string, string> = {}, runtimeAgent: unknown;
if (mock) {
  model = 'stub/scripted';
  provider = { stub: { npm: '@ai-sdk/openai-compatible', options: { baseURL: `http://127.0.0.1:${(mockServer!.address() as any).port}/v1`, apiKey: 'local-only' }, models: { scripted: { limit: { context: 131072, output: 8192 } } } } };
  process.env.HTTP_PROXY = process.env.HTTPS_PROXY = process.env.ALL_PROXY = 'http://127.0.0.1:9';
  process.env.NO_PROXY = '127.0.0.1,localhost';
} else {
  const loaded = await loadOpenCodeConfig(resolve(configPath!));
  model = loaded.config.model!; provider = loaded.config.provider as Record<string, unknown>; environment = loaded.environment; runtimeAgent = (loaded.config as any).agent;
}
const productAgents = new Set([...targets.keys()].filter(t => /^agents\/[^/]+\.md$/.test(t)).map(t => t.slice('agents/'.length, -'.md'.length)));
const merged = mergeAgentOptions(runtimeAgent, baseConfig.agent, productAgents);
const agent = { ...(merged.agent ?? baseConfig.agent) } as Record<string, any>;
agent[spec.role] = { ...(agent[spec.role] ?? {}), mode: 'all' }; // prompted directly instead of through a Coordinator task
const config = { ...baseConfig, agent, default_agent: spec.role, model, small_model: model, provider, enabled_providers: Object.keys(provider),
  plugin: [[join(repoRoot, 'apps', 'opencode-plugin', 'src', 'entry.ts'), { controlUrl, controlToken: token, tools: MANAGED_TOOLS }]] };

// ---------- run ----------
const abort = new AbortController();
const timer = setTimeout(() => abort.abort(), timeoutMs);
const finals: Array<{ round: number; session: string; text: string }> = [];
const skills: string[] = [];
let failure: string | undefined;
let engine: Awaited<ReturnType<typeof startManagedOpenCode>> | undefined;
try {
  engine = await startManagedOpenCode({ directory: runtimeDir, binaryPath: OPENCODE, signal: abort.signal, environment, config: config as never });
  const client = engine.client;
  for (const s of (await client.app.skills({}, { throwOnError: true })).data ?? []) skills.push(s.name);
  let session: string | undefined;
  for (const [i, round] of rounds.entries()) {
    roundIndex = i;
    roundStartSequences[i] = sequence;
    if (!session || round.session !== 'same') session = (await client.session.create({ title: `${spec.id} ${variantName} r${i}` }, { throwOnError: true })).data!.id;
    record('round.start', { round: i, session, sessionMode: i === 0 ? 'first' : round.session ?? 'new' });
    await client.session.prompt({ sessionID: session, agent: spec.role, parts: [{ type: 'text', text: round.dispatch }] }, { throwOnError: true });
    const messages = (await client.session.messages({ sessionID: session }, { throwOnError: true })).data ?? [];
    const last = [...messages].reverse().find((m: any) => m.info.role === 'assistant');
    const text = (last?.parts ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
    finals.push({ round: i, session, text });
    record('round.end', { round: i, session, textChars: text.length, error: last ? Boolean((last.info as any).error) : null });
  }
} catch (error) {
  failure = abort.signal.aborted ? 'timeout' : String(error instanceof Error ? error.message : error).slice(0, 300);
} finally {
  clearTimeout(timer);
  await engine?.close().catch(() => undefined);
  control.close(); mockServer?.close();
}

// ---------- outputs ----------
const calls = events.filter(e => e.kind === 'tool.call');
const writes = rows.filter(r => written.has(r.id));
const roundOfWrite = new Map<number, number>(events.filter(e => e.kind === 'tool.result' && e.tool === 'recon.note' && typeof (e.result as any)?.id === 'number').map(e => [(e.result as any).id as number, e.round as number]));
const isEarlierOwn = (r: any, i: number) => { const old = rows.find(o => o.id === r.note_json.supersedes); return Boolean(old && old.role === spec.role && old.sequence <= (roundStartSequences[i] ?? 0)); };
const bigrams = (t: string) => { const x = t.replace(/\s+/g, ''); return new Set([...Array(Math.max(0, x.length - 1)).keys()].map(k => x.slice(k, k + 2))); };
const similarity = (a: string, b: string) => { const A = bigrams(a), B = bigrams(b); const inter = [...A].filter(v => B.has(v)).length; const union = new Set([...A, ...B]).size; return union ? inter / union : 0; };
const summary = {
  case: spec.id, variant: variantName, questions: spec.questions, mode: mock ? 'mock' : 'model', model, failure: failure ?? null,
  rounds: rounds.length, modelCalls, maxModelCalls,
  skillsInstalled: skills,
  toolCalls: Object.fromEntries([...new Set(calls.map(c => c.tool))].map(t => [t, calls.filter(c => c.tool === t).length])),
  toolCallsByRound: rounds.map((_, i) => calls.filter(c => c.round === i).map(c => c.tool)),
  skillLoads: calls.filter(c => c.tool === 'skill').map(c => ({ round: c.round, name: c.args?.name ?? null })),
  skillReferenceReads: calls.filter(c => c.tool === 'read').length,
  firstNonReadAction: rounds.map((_, i) => calls.find(c => c.round === i && !['read', 'skill', 'ctf_workspace_read', 'ctf_workspace_list', 'ctf_recon_read', 'ctf_workspace_search'].includes(c.tool))?.tool ?? null),
  workbookWrites: writes.map(r => ({ id: r.id, slot: r.note_json.slot, status: r.note_json.status ?? null, supersedes: r.note_json.supersedes ?? null })),
  hint: Boolean(variant.hint),
  // Per round: writes that supersede an own entry that existed before the round, and those whose text barely changed.
  earlierOwnSupersededByRound: rounds.map((_, i) => writes.filter(r => roundOfWrite.get(r.id) === i && isEarlierOwn(r, i)).length),
  nearIdenticalRewrites: writes.filter(r => { const old = rows.find(o => o.id === r.note_json.supersedes); return old && similarity(String(old.note_json.text), String(r.note_json.text)) >= 0.8; }).length,
  denied: events.filter(e => e.kind === 'tool.denied' || e.kind === 'model.denied').length,
  contextPresentations: events.filter(e => e.kind === 'context').length,
  expected: spec.expected
};
await mkdir(out, { recursive: true });
await writeFile(join(out, 'transcript.json'), JSON.stringify({ case: spec.id, variant: variantName, rounds, events, finals, workbook: rows }, null, 1));
await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 1));

if (mock) {
  const role = spec.role;
  const checks = {
    rolePromptReachedModel: mockRequests.some(r => r.system.includes(`# Role: ${role}`)),
    sharedAgentsReachedModel: mockRequests.some(r => r.system.includes('題目工作簿')),
    contextBlockReachedModel: mockRequests.some(r => r.user.includes('[CTF investigation context]') && spec.workbook.every(e => r.user.includes(`"id":${e.id}`))),
    dispatchReachedModel: mockRequests.some(r => r.user.includes(rounds[0]!.dispatch.slice(0, 40))),
    managedToolsOffered: mockRequests.some(r => r.tools.includes('ctf_recon_note') && r.tools.includes('ctf_workspace_read')),
    skillDiscovered: skills.includes('python-runtime-diagnosis'),
    workspaceReadRouted: events.some(e => e.kind === 'tool.result' && e.tool === 'workspace.read' && !(e.result as any)?.error),
    skillCallRecorded: calls.some(c => c.tool === 'skill'),
    // The round-1 session must have been shown the round-0 writes before its first tool call (same session: already in
    // its history; new session: in its first context block).
    workbookWriteVisibleNextRound: rounds.length < 2 || written.size === 0 || (() => {
      const start = events.find(e => e.kind === 'round.start' && e.round === 1);
      const firstCall = events.find(e => e.kind === 'tool.call' && e.round === 1)?.t_ms ?? Infinity;
      const before = events.filter(e => e.kind === 'context' && e.session === start?.session && e.t_ms <= firstCall);
      const round0 = [...written].filter(id => roundOfWrite.get(id) === 0);
      return round0.length === 0 || before.some(e => round0.every(id => (e.activeIds as number[]).includes(id)));
    })(),
    hintReachedModel: !variant.hint || mockRequests.some(r => r.user.includes('own_open_unchanged_this_round')),
    noFailure: !failure
  };
  await writeFile(join(out, 'mock-checks.json'), JSON.stringify(checks, null, 1));
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  console.log(JSON.stringify({ mock: true, checks: Object.keys(checks).length, failed }));
  process.exit(failed.length ? 1 : 0);
}
console.log(JSON.stringify({ case: spec.id, variant: variantName, modelCalls, failure: failure ?? null, out }));
process.exit(failure ? 1 : 0);
