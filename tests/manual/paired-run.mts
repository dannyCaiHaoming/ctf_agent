// One run of one arm of the workbook paired control (team-decision design §7.2). Calls the real model: run it only
// inside an authorized experiment batch.
//
// Usage: npx tsx tests/manual/paired-run.mts <spec.json> [--check]
//   --check: run every precondition (product, profile, model, thinking, budget, judge, frozen store) and stop before
//   anything is written to the batch or the runs root; 0 model calls.
//
// The two arms differ only in what this script sets from `arm`:
//   on  -> repository product/ (must be committed and clean), context {index: summary, workbook: true}
//   off -> spec.product (made by paired-control-product.py; files checked against its manifest), context {index: summary, workbook: false}
// Everything else (OpenCode config, model, Solver thinking, budget, challenge, judge) comes from the same base profile
// and is asserted against the spec, so a mismatch stops before launch instead of producing an unpaired run.
// Each run gets its own runs root; the experience store starts empty or as a consistent copy of one frozen store, so
// no lesson or episode crosses arms or runs.
//
// spec.json:
// { "batch": "<abs batch dir>", "arm": "on"|"off", "runId": "...", "challenge": "<judge key>",
//   "baseProfile": "<abs profile.json without context>", "product": "<abs off-arm product dir, off only>",
//   "runsRoot": "<abs, must not exist, outside the repository>", "frozenExperience": "<abs sqlite>" | null,
//   "judge": {"module": "<abs .mts>", "export": "<factory(challenge)>"},
//   "deadlineMs": n, "maxObservableTokens": n, "model": "<provider/model>", "solverThinking": "enabled"|"disabled" }
// Writes <batch>/configs/<runId>.profile.json, <batch>/logs/<runId>.lock.json and <batch>/logs/<runId>.meta.json.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { launch } from '../../apps/launcher/src/launch.ts';
import { loadLocalEnv } from '../../apps/cli/src/composition/localEnv.ts';
import { loadReleaseProfile } from '../../apps/cli/src/composition/releaseProfile.ts';

const REPO = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const fail = (message: string): never => { throw new Error(message); };
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);
const git = (...args: string[]) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();

async function treeHashes(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(root, path)] = sha256(await readFile(path));
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const specPath = process.argv[2] ?? fail('usage: npx tsx tests/manual/paired-run.mts <spec.json> [--check]');
const checkOnly = process.argv[3] === '--check';
if (process.argv.length > 4 || (process.argv[3] !== undefined && !checkOnly)) fail('unexpected arguments');
const spec = JSON.parse(await readFile(specPath, 'utf8'));
const allowed = ['batch', 'arm', 'runId', 'challenge', 'baseProfile', 'product', 'runsRoot', 'frozenExperience', 'judge', 'deadlineMs', 'maxObservableTokens', 'model', 'solverThinking'];
for (const key of Object.keys(spec)) if (!allowed.includes(key)) fail(`unknown spec field ${key}`);
if (spec.arm !== 'on' && spec.arm !== 'off') fail('arm must be on or off');
if (!/^[\w.-]+$/.test(spec.runId ?? '')) fail('runId must be a plain name');
for (const key of ['batch', 'baseProfile', 'runsRoot']) if (typeof spec[key] !== 'string' || !spec[key].startsWith('/')) fail(`${key} must be an absolute path`);
if (!Number.isSafeInteger(spec.deadlineMs) || !Number.isSafeInteger(spec.maxObservableTokens)) fail('deadlineMs and maxObservableTokens are required integers');
if (spec.solverThinking !== 'enabled' && spec.solverThinking !== 'disabled') fail('solverThinking must be enabled or disabled');

// Product: the on arm uses the committed repository product; the off arm a generated directory that matches its manifest.
let product: { source: string; dir?: string; head: string; manifest?: unknown; files: Record<string, string> };
if (spec.arm === 'on') {
  if (spec.product !== undefined) fail('the on arm uses the repository product; omit product');
  if (git('status', '--porcelain', '--', 'product', 'apps')) fail('refusing: product/ or apps/ has uncommitted changes');
  product = { source: 'repository', head: git('rev-parse', '--short=8', 'HEAD'), files: await treeHashes(join(REPO, 'product')) };
} else {
  if (typeof spec.product !== 'string' || !spec.product.startsWith('/')) fail('the off arm needs an absolute product dir');
  const manifest = JSON.parse(await readFile(join(dirname(spec.product), 'manifest.json'), 'utf8'));
  const files = await treeHashes(spec.product);
  const names = new Set([...Object.keys(files), ...Object.keys(manifest.files ?? {})]);
  if ([...names].some(name => files[name] !== manifest.files?.[name])) fail('off-arm product does not match its manifest');
  if (git('status', '--porcelain', '--', 'apps')) fail('refusing: apps/ has uncommitted changes');
  product = { source: 'generated', dir: spec.product, head: git('rev-parse', '--short=8', 'HEAD'), manifest: { head: manifest.head, base: manifest.base, included: manifest.included, excluded: manifest.excluded }, files };
}

