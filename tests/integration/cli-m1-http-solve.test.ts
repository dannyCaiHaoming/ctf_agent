import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { StateStore } from '@ctf/state';

const roots: string[] = []; const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

function responseFor(request: Record<string, any>, wrongCandidate = false): Record<string, unknown> {
  const solver = request.messages.map((message: { content?: string }) => message.content ?? '').find((content: string) => content.includes('"remaining"'));
  const state = JSON.parse(solver!) as Record<string, any>;
  const experiment = state.experiment as Record<string, any> | null;
  const observation = state.observation as Record<string, any> | null;
  const expectedUrl = experiment?.plan.procedure[0]?.input?.url;
  const currentObservation = observation?.tool === 'http.request' && (() => { try { return JSON.parse(observation.raw).url === expectedUrl; } catch { return false; } })();
  let action: Record<string, unknown>;
  if (!experiment) {
    const url = new URL('/robots.txt', state.challenge.snapshot.target).toString();
    action = dispatch('robots', 'HTTP response body from URL contains literal marker: /static/', url, 'http.body.contains:/static/', 'http.body.absent:/static/');
  } else if (experiment.plan.hypothesis_id === 'h-robots' && experiment.status === 'running' && !currentObservation) {
    action = { kind: 'tool', tool: 'http.request', input: experiment.plan.procedure[0].input, step_id: 'probe' };
  } else if (experiment.plan.hypothesis_id === 'h-robots' && experiment.status === 'succeeded' && !experiment.conclusion) {
    action = { kind: 'conclude', verdict: 'supported', rationale: 'robots body advertises a protected static path', evidence_refs: observation!.artifact_refs };
  } else if (experiment.plan.hypothesis_id === 'h-robots' && experiment.status === 'succeeded' && experiment.conclusion) {
    const raw = JSON.parse(observation!.raw);
    const path = raw.body.split('\n').find((line: string) => line.startsWith('Disallow: /static/'))?.slice('Disallow: '.length);
    if (!path) throw new Error('provider stub did not find the visible robots disallow path');
    const url = new URL(path, state.challenge.snapshot.target).toString();
    action = dispatch('flag', `HTTP response body from URL contains literal marker: flag{`, url, 'http.body.contains:flag{', 'http.body.absent:flag{');
  } else if (experiment.plan.hypothesis_id === 'h-flag' && experiment.status === 'running' && !currentObservation) {
    action = { kind: 'tool', tool: 'http.request', input: experiment.plan.procedure[0].input, step_id: 'probe' };
  } else if (experiment.plan.hypothesis_id === 'h-flag' && experiment.status === 'running' && currentObservation) {
    action = { kind: 'conclude', verdict: 'supported', rationale: 'literal marker check', evidence_refs: observation.artifact_refs };
  } else if (experiment.plan.hypothesis_id === 'h-flag' && experiment.status === 'succeeded' && !experiment.conclusion) {
    action = { kind: 'conclude', verdict: 'supported', rationale: 'the response has the expected literal flag marker', evidence_refs: observation!.artifact_refs };
  } else if (experiment.plan.hypothesis_id === 'h-flag' && experiment.status === 'succeeded' && experiment.conclusion) {
    const value = wrongCandidate ? 'flag{deterministic-wrong-candidate}' : JSON.parse(observation!.raw).body;
    action = { kind: 'candidate', value, evidence_refs: observation!.artifact_refs };
  } else if (experiment.plan.hypothesis_id === 'h-robots' && experiment.status === 'running' && currentObservation) {
    action = { kind: 'conclude', verdict: 'supported', rationale: 'robots body advertises a protected static path', evidence_refs: observation!.artifact_refs };
  } else throw new Error(`unexpected deterministic provider state: ${experiment.plan.hypothesis_id}/${experiment.status}`);
  return { choices: [{ message: { content: JSON.stringify(action) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
}

function dispatch(id: string, claim: string, url: string, expected_support: string, expected_refutation: string) {
  const hypothesisId = id === 'robots' ? 'h-robots' : 'h-flag';
  const actualClaim = claim.replace('URL', url);
  const cost = { wall_ms: 5000, tokens: 10000, remote_units: 0 };
  return { kind: 'dispatch', hypothesis: { id: hypothesisId, claim: actualClaim, preconditions: [], missing_preconditions: [],
    supporting_refs: [], contradicting_refs: [], alternative_explanations: [], falsifier: `body lacks ${id === 'robots' ? '/static/' : 'flag{'}`,
    minimal_experiment: `GET ${url}`, expected_observation: expected_support, state_dependencies: { generation: 1 }, required_capabilities: ['http.request'],
    route_status: 'queued', next_action: `GET ${url}`, cost, state: 'proposed' },
  experiment: { id: `e-${id}`, hypothesis_id: hypothesisId, objective: `fetch ${url}`, input_refs: [], state_dependencies: { generation: 1 },
    parameters: { url }, procedure: [{ id: 'probe', tool: 'http.request', input: { url } }], expected_support, expected_refutation,
    budget: cost, repair_budget: 0, stop_condition: 'complete response received', expected_artifacts: ['http response body'] } };
}

describe('normal CLI M1 solve against local HTTP with deterministic provider stub', () => {
  it('reads, makes evidence-backed progress, extracts from runtime observation, independently replays, and submits to host-only oracle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-m1-http-')); roots.push(root);
    let wrongCandidate = false;
    const apiServer = createServer(async (request, response) => {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      try { const result = responseFor(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>, wrongCandidate);
        response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result));
      } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: { message: String(error) } })); }
    }); servers.push(apiServer); await new Promise<void>(resolveListen => apiServer.listen(0, '127.0.0.1', resolveListen));
    const address = apiServer.address(); if (!address || typeof address === 'string') throw new Error('provider stub did not bind');
    const profilePath = join(root, 'profile.json');
    await import('node:fs/promises').then(fs => fs.writeFile(profilePath, JSON.stringify({ profileId: 'local-http-m1', solverMode: 'm1',
      solverProfile: { promptTemplateVersion: 'http-literal/v1', toolManifestVersion: 'm1-tools/v2' },
      model: { provider: 'openai_compatible', id: 'deterministic-local-stub', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKeyEnv: 'LOCAL_M1_STUB_KEY', temperature: 0 },
      reference: { enabled: true }, budget: { wallClockMs: 60000, maxSteps: 20, maxToolJobs: 20, maxObservableTokens: 200000 }, os: { platform: 'macos' } })));
    const out = process.env.M1_PRESERVE_E2E_RUN === '1'
      ? resolve(process.env.M1_PRESERVE_E2E_DIR ?? 'runs/m1-cli-luna-e2e')
      : root;
    if (out !== root) {
      const fs = await import('node:fs/promises');
      await fs.mkdir(out, { recursive: true });
      const profileSnapshot = JSON.parse(await readFile(profilePath, 'utf8')) as Record<string, any>;
      delete profileSnapshot.model.apiKeyEnv;
      await fs.writeFile(join(out, 'profile.snapshot.json'), JSON.stringify(profileSnapshot, null, 2));
    }
    const cli = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', 'solve', '--target', 'auto', '--profile', profilePath, '--out', out], {
      cwd: process.cwd(), env: { ...process.env, NODE_NO_WARNINGS: '1', LOCAL_M1_STUB_KEY: 'local-only-stub-key' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    cli.stdout.on('data', value => stdout.push(Buffer.from(value))); cli.stderr.on('data', value => stderr.push(Buffer.from(value)));
    const exitCode = await new Promise<number>((resolveClose, reject) => { cli.once('error', reject); cli.once('close', code => resolveClose(code ?? -1)); });
    expect(Buffer.concat(stderr).toString()).toBe(''); expect(exitCode, Buffer.concat(stdout).toString()).toBe(0);
    const report = JSON.parse(Buffer.concat(stdout).toString()) as { run_id: string; status: string; candidate: { value_ref: { hash: string } } };
    expect(report.status).toBe('solved');
    const state = new StateStore(join(out, 'state'), report.run_id);
    if (out === root) roots.push(join(out, 'state'));
    try {
      const events = state.events();
      expect(events.filter(event => event.kind === 'solver.activity' && event.activity === 'tool.result' && event.data.tool === 'http.request')).toHaveLength(2);
      expect(events.filter(event => event.kind === 'solver.activity' && event.activity === 'progress.adjudication' && event.data.accepted === true), JSON.stringify(events.map(event => event.kind === 'solver.activity' ? [event.activity, event.data] : event))).toHaveLength(2);
      expect(events.filter(event => event.kind === 'solver.activity' && event.activity === 'candidate.stage' && event.data.state === 'completed').map(event => event.kind === 'solver.activity' ? event.data.stage : null)).toEqual(['engineering', 'verification', 'oracle_submit']);
      const submit = state.effectsFor({ operation: 'candidate.submit' });
      expect(submit).toHaveLength(1); expect(submit[0]).toMatchObject({ state: 'confirmed', businessOutcome: 'accepted' });
      expect(submit[0]!.authoritativeResponse).toMatchObject({ authoritative: true, status: 'accepted', completed: true });
      const artifacts = await readdir(join(out, 'artifacts-store', report.candidate.value_ref.hash.slice(0, 2)));
      expect(artifacts).toContain(report.candidate.value_ref.hash);
      const final = [...events].reverse().find(event => event.kind === 'solver.activity' && event.activity === 'checkpoint');
      expect(final).toMatchObject({ kind: 'solver.activity', activity: 'checkpoint', data: { status: 'solved' } });
      if (out !== root) await import('node:fs/promises').then(fs => fs.writeFile(join(out, 'audit-summary.json'), JSON.stringify({
        run_id: report.run_id,
        status: report.status,
        http_tool_results: events.filter(event => event.kind === 'solver.activity' && event.activity === 'tool.result' && event.data.tool === 'http.request').length,
        accepted_progress_adjudications: events.filter(event => event.kind === 'solver.activity' && event.activity === 'progress.adjudication' && event.data.accepted === true).length,
        completed_stages: events.filter(event => event.kind === 'solver.activity' && event.activity === 'candidate.stage' && event.data.state === 'completed').map(event => event.kind === 'solver.activity' ? event.data.stage : null),
        authoritative_submit: submit[0],
        final_checkpoint: final
      }, null, 2)));
    } finally { state.close(); }

    wrongCandidate = true;
    const negativeOut = join(root, 'wrong-candidate-run'); await import('node:fs/promises').then(fs => fs.mkdir(negativeOut));
    const negative = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', 'solve', '--target', 'auto', '--profile', profilePath, '--out', negativeOut], {
      cwd: process.cwd(), env: { ...process.env, NODE_NO_WARNINGS: '1', LOCAL_M1_STUB_KEY: 'local-only-stub-key' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    const negativeStdout: Buffer[] = []; const negativeStderr: Buffer[] = [];
    negative.stdout.on('data', value => negativeStdout.push(Buffer.from(value))); negative.stderr.on('data', value => negativeStderr.push(Buffer.from(value)));
    const negativeExit = await new Promise<number>((resolveClose, reject) => { negative.once('error', reject); negative.once('close', code => resolveClose(code ?? -1)); });
    expect(Buffer.concat(negativeStderr).toString()).toBe(''); expect(negativeExit).toBe(1);
    const negativeReport = JSON.parse(Buffer.concat(negativeStdout).toString()) as { run_id: string; status: string };
    expect(negativeReport.status).not.toBe('solved');
    const negativeState = new StateStore(join(negativeOut, 'state'), negativeReport.run_id); roots.push(join(negativeOut, 'state'));
    try { expect(negativeState.effectsFor({ operation: 'candidate.submit' })).toHaveLength(0); }
    finally { negativeState.close(); }
  });
});
