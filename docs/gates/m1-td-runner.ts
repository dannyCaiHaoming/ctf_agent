/** Narrow T-D harness. OpenCode owns every inference/tool turn; this only freezes and launches independent CLI runs. */
import { readFile, writeFile, mkdir, readdir, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { loadLocalEnv } from '../../apps/cli/src/composition/localEnv.js';
import { loadOpenCodeConfig, startManagedOpenCode } from '../../packages/opencode-bridge/src/server.js';

const exec = promisify(execFile);
const batch = 'm1-opencode-t1-bailian-20261019-b2';
const root = resolve('.');
const record = resolve('docs/gates', batch);
const runs = resolve('runs', batch);
const profilePath = 'config/release-profile.m1-td-bailian-20261019.json';
const configPath = 'config/opencode.m1-td-bailian-20261019.json';
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const readJSON = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const save = async (path: string, data: unknown) => writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });

export function assertAttemptAllowed(reserved: number, authorized: number) {
  if (!Number.isInteger(reserved) || reserved < 0 || reserved >= 12) throw new Error('STOP_RULE: twelve reserved attempts; no reset or retry');
  if (reserved >= authorized) throw new Error('STOP_RULE: authorized three-run allowance exhausted');
}

async function credentials() {
  await loadLocalEnv();
  if (process.env.DASHSCOPE_API_KEY) return 'DASHSCOPE_API_KEY environment';
  const auth = await readJSON(join(homedir(), '.local/share/opencode/auth.json'));
  const item = auth['aliyun-bailian'];
  if (item?.type !== 'api' || !item.key) throw new Error('blocked_external_input: Bailian API credential missing');
  process.env.DASHSCOPE_API_KEY = item.key; // In-memory only, never copied into a file or command line.
  return 'OpenCode auth provider aliyun-bailian -> in-memory DASHSCOPE_API_KEY';
}

