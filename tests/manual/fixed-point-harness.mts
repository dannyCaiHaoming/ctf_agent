// Fixed decision-point harness (fixed decision-point diagnosis design §3.2, option C): one product role in one OpenCode
// session, with the real role files, Skills and CTF plugin, but a local fake control service instead of the launcher.
// The fake serves a synthetic workbook through the same view function the host uses (workbook.ts), keeps workbook
// writes in memory, serves synthetic materials, and defaults to a fixed "not executed" result or a case-defined stub.
// Cases with execute opt into disk workspace tools and local JobManager jobs, followed by a bounded artifact checker.
// These processes run directly on this machine, without filesystem/network isolation: synthetic materials only.
// No launcher, container, challenge service or network tool is started. --mock never calls a real model.
//
// Usage:
//   npx tsx tests/manual/fixed-point-harness.mts <case.json> --variant <name> --out <dir> --mock
//   npx tsx tests/manual/fixed-point-harness.mts <case.json> --variant <name> --out <dir> \
//       --opencode-config <opencode.json> --allow-model [--max-model-calls 40] [--timeout-ms 600000]
//   --mock: scripted local provider, 0 model calls; checks the wiring (role prompt, context block, tool routing,
//           Skill discovery, same/new session) and exits non-zero if a check fails.
//   --allow-model: calls the provider of the given OpenCode config. Only inside an authorized experiment batch.
// <dir> must not exist and must be outside the repository: it receives transcript.json (tool calls, workbook writes,
// final texts; synthetic content only), summary.json (counts and observed usage), and review.json (manual verdict).
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SessionMessagesResponses } from '@opencode-ai/sdk/v2';
import { summarizeCandidateHandback, summarizeUsage, usageMatchesMessages, reviewSkeleton, type UsageRound } from './fixed-point-records.js';
import { startManagedOpenCode, loadOpenCodeConfig } from '../../packages/opencode-bridge/src/server.js';
import { collectLayer, mergeAgentOptions } from '../../apps/launcher/src/launch.js';
import { MANAGED_TOOLS } from '../../apps/launcher/src/control-service.js';
import { workbookView, activeEntries, type WorkbookRole } from '../../apps/launcher/src/workbook.js';
import { JobManager, JobRefused, type JobBinding } from '../../apps/launcher/src/job-tools.js';
import { listWorkspace, readWorkspace, writeWorkspace, searchWorkspace, diffWorkspace, viewWorkspace, WorkspaceRefused } from '../../apps/launcher/src/workspace-tools.js';
import { snapshotWork } from '../../apps/launcher/src/artifact-tools.js';

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
interface Variant { dispatch?: string; dispatchAppend?: string; workbook?: Entry[]; rounds?: Round[]; note?: string; hint?: boolean; candidateReminder?: true }
interface Execute { maxJobs: number; maxTimeoutMs: number; artifactCheck?: { argv: string[]; cwdFiles?: Record<string, string> } }
interface Case {
  id: string; role: WorkbookRole; questions: string[]; materials: Record<string, string>; workbook: Entry[];
  rounds: Round[]; stubs?: Stub[]; variants: Record<string, Variant>; expected: { next_step: string; must_not: string[] };
  execute?: Execute;
}
const spec = JSON.parse(await readFile(resolve(casePath!), 'utf8')) as Case;
const variant = spec.variants?.[variantName!] ?? fail(`unknown variant ${variantName}; known: ${Object.keys(spec.variants ?? {}).join(', ')}`);
// Both arms of a reminder comparison collect the same measurements. Legacy cases keep their output schema.
const trackCandidateHandback = Object.values(spec.variants).some(arm => arm.candidateReminder === true);
const handbackMock = spec.id === 'handback-ready' || spec.id === 'handback-decoy';
if (!['domain-solver', 'recon'].includes(spec.role)) fail('role must be domain-solver or recon');
const rounds: Round[] = (variant.rounds ?? spec.rounds).map((r, i) => ({
  ...r, dispatch: (i === 0 && variant.dispatch ? variant.dispatch : r.dispatch) + (i === 0 && variant.dispatchAppend ? `\n\n${variant.dispatchAppend}` : '')
}));
if (!rounds.length) fail('case has no rounds');
if (spec.execute && (!Number.isInteger(spec.execute.maxJobs) || spec.execute.maxJobs < 1 ||
  !Number.isInteger(spec.execute.maxTimeoutMs) || spec.execute.maxTimeoutMs < 1 || spec.execute.maxTimeoutMs > 600000))
  fail('execute requires positive integer maxJobs and maxTimeoutMs (at most 600000)');
