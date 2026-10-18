import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../packages/artifacts/src/index.js';
import { ResponsibilityRegistry, PublishedRevisionService } from '../../packages/supervisor/src/index.js';

// Test the trust seam with actual published bytes, not an always-true callback.
describe('responsibility immutable artifact boundary', () => {
  it('accepts published bytes and refuses tampered bytes in every reference location', async () => {
    const root = await mkdtemp(join(tmpdir(), 'responsibility-artifacts-'));
    try {
      const artifacts = new ArtifactStore(root);
      const ref = await artifacts.publish(Buffer.from('raw observation'));
      const verifyArtifact = (value: typeof ref) => artifacts.verify(value);
      const registry = new ResponsibilityRegistry({ verifyArtifact });
      registry.createTask({ run_id: 'run', challenge_id: 'challenge', task_id: 'solver', attempt_id: 'attempt', responsibility_set: ['domain_solver'], lease: { lease_id: 'lease', expires_at: '2030-01-01T00:00:00.000Z' } });
      registry.bindSession({ session_id: 'session', task_id: 'solver', context: registry.createReasoningContext() });
      const host = { session_id: 'session', lease_id: 'lease' };
      const payload = { responsibility: 'domain_solver', revision: 0, consumed_snapshot_sequence: 0, input_refs: [], dependency_versions: [], status: 'completed', outputs: [], observation_refs: [], evidence_refs: [], assumptions: [], rejected_assumptions: [], unresolved_questions: [], next_action: 'Replay', failure_code: null, actual_cost: { wall_clock_ms: 0, model_calls: 0, tool_jobs: 0, observable_tokens: 0, monetary_cost: 0 } };
      await expect(registry.submit(host, { ...payload, observation_refs: [ref] })).resolves.toMatchObject({ task_id: 'solver' });
      const revisions = new PublishedRevisionService({ verifyArtifact });
      const published = await revisions.publish({ output_id: 'observation', artifact: ref, dependency_versions: [] });
      expect(revisions.adopt(published.publication_id).current.valid).toBe(true);
      await writeFile(ref.path, 'bad observation'); // same byte length, different content
      const locations = [
        { input_refs: [ref] }, { observation_refs: [ref] }, { evidence_refs: [ref] },
        { outputs: [{ kind: 'artifact', name: 'script', ref }] },
        { outputs: [{ kind: 'decision', statement: 'Replay', basis_refs: [ref] }] },
        { assumptions: [{ statement: 'Input decoded once', basis_refs: [ref] }] },
        { rejected_assumptions: [{ statement: 'Input decoded twice', reason: 'Probe', basis_refs: [ref] }] }
      ];
      for (const location of locations) {
        await expect(registry.submit(host, { ...payload, ...location })).rejects.toThrow(/hash mismatch/);
      }
      await expect(revisions.publish({ output_id: 'corrupt', artifact: ref, dependency_versions: [] })).rejects.toThrow(/hash mismatch/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
