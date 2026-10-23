import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { CookieJar, createHttpTools } from '../../apps/launcher/src/http-tools.js';
import { StateStore } from '../../packages/state/src/index.js';
import { PlatformService } from '../../packages/platform/src/index.js';
import { prepareRun } from '../../apps/launcher/src/run-prep.js';
import { createProtectedHost, type Descriptor } from '../support/g-protected-host.js';

const cleanups: Array<() => Promise<void> | void> = [];
const traces: unknown[] = [];
const evidence = process.env.G_PROTECTED_EVIDENCE;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'gdec-protected-operations-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  let timerStarts = 0, hints = 0, observations = 0, connections = 0;
  let onHint: (() => void) | undefined;
  let disconnect = false, malformed = false;
  const requests: unknown[] = [];
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://fixture').pathname;
    requests.push({ sequence: requests.length + 1, method: req.method, path, at: new Date().toISOString() });
    if (path === '/timer') { timerStarts++; res.end(JSON.stringify({ outcome: 'accepted' })); }
    else if (path === '/hint' || path === '/hint-alias') {
      hints++; onHint?.();
      // The effect has happened, but no response is delivered.
      if (disconnect) req.socket.destroy();
      else res.end(JSON.stringify(malformed ? { ok: true } : { outcome: 'rejected' }));
    } else if (path === '/observe') { observations++; res.end(JSON.stringify({ observations })); }
    else if (path === '/redirect') { res.writeHead(302, { location: '/timer' }); res.end(); }
    else { res.statusCode = 404; res.end('{}'); }
  });
  server.on('connection', () => { connections++; });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  cleanups.push(() => new Promise<void>(done => { server.closeAllConnections(); server.close(() => done()); }));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  traces.push({ case: expect.getState().currentTestName, origin, requests });
  const state = new StateStore(root, 'run-protected');
  cleanups.push(() => state.close());
  const descriptors: Descriptor[] = [
    { id: 'timer.start', effect: 'protected', scope: 'timer', method: 'GET', path: '/timer', maxSends: 1 },
    { id: 'hint.use', effect: 'protected', scope: 'hint', method: 'POST', path: '/hint', maxSends: 1 },
    { id: 'hint.alias', effect: 'protected', scope: 'hint', method: 'POST', path: '/hint-alias', maxSends: 1 },
    { id: 'observe', effect: 'observation', scope: 'observation', method: 'POST', path: '/observe' },
    { id: 'redirect', effect: 'observation', scope: 'redirect', method: 'GET', path: '/redirect' },
  ];
  const source = join(root, 'host-adapter.json');
  await writeFile(source, JSON.stringify(descriptors));
  const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
  const transport = createHttpTools({ target: origin, jar: new CookieJar(), workDir: root });
  let call = 0;
  const raw = (args: Record<string, unknown>) => transport.request(args, {
    run: 'run-protected', sessionID: 'solver', callID: `call-${++call}`,
    signal: new AbortController().signal, deadline: Date.now() + 3000,
  });
  const makeHost = (store = state) => createProtectedHost({ source, sourceHash, state: store, origin, raw, challenge: 'c1' });
  return { root, origin, state, descriptors, source, sourceHash, raw, makeHost,
    onHint: (fn: () => void) => { onHint = fn; },
    disconnectHint: () => { disconnect = true; },
    malformedHint: () => { malformed = true; },
    counts: () => ({ timerStarts, hints, observations, connections }) };
}

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  if (evidence) await writeFile(join(evidence, 'fixture-trace.json'), JSON.stringify(traces, null, 2) + '\n');
});

