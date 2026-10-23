// Debug/release entry launcher: prepares an isolated run directory, copies product assets, starts
// `opencode serve` through startManagedOpenCode, sends one fixed start message to the coordinator,
// waits for the root session to go idle (or the deadline) and saves state + evidence. It never creates
// child sessions, forwards tool calls or writes follow-up prompts. The control service (control-service.ts) runs in
// this process: the product plugin binds sessions, admits model calls and authorizes tools through a loopback RPC.
//
// Usage: npx tsx apps/launcher/src/launch.ts --profile <release-profile.json>
//          [--runs-root <dir>] [--run-id <id>] [--product <dir>] [--deadline-ms <n>]
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadOpenCodeConfig, startManagedOpenCode } from '@ctf/opencode-bridge';
import type { OpencodeClient } from '@opencode-ai/sdk/v2';
import { Blocked } from './blocked.js';
import { prepareRun } from './run-prep.js';
import { ControlService, summarizeUsage } from './control-service.js';
import { startControlRpc } from './control-rpc.js';
import { loadLocalEnv } from '../../cli/src/composition/localEnv.js';
import { loadReleaseProfile } from '../../cli/src/composition/releaseProfile.js';

export const START_MESSAGE = '開始運行。按產品運行約定，由 Coordinator 組織各角色並經 Intake 取得題目。';
const COORDINATOR = 'coordinator';


export interface LaunchOptions {
  profile: string; runsRoot?: string; runId?: string; product?: string; deadlineMs?: number;
  /** Test seam: called once after the start message is sent, with the launcher's own SDK client. */
  onStarted?: (context: { client: OpencodeClient; rootId: string }) => Promise<void>;
}
interface Copy { path: string; sha256: string; source: string }

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

/** realpath of the deepest existing ancestor plus the not-yet-existing tail. */
async function resolveReal(path: string): Promise<string> {
  const absolute = resolve(path);
  const tail: string[] = [];
  let current = absolute;
  while (!existsSync(current)) { tail.unshift(basename(current)); current = dirname(current); }
  return join(await realpath(current), ...tail);
}

function git(cwd: string, ...args: string[]): string | undefined {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return undefined; }
}

function parseFrontmatter(text: string): Record<string, string> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return undefined;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (m) fields[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

async function listFiles(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Blocked(`product asset contains a symbolic link: ${path}`);
    if (entry.isDirectory()) out.push(...await listFiles(path)); else out.push(path);
  }
  return out;
}

