import { expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { StateStore } from '@ctf/state';
import { ToolRuntime } from '@ctf/runtime';
import { ResponsibilityRegistry } from '@ctf/supervisor';
import { OpenCodeTask } from '../../apps/cli/src/commands/openCodeTask.js';

it('keeps cursors per ref, rejects overlapping reads, and advances only after a successful page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-cursor-'));
  const state = new StateStore(join(root, 'state'), 'run_cursor');
  const artifacts = new ArtifactStore(join(root, 'artifacts'));
  const runtime = new ToolRuntime(artifacts, join(root, 'workspaces'), 'run_cursor', 'challenge_cursor');
  try {
    const deadline = new Date(Date.now() + 30000).toISOString();
    const registry = new ResponsibilityRegistry({ verifyArtifact: async ref => { await artifacts.verify(ref); return true; } });
    registry.createTask({ run_id: 'run_cursor', challenge_id: 'challenge_cursor', task_id: 'task_solver', attempt_id: 'attempt_cursor',
      responsibility_set: ['domain_solver'], lease: { lease_id: 'lease_cursor', expires_at: deadline } });
    registry.bindSession({ session_id: 'ses_cursor', task_id: 'task_solver', context: registry.createReasoningContext() });
    const httpSessionID = await runtime.openHttpSession();
    const body = Buffer.from('中'.repeat(2050));
    vi.spyOn(runtime, 'httpRequest').mockImplementation(async () => ({ status: 302, contentType: 'text/plain', location: 'http://localhost/account',
      setCookieNames: ['sid'], cookieNamesSent: ['sid'], body,
      artifact: await artifacts.publish(body) }));
    const task = new OpenCodeTask({ state, artifacts, runtime, registry, sessionID: 'ses_cursor', deadline, httpSessionID,
      budget: { wallClockMs: 30000, maxSteps: 100, maxToolJobs: 20, maxObservableTokens: 20000 },
      controller: new AbortController(), secrets: ['test-control-secret'], resolveCandidate: async () => { throw new Error('no oracle'); } });
    const call = async (name: string, args: unknown): Promise<Record<string, any>> => {
      const result = await task.tool(name, args) as Record<string, any>;
      return result.outcome === 'success' ? { ...JSON.parse(result.raw), outcome: result.outcome } : result;
    };
    const first = await call('http.request', { url: 'http://localhost/' });
    const second = await call('http.request', { url: 'http://localhost/' });
    expect(first).toMatchObject({ status: 302, redirect_location: 'http://localhost/account', set_cookie_names: ['sid'], cookie_names_sent: ['sid'] });
    expect(first.observation_ref).not.toBe(second.observation_ref);
    const ref = first.observation_ref;
    const simultaneous = await Promise.all([call('observation.read', { ref, max_bytes: 3 }), call('observation.read', { ref, max_bytes: 3 })]);
    expect(simultaneous.filter(page => page.outcome === 'failure')).toHaveLength(1);
    expect(simultaneous.find(page => page.outcome !== 'failure')).toMatchObject({ cursor: 2046, next_cursor: 2049, chunk: '中' });
    expect(await call('observation.read', { ref, max_bytes: 1 })).toMatchObject({ outcome: 'failure' });
    expect(await call('observation.read', { ref, cursor: 999 })).toMatchObject({ outcome: 'failure' });
    expect(await call('observation.read', { ref: 'observation_00000000-0000-0000-0000-000000000000' })).toMatchObject({ outcome: 'failure' });
    expect(await call('observation.read', { ref, max_bytes: 3 })).toMatchObject({ cursor: 2049, next_cursor: 2052, chunk: '中' });
    expect(await call('observation.read', { ref: second.observation_ref, max_bytes: 3 })).toMatchObject({ cursor: 2046, next_cursor: 2049 });
    expect(await call('observation.read', { ref, mode: 'start', max_bytes: 3 })).toMatchObject({ cursor: 0, next_cursor: 3 });
    expect(await call('observation.read', { ref, max_bytes: 3 })).toMatchObject({ cursor: 3, next_cursor: 6 });
    await call('observation.read', { ref });
    expect(await call('observation.read', { ref })).toMatchObject({ eof: true, next_cursor: body.length });
    expect(await call('observation.read', { ref })).toMatchObject({ outcome: 'failure', error: expect.stringContaining('eof') });
    const messages = [
      { info: { sessionID: 'ses_cursor', role: 'user' }, parts: [{ type: 'text', text: 'target' }, { type: 'file', url: 'local:opaque' }] },
      { info: { sessionID: 'ses_cursor', role: 'assistant' }, parts: [{ type: 'text', text: 'old中' }] },
      { info: { sessionID: 'ses_cursor', role: 'assistant' }, parts: [{ type: 'reasoning', text: 'recent' }] },
      { info: { sessionID: 'ses_cursor', role: 'assistant' }, parts: [{ type: 'text', text: 'next step' }] }
    ];
    const original = JSON.stringify(messages);
    await task.control('ses_cursor', 'model.input', messages);
    await task.control('ses_cursor', 'model.system', ['authorized target only']);
    await task.control('ses_cursor', 'model.call', { model: 'local-test' });
    const event = state.events().at(-1) as any;
    const measurement = event.data.context_measurement;
    expect(measurement.categories.history_candidate.bytes).toBe(Buffer.byteLength(JSON.stringify(messages[1]!.parts[0])));
    expect(measurement.categories.unclassified.parts).toBe(1);
    expect(measurement.categories.working_set.parts).toBe(3);
    expect(JSON.stringify(messages)).toBe(original);
    expect(JSON.stringify(measurement)).not.toContain('old中');
    await expect(task.control('ses_cursor', 'model.input', [{ info: { sessionID: 'ses_foreign' }, parts: [] }])).rejects.toThrow('foreign');
    await expect(task.control('ses_cursor', 'model.system', ['test-control-secret'])).rejects.toThrow('control secret');
    expect(JSON.stringify(state.events())).not.toContain('test-control-secret');
    expect(task.finish().provider_usage).toMatchObject({ availability: 'unavailable', input_tokens: null, messages: [] });

  } finally { await runtime.dispose(); state.close(); await rm(root, { recursive: true, force: true }); }
});

