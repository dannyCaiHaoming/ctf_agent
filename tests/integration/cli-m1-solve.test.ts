import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { StateStore } from '@ctf/state';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('normal CLI solve entry for M1', () => {
  it('creates run identity, fixed Reference binding, and a deterministic provider-stub SolverLoop without live model calls', async () => {
    const out = await mkdtemp(join(tmpdir(), 'cli-m1-solve-')); roots.push(out);
    const scriptPath = join(out, 'solve.mjs');
    const payloadPath = join(out, 'payload.txt');
    await writeFile(scriptPath, 'console.log("fixture");\n');
    await writeFile(payloadPath, 'fixture payload\n');
    const profilePath = join(out, 'm1-profile.json');
    await writeFile(profilePath, JSON.stringify({
      profileId: 'm1-deterministic-wiring', solverMode: 'm1',
      solverProfile: { promptTemplateVersion: 'solver-action-json/v6', toolManifestVersion: 'm1-tools/v2' },
      model: { provider: 'stub', id: 'deterministic-only', temperature: 0 },
      reference: { enabled: true }, budget: { wallClockMs: 10000, maxSteps: 10, maxToolJobs: 10, maxObservableTokens: 10000 }, os: { platform: 'macos' }
    }));
    const actionScript = JSON.stringify([
      { kind: 'tool', tool: 'reference.search', input: { query: 'runtime scope' } },
      { kind: 'tool', tool: 'skill.load', input: { domain: 'web' } },
      { kind: 'tool', tool: 'job.list', input: {} },
      { kind: 'stop', reason: 'deterministic wiring probe' }
    ]);
    const cli = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/main.ts', 'solve', '--target', 'http://127.0.0.1:8787', '--profile', profilePath, '--out', out, '--allow-stub', '--material', scriptPath, '--material', payloadPath], {
      cwd: process.cwd(), env: { ...process.env, NODE_NO_WARNINGS: '1', M1_STUB_SOLVER_ACTIONS: actionScript }, stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    cli.stdout.on('data', value => stdout.push(Buffer.from(value)));
    cli.stderr.on('data', value => stderr.push(Buffer.from(value)));
    const exitCode = await new Promise<number>((resolve, reject) => {
      cli.once('error', reject); cli.once('close', code => resolve(code ?? -1));
    });
    expect(Buffer.concat(stderr).toString()).toBe('');
    expect(exitCode).toBe(1);
    const result = { code: exitCode, message: Buffer.concat(stdout).toString().trim() };
    const report = JSON.parse(result.message) as { run_id: string; challenge_id: string; session_id: string; status: string; outcome: string;
      provider_usage: { input_tokens: number; output_tokens: number; model_calls: number }; canonical_event_count: number; reference: { snapshotId: string; digest: string } };
    expect(report).toMatchObject({ status: 'no_route', outcome: 'unsolved', provider_usage: { model_calls: 0 }, canonical_event_count: expect.any(Number) });
    expect(report.run_id).toMatch(/^run_/); expect(report.challenge_id).toMatch(/^challenge_/); expect(report.session_id).toMatch(/^session_/);
    expect(report.reference).toMatchObject({ snapshotId: 'local-recipes-candidate-1', digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const state = new StateStore(join(out, 'state'), report.run_id); roots.push(join(out, 'state'));
    try {
      const call = state.events().find(event => event.kind === 'solver.activity' && event.activity === 'driver.call');
      expect(call).toMatchObject({ kind: 'solver.activity', activity: 'driver.call', data: { usage: { provenance: 'deterministic', model_calls: 0 } } });
      const started = state.events().find(event => event.kind === 'solver.activity' && event.activity === 'started');
      expect(started?.kind).toBe('solver.activity');
      if (started?.kind === 'solver.activity') expect(started.data)
        .toMatchObject({ challenge: { workspace_files: ['solve.mjs', 'payload.txt'], material_refs: [{ size: expect.any(Number) }, { size: expect.any(Number) }], snapshot: { toolManifestVersion: 'm1-tools/v2', promptTemplateVersion: 'solver-action-json/v6' } } });
      const final = [...state.events()].reverse().find(event => event.kind === 'solver.activity' && event.activity === 'checkpoint');
      expect(final?.kind).toBe('solver.activity');
      if (final?.kind === 'solver.activity') expect(report).toMatchObject({
        run_id: final.runId, challenge_id: final.challengeId, session_id: final.sessionId,
        status: final.data.status, solve_state: final.data.solve_state, outcome: final.data.outcome, reason: final.data.reason
      });
      expect(state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'tool.result')).toHaveLength(3);
      expect(state.loadCheckpoint(report.run_id)).toMatchObject({ runId: report.run_id });
    } finally { state.close(); }
  });
});
