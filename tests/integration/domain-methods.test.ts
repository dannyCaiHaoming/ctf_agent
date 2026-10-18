import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { loadDomainSkill } from '../../packages/supervisor/src/skills/index.js';
import { DomainCandidateRegistry } from '../../packages/supervisor/src/domain-candidates.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('on-demand benign domain methods and candidate registration', () => {
  it('loads only the requested method and includes all four actionable fields', async () => {
    for (const domain of ['web', 'misc', 'crypto'] as const) {
      const skill = await loadDomainSkill(domain);
      expect(skill.domain).toBe(domain);
      for (const key of ['applicabilityClues', 'minimalExperiment', 'failureBranches', 'verification'] as const) {
        expect(skill[key].length).toBeGreaterThan(0);
        expect(skill[key].every(text => text.length > 12)).toBe(true);
      }
      expect(Object.isFrozen(skill)).toBe(true);
    }
    await expect(loadDomainSkill('unknown' as 'web')).rejects.toThrow('unsupported domain');
  });

  it('requires anchored format, exact length and intact evidence; registration never means verified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'domain-candidate-')); roots.push(root);
    const store = new ArtifactStore(root);
    const registry = new DomainCandidateRegistry(store);
    const evidence = await store.publish(Buffer.from('synthetic tool output puzzle{ten}'));
    const input = { value: 'puzzle{ten}', format: /^puzzle\{[a-z]+\}$/, minBytes: 10, maxBytes: 32, evidenceRefs: [evidence] };
    const registered = await registry.register(input);
    expect(registered.status).toBe('candidate_only');
    expect((await store.read(registered.valueRef)).toString()).toBe(input.value);
    expect(registered.evidenceRefs).toEqual([evidence]);
    await expect(registry.register({ ...input, value: input.value + '\n' })).rejects.toThrow('format');
    await expect(registry.register({ ...input, maxBytes: 10 })).rejects.toThrow('length');
    await expect(registry.register({ ...input, evidenceRefs: [] })).rejects.toThrow('evidence');
    await expect(registry.register({ ...input, format: /puzzle/ })).rejects.toThrow('anchored');
    await expect(registry.register({ ...input, evidenceRefs: [{ ...evidence, hash: '0'.repeat(64) }] })).rejects.toThrow('hash');
  });
});