it('persists a candidate substring from HTTP evidence when no verifier is configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-candidate-'));
  const state = new StateStore(join(root, 'state'), 'run_candidate');
  const artifacts = new ArtifactStore(join(root, 'artifacts'));
  const runtime = new ToolRuntime(artifacts, join(root, 'workspaces'), 'run_candidate', 'challenge_candidate', 'http://localhost');
  try {
    const deadline = new Date(Date.now() + 30000).toISOString();
    const registry = new ResponsibilityRegistry({ verifyArtifact: async ref => { await artifacts.verify(ref); return true; } });
    registry.createTask({ run_id: 'run_candidate', challenge_id: 'challenge_candidate', task_id: 'task_solver', attempt_id: 'attempt_candidate',
      responsibility_set: ['domain_solver'], lease: { lease_id: 'lease_candidate', expires_at: deadline } });
    registry.bindSession({ session_id: 'ses_candidate', task_id: 'task_solver', context: registry.createReasoningContext() });
    const httpSessionID = await runtime.openHttpSession();
    const body = Buffer.from('<main>Found flag{substring-evidence}</main>');
    vi.spyOn(runtime, 'httpRequest').mockImplementation(async () => ({ status: 200, contentType: 'text/html', location: null, body,
      setCookieNames: [], cookieNamesSent: [], artifact: await artifacts.publish(body) }));
    const task = new OpenCodeTask({ state, artifacts, runtime, registry, sessionID: 'ses_candidate', deadline, httpSessionID,
      budget: { wallClockMs: 30000, maxSteps: 100, maxToolJobs: 20, maxObservableTokens: 20000 },
      controller: new AbortController(), secrets: [], resolveCandidate: async () => { throw new Error('unused'); } });
    await task.tool('http.request', { url: 'http://localhost/' });
    await expect(task.tool('candidate.register', { value: 'flag{substring-evidence}' })).resolves.toMatchObject({
      status: 'inconclusive', authoritative: false, detail: expect.stringContaining('no independent verifier')
    });
    const candidateEvents = state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'candidate');
    expect(candidateEvents).toHaveLength(2);
    expect(candidateEvents.at(-1)).toMatchObject({ data: { status: 'inconclusive', authoritative: false,
      resolution: { status: 'inconclusive', authoritative: false } } });
    expect(await artifacts.read((candidateEvents.at(-1) as any).data.candidate.value_ref)).toEqual(Buffer.from('flag{substring-evidence}'));
  } finally { await runtime.dispose(); state.close(); await rm(root, { recursive: true, force: true }); }
});