await mkdir(out, { recursive: true });
await writeFile(join(out, 'review.json'), JSON.stringify(reviewSkeleton(spec.id, variantName!, spec.expected), null, 1));

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
const record = (kind: string, detail: Record<string, unknown>) => {
  const event = { t_ms: Date.now() - t0, kind, ...detail };
  events.push(event);
  return event;
};
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
const workdir = join(out, 'workdir');
const workspaceRoots = { materialsDir: join(workdir, 'materials'), workDir: join(workdir, 'work'), publishedDir: join(workdir, 'published') };
const jobsRoot = join(out, 'jobs');
const jobs = spec.execute ? new JobManager({ jobsRoot }) : undefined;
interface SyntheticArtifact {
  metadata: { ref: string; bytes: number; sha256: string; snapshotFixed: true; rangeComplete: true; originalComplete: null };
  snapshot: Buffer;
}
const publishedArtifacts = new Map<string, SyntheticArtifact>();
const jobBinding = (sessionId: string): JobBinding => ({ sessionId, challengeId: spec.id, workDir: workdir,
  materialsDir: workspaceRoots.materialsDir, publishedDir: workspaceRoots.publishedDir });
const startedJobs = new Map<string, { session: string; argv: unknown }>();
let jobCount = 0;
if (spec.execute) {
  for (const dir of Object.values(workspaceRoots)) await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(spec.materials))
    await writeWorkspace({ ...workspaceRoots, workDir: workspaceRoots.materialsDir }, { path: `work/${name}`, content });
}
const recordJob = async (session: string, result: { job: string; state: string; exitCode: number | null }) => {
  const bytes = async (stream: string) => (await stat(join(jobsRoot, session, result.job, `${stream}.bin`))).size;
  record('job.state', { round: roundIndex, session, job: result.job, argv: startedJobs.get(result.job)?.argv,
    state: result.state, exitCode: result.exitCode, stdoutBytes: await bytes('stdout'), stderrBytes: await bytes('stderr') });
};
const executeTool = async (session: string, tool: string, args: any) => {
  try {
    switch (tool) {
      case 'workspace.list': return await listWorkspace(workspaceRoots, args);
      case 'workspace.read': return await readWorkspace(workspaceRoots, args);
      case 'workspace.write': return await writeWorkspace(workspaceRoots, args);
      case 'workspace.search': return await searchWorkspace(workspaceRoots, args);
      case 'workspace.diff': return await diffWorkspace(workspaceRoots, args);
      case 'workspace.view': return await viewWorkspace(workspaceRoots, args);
      case 'artifact.publish': {
        if (args.source !== 'file') return undefined;
        const file = await snapshotWork(workspaceRoots, args.path).catch(() => { throw new WorkspaceRefused('artifact source'); });
        const start = args.start ?? 0, end = args.end ?? file.length;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end > file.length)
          throw new WorkspaceRefused('artifact range');
        const snapshot = file.subarray(start, end);
        const sha256 = createHash('sha256').update(snapshot).digest('hex');
        const ref = `artifact:synthetic/${sha256}`;
        const metadata = { ref, bytes: snapshot.length, sha256, snapshotFixed: true, rangeComplete: true, originalComplete: null } as const;
        publishedArtifacts.set(ref, { metadata, snapshot });
        return metadata;
      }
      case 'artifact.read': {
        const artifact = publishedArtifacts.get(args.ref);
        if (!artifact) throw new WorkspaceRefused('artifact source');
        const cursor = args.cursor ?? '0';
        if (typeof cursor !== 'string' || !/^\d{1,15}$/.test(cursor) || Number(cursor) > artifact.snapshot.length)
          throw new WorkspaceRefused('cursor');
        const offset = Number(cursor), end = Math.min(offset + 32768, artifact.snapshot.length);
        const done = end === artifact.snapshot.length;
        return { ...artifact.metadata, encoding: 'base64', data: artifact.snapshot.subarray(offset, end).toString('base64'),
          offset, nextCursor: done ? null : String(end), done };
      }
      case 'job.run': {
        const timeout = args.timeout_ms ?? Math.min(60000, spec.execute!.maxTimeoutMs);
        if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > spec.execute!.maxTimeoutMs)
          throw new JobRefused('maxTimeoutMs');
        if (jobCount >= spec.execute!.maxJobs) throw new JobRefused('maxJobs');
        jobCount++; // Reserve before awaiting, so concurrent requests cannot exceed the case limit.
        // Keep the start in event order even if another tool completes while JobManager awaits the result.
        const jobStart = trackCandidateHandback ? record('job.start', { round: roundIndex, started: false }) : undefined;
        let result;
        try { result = await jobs!.run(jobBinding(session), { ...args, timeout_ms: timeout }); }
        catch (error) { jobCount--; throw error; }
        if (jobStart) Object.assign(jobStart, { started: true, job: result.job });
        startedJobs.set(result.job, { session, argv: args.argv });
        await recordJob(session, result);
        return result;
      }
      case 'job.read': {
        const result = jobs!.read(jobBinding(session), args);
        await recordJob(session, result);
        return result;
      }
      case 'job.cancel': {
        const result = await jobs!.cancel(jobBinding(session), args.job);
        await recordJob(session, result);
        return result;
      }
    }
  } catch (error) {
    if (!(error instanceof JobRefused || error instanceof WorkspaceRefused)) throw error;
    record('tool.denied', { round: roundIndex, session, tool, reason: error.code, args });
    return { error: `denied: ${error.code}` };
  }
  return undefined;
};
const finishJobs = async () => {
  if (!jobs) return;
  await jobs.cancelAll();
  for (const [id, { session }] of startedJobs) await recordJob(session, await jobs.waitSettled(jobBinding(session), id));
};
const checkArtifact = async () => {
  const check = spec.execute?.artifactCheck;
  if (!check) return undefined;
  try {
    // Install scoring files only after the session and all its jobs end; they are not Solver materials.
    for (const [name, content] of Object.entries(check.cwdFiles ?? {}))
      await writeWorkspace({ ...workspaceRoots, workDir: workdir }, { path: `work/${name}`, content });
    const binding = jobBinding('artifact-check');
    const result = await jobs!.run(binding, { argv: check.argv, timeout_ms: spec.execute!.maxTimeoutMs });
    startedJobs.set(result.job, { session: binding.sessionId, argv: check.argv });
    const terminal = await jobs!.waitSettled(binding, result.job);
    await recordJob(binding.sessionId, terminal);
    const stdout = jobs!.outputSnapshot(binding, result.job, 'stdout').bytes.toString('utf8').slice(0, 2000);
    return { exitCode: terminal.exitCode, stdout, passed: terminal.exitCode === 0, state: terminal.state };
  } catch (error) {
    return { exitCode: null, stdout: '', passed: false, error: String(error).slice(0, 300) };
  } finally { await jobs!.cancelAll('artifact-check'); }
};
const stubFor = (tool: string, args: unknown) => (spec.stubs ?? []).find(s => (s.tool === tool || s.tool === '*') && (!s.match || new RegExp(s.match).test(JSON.stringify(args))))?.result;
// Candidate host hint (team-decision design §6.2): ids only, computed from roles, statuses, supersedes and the round
// boundary; the host never reads the entry text or judges whether an entry should change.
const roundStartSequences: number[] = [];
const unchangedOwnOpen = () => activeEntries(rows)
  .filter(e => e.role === spec.role && (e.slot === 'hypotheses' || e.slot === 'questions') && (e.status ?? 'open') === 'open' && e.sequence <= (roundStartSequences[roundIndex] ?? 0))
  .map(e => e.id);