/** Whitelisted assets of one layer: AGENTS.md, agents/*.md and skills/<name>/**. Targets are relative to the config directory. */
async function collectLayer(layer: string): Promise<Array<{ source: string; target: string }>> {
  const items: Array<{ source: string; target: string }> = [];
  for (const forbidden of ['plugin', 'plugins', 'tool', 'tools', 'command', 'commands']) {
    if (existsSync(join(layer, forbidden))) throw new Blocked(`product layer must not contain ${forbidden}/`);
  }
  if (existsSync(join(layer, 'AGENTS.md'))) items.push({ source: join(layer, 'AGENTS.md'), target: 'AGENTS.md' });
  const agents = join(layer, 'agents');
  if (existsSync(agents)) {
    for (const name of (await readdir(agents)).filter(n => n.endsWith('.md')).sort()) {
      const fields = parseFrontmatter(await readFile(join(agents, name), 'utf8'));
      if (!fields?.description || !fields.mode) throw new Blocked(`agent ${name} needs description and mode frontmatter`);
      items.push({ source: join(agents, name), target: `agents/${name}` });
    }
  }
  const skills = join(layer, 'skills');
  if (existsSync(skills)) {
    for (const entry of (await readdir(skills, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const skillFile = join(skills, entry.name, 'SKILL.md');
      const fields = existsSync(skillFile) ? parseFrontmatter(await readFile(skillFile, 'utf8')) : undefined;
      if (!fields?.name || !fields.description) throw new Blocked(`skill ${entry.name} lacks name/description frontmatter`);
      if (fields.name !== entry.name) throw new Blocked(`skill ${entry.name} frontmatter name "${fields.name}" does not match its directory`);
      for (const file of await listFiles(join(skills, entry.name))) {
        items.push({ source: file, target: join('skills', entry.name, file.slice(join(skills, entry.name).length + 1)) });
      }
    }
  }
  return items;
}

function assertNoAsk(value: unknown): void {
  if (value === 'ask') throw new Blocked('product configuration must not use permission "ask"');
  if (value && typeof value === 'object') Object.values(value).forEach(assertNoAsk);
}

export async function launch(options: LaunchOptions): Promise<{ code: number; status: string; runDir?: string }> {
  // Control service RPC: the handler is attached once the SDK client exists; until then every request is denied.
  let control: ControlService | undefined;
  const rpc = await startControlRpc(async (sessionID, operation, input) => {
    if (!control) throw new Error('control service not ready');
    return control.handle(sessionID, operation, input);
  });
  try { return await runLaunch(options, rpc, service => { control = service; }); } finally { await rpc.close(); }
}

async function runLaunch(options: LaunchOptions, rpc: { url: string; token: string }, attach: (service: ControlService) => void): Promise<{ code: number; status: string; runDir?: string }> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const productDir = await realpath(resolve(options.product ?? join(repoRoot, 'product')));
  const repoReal = await realpath(repoRoot);
  const mainRepo = git(repoRoot, 'rev-parse', '--git-common-dir');
  const forbiddenRoots = [repoReal, productDir, ...(mainRepo ? [dirname(await realpath(resolve(repoRoot, mainRepo)))] : [])];

  const profile = await loadReleaseProfile(options.profile);
  const loaded = await loadOpenCodeConfig(profile.opencode.configPath);

  // 1. Run data location: outside the repository / product, never inside any git work tree; realpath before use.
  const requestedRoot = await resolveReal(options.runsRoot ?? join(homedir(), '.ctf-agent', 'runs'));
  if (forbiddenRoots.some(root => inside(requestedRoot, root)) || git(await nearest(requestedRoot), 'rev-parse', '--show-toplevel')) {
    throw new Blocked('run data root must be outside the repository and product/');
  }
  await mkdir(requestedRoot, { recursive: true });
  const runsRoot = await realpath(requestedRoot);
  const runId = options.runId ?? `run_${randomUUID()}`;
  if (!/^[\w.-]+$/.test(runId)) throw new Blocked('invalid run id');
  const runDir = join(runsRoot, runId);
  const paths = { opencode: join(runDir, 'opencode'), workspace: join(runDir, 'workspace'), state: join(runDir, 'state'), evidence: join(runDir, 'evidence') };

  // 2. OpenCode working directory must be empty or absent, with no .opencode/ at its root.
  if (existsSync(join(paths.opencode, '.opencode'))) throw new Blocked('OpenCode working directory contains .opencode/');
  if (existsSync(paths.opencode) && (await readdir(paths.opencode)).length > 0) throw new Blocked('OpenCode working directory is not empty');
  for (const path of Object.values(paths)) await mkdir(path, { recursive: true });
  const real = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([k, v]) => [k, await realpath(v)]))) as typeof paths;

  const secrets = [...loaded.secrets, rpc.token];

  // 2b. Challenges: check and pin them before anything is started. A rejection is recorded in evidence/ and rethrown.
  try { await prepareRun({ challengesPath: profile.challenges, workspace: real.workspace, evidence: real.evidence, secrets }); } catch (cause) {
    const reason = String(cause instanceof Error ? cause.message : cause);
    const scrubbed = secrets.reduce((acc, s) => (s ? acc.split(s).join('<redacted>') : acc), reason);
    await writeFile(join(real.evidence, 'run-prep-rejection.json'), JSON.stringify({ reason: scrubbed, at: new Date().toISOString() }, null, 2), { flag: 'wx' });
    throw cause instanceof Blocked ? new Blocked(scrubbed.replace(/^blocked_configuration: /, '')) : cause;
  }

  // 3. Whitelist copy of product assets into <opencode>/config/opencode.
  const configDirectory = join(real.opencode, 'config', 'opencode');
  const targets = new Map<string, string>();
  for (const layer of [productDir, join(productDir, 'opencode')]) {
    for (const item of await collectLayer(layer)) {
      const existing = targets.get(item.target);
      if (existing) throw new Blocked(`shared and specific layers both provide ${item.target}`);
      targets.set(item.target, item.source);
    }
  }
  const baseConfig = JSON.parse(await readFile(join(productDir, 'opencode', 'opencode.json'), 'utf8')) as Record<string, unknown>;
  for (const key of ['provider', 'model', 'small_model', 'plugin', 'default_agent']) {
    if (key in baseConfig) throw new Blocked(`product opencode.json must not contain runtime field ${key}`);
  }
  assertNoAsk(baseConfig);
  const copies: Copy[] = [];
  for (const [target, source] of [...targets].sort()) {
    const bytes = await readFile(source);
    if (secrets.some(secret => secret && bytes.includes(Buffer.from(secret)))) throw new Blocked(`control credential found in product asset ${target}`);
    const destination = join(configDirectory, target);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    copies.push({ path: destination, sha256: sha256(bytes), source });
  }
  const productRevision = {
    commit: git(repoRoot, 'rev-parse', 'HEAD') ?? 'unavailable',
    productDirty: (git(repoRoot, 'status', '--porcelain', '--', productDir) ?? '?') !== ''
  };

  // 4. Merge runtime fields and start OpenCode through the managed launcher.
  const pluginEntry = join(repoRoot, 'apps', 'opencode-plugin', 'src', 'entry.ts');
  const config = {
    ...baseConfig, default_agent: COORDINATOR, plugin: [[pluginEntry, { controlUrl: rpc.url, controlToken: rpc.token, tools: [] }]], model: loaded.config.model, small_model: loaded.config.model,
    provider: loaded.config.provider, ...(loaded.config.enabled_providers ? { enabled_providers: loaded.config.enabled_providers } : {})
  };
  const deadlineMs = options.deadlineMs ?? profile.budget.wallClockMs;
  const timeline: Array<{ t: number; event: string; detail?: unknown }> = [];
  const t0 = Date.now();
  const mark = (event: string, detail?: unknown) => timeline.push({ t: Date.now() - t0, event, ...(detail === undefined ? {} : { detail }) });
  const scrub = (text: string) => secrets.reduce((acc, s) => (s ? acc.split(s).join('<redacted>') : acc), text);
  const controller = new AbortController();
  mark('start', { runId, deadlineMs });
  const engine = await startManagedOpenCode({ directory: real.opencode, config: config as never, environment: loaded.environment,
    binaryPath: profile.opencode.binaryPath, signal: controller.signal });
  mark('opencode_started', { version: engine.version });
  const client = engine.client;
  let rootId = '';
  let status = 'completed';
  const sessionIds = new Set<string>();
  const deadlineAt = Date.now() + deadlineMs; // one deadline for the launcher loop and for every binding's expiry
  const control = new ControlService({ client, budget: { maxModelCalls: profile.budget.maxSteps, maxObservableTokens: profile.budget.maxObservableTokens },
    expiresAt: deadlineAt, workdir: real.opencode, skillRoot: join(configDirectory, 'skills') });
  attach(control);
  const usageTotal = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, lowerBound: false };
  const descendants = async (id: string): Promise<string[]> => {
    const children = (await client.session.children({ sessionID: id }, { throwOnError: true })).data ?? [];
    return [...children.map(c => c.id), ...(await Promise.all(children.map(c => descendants(c.id)))).flat()];
  };
  try {
    const agents = (await client.app.agents({}, { throwOnError: true })).data ?? [];
    const skills = (await client.app.skills({}, { throwOnError: true })).data ?? [];
    mark('inventory', { agents: agents.map(a => ({ name: a.name, mode: a.mode })), skills: skills.map(s => ({ name: s.name, location: s.location })) });
    await writeFile(join(real.evidence, 'inventory.json'), scrub(JSON.stringify({ agents, skills }, null, 2)), { flag: 'wx' });
    const session = await client.session.create({ title: 'CTF Agent run' }, { throwOnError: true });
    rootId = session.data!.id; sessionIds.add(rootId);
    control.bindRoot(rootId); // bound as coordinator before the first message, hence before the first model request
    mark('root_bound', { rootId });
    await client.session.promptAsync({ sessionID: rootId, agent: COORDINATOR, parts: [{ type: 'text', text: START_MESSAGE }] }, { throwOnError: true });
    mark('start_message_sent', { rootId });
    await options.onStarted?.({ client, rootId });
    let idleSeen = 0;
    while (true) {
      await control.checkBudget();
      const reason = control.stopReason ?? (Date.now() >= deadlineAt ? 'deadline' : undefined);
      if (reason) {
        status = reason === 'deadline' ? 'deadline_exceeded' : 'budget_exceeded';
        mark(reason === 'deadline' ? 'deadline' : 'budget_stop');
        await control.stopAll(reason); // marks every session first, then aborts them all
        mark('aborted', { sessions: [...control.bindings.keys()] });
        await delay(500);
        break;
      }
      const current = (await client.session.status({}, { throwOnError: true })).data?.[rootId];
      if (!current || current.type === 'idle') {
        const messages = (await client.session.messages({ sessionID: rootId }, { throwOnError: true })).data ?? [];
        const done = messages.some(m => m.info.role === 'assistant' && m.info.time.completed !== undefined);
        idleSeen = done ? idleSeen + 1 : 0;
        if (idleSeen >= 2) { mark('root_idle'); await control.stopAll('completed'); break; }
      } else idleSeen = 0;
      await delay(500);
    }
    // 5. Save sessions, messages and usage.
    for (const id of [...await descendants(rootId), ...control.bindings.keys()]) sessionIds.add(id);
    const sessions: unknown[] = [];
    const finalStatus = (await client.session.status({}, { throwOnError: true })).data ?? {};
    for (const id of sessionIds) {
      const info = (await client.session.get({ sessionID: id }, { throwOnError: true })).data!;
      const messages = (await client.session.messages({ sessionID: id }, { throwOnError: true })).data ?? [];
      const usage = summarizeUsage(messages as never);
      let error: unknown;
      for (const m of messages) if (m.info.role === 'assistant' && m.info.error) error = m.info.error;
      usageTotal.input_tokens += usage.input; usageTotal.output_tokens += usage.output; usageTotal.reasoning_tokens += usage.reasoning;
      if (usage.incomplete) usageTotal.lowerBound = true;
      sessions.push({ id, parentID: info.parentID ?? null, title: info.title, status: finalStatus[id]?.type ?? 'idle',
        agents: [...new Set(messages.map(m => (m.info as { agent?: string }).agent).filter(Boolean))], assistantMessages: usage.assistantMessages,
        usage: usage.availability === 'reported' ? { availability: 'reported', input_tokens: usage.input, output_tokens: usage.output, reasoning_tokens: usage.reasoning,
          complete: !usage.incomplete } : { availability: 'unavailable' },
        error: error ?? null });
      await writeFile(join(real.evidence, `messages-${id}.json`), scrub(JSON.stringify(messages, null, 2)), { flag: 'wx' });
      if (error && status === 'completed' && id === rootId) status = 'failed';
    }
    await writeFile(join(real.evidence, 'sessions.json'), scrub(JSON.stringify(sessions, null, 2)), { flag: 'wx' });
  } catch (cause) {
    status = 'failed';
    mark('error', scrub(String(cause)));
  } finally {
    await engine.close();
    mark('opencode_closed');
  }
  // A stopped run can lose the usage of the aborted message, so its total is only a lower bound.
  if (control.stopReason && control.stopReason !== 'completed') usageTotal.lowerBound = true;
  await writeFile(join(real.evidence, 'bindings.json'), JSON.stringify([...control.bindings.values()], null, 2), { flag: 'wx' });
  await writeFile(join(real.evidence, 'admissions.json'), JSON.stringify(control.audit.filter(r => r.op === 'model.call'), null, 2), { flag: 'wx' });
  await writeFile(join(real.evidence, 'control-audit.json'), scrub(JSON.stringify(control.audit, null, 2)), { flag: 'wx' });
  await writeFile(join(real.evidence, 'assets.json'), JSON.stringify({ productRevision, copies }, null, 2), { flag: 'wx' });
  await writeFile(join(real.state, 'run.json'), JSON.stringify({ runId, status, rootSessionId: rootId || null, sessions: [...sessionIds],
    deadlineMs, opencodeVersion: engine.version, model: loaded.config.model, configSha256: sha256(JSON.stringify({ ...config, plugin: undefined })), productRevision,
    budget: profile.budget, admittedModelCalls: control.admitted, stopReason: control.stopReason ?? null, usageTotal,
    paths: real, timeline }, null, 2), { flag: 'wx' });
  return { code: status === 'completed' ? 0 : 1, status, runDir };
}

async function nearest(path: string): Promise<string> {
  let current = path;
  while (!existsSync(current)) current = dirname(current);
  return current;
}

function parseArgs(argv: string[]): LaunchOptions {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]!;
    if (!key.startsWith('--') || argv[i + 1] === undefined) throw new Error(`invalid argument ${key}`);
    values[key.slice(2)] = argv[i + 1]!;
  }
  if (!values.profile) throw new Error('--profile is required');
  return { profile: values.profile, runsRoot: values['runs-root'], runId: values['run-id'], product: values.product,
    deadlineMs: values['deadline-ms'] ? Number(values['deadline-ms']) : undefined };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await loadLocalEnv();
    const result = await launch(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result));
    process.exitCode = result.code;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ status: message.startsWith('blocked_configuration') ? 'blocked_configuration' : 'error', reason: message }));
    process.exitCode = message.startsWith('blocked_configuration') ? 2 : 1;
  }
}
