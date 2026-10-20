/** Trajectory 2 acceptance only. OpenCode owns every model/tool turn. */
import { readFile, writeFile, mkdir, readdir, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { loadLocalEnv } from '../../apps/cli/src/composition/localEnv.js';
import { loadOpenCodeConfig, startManagedOpenCode } from '../../packages/opencode-bridge/src/server.js';
import { assertAttemptAllowed } from './m1-td-runner.js';

const exec = promisify(execFile);
const batch = 'm1b-opencode-t2-bailian-20261020-b1';
const record = resolve('docs/gates', batch);
const runs = resolve('runs', batch);
const profilePath = 'config/release-profile.m1b-t2-bailian-20261020.json';
const configPath = 'config/opencode.m1b-t2-bailian-20261020.json';
const grader = 'docs/gates/m1b-t2-acceptance.py';
const materials = ['target.mjs', 'decode.mjs', 'payload.txt'].map(name => `fixtures/trajectories/t2-falsified/${name}`);
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const readJSON = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const save = (path: string, data: unknown) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });

export function assertT2AttemptAllowed(batchReserved: number, trajectoryReserved: number) {
  if (!Number.isInteger(batchReserved) || batchReserved < 0 || trajectoryReserved < batchReserved) throw new Error('STOP_RULE: inconsistent attempt ledger');
  assertAttemptAllowed(trajectoryReserved, 12);
  if (batchReserved >= 3) throw new Error('STOP_RULE: authorized three-run allowance exhausted');
}

async function credentials() {
  await loadLocalEnv();
  if (process.env.DASHSCOPE_API_KEY) return 'DASHSCOPE_API_KEY environment';
  let auth: any;
  try { auth = await readJSON(join(homedir(), '.local/share/opencode/auth.json')); }
  catch { throw new Error('blocked_external_input: Bailian credential unavailable'); }
  if (auth['aliyun-bailian']?.type !== 'api' || !auth['aliyun-bailian'].key) throw new Error('blocked_external_input: Bailian API credential missing');
  process.env.DASHSCOPE_API_KEY = auth['aliyun-bailian'].key;
  return 'OpenCode aliyun-bailian auth -> in-memory DASHSCOPE_API_KEY';
}

