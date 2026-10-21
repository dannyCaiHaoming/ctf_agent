import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ArtifactStore } from '@ctf/artifacts';
import { StateStore } from '@ctf/state';
import { ToolRuntime } from '@ctf/runtime';
import { ResponsibilityRegistry } from '@ctf/supervisor';
import { OpenCodeTask } from '../../apps/cli/src/commands/openCodeTask.js';
import { createLocalHttpCandidateResolver } from '../../apps/cli/src/commands/localHttpCandidateResolver.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it('independently verifies a candidate substring and propagates authoritative completion', async () => {
  const run = await runCandidate({ candidate: 'flag{accepted}', oracle: 'flag{accepted}' });
  expect(run.result, JSON.stringify(run.result)).toMatchObject({ status: 'accepted', authoritative: true, completed: true });
  expect(run.final.outcome).toBe('solved');
  expect(run.events.some(event => event.activity === 'candidate.stage' && event.data.stage === 'verification' && event.data.state === 'completed')).toBe(true);
  expect(run.events.some(event => event.activity === 'candidate.stage' && event.data.stage === 'oracle_submit' && event.data.state === 'completed')).toBe(true);
});

it('records oracle rejection without setting solved', async () => {
  const run = await runCandidate({ candidate: 'flag{wrong}', oracle: 'flag{right}' });
  expect(run.result, JSON.stringify(run.result)).toMatchObject({ status: 'rejected', authoritative: true });
  expect(run.final.outcome).not.toBe('solved');
});

it('does not submit when independent replay fails', async () => {
  const run = await runCandidate({ candidate: 'flag{candidate}', oracle: 'flag{candidate}', breakReplay: true });
  expect(run.result).toMatchObject({ status: 'inconclusive', authoritative: false });
  expect(run.events.some(event => event.activity === 'candidate.stage' && event.data.stage === 'oracle_submit')).toBe(false);
  expect(run.final.outcome).not.toBe('solved');
});

it('preserves a POST candidate without blind replay or oracle submission', async () => {
  const run = await runCandidate({ candidate: 'flag{post-result}', oracle: 'flag{post-result}', method: 'POST' });
  expect(run.result).toMatchObject({ status: 'inconclusive', authoritative: false,
    detail: expect.stringContaining('unsupported for this potentially state-changing request') });
  expect(run.events.some(event => event.activity === 'candidate.stage' && event.data.stage === 'oracle_submit')).toBe(false);
  expect(run.final.outcome).not.toBe('solved');
});

it('does not anonymously replay a candidate response that establishes session state', async () => {
  const run = await runCandidate({ candidate: 'flag{session-result}', oracle: 'flag{session-result}', setCookie: true });
  expect(run.result).toMatchObject({ status: 'inconclusive', authoritative: false,
    detail: expect.stringContaining('depends on HTTP session state') });
  expect(run.events.some(event => event.activity === 'candidate.stage' && event.data.stage === 'oracle_submit')).toBe(false);
});

async function runCandidate(input: { candidate: string; oracle: string; breakReplay?: boolean; method?: 'GET' | 'POST'; setCookie?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), 'http-candidate-resolver-')); roots.push(root);
  let calls = 0;
  const server = createServer((_request, response) => {
    calls++;
    response.writeHead(200, { 'content-type': 'text/html', ...(input.setCookie ? { 'set-cookie': 'sid=test-session; HttpOnly; Path=/' } : {}) });
    response.end(input.breakReplay && calls > 1 ? '<p>no match</p>' : `<main>result ${input.candidate}</main>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test HTTP server failed to bind');
  const origin = `http://127.0.0.1:${address.port}`;
  const runId = `run_${address.port}`; const challengeId = `challenge_${address.port}`;
  const state = new StateStore(join(root, 'state'), runId);
  const artifacts = new ArtifactStore(join(root, 'artifacts'));
  const runtime = new ToolRuntime(artifacts, join(root, 'workspaces'), runId, challengeId, origin);
  const deadline = new Date(Date.now() + 30000).toISOString();
  const registry = new ResponsibilityRegistry({ verifyArtifact: async ref => { await artifacts.verify(ref); return true; } });
  registry.createTask({ run_id: runId, challenge_id: challengeId, task_id: 'task_solver', attempt_id: `attempt_${address.port}`,
    responsibility_set: ['domain_solver'], lease: { lease_id: `lease_${address.port}`, expires_at: deadline } });
  registry.bindSession({ session_id: `session_${address.port}`, task_id: 'task_solver', context: registry.createReasoningContext() });
  const session = await runtime.openHttpSession();
  const resolver = createLocalHttpCandidateResolver({ artifacts, state, runtime, registry,
    owner: { taskId: 'task_solver', sessionId: `session_${address.port}`, leaseId: `lease_${address.port}` },
    challengeId, runId, deadline, targetOrigin: origin, flag: input.oracle });
  const task = new OpenCodeTask({ state, artifacts, runtime, registry, sessionID: `session_${address.port}`,
    budget: { wallClockMs: 30000, maxSteps: 100, maxToolJobs: 20, maxObservableTokens: 20000 },
    deadline, controller: new AbortController(), secrets: [], httpSessionID: session,
    resolveCandidate: async () => { throw new Error('not used'); }, resolveWebCandidate: resolver });
  try {
    await task.tool('http.request', { url: `${origin}/result`, ...(input.method === 'POST' ? { method: 'POST', body: 'probe' } : {}) });
    const result = await task.tool('candidate.register', { value: input.candidate });
    const events = state.events().filter((event): event is Extract<typeof event, { kind: 'solver.activity' }> => event.kind === 'solver.activity');
    return { result, final: task.finish(), events };
  } finally {
    await runtime.dispose(); state.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
