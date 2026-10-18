import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { ToolRuntime } from '@ctf/runtime';
import { WebMethod, type WebCapture } from '../../packages/supervisor/src/domain-web.js';
import { DomainCandidateRegistry } from '../../packages/supervisor/src/domain-candidates.js';
import { startGreetingFixture } from '../../fixtures/challenges/web/server.js';
import { puzzleOracle } from '../../fixtures/challenges/web/oracle.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function setup() {
  const fixture = await startGreetingFixture(); cleanups.push(fixture.close);
  const root = await mkdtemp(join(tmpdir(), 'domain-web-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const store = new ArtifactStore(join(root, 'artifacts'));
  const runtime = new ToolRuntime(store, join(root, 'workspace'), 'domain-run', 'web-puzzle', fixture.url);
  const session = await runtime.openHttpSession();
  const method = new WebMethod(store, async request => {
    const result = await runtime.httpRequest(session, request.url, { method: request.method, headers: request.headers, redirect: 'manual' });
    return { status: result.status, body: result.body, effectiveUrl: request.url };
  });
  const capture = (path: string) => method.capture({ url: fixture.url + path, method: 'GET', headers: { 'x-fixture-session': 'ordinary-reader' } });
  return { store, method, capture, url: fixture.url };
}

describe('ordinary HTTP baseline and controlled benign changes', () => {
  it('compares one greeting parameter using real managed localhost requests and a separate oracle', async () => {
    const { method, store, capture } = await setup();
    const normal = await capture('/greet?name=world');
    const login = await capture('/login');
    const error = await capture('/error');
    const baseline = await method.establishBaseline({ normal, login, error });
    expect(baseline.valid).toBe(true);
    const changed = await capture('/greet?name=reader');
    const pair = await method.compare(baseline, changed);
    expect(pair.classification).toBe('controlled_difference');
    expect(pair.changedVariables).toEqual(['query:name']);
    expect(pair.vulnerabilityClaim).toBe(false);
    const transcript = JSON.parse((await store.read(pair.transcriptRef)).toString());
    expect(transcript.normal.responseRef).toEqual(normal.responseRef);
    expect(transcript.variant.responseRef).toEqual(changed.responseRef);
    const value = (await store.read(changed.responseRef)).toString('utf8');
    const registration = await new DomainCandidateRegistry(store).register({ value, format: /^puzzle\{hello_[a-z]+\}$/, minBytes: 12, maxBytes: 64, evidenceRefs: [pair.transcriptRef, changed.responseRef] });
    expect(await puzzleOracle.submit(registration.value)).toMatchObject({ authoritative: true, status: 'accepted' });
  });

  it('excludes login, unified error and redirect baselines; a single 500/reflection is never a vulnerability', async () => {
    const { method, capture } = await setup();
    const login = await capture('/login');
    const error = await capture('/error');
    const normal = await capture('/greet?name=world');
    expect((await method.establishBaseline({ normal: login, login, error })).reason).toBe('login_page');
    expect((await method.establishBaseline({ normal: error, login, error })).reason).toBe('unified_error');
    expect((await method.establishBaseline({ normal: await capture('/redirect'), login, error })).reason).toBe('redirect');
    const baseline = await method.establishBaseline({ normal, login, error });
    expect((await method.compare(baseline, await capture('/greet?name=error'))).classification).toBe('unified_error');
    expect((await method.compare(baseline, await capture('/greet?name=login'))).classification).toBe('login_page');
    const failure = await method.compare(baseline, await capture('/greet?name=broken'));
    expect(failure.classification).toBe('server_error');
    expect(failure.vulnerabilityClaim).toBe(false);
    const reflected = await method.compare(baseline, await capture('/greet?name=reader'));
    expect(reflected.vulnerabilityClaim).toBe(false);
    await expect(method.compare(baseline, await capture('/greet?name=reader&extra=yes'))).rejects.toThrow('one variable');
  });

  it('requires same session/context and retains client rewrite exclusion as explicit capture provenance', async () => {
    const { method, capture, url, store } = await setup();
    const normal = await capture('/greet?name=world');
    const login = await capture('/login'); const error = await capture('/error');
    const dom = await store.publish(Buffer.from('synthetic rendered URL observation'));
    const rewritten: WebCapture = { ...normal, clientPage: { url: url + '/login', evidenceRef: dom } };
    expect((await method.establishBaseline({ normal: rewritten, login, error })).reason).toBe('client_rewrite');
    // This is supplied synthetic browser provenance, not a claim that a browser was run.
    const baseline = await method.establishBaseline({ normal, login, error });
    const otherSession = await method.capture({ url: url + '/greet?name=reader', method: 'GET', headers: { 'x-fixture-session': 'other-reader' } });
    await expect(method.compare(baseline, otherSession)).rejects.toThrow('one variable');
    const changed = await capture('/greet?name=reader');
    await expect(method.compare(baseline, { ...changed, status: 2000 })).rejects.toThrow('retained transcript');
  });

  it('builds a source/DOM/API input-effect hypothesis from immutable controls without calling it a vulnerability', async () => {
    const { method, capture, store } = await setup();
    const normal = await capture('/greet?name=world');
    const login = await capture('/login'); const error = await capture('/error');
    const baseline = await method.establishBaseline({ normal, login, error });
    const variant = await capture('/greet?name=reader');
    const sourceRef = await store.publish(Buffer.from('const name = request.query.name; renderGreeting(name);'));
    const domRef = await store.publish(Buffer.from('<main><span>Hello reader</span></main>'));
    const hypothesis = await method.inputEffectHypothesis({ baseline, variant, sourceRef, domRef, inputName: 'name', inputValue: 'reader' });
    expect(hypothesis).toMatchObject({ status: 'supported', inputName: 'name', inputValue: 'reader', vulnerabilityClaim: false });
    expect(hypothesis.evidenceRefs.map(ref => ref.hash)).toEqual(expect.arrayContaining([sourceRef.hash, domRef.hash, variant.requestRef.hash, variant.responseRef.hash]));
    expect(hypothesis.alternativeExplanations.length).toBeGreaterThan(0);

    const unrelatedDom = await store.publish(Buffer.from('<main><span>Hello world</span></main>'));
    const inconclusive = await method.inputEffectHypothesis({ baseline, variant, sourceRef, domRef: unrelatedDom, inputName: 'name', inputValue: 'reader' });
    expect(inconclusive.status).toBe('inconclusive');
  });
});
