import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore, type ArtifactReference } from '@ctf/artifacts';
import { MiscMethod, type MiscLimits } from '../../packages/supervisor/src/domain-misc.js';
import { WebMethod } from '../../packages/supervisor/src/domain-web.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'domain-fix1-')); roots.push(root); return root; }
const limits = (): MiscLimits => ({ maxDepth: 3, maxProducts: 5, maxExpandedBytes: 1024, maxInputBytes: 1024 });
function attemptMutation(operation: () => void) {
  try { operation(); } catch (error) { if (!(error instanceof TypeError)) throw error; }
}

describe('Task5 review round 1: synthetic data-integrity regressions', () => {
  it('caller edits to ingestion and returned saved/consumed references cannot change actual lineage', async () => {
    const store = new ArtifactStore(await directory());
    const method = new MiscMethod(store, limits());
    const metadata = { source: 'ordinary-hex.txt' };
    const original = await method.ingest(Buffer.from('4142'), metadata);
    const originalOutput = { ...original.outputRef }; const originalProvenance = { ...original.provenanceRef };
    const unrelated = await store.publish(Buffer.from('4344'));
    attemptMutation(() => Object.assign(original.outputRef, unrelated));
    attemptMutation(() => Object.assign(original.provenanceRef, unrelated));
    attemptMutation(() => { original.outputRef = unrelated; });
    attemptMutation(() => { original.metadata.source = 'changed-public-metadata'; });
    metadata.source = 'changed-caller-metadata';
    const staged = await method.transform(original.id, 'hex');
    const saved = await method.save(staged.id);
    const receipt = JSON.parse((await store.read(saved.provenanceRef)).toString());
    expect((await store.read(saved.outputRef)).toString()).toBe('AB');
    expect(receipt.parentRefs).toEqual([originalOutput]);
    expect(receipt.parentProvenanceRefs).toEqual([originalProvenance]);
    expect((await store.read(receipt.parentRefs[0])).toString()).toBe('4142');
    expect(JSON.parse((await store.read(originalProvenance)).toString()).metadata.source).toBe('ordinary-hex.txt');
    attemptMutation(() => Object.assign(saved.outputRef, unrelated));
    attemptMutation(() => Object.assign(saved.provenanceRef, unrelated));
    const consumed = await method.consume(staged.id);
    const consumedOutput = { ...consumed.outputRef }; const consumedProvenance = { ...consumed.provenanceRef };
    consumed.bytes.fill(0);
    attemptMutation(() => Object.assign(consumed.outputRef, unrelated));
    attemptMutation(() => Object.assign(consumed.provenanceRef, unrelated));
    const repeated = await method.consume(staged.id);
    expect(repeated.outputRef).toEqual(consumedOutput);
    expect(repeated.provenanceRef).toEqual(consumedProvenance);
    expect(repeated.bytes.toString()).toBe('AB');
    for (const value of [original, original.metadata, original.outputRef, original.provenanceRef, saved, saved.outputRef, saved.provenanceRef, consumed, consumed.outputRef, consumed.provenanceRef]) expect(Object.isFrozen(value)).toBe(true);
  });

  it('artifact-publisher aliases cannot edit the graph private parent references', async () => {
    class CapturingStore extends ArtifactStore {
      readonly issued: ArtifactReference[] = [];
      override async publish(bytes: Uint8Array) { const ref = await super.publish(bytes); this.issued.push(ref); return ref; }
    }
    const store = new CapturingStore(await directory());
    const method = new MiscMethod(store, limits());
    const original = await method.ingest(Buffer.from('4142'), { source: 'private-ref-copy.txt' });
    const originalOutput = { ...original.outputRef }; const originalProvenance = { ...original.provenanceRef };
    const unrelated = await store.publish(Buffer.from('4344'));
    Object.assign(store.issued[0]!, unrelated); Object.assign(store.issued[1]!, unrelated);
    const staged = await method.transform(original.id, 'hex');
    const consumed = await method.consume(staged.id);
    const receipt = JSON.parse((await store.read(consumed.provenanceRef)).toString());
    expect(receipt.parentRefs).toEqual([originalOutput]);
    expect(receipt.parentProvenanceRefs).toEqual([originalProvenance]);
    expect(consumed.bytes.toString()).toBe('AB');
  });

  it.each(['maxExpandedBytes', 'maxDepth', 'maxProducts', 'maxInputBytes'] as const)('later caller edits cannot raise the original %s bound', async field => {
    const configuration = limits(); configuration[field] = 1;
    const store = new ArtifactStore(await directory());
    const method = new MiscMethod(store, configuration);
    configuration[field] = 100;
    if (field === 'maxInputBytes') {
      await expect(method.ingest(Buffer.from('4142'), { source: 'input-limit.txt' })).rejects.toThrow('input bytes limit');
    } else if (field === 'maxExpandedBytes') {
      const source = await method.ingest(Buffer.from('4142'), { source: 'byte-limit.txt' });
      await expect(method.transform(source.id, 'hex')).rejects.toThrow('expanded bytes limit');
    } else if (field === 'maxDepth') {
      const source = await method.ingest(Buffer.from('34313432'), { source: 'depth-limit.txt' });
      const first = await method.transform(source.id, 'hex');
      await expect(method.transform(first.id, 'hex')).rejects.toThrow('transform depth limit');
    } else {
      const a = await method.ingest(Buffer.from('4142'), { source: 'a.txt' });
      const b = await method.ingest(Buffer.from('4344'), { source: 'b.txt' });
      await method.transform(a.id, 'hex');
      await expect(method.transform(b.id, 'hex')).rejects.toThrow('transform product limit');
    }
  });

  it.each(['other:first', 'reader:second', 'other:second'])('rejects userinfo change %s alongside an ordinary query change', async userinfo => {
    const store = new ArtifactStore(await directory());
    // In-memory ordinary response fixture. URL credentials are synthetic; no connection occurs.
    const method = new WebMethod(store, async request => {
      const url = new URL(request.url);
      const text = url.pathname === '/login' ? '<input type="password">' : url.pathname === '/error' ? 'ordinary error' : `hello ${url.searchParams.get('name')}`;
      return { status: 200, body: Buffer.from(text), effectiveUrl: request.url };
    });
    const capture = (userinfo: string, path: string) => method.capture({ url: `http://${userinfo}@127.0.0.1:43111${path}`, method: 'GET', headers: { 'x-fixture-session': 'same-session' } });
    const normal = await capture('reader:first', '/greet?name=world');
    const login = await capture('reader:first', '/login'); const error = await capture('reader:first', '/error');
    const baseline = await method.establishBaseline({ normal, login, error });
    await expect(method.compare(baseline, await capture(userinfo, '/greet?name=reader'))).rejects.toThrow('one variable');
  });

  it('permits one benign query change when synthetic URL credentials stay exactly fixed', async () => {
    const store = new ArtifactStore(await directory());
    const method = new WebMethod(store, async request => {
      const url = new URL(request.url);
      return { status: 200, body: Buffer.from(url.pathname === '/greet' ? `hello ${url.searchParams.get('name')}` : url.pathname), effectiveUrl: request.url };
    });
    const capture = (path: string) => method.capture({ url: `http://reader:first@127.0.0.1:43111${path}`, method: 'GET' });
    const baseline = await method.establishBaseline({ normal: await capture('/greet?name=world'), login: await capture('/login'), error: await capture('/error') });
    expect(await method.compare(baseline, await capture('/greet?name=reader'))).toMatchObject({ classification: 'controlled_difference', changedVariables: ['query:name'], vulnerabilityClaim: false });
  });
});
