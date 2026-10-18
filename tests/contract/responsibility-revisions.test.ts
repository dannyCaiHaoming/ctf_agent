import { describe, expect, it, vi } from 'vitest';
import { PublishedRevisionService } from '../../packages/supervisor/src/index.js';

const artifact = (letter: string) => ({ hash: letter.repeat(64), size: 1, path: `/artifacts/${letter}` });
function setup() {
  const verifyArtifact = vi.fn(async () => true as const);
  const revisions = new PublishedRevisionService({ verifyArtifact });
  return { revisions, verifyArtifact };
}

describe('adopted publication revision invalidation', () => {
  it('keeps candidates valid across unrelated workspace edits and unadopted publications', async () => {
    const { revisions } = setup();
    const recon = await revisions.publish({ output_id: 'recon', artifact: artifact('a'), dependency_versions: [] });
    revisions.adopt(recon.publication_id);
    const candidate = await revisions.publish({ output_id: 'candidate', artifact: artifact('b'), dependency_versions: [{ output_id: 'recon', revision: recon.revision }] });
    revisions.adopt(candidate.publication_id);
    // Mutable workspace state is not an input of the publication/adoption service.
    const workspace = { log: 'old', comment: 'old' };
    workspace.log = 'a temporary observation'; workspace.comment = 'an unpublished edit';
    await revisions.publish({ output_id: 'recon', artifact: artifact('c'), dependency_versions: [] });
    const unrelated = await revisions.publish({ output_id: 'unrelated', artifact: artifact('d'), dependency_versions: [] });
    revisions.adopt(unrelated.publication_id);
    expect(revisions.current('candidate')).toMatchObject({ revision: candidate.revision, valid: true });
    expect(revisions.current('recon')).toMatchObject({ revision: recon.revision, valid: true });
  });
  it('invalidates only direct and transitive adopted dependents when a new output is adopted', async () => {
    const { revisions } = setup();
    const recon = await revisions.publish({ output_id: 'recon', artifact: artifact('a'), dependency_versions: [] }); revisions.adopt(recon.publication_id);
    const candidate = await revisions.publish({ output_id: 'candidate', artifact: artifact('b'), dependency_versions: [{ output_id: 'recon', revision: recon.revision }] }); revisions.adopt(candidate.publication_id);
    const verification = await revisions.publish({ output_id: 'verification', artifact: artifact('c'), dependency_versions: [{ output_id: 'candidate', revision: candidate.revision }] }); revisions.adopt(verification.publication_id);
    const other = await revisions.publish({ output_id: 'other', artifact: artifact('d'), dependency_versions: [] }); revisions.adopt(other.publication_id);
    const next = await revisions.publish({ output_id: 'recon', artifact: artifact('e'), dependency_versions: [] });
    expect(revisions.adopt(next.publication_id).invalidated_output_ids).toEqual(['candidate', 'verification']);
    expect(revisions.current('candidate')?.valid).toBe(false);
    expect(revisions.current('verification')?.valid).toBe(false);
    expect(revisions.current('other')?.valid).toBe(true);
  });
  it('treats identical content and dependencies as a no-op, but changed dependencies as a revision', async () => {
    const { revisions } = setup();
    const dependency = await revisions.publish({ output_id: 'dependency', artifact: artifact('a'), dependency_versions: [] }); revisions.adopt(dependency.publication_id);
    const original = await revisions.publish({ output_id: 'mechanism', artifact: artifact('b'), dependency_versions: [] }); revisions.adopt(original.publication_id);
    const downstream = await revisions.publish({ output_id: 'candidate', artifact: artifact('c'), dependency_versions: [{ output_id: 'mechanism', revision: original.revision }] }); revisions.adopt(downstream.publication_id);
    const identical = await revisions.publish({ output_id: 'mechanism', artifact: artifact('b'), dependency_versions: [] });
    expect(revisions.adopt(identical.publication_id).invalidated_output_ids).toEqual([]);
    expect(revisions.current('mechanism')?.revision).toBe(original.revision);
    const changed = await revisions.publish({ output_id: 'mechanism', artifact: artifact('b'), dependency_versions: [{ output_id: 'dependency', revision: dependency.revision }] });
    expect(revisions.adopt(changed.publication_id).invalidated_output_ids).toEqual(['candidate']);
  });
  it('rejects unpublished refs, forged publications, stale dependencies and invalidated dependencies', async () => {
    const { revisions, verifyArtifact } = setup();
    verifyArtifact.mockRejectedValueOnce(new Error('artifact not published'));
    await expect(revisions.publish({ output_id: 'bad', artifact: artifact('a'), dependency_versions: [] })).rejects.toThrow(/not published/);
    expect(() => revisions.adopt('forged')).toThrow(/publication/);
    const root = await revisions.publish({ output_id: 'root', artifact: artifact('a'), dependency_versions: [] }); revisions.adopt(root.publication_id);
    const pending = await revisions.publish({ output_id: 'pending', artifact: artifact('b'), dependency_versions: [{ output_id: 'root', revision: root.revision }] });
    const next = await revisions.publish({ output_id: 'root', artifact: artifact('c'), dependency_versions: [] }); revisions.adopt(next.publication_id);
    expect(() => revisions.adopt(pending.publication_id)).toThrow(/dependency/);
    await expect(revisions.publish({ output_id: 'bad', artifact: { ...artifact('a'), hash: 'wrong' }, dependency_versions: [] })).rejects.toThrow();
  });
  it('refuses adopting an output that depends on an invalidated transitive revision', async () => {
    const { revisions } = setup();
    const root = await revisions.publish({ output_id: 'root', artifact: artifact('a'), dependency_versions: [] }); revisions.adopt(root.publication_id);
    const child = await revisions.publish({ output_id: 'child', artifact: artifact('b'), dependency_versions: [{ output_id: 'root', revision: root.revision }] }); revisions.adopt(child.publication_id);
    const pending = await revisions.publish({ output_id: 'pending', artifact: artifact('c'), dependency_versions: [{ output_id: 'child', revision: child.revision }] });
    const next = await revisions.publish({ output_id: 'root', artifact: artifact('d'), dependency_versions: [] }); revisions.adopt(next.publication_id);
    expect(() => revisions.adopt(pending.publication_id)).toThrow(/dependency/);
    expect(() => revisions.adopt(root.publication_id)).toThrow(/newer/);
    const repaired = await revisions.publish({ output_id: 'child', artifact: artifact('b'), dependency_versions: [{ output_id: 'root', revision: next.revision }] });
    expect(revisions.adopt(repaired.publication_id).current.valid).toBe(true);
    expect(revisions.current('root')?.revision).toBe(next.revision);
  });
  it('rejects cycles and cannot be modified through input or result aliases', async () => {
    const { revisions } = setup();
    const input = { output_id: 'root', artifact: artifact('a'), dependency_versions: [] as Array<{ output_id: string; revision: number }> };
    const root = await revisions.publish(input); revisions.adopt(root.publication_id);
    input.artifact.hash = 'b'.repeat(64);
    expect(revisions.current('root')?.artifact.hash).toBe('a'.repeat(64));
    expect(() => Object.assign(root, { output_id: 'forged' })).toThrow();
    expect(() => Object.assign(revisions.current('root')!.artifact, { hash: 'forged' })).toThrow();
    const child = await revisions.publish({ output_id: 'child', artifact: artifact('b'), dependency_versions: [{ output_id: 'root', revision: root.revision }] }); revisions.adopt(child.publication_id);
    const cyclic = await revisions.publish({ output_id: 'root', artifact: artifact('c'), dependency_versions: [{ output_id: 'child', revision: child.revision }] });
    expect(() => revisions.adopt(cyclic.publication_id)).toThrow(/cycle/);
  });
});
