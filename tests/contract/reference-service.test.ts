import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReferenceHost, inspectReferenceSnapshot, createReferenceTools } from '../../packages/reference/src/index.js';

const fixture = fileURLToPath(new URL('../../fixtures/reference-snapshot', import.meta.url));
const hosts: ReferenceHost[] = [];
function setup(root = fixture) {
  const host = new ReferenceHost(); hosts.push(host);
  const snapshot = inspectReferenceSnapshot(root);
  const approval = { kind: 'fixture-only' as const, snapshotDigest: snapshot.digest, reviewer: 'deterministic-test-fixture', reviewedAt: '2026-10-18T00:00:00Z' };
  return { host, snapshot, approval, service: host.open({ runId: 'run_reference', root, mode: 'fixture', approval }) };
}
afterEach(() => { hosts.splice(0).forEach(host => host.close()); vi.restoreAllMocks(); });

describe('offline reference service', () => {
  it('indexes actual FTS5/BM25 and returns bounded original quotations and provenance', () => {
    const { service, snapshot } = setup();
    const hits = service.search({ query: 'observation fingerprint', limit: 2 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(2);
    expect(hits[0]?.id).toBe('observation-fingerprint');
    expect(hits[0]?.rank).toBeLessThan(0);
    for (const hit of hits) {
      expect(hit).toMatchObject({ namespace: 'approved', snapshotDigest: snapshot.digest, dataOnly: true });
      expect(hit.source.version).toBeTruthy();
      expect(hit.source.title).toBeTruthy();
      expect(hit.source.license).toBeTruthy();
      expect(hit.applicability).not.toHaveLength(0);
      expect(readFileSync(join(fixture, hit.source.path), 'utf8')).toContain(hit.quote);
      expect(hit.quote.length).toBeLessThanOrEqual(1200);
      expect(service.get({ id: hit.id })).toMatchObject({ quote: hit.quote, source: hit.source });
    }
    expect(service.search({ query: 'zzzznoresult' })).toEqual([]);
    expect(service.get({ id: 'missing' })).toBeNull();
  });

  it('rejects candidate, absent, wrong-digest and fixture-only production approval', () => {
    const host = new ReferenceHost(); hosts.push(host);
    const snapshot = inspectReferenceSnapshot(fixture);
    expect(() => host.open({ runId: 'r1', root: fixture, mode: 'production' })).toThrow(/approval/i);
    const fixtureApproval = { kind: 'fixture-only' as const, snapshotDigest: snapshot.digest, reviewer: 'test', reviewedAt: '2026-10-18T00:00:00Z' };
    expect(() => host.open({ runId: 'r1', root: fixture, mode: 'production', approval: fixtureApproval })).toThrow(/fixture/i);
    expect(() => host.open({ runId: 'r1', root: fixture, mode: 'fixture', approval: { ...fixtureApproval, snapshotDigest: '0'.repeat(64) } })).toThrow(/digest/i);
    // Synthetic host testimony exercises the API; it does not approve the checked-in candidate.
    expect(host.open({ runId: 'synthetic', root: fixture, mode: 'production', approval: { ...fixtureApproval, kind: 'human', reviewer: 'synthetic-test-only' } }).identity.approvalKind).toBe('human');
  });

  it('rejects missing provenance, tampered source and non-approved namespaces', () => {
    for (const mutation of ['source', 'namespace', 'quote', 'path']) {
      const root = mkdtempSync(join(tmpdir(), 'reference-invalid-')); cpSync(fixture, root, { recursive: true });
      const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
      if (mutation === 'source') delete manifest.sources[0].version;
      if (mutation === 'namespace') manifest.namespace = 'candidate_knowledge/run';
      if (mutation === 'quote') manifest.chunks[0].quote = 'invented quotation';
      if (mutation === 'path') manifest.sources[0].path = '../outside.md';
      writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
      expect(() => inspectReferenceSnapshot(root)).toThrow();
    }
    const root = mkdtempSync(join(tmpdir(), 'reference-tamper-')); cpSync(fixture, root, { recursive: true });
    writeFileSync(join(root, 'sources/recipes.md'), 'tampered');
    expect(() => inspectReferenceSnapshot(root)).toThrow(/hash/i);
  });

  it('pins snapshot for a run across reopen and rejects replacement after source updates', () => {
    const root = mkdtempSync(join(tmpdir(), 'reference-pinned-')); cpSync(fixture, root, { recursive: true });
    const { service, host, approval } = setup(root);
    const before = service.get({ id: 'observation-fingerprint' });
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
    manifest.version = 'next'; writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
    expect(service.get({ id: 'observation-fingerprint' })).toEqual(before);
    const changed = inspectReferenceSnapshot(root);
    expect(() => host.open({ runId: 'run_reference', root, mode: 'fixture', approval: { ...approval, snapshotDigest: changed.digest } })).toThrow(/immutable/i);
    expect(service.search({ query: 'observation' })).toHaveLength(1);
  });

  it('has strict bounded read-only tools and safely handles FTS syntax as search data', () => {
    const { service } = setup(); const tools = createReferenceTools(service);
    expect(Object.keys(tools)).toEqual(['reference.search', 'reference.get']);
    expect(tools['reference.search'].execute({ query: 'observation OR * " ; --' }).length).toBeGreaterThan(0);
    expect(() => tools['reference.search'].execute({ query: 'observation', limit: 6 })).toThrow();
    expect(() => tools['reference.search'].execute({ query: 'x'.repeat(513) })).toThrow();
    expect(() => tools['reference.get'].execute({ id: 'x', execute: 'shell' })).toThrow();
    expect(service.search({ query: '   ' })).toEqual([]);
  });

  it('performs searches offline even with every attempted network call blocked', () => {
    const network = vi.fn(() => { throw new Error('network forbidden'); });
    vi.stubGlobal('fetch', network);
    const { service } = setup();
    expect(service.search({ query: 'scope' }).length).toBeGreaterThan(0);
    expect(service.get({ id: 'scope-boundary' })).not.toBeNull();
    expect(network).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