const activeCandidates = () => activeEntries(rows).filter(e => e.slot === 'candidate' && e.status !== 'withdrawn');
const HINT_NOTE = 'Open hypotheses and questions your role wrote before this round that this round has not superseded yet. Supersede, refute or leave each open as the evidence says; the host does not judge them.';
const CANDIDATE_REMINDER = 'Candidate recorded. The Coordinator cannot see it until you hand back. If it is ready for the Engineer, hand back now; if a check is still needed to tell it apart from another explanation, do that check first, then hand back and say what was checked.';
const contextText = (role: WorkbookRole) => {
  const host = { goal: { challenge: spec.id, materials: Object.keys(spec.materials).map(n => `materials/${n}`), submission: { available: false } }, candidate_host: { packages: [], completions: [] } };
  const wb = workbookView(rows, role, host as never);
  const hint = variant.hint ? { own_open_unchanged_this_round: { ids: unchangedOwnOpen(), note: HINT_NOTE } } : {};
  const version = createHash('sha256').update(JSON.stringify([wb.view, hint])).digest('hex').slice(0, 16);
  const payload = { mode: 'full', version, current_question: { source: 'the native dispatch message of this session, kept unmodified in history', execution: null, role }, state: { publications: [] }, workbook: wb.view, ...hint };
  return { version, text: '[CTF investigation context]\n' + JSON.stringify(payload), hintIds: variant.hint ? hint.own_open_unchanged_this_round!.ids : null };
};
const toolExecute = async (sessionID: string, tool: string, args: any) => {
  if (spec.execute && (tool === 'artifact.publish' || tool === 'artifact.read'))
    return stubFor(tool, args) ?? (await executeTool(sessionID, tool, args)) ?? notExecuted;
  if (spec.execute && (tool.startsWith('workspace.') || ['job.run', 'job.read', 'job.cancel'].includes(tool)))
    return (await executeTool(sessionID, tool, args)) ?? stubFor(tool, args) ?? notExecuted;
  switch (tool) {
    case 'recon.note': {
      const result = writeEntry(spec.role, args);
      if (!trackCandidateHandback || result.slot !== 'candidate' || result.id === undefined) return result;
      const reminder_shown = variant.candidateReminder === true;
      record('candidate.write', { round: roundIndex, id: result.id, status: args.status, reminder_shown });
      return reminder_shown ? { ...result, harness_note: CANDIDATE_REMINDER } : result;
    }
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
      if (trackCandidateHandback) record('model.call', { round: roundIndex });
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
      const result = await toolExecute(sessionID, String(input?.tool), input?.args ?? {});
      record('tool.result', { round: roundIndex, tool: input?.tool, result });
      return reply(result);
    }
    default: return reply({});
  }
})().catch(() => res.writeHead(500).end()); });
await new Promise<void>(done => control.listen(0, '127.0.0.1', done));
const controlUrl = `http://127.0.0.1:${(control.address() as any).port}/`;