// Arm profile: the base profile with only profileId and context set here.
const base = JSON.parse(await readFile(spec.baseProfile, 'utf8'));
if (base.context !== undefined) fail('base profile must not set context; the arm sets it');
const baseDir = dirname(spec.baseProfile);
const armProfile = {
  ...base, profileId: `${base.profileId}-${spec.arm}`,
  opencode: { ...base.opencode, configPath: resolve(baseDir, base.opencode.configPath) },
  ...(base.challenges ? { challenges: resolve(baseDir, base.challenges) } : {}),
  context: { index: 'summary', workbook: spec.arm === 'on' },
};
const profilePath = checkOnly ? join(await mkdtemp(join(tmpdir(), 'paired-check-')), 'profile.json') : join(spec.batch, 'configs', `${spec.runId}.profile.json`);
const lockPath = join(spec.batch, 'logs', `${spec.runId}.lock.json`), metaPath = join(spec.batch, 'logs', `${spec.runId}.meta.json`);
for (const path of [join(spec.batch, 'configs', `${spec.runId}.profile.json`), lockPath, metaPath, spec.runsRoot]) if (existsSync(path)) fail(`refusing existing ${path}`);
if (inside(resolve(spec.runsRoot), REPO)) fail('runsRoot must be outside the repository');
await mkdir(dirname(profilePath), { recursive: true }); if (!checkOnly) await mkdir(dirname(lockPath), { recursive: true });
await writeFile(profilePath, JSON.stringify(armProfile, null, 2) + '\n', { flag: 'wx' });

const profile = await loadReleaseProfile(profilePath);
if (profile.budget.wallClockMs !== spec.deadlineMs || profile.budget.maxObservableTokens !== spec.maxObservableTokens) fail('profile budget does not match the spec');
if (profile.learning?.enabled) fail('learning must be disabled in the paired control');
const opencode = JSON.parse(await readFile(profile.opencode.configPath, 'utf8'));
if (opencode.model !== spec.model) fail(`model ${opencode.model} does not match the spec`);
if ((opencode.agent?.['domain-solver']?.options?.thinking?.type ?? 'disabled') !== spec.solverThinking) fail('Solver thinking does not match the spec');

// Experience store: empty, or a consistent snapshot (VACUUM INTO) of one frozen store; never a shared live file.
const judgeModule = await import(pathToFileURL(spec.judge.module).href);
// The factory may be async (subprocessExactJudge is); an unawaited Promise has no limits, so the host refuses every
// completion as "submission limits unknown". Await it and check the shape the completion gate reads.
const judge = await (judgeModule[spec.judge.export] ?? fail(`judge export ${spec.judge.export} missing`))(spec.challenge);
if (typeof judge?.id !== 'string' || typeof judge.submit !== 'function') fail('judge factory did not return a CompletionJudge');
const attempts = judge.limits?.attempts?.kind;
if (attempts !== 'unlimited' && attempts !== 'limited') fail(`judge submission limits ${attempts ?? 'missing'}; the host would refuse every completion`);
if (checkOnly) {
  if (spec.frozenExperience) new DatabaseSync(spec.frozenExperience, { readOnly: true }).close();
  console.log(JSON.stringify({ check: 'passed', arm: spec.arm, runId: spec.runId, context: armProfile.context, product: { source: product.source, head: product.head, files: Object.keys(product.files).length }, model: spec.model, solverThinking: spec.solverThinking, judge: { id: judge.id, attempts } }));
  process.exit(0);
}
await mkdir(spec.runsRoot, { recursive: true });
let experience: { source: 'empty' } | { source: string; sha256: string; lessons: number; episodes: number } = { source: 'empty' };
if (spec.frozenExperience) {
  const target = join(spec.runsRoot, 'experience.sqlite');
  const frozen = new DatabaseSync(spec.frozenExperience, { readOnly: true });
  try { frozen.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`); } finally { frozen.close(); }
  const copy = new DatabaseSync(target, { readOnly: true });
  const count = (table: string) => { try { return Number((copy.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n); } catch { return 0; } };
  experience = { source: spec.frozenExperience, sha256: sha256(await readFile(target)), lessons: count('lessons'), episodes: count('episodes') };
  copy.close();
}

await loadLocalEnv(join(REPO, '.env'));
const common = { runId: spec.runId, arm: spec.arm, challenge: spec.challenge, profile: profilePath, runsRoot: spec.runsRoot, deadlineMs: spec.deadlineMs,
  maxObservableTokens: spec.maxObservableTokens, model: spec.model, solverThinking: spec.solverThinking, context: armProfile.context,
  product: { source: product.source, dir: product.dir ?? null, head: product.head, manifest: product.manifest ?? null, filesSha256: sha256(JSON.stringify(product.files)) }, experience };
await writeFile(lockPath, JSON.stringify({ ...common, at: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx' });

const startedAt = new Date().toISOString();
let result: Awaited<ReturnType<typeof launch>> | undefined, error: string | undefined;
try {
  result = await launch({ profile: profilePath, runsRoot: spec.runsRoot, runId: spec.runId, deadlineMs: spec.deadlineMs,
    ...(product.dir ? { product: product.dir } : {}), completionJudges: { [spec.challenge]: judge } });
} catch (cause) {
  error = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
  console.error(error);
} finally {
  await writeFile(metaPath, JSON.stringify({ ...common, startedAt, finishedAt: new Date().toISOString(), exitCode: result?.code ?? null, result: result ?? null, ...(error ? { error } : {}) }, null, 2) + '\n', { flag: 'wx' });
}
if (!result) process.exitCode = 1;
else if (result.code !== 0) process.exitCode = result.code;
