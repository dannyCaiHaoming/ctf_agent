import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

export interface FixtureCall { name: string; args: Record<string, unknown> }

/** A deterministic local HTTP provider. The actual OpenCode binary owns all agent turns. */
export async function openCodeFixture(calls: FixtureCall[], options: { preset?: boolean; model?: string; maxSteps?: number; omitUsage?: boolean; root?: string; trajectory?: 't1' | 't2' } = {}) {
  const root = options.root ? resolve(options.root) : await mkdtemp(join(tmpdir(), 'm1-opencode-'));
  if (options.root) { await mkdir(resolve(root, '..'), { recursive: true }); await mkdir(root, { recursive: false }); }
  const requests: Array<Record<string, unknown>> = [];
  let cursor = 0;
  const provider = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
    requests.push(body);
    const call = calls[cursor++];
    const id = `fixture-${cursor}`;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (delta: unknown, finish_reason: string | null = null) => response.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created: 1, model: options.model ?? 'local-perfect',
      choices: [{ index: 0, delta, finish_reason }]
    })}\n\n`);
    emit({ role: 'assistant', ...(call ? { tool_calls: [{ index: 0, id: `call-${cursor}`, type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Finished.' }) });
    emit({}, call ? 'tool_calls' : 'stop');
    if (!options.omitUsage) response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  provider.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((done, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', done); });
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('fixture provider did not bind');
  const model = options.model ?? 'local-perfect';
  const engineConfig = join(root, 'opencode.json');
  await writeFile(engineConfig, JSON.stringify({ model: `local/${model}`, provider: { local: {
    npm: '@ai-sdk/openai-compatible', name: 'Deterministic local fixture',
    options: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: '{env:M1_LOCAL_FIXTURE_KEY}' },
    models: { [model]: { name: model, limit: { context: 64000, output: 4000 } } }
  } } }));
  const profilePath = join(root, 'profile.json');
  await writeFile(profilePath, JSON.stringify({ profileId: 'm1-opencode-fixture', solverMode: 'm1',
    solverProfile: { promptTemplateVersion: `opencode-${options.trajectory ?? 't1'}/v1`, toolManifestVersion: `ctf-managed-${options.trajectory ?? 't1'}/v1` },
    opencode: { configPath: engineConfig }, reference: { enabled: false },
    budget: { wallClockMs: 45000, maxSteps: options.maxSteps ?? 40, maxToolJobs: 20, maxObservableTokens: 20000 }, os: { platform: 'macos' } }));
  const out = join(root, 'run');
  return {
    root, out, requests,
    async run(extra: string[] = []) {
      const argv = ['--import', 'tsx', 'apps/cli/src/main.ts', 'solve', '--target', 'http://127.0.0.1',
        '--profile', profilePath, '--out', out,
        ...(options.trajectory === 't2' ? ['--trajectory', 't2', ...['target.mjs', 'decode.mjs', 'payload.txt']
          .flatMap(name => ['--material', resolve('fixtures/trajectories/t2-falsified', name)])]
          : ['--material', resolve('fixtures/trajectories/t1-script-error/solve.mjs'),
            '--material', resolve('fixtures/trajectories/t1-script-error/payload.txt')]),
        ...(options.preset ? ['--preset-trajectory1'] : []), ...extra];
      const child = spawn(process.execPath, argv, { cwd: process.cwd(),
        env: { ...process.env, NODE_NO_WARNINGS: '1', M1_LOCAL_FIXTURE_KEY: 'local-fixture-key-never-in-model' },
        stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', value => stdout += String(value));
      child.stderr.on('data', value => stderr += String(value));
      const timer = setTimeout(() => child.kill('SIGTERM'), 55000);
      const code = await new Promise<number | null>((done, reject) => {
        child.once('error', reject); child.once('close', done);
      }).finally(() => clearTimeout(timer));
      if (!stdout.trim()) throw new Error(`CLI exited ${code}: ${stderr}`);
      return { code, result: JSON.parse(stdout) as Record<string, any>, stderr };
    },
    async events() {
      const files = await readdir(join(out, 'state'));
      const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
      const db = new DatabaseSync(join(out, 'state', files.find(file => file.endsWith('.sqlite'))!));
      try { return db.prepare('SELECT payload FROM events ORDER BY seq').all().map(row => JSON.parse(String(row.payload))) as any[]; }
      finally { db.close(); }
    },
    async close(preserve = false) { await new Promise<void>(done => provider.close(() => done())); if (!preserve) await rm(root, { recursive: true, force: true }); }
  };
}

export const successfulRepair: FixtureCall[] = [
  { name: 'ctf_job_run', args: { command: ['node', 'solve.mjs'] } },
  { name: 'ctf_workspace_read', args: { path: 'solve.mjs' } },
  { name: 'ctf_workspace_patch', args: { path: 'solve.mjs', find: ".toString('utf8');", replace: ".toString('utf8'));" } },
  { name: 'ctf_job_run', args: { command: ['node', 'solve.mjs'] } },
  { name: 'ctf_candidate_register', args: { value: 'flag{local_repair}' } }
];

export const falsifiedRoute: FixtureCall[] = [
  { name: 'ctf_hypothesis_propose', args: { claim: 'The parser evaluates expressions.', prediction: 'expression_evaluates',
    falsifier: 'Successful output preserves the expression literally.', command: ['node', 'target.mjs', '7*6'] } },
  { name: 'ctf_job_run', args: { command: ['node', 'target.mjs', '7*6'] } },
  { name: 'ctf_hypothesis_conclude', args: { verdict: 'rejected', rationale: 'The actual literal value 7*6 contradicts expression evaluation.' } },
  { name: 'ctf_hypothesis_propose', args: { claim: 'The separate payload can yield a decoded result.', prediction: 'other',
    falsifier: 'The decoder fails to produce a result.', command: ['node', 'decode.mjs'],
    route_reason: 'Evaluation was refuted by the literal output; investigate the independent payload.' } },
  { name: 'ctf_job_run', args: { command: ['node', 'decode.mjs'] } },
  { name: 'ctf_candidate_register', args: { value: 'flag{changed_route}' } }
];