// ---------- scripted provider (--mock) ----------
// The execution fixture's script exercises feedback and output transport; it is not a model capability test.
const correctedParser = `import csv, json, sys
from pathlib import Path
with Path(sys.argv[1]).open(newline='', encoding='utf-8') as source:
    records = list(csv.DictReader(source))
text = json.dumps(records, ensure_ascii=False) + '\\n'
Path(sys.argv[2]).write_text(text, encoding='utf-8')
print(text, end='')
`;
const executionMockPlan = (): Array<[string, unknown] | null> => {
  const lastJob = [...events].reverse().find(e => e.kind === 'tool.result' && e.tool === 'job.run' && e.result?.job)?.result.job;
  const lastOutput = [...events].reverse().find(e => e.kind === 'tool.result' && e.tool === 'job.read' && e.result?.data)?.result.data;
  const run = (argv: string[]): [string, unknown] => ['ctf_job_run', { argv, timeout_ms: spec.execute!.maxTimeoutMs }];
  const read: [string, unknown] = ['ctf_job_read', { job: lastJob, stream: 'stdout' }];
  return [
    run(['python3', '-I', 'materials/parse_records.py', 'materials/orders.csv', 'work/initial.json']),
    read,
    ['ctf_workspace_read', { path: 'work/initial.json' }],
    ['ctf_workspace_list', { path: 'work' }],
    ['ctf_workspace_search', { path: 'work/initial.json', needle: 'book' }],
    run(['python3', '-I', '-c', `import csv, io
s = 'id,item,note\\n1,book,"first\\nsecond"\\n'
a = list(csv.DictReader(io.StringIO(s)))
b = s.splitlines()[1:]
assert len(a) == 1 and len(b) == 2
print('minimal sample: csv=1, splitlines=2; embedded newline preserved')`]),
    read,
    ['ctf_workspace_write', { path: 'work/parse_records.py', content: correctedParser }],
    run(['python3', '-I', 'work/parse_records.py', 'materials/orders.csv', 'work/generated.json']),
    read,
    ['ctf_workspace_write', { path: 'work/records.json', content: lastOutput ? Buffer.from(lastOutput, 'base64').toString('utf8') : '' }],
    ['ctf_workspace_read', { path: 'work/records.json' }],
    ['ctf_job_run', { argv: ['python3', '-I', '-c', "print('must not execute: timeout limit')"], timeout_ms: spec.execute!.maxTimeoutMs + 1 }],
    run(['python3', '-I', '-c', "print('must not execute: job count limit')"]),
    null
  ];
};
const handbackMockPlan = (): Array<[string, unknown] | null> => {
  const path = 'work/candidate.txt';
  const publications = events.filter(e => e.kind === 'tool.result' && e.tool === 'artifact.publish' && e.result?.ref);
  const firstRef = publications[0]?.result.ref;
  const publish: [string, unknown] = ['ctf_artifact_publish', { source: 'file', path }];
  const propose = (ref: string): [string, unknown] => ['ctf_recon_note', {
    slot: 'candidate', status: 'proposed', text: 'Extract the single UTF-8 line up to the newline from the published file.', evidence_refs: [ref]
  }];
  const run = (script: string): [string, unknown] => ['ctf_job_run', {
    argv: ['python3', '-I', script, 'materials/inventory.csv', path], timeout_ms: spec.execute!.maxTimeoutMs
  }];
  if (spec.id === 'handback-ready') {
    const corrected = spec.materials['calculate.py']!
      .replace('int(row["priority"]) + 3 * int(row["units"])', 'int(row["units"]) + 3 * int(row["priority"])');
    return [['ctf_workspace_write', { path: 'work/calculate.py', content: corrected }], run('work/calculate.py'),
      publish, propose(firstRef), null];
  }
  const oldOutput = events.find(e => e.kind === 'tool.result' && e.tool === 'workspace.read' &&
    e.result?.path === 'materials/latest-output.txt')?.result.text;
  const oldCandidate = events.find(e => e.kind === 'candidate.write' && e.status === 'proposed')?.id;
  return [
    ['ctf_workspace_read', { path: 'materials/latest-output.txt' }],
    ['ctf_workspace_write', { path, content: oldOutput ?? '' }],
    publish, propose(firstRef),
    run('materials/calculate.py'),
    ['ctf_artifact_read', { ref: firstRef }],
    publish,
    ['ctf_recon_note', { slot: 'candidate', status: 'withdrawn', supersedes: oldCandidate,
      text: 'The current calculation produced a different code; this snapshot is obsolete.', evidence_refs: [publications[1]?.result.ref] }],
    propose(publications[1]?.result.ref),
    null
  ];
};
const mockRequests: Array<{ system: string; user: string; tools: string[] }> = [];
const mockCandidateResults = new Map<number, Record<string, unknown>>();
const mockServer = mock ? createServer((req, res) => { void (async () => {
  if (!req.url?.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(Buffer.from(c));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const text = (m: any) => typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((x: any) => x?.text ?? '').join('\n') : '';
  const messages: any[] = body.messages ?? [];
  const lastUser = messages.map(m => m.role).lastIndexOf('user');
  mockRequests.push({ system: messages.filter(m => m.role === 'system').map(text).join('\n'), user: messages.filter(m => m.role === 'user').map(text).join('\n'), tools: (body.tools ?? []).map((t: any) => t?.function?.name) });
  const step = messages.slice(lastUser + 1).filter(m => m.role === 'tool').length;
  if (handbackMock) {
    for (const message of messages.filter(m => m.role === 'tool')) {
      // The managed tool result is the first line. The plugin can append a context block below it.
      try {
        const result = JSON.parse(text(message).split('\n', 1)[0]!);
        if (result?.slot === 'candidate' && typeof result.id === 'number') mockCandidateResults.set(result.id, result);
      } catch { /* Native skill output need not be JSON. */ }
    }
  }
  // With the hint shown, the scripted note retires the first listed entry, so the hint and supersede metrics are exercised.
  const hinted = [...mockRequests.at(-1)!.user.matchAll(/"own_open_unchanged_this_round":\{"ids":\[([0-9,]*)\]/g)].at(-1)?.[1]?.split(',').filter(Boolean).map(Number) ?? [];
  const note = hinted.length ? { slot: 'refuted', text: 'mock: retired by the scripted provider', supersedes: hinted[0] } : { slot: 'hypotheses', text: 'mock hypothesis written by the scripted provider', status: 'open' };
  const plan: Array<[string, unknown] | null> = [
    ['ctf_workspace_read', { path: `materials/${Object.keys(spec.materials)[0]}` }], ['skill', { name: 'python-runtime-diagnosis' }]
  ];
  if (handbackMock) plan.push(...handbackMockPlan());
  else plan.push(['ctf_recon_note', note], ...(spec.execute ? executionMockPlan() : [null]));
  const call = plan[Math.min(step, plan.length - 1)];
  const base = { id: 'chatcmpl-' + randomUUID(), object: 'chat.completion.chunk', created: 1, model: 'scripted' };
  let handback = 'MOCK_HANDBACK';
  if (handbackMock && !call) {
    const artifact = events.findLast(e => e.kind === 'tool.result' && e.tool === 'artifact.publish' && e.result?.ref)?.result;
    if (artifact) handback += `: Current inventory recalculated. Read UTF-8 bytes [0, ${artifact.bytes - 1}) from ${artifact.ref} before the newline.`;
  }
  const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + randomUUID().slice(0, 8), type: 'function', function: { name: call[0], arguments: JSON.stringify(call[1]) } }] } : { role: 'assistant', content: handback };
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
const usageRounds: UsageRound[] = rounds.map((_, round) => ({ round, messages: [] }));
const usageReadErrors: Array<{ round: number; error: string }> = [];
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
    let messages: SessionMessagesResponses[200] = [];
    let usageReadError: unknown;
    try {
      const { data } = await client.session.prompt({ sessionID: session, agent: spec.role, parts: [{ type: 'text', text: round.dispatch }] }, { throwOnError: true });
      if (trackCandidateHandback && data?.info && !data.info.error) {
        record('round.handback', { round: i, active_candidates: activeCandidates().length });
      }
    } finally {
      // A rejected/aborted prompt may still have incurred usage. Read before closing OpenCode, preserving its error.
      try {
        messages = (await client.session.messages({ sessionID: session }, { throwOnError: true })).data ?? [];
        usageRounds[i]!.messages = messages;
      } catch (error) {
        usageReadError = error;
        usageReadErrors.push({ round: i, error: String(error instanceof Error ? error.message : error).slice(0, 300) });
      }
    }
    if (usageReadError) throw usageReadError;
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
  await finishJobs();
}

// ---------- outputs ----------
const artifactCheck = await checkArtifact();
const calls = events.filter(e => e.kind === 'tool.call');
const writes = rows.filter(r => written.has(r.id));
const roundOfWrite = new Map<number, number>(events.filter(e => e.kind === 'tool.result' && e.tool === 'recon.note' && typeof (e.result as any)?.id === 'number').map(e => [(e.result as any).id as number, e.round as number]));
const isEarlierOwn = (r: any, i: number) => { const old = rows.find(o => o.id === r.note_json.supersedes); return Boolean(old && old.role === spec.role && old.sequence <= (roundStartSequences[i] ?? 0)); };
const bigrams = (t: string) => { const x = t.replace(/\s+/g, ''); return new Set([...Array(Math.max(0, x.length - 1)).keys()].map(k => x.slice(k, k + 2))); };
const similarity = (a: string, b: string) => { const A = bigrams(a), B = bigrams(b); const inter = [...A].filter(v => B.has(v)).length; const union = new Set([...A, ...B]).size; return union ? inter / union : 0; };
const summary = {
  case: spec.id, variant: variantName, questions: spec.questions, mode: mock ? 'mock' : 'model', model, failure: failure ?? null,
  rounds: rounds.length, modelCalls, maxModelCalls,
  ...summarizeUsage(usageRounds),
  ...(usageReadErrors.length ? { usage_read_errors: usageReadErrors } : {}),
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
  expected: spec.expected,
  ...(trackCandidateHandback ? { candidate_handback: summarizeCandidateHandback(events, rounds.length) } : {}),
  ...(spec.execute?.artifactCheck ? { artifact_check: artifactCheck } : {})
};
await mkdir(out, { recursive: true });
await writeFile(join(out, 'transcript.json'), JSON.stringify({ case: spec.id, variant: variantName, rounds, events, finals, workbook: rows }, null, 1));
await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 1));