describe('G protected operations: local host/adapter decision probe', () => {
  it('raw G permits GET with an effect and POST without one; method is not a classifier', async () => {
    const f = await setup();
    await f.raw({ url: `${f.origin}/timer`, method: 'GET', effect: 'safe' });
    await f.raw({ url: `${f.origin}/observe`, method: 'POST' });
    expect(f.counts()).toMatchObject({ timerStarts: 1, hints: 0, observations: 1 });
    traces.push({ case: 'method-counterexample', counts: f.counts() });
  });

  it('persists host-bound intent before the server sees a protected request, and distinguishes business rejection', async () => {
    const f = await setup(); const host = await f.makeHost();
    let durable: unknown;
    f.onHint(() => {
      const reader = new StateStore(f.root, 'run-protected');
      durable = reader.effectsFor().map(e => ({ state: e.state, payload: e.payload })); reader.close();
    });
    const result = await host.execute('hint.use', {});
    expect(result).toMatchObject({ transport: 'response', business: 'rejected' });
    expect(durable).toEqual([expect.objectContaining({ state: 'dispatching', payload: expect.objectContaining({ sourceHash: f.sourceHash, operation: 'hint.use' }) })]);
    expect(f.state.effectsFor()[0]).toMatchObject({ state: 'confirmed', businessOutcome: 'rejected' });
    await expect(host.execute('hint.alias', {})).rejects.toThrow(/limit/);
    expect(f.counts().hints).toBe(1);
    traces.push({ case: 'intent-before-send', durable, result, counts: f.counts() });
  });

  it('after effect then disconnect, blocks same effect aliases across restart but ordinary observation and other scopes remain usable', async () => {
    const f = await setup(); const host = await f.makeHost();
    f.disconnectHint();
    const result = await host.execute('hint.use', {});
    expect(result).toMatchObject({ transport: 'unknown', business: 'unknown' });
    const reopened = new StateStore(f.root, 'run-protected'); cleanups.push(() => reopened.close());
    const resumed = await f.makeHost(reopened);
    await expect(resumed.execute('hint.use', {})).rejects.toThrow(/unknown/);
    await expect(resumed.execute('hint.alias', {})).rejects.toThrow(/unknown/);
    await expect(resumed.request({ url: `${f.origin}/observe`, method: 'POST' })).resolves.toMatchObject({ status: 200 });
    await expect(resumed.execute('timer.start', {})).resolves.toMatchObject({ business: 'accepted' });
    expect(f.counts()).toMatchObject({ hints: 1, observations: 1, timerStarts: 1 });
    expect(f.state.effectsFor().find(e => e.operation === 'hint')).toMatchObject({ state: 'unknown' });
    traces.push({ case: 'disconnect-unknown', result, effects: f.state.effectsFor(), counts: f.counts() });
  });

  it('rejects concurrent protected aliases before a second network send', async () => {
    const f = await setup(); const host = await f.makeHost();
    const results = await Promise.allSettled([host.execute('hint.use', {}), host.execute('hint.alias', {})]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(f.counts().hints).toBe(1);
  });

  it('does not treat an HTTP 200 without an adapter business receipt as confirmation', async () => {
    const f = await setup(); const host = await f.makeHost(); f.malformedHint();
    const result = await host.execute('hint.use', {});
    expect(result).toMatchObject({ transport: 'response', httpStatus: 200, business: 'unknown' });
    expect(f.state.effectsFor()[0]?.state).toBe('unknown');
    await expect(host.execute('hint.alias', {})).rejects.toThrow(/unknown/);
    expect(f.counts().hints).toBe(1);
    traces.push({ case: '200-not-business-receipt', result, counts: f.counts() });
  });

  it('refuses model safety claims, direct protected routes, alternate selectors and redirect bypass before protected send', async () => {
    const f = await setup(); const host = await f.makeHost();
    for (const args of [
      { url: `${f.origin}/timer`, method: 'GET', effect: 'observation', trusted: true },
      { url: `${f.origin}/observe?start=1`, method: 'POST' },
      { url: `${f.origin}/observe`, method: 'POST', headers: { Host: 'platform.internal' } },
      { url: `${f.origin}/observe`, method: 'GET' },
      { url: `${f.origin}/unknown`, method: 'GET' },
      { url: `${f.origin}/redirect`, follow_redirects: true },
    ]) await expect(host.request(args)).rejects.toThrow(/protected|unclassified|selector/);
    expect(f.counts()).toMatchObject({ timerStarts: 0, hints: 0, observations: 0 });
    await expect(host.request({ url: `${f.origin}/observe`, method: 'POST', effect: 'protected' })).resolves.toMatchObject({ status: 200 });
    traces.push({ case: 'generic-no-bypass', counts: f.counts() });
  });

  it('rejects adapter source hash mismatch without sending, rather than trusting a material/model descriptor', async () => {
    const f = await setup();
    await writeFile(f.source, JSON.stringify([{ ...f.descriptors[0], effect: 'observation' }]));
    await expect(f.makeHost()).rejects.toThrow(/source/);
    expect(f.counts().connections).toBe(0);
  });

  it('cannot send if intent persistence fails', async () => {
    const f = await setup(); const host = await f.makeHost();
    f.state.close(); cleanups.pop();
    await expect(host.execute('hint.use', {})).rejects.toThrow();
    expect(f.counts().connections).toBe(0);
  });

  it('treats crash-left dispatching as unresolved, without blindly replaying', async () => {
    const f = await setup();
    f.state.prepareEffect({ id: 'crash', runId: 'run-protected', operation: 'hint', kind: 'protected_effect', payload: {}, challengeId: 'c1', generation: 1,
      budget: { wallClockMs: 1000, maxSteps: 1, maxToolJobs: 1, maxObservableTokens: 1 }, deadline: new Date().toISOString(), expectedPostcondition: 'response' });
    f.state.dispatchEffect('crash');
    const host = await f.makeHost();
    await expect(host.execute('hint.alias', {})).rejects.toThrow(/unknown/);
    expect(f.counts().hints).toBe(0);
    await expect(host.request({ url: `${f.origin}/observe`, method: 'POST' })).resolves.toMatchObject({ status: 200 });
  });

  it('E TCP reachability connects even without HTTP: connect-triggered timers need upstream policy', async () => {
    const f = await setup();
    const config = join(f.root, 'input-challenges.json');
    await writeFile(config, JSON.stringify({ challenges: [{ id: 'c', target: { protocol: 'http', url: f.origin } }] }));
    const prepared = await prepareRun({ challengesPath: config, workspace: join(f.root, 'workspace'), evidence: f.root, secrets: [] });
    const result = prepared[0]!.reachability;
    expect(result?.reachable).toBe(true);
    expect(f.counts()).toMatchObject({ connections: 1, timerStarts: 0, observations: 0 });
    traces.push({ case: 'E-connect', counts: f.counts(), result });
  });

  it('legacy PlatformService can resend with a fresh generation after unknown: it is not the new D contract', async () => {
    const f = await setup(); f.disconnectHint();
    const legacy = new PlatformService(f.state, { name: 'local_oracle', submit: async () => {
      await f.raw({ url: `${f.origin}/hint`, method: 'POST' });
      return { authoritative: true, status: 'accepted', requiredSlots: 1 };
    } });
    const intent = { intent: 'candidate.submit', candidate: 'fixture-candidate', challengeId: 'c1', task: 't1', lease: 'l1' };
    await expect(legacy.executeIntent({ runId: 'run-protected', intent, actor: 'coordinator' })).rejects.toThrow();
    expect(f.state.isScopeUnknown('candidate.submit', 'c1')).toBe(true);
    await expect(legacy.executeIntent({ runId: 'run-protected', intent, actor: 'coordinator', generation: 2 })).rejects.toThrow();
    expect(f.counts().hints).toBe(2);
    traces.push({ case: 'legacy-does-not-enforce-unknown', effects: f.state.effectsFor(), counts: f.counts() });
  });
});