async function ledger() {
  const batches = (await readdir(resolve('docs/gates'), { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && entry.name.startsWith('m1b-opencode-t2-'));
  const entries: Array<{ batch: string; attempts: number }> = [];
  for (const entry of batches) entries.push({ batch: entry.name,
    attempts: (await readdir(resolve('docs/gates', entry.name))).filter(name => /^attempt-\d\d\.json$/.test(name)).length });
  return { entries, total: entries.reduce((sum, entry) => sum + entry.attempts, 0),
    current: entries.find(entry => entry.batch === batch)?.attempts ?? 0 };
}

async function preflight() {
  await mkdir(record, { recursive: true });
  // Reserve the single paid availability probe before any inference. It has no challenge materials.
  await save(join(record, 'preflight-intent.json'), { batch, authorized_on: '2026-10-20',
    authorization: 'User requested network/quota checks and three formal trajectory-2 runs with Bailian DeepSeek v4 Flash.',
    inference_probe_limit: 1, output_limit: 512, wall_clock_ms: 90000, no_solver_materials: true, formal_attempt: false });
  const result: any = { batch, at: new Date().toISOString(), inference_available: false,
    exact_remaining_quota: { availability: 'unavailable', value: null,
      reason: 'Only the model API credential is configured; no account balance/remaining-credit query is available through this credential workflow.' },
    probe: { output_limit: 512, wall_clock_ms: 90000, retries_by_harness: 0 } };
  let engine: Awaited<ReturnType<typeof startManagedOpenCode>> | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    result.credential_source = await credentials();
    const loaded = await loadOpenCodeConfig(resolve(configPath));
    const modelID = loaded.config.model!.split('/')[1]!;
    const provider = loaded.config.provider!.bailian!;
    result.endpoint = provider.options!.baseURL; result.model = loaded.config.model;
    const response = await fetch(`${result.endpoint}/models`, { headers: { authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
    const models = response.ok ? await response.json() as { data?: Array<{ id: string }> } : null;
    result.network = { authenticated_models_http_status: response.status, listed_model: models?.data?.some(item => item.id === modelID) ?? null };
    if (!response.ok || !result.network.listed_model) throw new Error('blocked_external_input');
    const config = { model: loaded.config.model, small_model: loaded.config.model, provider: loaded.config.provider,
      default_agent: 'preflight', tools: { '*': false }, permission: { '*': 'deny' as const }, share: 'disabled' as const,
      snapshot: false, autoupdate: false, lsp: false as const, formatter: false as const, mcp: {}, instructions: [],
      compaction: { auto: false, prune: false }, agent: {
        preflight: { mode: 'primary' as const, steps: 1, tools: { '*': false },
          prompt: 'Connectivity check only. Reply M1B_T2_PREFLIGHT_OK. Do not use tools.', options: { maxOutputTokens: 512 } },
        build: { disable: true }, plan: { disable: true }, general: { disable: true }, explore: { disable: true },
        title: { disable: true }, summary: { disable: true }, compaction: { disable: true } } };
    config.provider!.bailian!.models![modelID]!.limit!.output = 512;
    engine = await startManagedOpenCode({ directory: join(runs, 'preflight-engine'), config, environment: loaded.environment, signal: controller.signal });
    const session = await engine.client.session.create({ title: 'Trajectory 2 availability only' }, { signal: controller.signal, throwOnError: true });
    const answer = await engine.client.session.prompt({ sessionID: session.data!.id, agent: 'preflight',
      parts: [{ type: 'text', text: 'Reply M1B_T2_PREFLIGHT_OK.' }] }, { signal: controller.signal, throwOnError: true });
    const info = answer.data!.info;
    const text = answer.data!.parts.filter(part => part.type === 'text').map(part => part.text).join('');
    result.probe = { ...result.probe, session_id: session.data!.id, engine_version: engine.version,
      returned_model: info.modelID, returned_provider: info.providerID, error_name: info.error?.name ?? null,
      marker_received: text.includes('M1B_T2_PREFLIGHT_OK'), reported_tokens: info.tokens,
      engine_cost: info.cost, monetary_charge: 'unavailable' };
    result.inference_available = !info.error && info.modelID === modelID && info.tokens.input > 0 && info.tokens.output + info.tokens.reasoning > 0;
  } catch (error) { result.error_class = error instanceof Error ? error.name : 'unknown'; }
  finally { clearTimeout(timer); await engine?.close(); await save(join(record, 'preflight.json'), result); }
  console.log(JSON.stringify(result, null, 2));
  if (!result.inference_available) throw new Error('preflight unavailable; no formal attempt launched');
}

async function freeze() {
  const preflight = await readJSON(join(record, 'preflight.json'));
  if (preflight.inference_available !== true || Date.now() - Date.parse(preflight.at) > 3600000) throw new Error('fresh successful availability preflight required');
  const counts = await ledger();
  if (counts.current !== 0 || counts.total > 9) throw new Error('STOP_RULE: insufficient capacity for three independent runs');
  const profile = await readJSON(profilePath), config = await readJSON(configPath);
  const files = (await exec('git', ['ls-files', '-co', '--exclude-standard'])).stdout.trim().split('\n');
  const selected = [...new Set(files.filter(path => /^(apps|packages|fixtures|tests|config)\//.test(path) ||
    /^(package(?:-lock)?\.json|tsconfig.*\.json|vitest.config.ts)$/.test(path)).concat([
      'docs/gates/m1b-t2-runner.ts', grader, 'docs/gates/m1-t1-acceptance.py', 'docs/gates/m1-td-runner.ts']))].sort();
  const hashes: Record<string, string> = {};
  for (const path of selected) hashes[path] = digest(await readFile(path));
  const binary = (await exec('which', ['opencode'])).stdout.trim();
  await save(join(record, 'manifest.json'), { batch, at: new Date().toISOString(), trajectory: 2,
    authorization: '2026-10-20 user authorized Bailian preflight plus exactly three independent formal trajectory-2 runs; no commit/push.',
    authorized_runs: 3, stop_limit: 12, cumulative_trajectory_ledger: counts, preflight_counted_as_solver_attempt: false,
    preflight_sha256: digest(await readFile(join(record, 'preflight.json'))),
    predecessor: { m1_t1_batches_unchanged: true, results_merged: false, trajectory2_previous_attempts: counts.total },
    preset: false, intervention: 'none; no hints, patches or repeated runs after failures', reference: null,
    profile_path: profilePath, config_path: configPath, profile, config, materials,
    tools: ['workspace.list', 'workspace.read', 'workspace.search', 'workspace.patch', 'job.run', 'candidate.register', 'hypothesis.propose', 'hypothesis.conclude'],
    grading: { script: grader, threshold: 'three independent runs; at least two pass', semantic_review_required: true },
    runtime: { node: process.version, node_path: process.execPath, node_sha256: digest(await readFile(process.execPath)),
      opencode_path: binary, opencode_version: (await exec(binary, ['--version'])).stdout.trim(), opencode_sha256: digest(await readFile(binary)) },
    base_head: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(), worktree: 'execution identity is frozen file hashes; only new acceptance harness/config plus unrelated pre-existing changes', hashes });
  console.log(JSON.stringify({ batch, frozen_files: selected.length, authorized_runs: 3, stop_limit: 12 }));
}

async function check() {
  const manifest = await readJSON(join(record, 'manifest.json'));
  if (manifest.batch !== batch || manifest.authorized_runs !== 3 || manifest.stop_limit !== 12 || manifest.trajectory !== 2) throw new Error('frozen authority mismatch');
  for (const [path, hash] of Object.entries(manifest.hashes)) if (digest(await readFile(path)) !== hash) throw new Error(`frozen source changed: ${path}`);
  if (digest(await readFile(join(record, 'preflight.json'))) !== manifest.preflight_sha256 || process.version !== manifest.runtime.node ||
    process.execPath !== manifest.runtime.node_path || digest(await readFile(process.execPath)) !== manifest.runtime.node_sha256 ||
    digest(await readFile(manifest.runtime.opencode_path)) !== manifest.runtime.opencode_sha256) throw new Error('frozen runtime or preflight changed');
  return manifest;
}

async function verifyBinding(out: string, manifest: any, result: any) {
  const { DatabaseSync } = await import('node:sqlite');
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    const file = (await readdir(join(out, 'state'))).find(file => file.endsWith('.sqlite'))!;
    db = new DatabaseSync(join(out, 'state', file), { readOnly: true });
    const events = db.prepare('SELECT payload FROM events ORDER BY seq').all().map(row => JSON.parse(String(row.payload)));
    const start = events.find(event => event.activity === 'started'), final = events.find(event => event.activity === 'checkpoint');
    const snapshot = start?.data.challenge.snapshot;
    return snapshot?.opencode_config_hash === digest(JSON.stringify(manifest.config)) && snapshot?.profile_id === manifest.profile.profileId &&
      snapshot?.preset === false && snapshot?.reference === null && start?.data.challenge.trajectory === 't2' &&
      JSON.stringify(snapshot?.solver_profile) === JSON.stringify(manifest.profile.solverProfile) &&
      JSON.stringify(start?.data.budget) === JSON.stringify(manifest.profile.budget) && start?.data.engine_version === manifest.runtime.opencode_version &&
      JSON.stringify(start?.data.challenge.material_refs.map((ref: any) => ref.hash).sort()) === JSON.stringify(materials.map(path => manifest.hashes[path]).sort()) &&
      result?.engine?.model === manifest.config.model && result?.run_id === start?.runId && result?.session_id === start?.sessionId &&
      Object.entries(manifest.profile.budget).every(([key, limit]) => Number.isFinite(final?.data.budget?.[key]) && final.data.budget[key] <= Number(limit));
  } catch { return false; } finally { db?.close(); }
}

async function publicFiles(out: string, name: string): Promise<string[]> {
  const path = join(out, name); const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? publicFiles(out, join(name, entry.name)) : [join(name, entry.name)]))).flat();
}