const candidateMockChecks = (metrics: ReturnType<typeof summarizeCandidateHandback>[number] | undefined) => {
  const decoy = spec.id === 'handback-decoy';
  const candidateWrites = writes.filter(r => r.note_json.slot === 'candidate');
  const firstWriteIndex = events.findIndex(e => e.kind === 'candidate.write');
  const shown = variant.candidateReminder === true;
  const expectedTools: Record<string, number> = decoy
    ? { ctf_job_run: 1, ctf_artifact_read: 1, ctf_artifact_publish: 1, ctf_recon_note: 2 }
    : {};
  const usesPublishedArtifact = (row: (typeof writes)[number]) => {
    const writeIndex = events.findIndex(e => e.kind === 'candidate.write' && e.id === row.id);
    const refs = row.note_json.evidence_refs;
    return writeIndex >= 0 && Array.isArray(refs) && refs.length === 1 &&
      events.slice(0, writeIndex).some(e => e.kind === 'tool.result' && e.tool === 'artifact.publish' &&
        e.result?.ref === refs[0] && e.result.ref === `artifact:synthetic/${e.result.sha256}` && e.result.bytes > 0);
  };
  const old = candidateWrites[0], withdrawn = candidateWrites[1], current = candidateWrites[2];
  const readBack = events.find(e => e.kind === 'tool.result' && e.tool === 'artifact.read')?.result;
  const active = activeCandidates();
  return {
    candidateHandbackRecorded: firstWriteIndex >= 0 && metrics?.first_write_event_seq === firstWriteIndex + 1 &&
      metrics.first_write_t_ms === events[firstWriteIndex]?.t_ms && metrics.elapsed_ms != null && metrics.elapsed_ms >= 0 &&
      metrics.model_calls_after === (decoy ? 6 : 1) && metrics.jobs_after === (decoy ? 1 : 0) &&
      metrics.tool_calls_after !== null && Object.keys(metrics.tool_calls_after).length === Object.keys(expectedTools).length &&
      Object.entries(expectedTools).every(([tool, count]) => metrics.tool_calls_after?.[tool] === count) &&
      metrics.active_candidates_at_end === 1 && metrics.reminder_shown === shown &&
      finals.some(f => f.text.includes('MOCK_HANDBACK')),
    candidateReminderDelivered: candidateWrites.length === (decoy ? 3 : 1) && candidateWrites.every(row => {
      const result = mockCandidateResults.get(row.id);
      return result !== undefined && (shown ? result.harness_note === CANDIDATE_REMINDER : !Object.hasOwn(result, 'harness_note'));
    }),
    candidateUsesPublishedArtifact: candidateWrites.length === (decoy ? 3 : 1) && candidateWrites.every(usesPublishedArtifact),
    ...(decoy ? {
      withdrawnCandidateSuperseded: metrics?.statuses?.join(',') === 'proposed,withdrawn,proposed' &&
        withdrawn?.note_json.supersedes === old?.id && active.length === 1 && active[0]?.id === current?.id,
      publishedSnapshotReadable: readBack?.ref === old?.note_json.evidence_refs?.[0] &&
        readBack?.ref !== current?.note_json.evidence_refs?.[0] && readBack?.encoding === 'base64' && readBack?.nextCursor === null &&
        Buffer.from(readBack?.data ?? '', 'base64').toString('utf8') === spec.materials['latest-output.txt']
    } : {})
  };
};

