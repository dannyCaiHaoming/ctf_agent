import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { createOpencodeClient, type Config } from '@opencode-ai/sdk/v2';
import { safeEnvironment } from '@ctf/policy';

export const OPENCODE_RUNTIME_VERSION = '1.19.3';

export async function loadOpenCodeConfig(path: string): Promise<{ config: Config; secrets: string[]; environment: Record<string, string> }> {
  const raw = await readFile(path, 'utf8');
  const config = JSON.parse(raw) as Config;
  if (!config.model || !config.model.includes('/')) throw new Error('OpenCode config requires an explicit provider/model');
  for (const provider of Object.values(config.provider ?? {})) {
    if (provider.npm && !['@ai-sdk/openai-compatible', '@ai-sdk/openai', '@ai-sdk/anthropic'].includes(provider.npm)) {
      throw new Error('blocked_configuration: provider adapter is not in the preinstalled OpenCode adapter allowlist');
    }
  }
  if (raw.includes('{file:')) throw new Error('OpenCode solve config uses env credential references, not file substitution');
  const check = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/^(api[-_]?key|.*[-_]?token|password|secret|authorization|x-api-key)$/i.test(key) &&
        (typeof item !== 'string' || !/^\{env:[A-Z_][A-Z0-9_]*\}$/.test(item))) {
        throw new Error('OpenCode credentials must use an env reference');
      }
      check(item);
    }
  };
  check(config);
  const environment: Record<string, string> = {};
  for (const match of raw.matchAll(/\{env:([A-Z_][A-Z0-9_]*)\}/g)) {
    const name = match[1]!;
    const value = process.env[name];
    if (!value) throw new Error(`blocked_external_input: ${name} is missing`);
    environment[name] = value;
  }
  return { config, secrets: Object.values(environment), environment };
}

/** Public `opencode serve` + SDK client, with per-run config and no workspace config loading. */
export async function startManagedOpenCode(input: {
  directory: string; config: Config; environment: Record<string, string>; binaryPath?: string; signal: AbortSignal;
}) {
  await mkdir(input.directory, { recursive: true });
  // OpenCode checks these before loading plugins. Reuse the installed lockfile
  // and node_modules; never let a running solve bootstrap packages from npm.
  const nodeModules = dirname(dirname(createRequire(import.meta.url).resolve('zod/package.json')));
  const configDirectory = join(input.directory, 'config', 'opencode');
  await mkdir(configDirectory, { recursive: true });
  await symlink(nodeModules, join(configDirectory, 'node_modules'), 'dir');
  for (const name of ['package.json', 'package-lock.json']) {
    await writeFile(join(configDirectory, name), await readFile(join(nodeModules, '..', name)), { flag: 'wx' });
  }
  const binary = input.binaryPath ?? 'opencode';
  const password = randomBytes(32).toString('hex');
  const env: Record<string, string> = {
    ...safeEnvironment(), ...input.environment, HOME: input.directory,
    XDG_CONFIG_HOME: join(input.directory, 'config'), XDG_DATA_HOME: join(input.directory, 'data'),
    XDG_STATE_HOME: join(input.directory, 'state'), XDG_CACHE_HOME: join(input.directory, 'cache'),
    OPENCODE_CONFIG_DIR: configDirectory, OPENCODE_CONFIG_CONTENT: JSON.stringify(input.config),
    npm_config_offline: 'true', NPM_CONFIG_OFFLINE: 'true', npm_config_ignore_scripts: 'true',
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
    OPENCODE_DISABLE_LSP_DOWNLOAD: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true',
    OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_AUTOCOMPACT: 'true',
    OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: 'true',
    OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: input.environment.OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS ?? 'true'
  };
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']) if (process.env[name]) env[name] = process.env[name]!;
  const version = (await promisify(execFile)(binary, ['--version'], { env, timeout: 10000 })).stdout.trim();
  if (version !== OPENCODE_RUNTIME_VERSION) throw new Error(`blocked_configuration: OpenCode ${OPENCODE_RUNTIME_VERSION} required; found ${version}`);
  input.signal.throwIfAborted();
  const child = spawn(binary, ['serve', '--hostname=127.0.0.1', '--port=0', '--log-level=ERROR'], {
    cwd: input.directory, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true
  });
  const exited = new Promise<void>(done => child.once('close', () => done()));
  const kill = (signal: NodeJS.Signals) => {
    if (child.pid) try { process.kill(-child.pid, signal); } catch { /* already stopped */ }
  };
  const abort = () => kill('SIGTERM');
  input.signal.addEventListener('abort', abort, { once: true });
  try {
    const url = await new Promise<string>((done, reject) => {
      let stdout = '';
      const timeout = setTimeout(() => reject(new Error('OpenCode server startup timed out')), 15000);
      const finish = (error?: Error, value?: string) => { clearTimeout(timeout); error ? reject(error) : done(value!); };
      child.once('error', () => finish(new Error('OpenCode server could not start')));
      child.once('exit', code => finish(new Error(`OpenCode server exited during startup (${code})`)));
      child.stderr.on('data', () => undefined); // Never include potentially sensitive engine logs in artifacts/errors.
      child.stdout.on('data', chunk => {
        stdout = (stdout + String(chunk)).slice(-4096);
        const match = /opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout);
        if (match) finish(undefined, match[1]);
      });
    });
    const client = createOpencodeClient({ baseUrl: url, directory: input.directory,
      headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` } });
    return { client, version, async close() {
      input.signal.removeEventListener('abort', abort);
      kill('SIGTERM');
      const timeout = setTimeout(() => kill('SIGKILL'), 1500);
      try { await exited; } finally { clearTimeout(timeout); }
    } };
  } catch (error) {
    input.signal.removeEventListener('abort', abort); kill('SIGKILL'); await exited; throw error;
  }
}