async function runNext() {
  const manifest = await check();
  await mkdir(runs, { recursive: true });
  const lock = join(runs, '.launch-lock'); await mkdir(lock);
  try {
    const counts = await ledger(); assertT2AttemptAllowed(counts.current, counts.total);
    const number = counts.current + 1, label = String(number).padStart(2, '0'), out = join(runs, `run-${label}`);
    await mkdir(out);
    await save(join(record, `attempt-${label}.json`), { batch, number, trajectory_attempt: counts.total + 1,
      reserved_at: new Date().toISOString(), out, manifest_sha256: digest(await readFile(join(record, 'manifest.json'))), counted_even_if_failed: true });
    const args = ['--import', 'tsx', 'apps/cli/src/main.ts', 'solve', '--target', 'local-materials', '--trajectory', 't2',
      '--profile', profilePath, ...materials.flatMap(path => ['--material', path]), '--out', out];
    await save(join(out, 'command.json'), { executable: process.execPath, args });
    await credentials();
    const started = Date.now();
    const child = spawn(process.execPath, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => stdout += String(bytes)); child.stderr.on('data', bytes => stderr += String(bytes));
    const timeout = setTimeout(() => child.kill('SIGTERM'), manifest.profile.budget.wallClockMs + 30000);
    let code: number | null = null, launchError: string | null = null;
    try { code = await new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('close', done); }); }
    catch (error) { launchError = error instanceof Error ? error.name : 'unknown'; }
    finally { clearTimeout(timeout); }
    const secret = process.env.DASHSCOPE_API_KEY!;
    stdout = stdout.replaceAll(secret, '[redacted]'); stderr = stderr.replaceAll(secret, '[redacted]');
    await writeFile(join(out, 'stdout.json'), stdout, { flag: 'wx' }); await writeFile(join(out, 'stderr.txt'), stderr, { flag: 'wx' });
    let canonical: any;
    try { canonical = JSON.parse((await exec('python3', [grader, out])).stdout); }
    catch (error) { try { canonical = JSON.parse((error as { stdout: string }).stdout); } catch { canonical = { passed: false, reason: 'grader unavailable' }; } }
    let result: any = {}; try { result = JSON.parse(stdout); } catch { /* raw failure retained */ }
    const frozenBinding = await verifyBinding(out, manifest, result);
    const names = (await readdir(out)).filter(name => ['state', 'artifacts-store', 'workspaces', 'command.json', 'stdout.json', 'stderr.txt'].includes(name));
    const files = (await Promise.all(names.map(name => ['state', 'artifacts-store', 'workspaces'].includes(name) ? publicFiles(out, name) : [name]))).flat();
    for (const file of files) if ((await readFile(join(out, file))).includes(Buffer.from(secret))) throw new Error('public evidence secret scan failed; stop for review');
    const archive = join(record, `run-${label}-evidence.tar.gz`);
    await exec('tar', ['-czf', archive, '-C', out, ...names]);
    const report = { batch, number, trajectory_attempt: counts.total + 1, exit_code: code, launch_error: launchError,
      elapsed_ms: Date.now() - started, canonical, frozen_binding: frozenBinding,
      passed: code === 0 && canonical.passed === true && frozenBinding, semantic_review: 'pending', result,
      output: out, evidence_archive: archive, evidence_archive_sha256: digest(await readFile(archive)), public_files_scanned: files.length,
      control_secret_matches: 0, private_engine_excluded: true, no_harness_retry: true };
    await save(join(record, `result-${label}.json`), report);
    console.log(JSON.stringify(report, null, 2));
  } finally { await rmdir(lock); }
}

async function stopCheck() {
  const counts = await ledger();
  let blocked = false;
  try { assertT2AttemptAllowed(counts.current, counts.total); } catch { blocked = true; }
  await save(join(record, 'stop-check.json'), { batch, ...counts, next_attempt_blocked: blocked,
    before_credentials_or_provider: true, absolute_limit: 12, authorized_runs: 3,
    boundary_checks: { eleven_allowed: (() => { try { assertT2AttemptAllowed(0, 11); return true; } catch { return false; } })(),
      twelve_blocked: (() => { try { assertT2AttemptAllowed(0, 12); return false; } catch { return true; } })() } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const actions: Record<string, () => Promise<unknown>> = { preflight, freeze, check, 'run-next': runNext, 'stop-check': stopCheck };
  const action = process.argv[2];
  if (!action || !actions[action]) throw new Error('expected preflight | freeze | check | run-next | stop-check');
  await actions[action]!();
}