async function preflight() {
  await mkdir(record, { recursive: true });
  const credentialSource = await credentials();
  const loaded = await loadOpenCodeConfig(resolve(configPath));
  const provider = loaded.config.provider!.bailian!;
  const modelID = loaded.config.model!.split('/')[1]!;
  const response = await fetch(`${provider.options!.baseURL}/models`, {
    headers: { authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}` }, signal: AbortSignal.timeout(20000)
  });
  const models = response.ok ? await response.json() as { data?: Array<{ id: string }> } : null;
  const result: Record<string, unknown> = { batch, at: new Date().toISOString(), credentialSource,
    endpoint: provider.options!.baseURL, model: loaded.config.model,
    network: { authenticated_models_http_status: response.status, listed_model: models?.data?.some(item => item.id === modelID) ?? null },
    remaining_quota: { availability: 'unavailable', value: null, reason: 'No account billing/remaining-credit API credentials; a successful probe proves current request availability only.' },
    probe: { max_wall_clock_ms: 90000, configured_output_limit: 256, formal_attempt: false, retries_by_harness: 0 } };
  if (!response.ok) {
    result.passed = false; await save(join(record, 'preflight.json'), result); throw new Error(`preflight credential HTTP ${response.status}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  let engine: Awaited<ReturnType<typeof startManagedOpenCode>> | undefined;
  try {
    const config = { model: loaded.config.model, small_model: loaded.config.model, provider: loaded.config.provider,
      default_agent: 'preflight', tools: { '*': false }, permission: { '*': 'deny' as const },
      share: 'disabled' as const, snapshot: false, autoupdate: false, lsp: false as const, formatter: false as const,
      mcp: {}, instructions: [], compaction: { auto: false, prune: false },
      agent: { preflight: { mode: 'primary' as const, steps: 1, tools: { '*': false },
        prompt: 'This is a connectivity check. Reply exactly M1_PREFLIGHT_OK. Do not use tools.',
        options: { maxOutputTokens: 256 } },
        build: { disable: true }, plan: { disable: true }, title: { disable: true }, summary: { disable: true },
        general: { disable: true }, explore: { disable: true }, compaction: { disable: true } } };
    // Bound the one-off probe's output; the formal configuration remains unchanged.
    config.provider!.bailian!.models![modelID]!.limit!.output = 256;
    engine = await startManagedOpenCode({ directory: join(runs, 'preflight-engine'), config,
      environment: loaded.environment, signal: controller.signal });
    const session = await engine.client.session.create({ title: 'Bailian availability preflight' }, { throwOnError: true });
    const answer = await engine.client.session.prompt({ sessionID: session.data!.id, agent: 'preflight',
      parts: [{ type: 'text', text: 'Reply exactly M1_PREFLIGHT_OK.' }] }, { signal: controller.signal, throwOnError: true });
    const info = answer.data!.info;
    const text = answer.data!.parts.filter(part => part.type === 'text').map(part => part.text).join('');
    result.probe = { ...result.probe as object, session_id: session.data!.id, engine_version: engine.version,
      returned_model: info.modelID, returned_provider: info.providerID, error_name: info.error?.name ?? null,
      marker_received: text.includes('M1_PREFLIGHT_OK'), reported_tokens: info.tokens, cost_reported_by_engine: info.cost };
    result.passed = !info.error && text.includes('M1_PREFLIGHT_OK');
  } catch (error) {
    result.passed = false;
    // SDK error messages may embed requests/headers: record only a safe error class.
    result.error_class = error instanceof Error ? error.name : 'unknown';
  } finally {
    clearTimeout(timer); await engine?.close(); await save(join(record, 'preflight.json'), result);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) throw new Error('preflight failed; no formal attempt launched');
}

async function freeze() {
  const preflight = await readJSON(join(record, 'preflight.json'));
  // Availability, not solving or echo fidelity, is the preflight gate. Keep the
  // original capped-marker failure intact; do not spend another inference hiding it.
  const inferenceAvailable = preflight.network.authenticated_models_http_status === 200 && preflight.network.listed_model === true &&
    preflight.probe.error_name === null && preflight.probe.returned_model === 'deepseek-v4-flash-0731' &&
    preflight.probe.reported_tokens?.input > 0 &&
    preflight.probe.reported_tokens.output + preflight.probe.reported_tokens.reasoning > 0;
  if (!inferenceAvailable || Date.now() - Date.parse(preflight.at) > 3600000) throw new Error('fresh successful inference availability preflight required');
  await save(join(record, 'preflight-assessment.json'), { inference_available: true, marker_probe_passed: preflight.passed,
    observed: 'API accepted inference and returned 256 reasoning tokens; marker absent at the 256-token probe cap',
    exact_remaining_quota: 'unavailable', no_second_inference: true, source_sha256: digest(await readFile(join(record, 'preflight.json'))) });
  const profile = await readJSON(profilePath), config = await readJSON(configPath);
  const files = (await exec('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root })).stdout.trim().split('\n');
  const selected = [...new Set(files.filter(path => /^(apps|packages|fixtures|tests|config)\//.test(path) ||
    /^(package(?:-lock)?\.json|tsconfig.*\.json)$/.test(path)).concat(['docs/gates/m1-td-runner.ts', 'docs/gates/m1-t1-acceptance.py']))].sort();
  const hashes: Record<string, string> = {};
  for (const path of selected) {
    try { hashes[path] = digest(await readFile(path)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const binary = (await exec('which', ['opencode'])).stdout.trim();
  await save(join(record, 'manifest.json'), { batch, at: new Date().toISOString(),
    authorization: '2026-10-19 user explicitly resumed Bailian API preflight and three independent formal T-D runs',
    predecessor: { batch: 'm1-t1-formal-20261019-b1', attempts: 12, frozen: true, merged: false },
    authorized_runs: 3, stop_limit: 12, preset: 'host first failed execution only; no repair hints', reference: null,
    profile_path: profilePath, config_path: configPath, profile, config,
    runtime: { node: process.version, node_path: process.execPath, node_sha256: digest(await readFile(process.execPath)),
      opencode_path: binary, opencode_version: (await exec(binary, ['--version'])).stdout.trim(), opencode_sha256: digest(await readFile(binary)) },
    base_head: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(), worktree: 'dirty; exact file hashes are execution identity, not a clean commit', hashes });
  console.log(`Frozen ${batch}: ${Object.keys(hashes).length} files; 3 authorized runs, absolute stop 12.`);
}

async function check() {
  const manifest = await readJSON(join(record, 'manifest.json'));
  if (manifest.batch !== batch || manifest.stop_limit !== 12 || manifest.authorized_runs !== 3) throw new Error('frozen batch identity/authority mismatch');
  for (const [path, hash] of Object.entries(manifest.hashes)) if (digest(await readFile(path)) !== hash) throw new Error(`frozen file changed: ${path}`);
  if (process.version !== manifest.runtime.node || process.execPath !== manifest.runtime.node_path ||
      digest(await readFile(process.execPath)) !== manifest.runtime.node_sha256 ||
      digest(await readFile(manifest.runtime.opencode_path)) !== manifest.runtime.opencode_sha256) throw new Error('frozen runtime changed');
  return manifest;
}

async function runNext() {
  const manifest = await check();
  await mkdir(runs, { recursive: true });
  const lock = join(runs, '.launch-lock');
  await mkdir(lock); // Exclusive across processes; a crash deliberately requires review, not silent retry.
  try {
    const previous = (await readdir(record)).filter(name => /^attempt-\d\d\.json$/.test(name));
    assertAttemptAllowed(previous.length, manifest.authorized_runs);
    const number = previous.length + 1, label = String(number).padStart(2, '0');
    const out = join(runs, `run-${label}`);
    await mkdir(out); // No directory reuse.
    await save(join(record, `attempt-${label}.json`), { batch, number, reserved_at: new Date().toISOString(),
      out, manifest_sha256: digest(await readFile(join(record, 'manifest.json'))), counted_even_if_failed: true });
    const args = ['--import', 'tsx', 'apps/cli/src/main.ts', 'solve', '--target', 'local-materials', '--profile', profilePath,
      '--material', 'fixtures/trajectories/t1-script-error/solve.mjs', '--material', 'fixtures/trajectories/t1-script-error/payload.txt',
      '--preset-trajectory1', '--out', out];
    await save(join(out, 'command.json'), { executable: process.execPath, args });
    await credentials();
    const started = Date.now();
    const child = spawn(process.execPath, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += String(bytes); }); child.stderr.on('data', bytes => { stderr += String(bytes); });
    const timeout = setTimeout(() => child.kill('SIGTERM'), manifest.profile.budget.wallClockMs + 30000);
    const code = await new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('close', done); });
    clearTimeout(timeout);
    const secret = process.env.DASHSCOPE_API_KEY!;
    stdout = stdout.replaceAll(secret, '[redacted]'); stderr = stderr.replaceAll(secret, '[redacted]');
    await writeFile(join(out, 'stdout.json'), stdout, { flag: 'wx' }); await writeFile(join(out, 'stderr.txt'), stderr, { flag: 'wx' });
    let canonical: Record<string, unknown>;
    try { canonical = JSON.parse((await exec('python3', ['docs/gates/m1-t1-acceptance.py', 'grade', out])).stdout); }
    catch (error) { try { canonical = JSON.parse((error as { stdout: string }).stdout); } catch { canonical = { passed: false, reason: 'grader unavailable' }; } }
    let result: any = {}; try { result = JSON.parse(stdout); } catch { /* retained raw failure */ }
    // Bind formal identity/budgets/materials to canonical start, not only CLI self-report.
    const { DatabaseSync } = await import('node:sqlite');
    let binding = false;
    try {
      const databases = (await readdir(join(out, 'state'))).filter(name => name.endsWith('.sqlite'));
      const db = new DatabaseSync(join(out, 'state', databases[0]!), { readOnly: true });
      try {
        const events = db.prepare('SELECT payload FROM events ORDER BY seq').all().map(row => JSON.parse(String(row.payload)));
        const start = events.find(event => event.activity === 'started');
        const snapshot = start?.data.challenge.snapshot;
        const expected = ['solve.mjs', 'payload.txt'].map(name => manifest.hashes[`fixtures/trajectories/t1-script-error/${name}`]).sort();
        const actual = start?.data.challenge.material_refs.map((ref: any) => ref.hash).sort();
        const final = events.find(event => event.activity === 'checkpoint');
        const budget = final?.data.budget;
        binding = snapshot?.opencode_config_hash === digest(JSON.stringify(manifest.config)) && snapshot?.profile_id === manifest.profile.profileId &&
          snapshot?.preset === true && snapshot?.reference === null && start?.data.engine_version === manifest.runtime.opencode_version &&
          JSON.stringify(start?.data.budget) === JSON.stringify(manifest.profile.budget) && JSON.stringify(expected) === JSON.stringify(actual) &&
          result?.engine?.model === manifest.config.model && result?.run_id === start?.runId && result?.session_id === start?.sessionId &&
          Object.entries(manifest.profile.budget).every(([key, limit]) => Number.isFinite(budget?.[key]) && budget[key] <= Number(limit));
      } finally { db.close(); }
    } catch { binding = false; }
    const report = { batch, number, exit_code: code, elapsed_ms: Date.now() - started, canonical,
      frozen_binding: binding, passed: code === 0 && canonical.passed === true && binding,
      result, output: out, no_harness_retry: true };
    await save(join(record, `result-${label}.json`), report);
    console.log(JSON.stringify(report, null, 2));
  } finally { await rmdir(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const action = process.argv[2];
  const actions: Record<string, () => Promise<unknown>> = { preflight, freeze, check, 'run-next': runNext };
  if (!action || !actions[action]) throw new Error('expected preflight | freeze | check | run-next');
  await actions[action]!();
}