if (mock) {
  const role = spec.role;
  const savedSummary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
  const savedArtifactCheck = savedSummary.artifact_check;
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
    ...(spec.execute ? {
      jobExecuted: events.some(e => e.kind === 'job.state' && e.session !== 'artifact-check' && e.state === 'exited' && typeof e.exitCode === 'number'),
      ...(handbackMock ? candidateMockChecks(savedSummary.candidate_handback?.[0]) : {
        jobOutputReadable: events.some(e => e.kind === 'tool.result' && e.tool === 'job.read' && e.result?.encoding === 'base64' && Buffer.from(e.result.data, 'base64').length > 0),
        jobFileReadable: events.some(e => e.kind === 'tool.result' && e.tool === 'workspace.read' && e.result?.path === 'work/initial.json' && typeof e.result.text === 'string'),
        maxJobsDenied: events.some(e => e.kind === 'tool.denied' && e.reason === 'maxJobs'),
        maxTimeoutDenied: events.some(e => e.kind === 'tool.denied' && e.reason === 'maxTimeoutMs')
      }),
      artifactCheckRecorded: !spec.execute.artifactCheck || (savedArtifactCheck?.exitCode === 0 && savedArtifactCheck.passed === true && typeof savedArtifactCheck.stdout === 'string')
    } : {}),
    usageRecordedMatchesOpenCode: usageReadErrors.length === 0 && usageMatchesMessages(savedSummary.usage, usageRounds),
    noFailure: !failure
  };
  await writeFile(join(out, 'mock-checks.json'), JSON.stringify(checks, null, 1));
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  console.log(JSON.stringify({ mock: true, checks: Object.keys(checks).length, failed }));
  process.exit(failed.length ? 1 : 0);
}
console.log(JSON.stringify({ case: spec.id, variant: variantName, modelCalls, failure: failure ?? null, out }));
process.exit(failure ? 1 : 0);
