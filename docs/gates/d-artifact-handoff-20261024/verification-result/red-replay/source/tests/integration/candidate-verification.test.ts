import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { ToolRuntime } from '@ctf/runtime';
import { StateStore } from '@ctf/state';
import { Coordinator, PlatformService } from '@ctf/platform';
import { ResponsibilityRegistry, SolutionEngineeringService, IndependentVerificationService, VerifiedCoordinator,
  publishHostExecutionReceipt, type CandidateForVerification, type EngineeringPackage } from '@ctf/supervisor';
import { t5Oracle } from '../../fixtures/trajectories/t5-rejected/oracle.js';
import type { ResponsibilityTask } from '../../packages/contracts/src/index.js';

const roots: string[] = [];
const states: StateStore[] = [];
afterEach(async () => { for (const state of states.splice(0)) state.close(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'candidate-verification-')); roots.push(root);
  const artifacts = new ArtifactStore(join(root, 'artifacts'));
  const state = new StateStore(join(root, 'state'), 'verification-run'); states.push(state);
  const registry = new ResponsibilityRegistry({ verifyArtifact: async ref => { await artifacts.verify(ref); return true; } });
  const verifier = new IndependentVerificationService(artifacts, registry, { makeTask: input => ({ run_id: 'verification-run' as never,
    challenge_id: input.challengeId as never, task_id: input.taskId as never, attempt_id: input.attemptId as never,
    responsibility_set: ['verification'], lease: { lease_id: input.leaseId as never, expires_at: input.expiresAt } }) as ResponsibilityTask });
  const candidate: CandidateForVerification = { candidateId: 'candidate-5', revision: 1, value: 'puzzle{slot_b}',
    valueRef: await artifacts.publish(Buffer.from('puzzle{slot_b}')), evidenceRefs: [await artifacts.publish(Buffer.from('candidate extracted from saved output'))],
    challengeId: 't5-rejected' as never, generation: 7 };
  const scriptRef = await artifacts.publish(Buffer.from('print("puzzle{slot_b}")'));
  const inputRef = await artifacts.publish(Buffer.from('synthetic-input'));
  const engineering = await new SolutionEngineeringService(artifacts).publish(candidate, { command: ['python3', 'solve.py'], scriptRef,
    inputRefs: [inputRef], dependencyVersions: [{ output_id: 'input', revision: 2 }], extractionRule: 'read exact stdout bytes' }) as EngineeringPackage;
  return { root, artifacts, state, registry, verifier, candidate, engineering };
}
const current = { currentDependencyVersions: [{ output_id: 'input', revision: 2 }], currentGeneration: 7 };
async function executionEvidence(artifacts: ArtifactStore, engineering: EngineeringPackage, outputRef: Awaited<ReturnType<ArtifactStore['publish']>>,
  mode: 'replay' | 'recompute' = 'recompute') {
  return { executionReceiptRef: await artifacts.publish(Buffer.from(JSON.stringify({ schema: 'ctf-host-execution-receipt/v1', mode,
    jobId: 'fixture-runtime-job', status: 'completed', exitCode: 0, command: [...engineering.command], cwd: '/fixture/workspace',
    scriptRef: engineering.scriptRef, inputRefs: engineering.inputRefs, dependencyVersions: engineering.dependencyVersions,
    generation: 7, outputRef, outputStartCursor: 0, outputEndCursor: outputRef.size }))) };
}

describe('Solution Engineering and independent candidate Verification', () => {
  it('does not create Engineer/Verifier work for an absent candidate', async () => {
    const { artifacts } = await setup();
    await expect(new SolutionEngineeringService(artifacts).publish(undefined, { command: ['true'], scriptRef: await artifacts.publish(Buffer.alloc(0)),
      inputRefs: [], dependencyVersions: [], extractionRule: 'none' })).resolves.toEqual({ required: false });
  });

  it('selects recompute when replay is unsafe, binds a new verification-only session, and does not confuse oracle rejection with solved', async () => {
    const { artifacts, state, registry, verifier, candidate, engineering } = await setup();
    const outputRef = await artifacts.publish(Buffer.from(candidate.value));
    const result = await verifier.verify({ candidate, engineering, evidence: await executionEvidence(artifacts, engineering, outputRef), ...current });
    expect(result).toMatchObject({ mode: 'recompute', status: 'verified', candidateHash: candidate.valueRef.hash, solutionHash: engineering.manifestRef.hash, generation: 7 });
    const binding = registry.binding(result.verifierSessionId);
    expect(binding.task_id).toBe(result.verifierTaskId); expect(binding.responsibility_set).toEqual(['verification']);
    await expect(registry.submit({ session_id: result.verifierSessionId, lease_id: binding.lease_id }, {})).rejects.toThrow();

    const platform = new PlatformService(state, t5Oracle);
    const coordinator = new VerifiedCoordinator(new Coordinator(platform, 'verification-run' as never), verifier);
    const submitted = await coordinator.submitCandidate({ candidateValue: candidate.value, candidate: candidate, engineering, verificationId: result.id,
      currentDependencyVersions: current.currentDependencyVersions, currentGeneration: 7, unknownAffectedEffect: false,
      challengeId: candidate.challengeId as never, task: 'coordinator' as never, lease: 'fixture-lease' as never });
    expect(submitted.result.status).toBe('rejected');
    expect(verifier.recordOracleOutcome(result.id, submitted.result.status)).toMatchObject({ outcome: 'rejected', solved: false,
      nextAction: expect.stringContaining('diagnose extraction, encoding, slot, generation and hypothesis') });
    expect(verifier.recordOracleOutcome(result.id, 'accepted', false)).toMatchObject({ outcome: 'accepted', solved: false,
      nextAction: expect.stringContaining('continue finding remaining flags') });
  });

  it('requires a host execution receipt for replay and audits exact transcript byte ranges otherwise', async () => {
    const { artifacts, verifier, candidate, engineering } = await setup();
    const outputRef = await artifacts.publish(Buffer.from(candidate.value));
    const replay = await verifier.verify({ candidate, engineering, evidence: await executionEvidence(artifacts, engineering, outputRef, 'replay'), ...current });
    expect(replay.mode).toBe('replay');
    const detached = JSON.parse((await artifacts.read(replay.evidenceRefs[0]!)).toString());
    detached.command = ['node', 'unrelated.js'];
    const detachedReceipt = await artifacts.publish(Buffer.from(JSON.stringify(detached)));
    expect(await verifier.verify({ candidate, engineering, evidence: { executionReceiptRef: detachedReceipt }, ...current }))
      .toMatchObject({ mode: 'replay', status: 'rejected', checks: expect.arrayContaining([expect.objectContaining({ name: 'execution_binding', passed: false })]) });
    const transcriptRef = await artifacts.publish(Buffer.from(`prefix:${candidate.value}:suffix`));
    const audited = await verifier.verify({ candidate, engineering,
      evidence: { transcriptRef, transcriptComplete: true, candidateStartByte: 7, candidateEndByte: 7 + Buffer.byteLength(candidate.value) }, ...current });
    expect(audited).toMatchObject({ mode: 'evidence_audit', status: 'verified' });
    const truncated = await verifier.verify({ candidate, engineering,
      evidence: { transcriptRef, transcriptComplete: true, candidateStartByte: 7, candidateEndByte: 9999 }, ...current });
    expect(truncated).toMatchObject({ mode: 'evidence_audit', status: 'inconclusive' });
  });

  it('issues replay evidence only from a completed successful Runtime job bound to the Engineering command', async () => {
    const { root, artifacts, verifier, candidate } = await setup();
    const command = [process.execPath, '-e', `process.stdout.write(${JSON.stringify(candidate.value)})`];
    const scriptRef = await artifacts.publish(Buffer.from(command.join(' ')));
    const inputRefs = [await artifacts.publish(Buffer.from('fixture input'))];
    const engineering = await new SolutionEngineeringService(artifacts).publish(candidate, { command, scriptRef, inputRefs,
      dependencyVersions: current.currentDependencyVersions, extractionRule: 'exact complete stdout bytes' }) as EngineeringPackage;
    const runtime = new ToolRuntime(artifacts, join(root, 'workspace'), 'verification-run', candidate.challengeId);
    try {
      const job = await runtime.jobStart({ taskId: 'solver', command, timeoutMs: 2_000, maxRetainedBytes: 4096 });
      let record = runtime.jobStatus(job.id)!;
      for (let attempt = 0; record.status === 'running' && attempt < 100; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 10)); record = runtime.jobStatus(job.id)!;
      }
      expect(record.status).toBe('completed');
      const executionReceiptRef = await publishHostExecutionReceipt({ artifacts, runtime, jobId: job.id, mode: 'replay', engineering, generation: 7 });
      const result = await verifier.verify({ candidate, engineering, evidence: { executionReceiptRef }, ...current });
      expect(result).toMatchObject({ mode: 'replay', status: 'verified' });
      expect(result.evidenceRefs.map(ref => ref.hash)).toContain(executionReceiptRef.hash);
      await expect(publishHostExecutionReceipt({ artifacts, runtime, jobId: job.id, mode: 'replay',
        engineering: { ...engineering, command: ['false'] }, generation: 7 })).rejects.toThrow('differs from published Engineering package');
    } finally { await runtime.dispose(); }
  });

  it('blocks submission without current verification, with an unknown effect, after dependency changes, or after expiry', async () => {
    const { artifacts, state, verifier, candidate, engineering } = await setup();
    const outputRef = await artifacts.publish(Buffer.from(candidate.value));
    const result = await verifier.verify({ candidate, engineering, evidence: await executionEvidence(artifacts, engineering, outputRef), ...current, validForMs: 10_000 });
    const gate = { candidate, engineering, currentDependencyVersions: current.currentDependencyVersions, currentGeneration: 7, unknownAffectedEffect: false };
    await expect(verifier.assertSubmittable(result.id, { ...gate, unknownAffectedEffect: true })).rejects.toThrow(/unknown effect/);
    expect(verifier.current(result.id, { ...gate, currentGeneration: 8 }).status).toBe('stale');
    await expect(verifier.assertSubmittable(result.id, gate)).rejects.toThrow(/stale/);

    const fresh = await verifier.verify({ candidate, engineering, evidence: await executionEvidence(artifacts, engineering, outputRef), ...current, validForMs: 10_000 });
    expect(Date.parse(fresh.validUntil)).toBeLessThanOrEqual(Date.now() + 10_000);
    const coordinator = new VerifiedCoordinator(new Coordinator(new PlatformService(state, t5Oracle), 'verification-run' as never), verifier);
    await expect(coordinator.submitCandidate({ candidateValue: candidate.value, candidate, engineering, verificationId: fresh.id,
      currentDependencyVersions: [{ output_id: 'input', revision: 3 }], currentGeneration: 7, unknownAffectedEffect: false,
      challengeId: candidate.challengeId as never, task: 'coordinator' as never, lease: 'fixture-lease-2' as never })).rejects.toThrow(/stale/);
    const forgedCandidate = { ...candidate, value: 'puzzle{slot_a}' };
    await expect(coordinator.submitCandidate({ candidateValue: forgedCandidate.value, candidate: forgedCandidate, engineering, verificationId: fresh.id,
      currentDependencyVersions: current.currentDependencyVersions, currentGeneration: 7, unknownAffectedEffect: false,
      challengeId: candidate.challengeId as never, task: 'coordinator' as never, lease: 'fixture-lease-3' as never })).rejects.toThrow(/differs from verified bytes/);
    expect(verifier.current(fresh.id, { ...gate, now: Date.parse(fresh.validUntil) }).status).toBe('stale');
  });

  it('rejects copied or cross-candidate verifier contexts and honors a short validForMs window', async () => {
    const { artifacts, verifier, candidate, engineering } = await setup();
    const outputRef = await artifacts.publish(Buffer.from(candidate.value));
    const context = verifier.createTaskContext(candidate);
    await expect(verifier.verify({ candidate, engineering, evidence: await executionEvidence(artifacts, engineering, outputRef), ...current,
      verifierContext: { ...context } })).rejects.toThrow('not issued for this exact candidate');
    const short = await verifier.verify({ candidate, engineering, evidence: await executionEvidence(artifacts, engineering, outputRef), ...current,
      validForMs: 25 });
    expect(Date.parse(short.validUntil)).toBeLessThanOrEqual(Date.now() + 25);
    expect(verifier.current(short.id, { candidate, engineering, currentDependencyVersions: current.currentDependencyVersions,
      currentGeneration: 7, now: Date.parse(short.validUntil) }).status).toBe('stale');
  });

  it('rejects replay without safe output and rejects manifests detached from candidate bytes', async () => {
    const { artifacts, verifier, candidate, engineering } = await setup();
    await expect(verifier.verify({ candidate, engineering, evidence: {}, ...current })).resolves.toMatchObject({ status: 'inconclusive', mode: 'evidence_audit' });
    const mutated = { ...candidate, value: 'puzzle{slot_a}' };
    await expect(new SolutionEngineeringService(artifacts).publish(mutated, { command: engineering.command, scriptRef: engineering.scriptRef,
      inputRefs: engineering.inputRefs, dependencyVersions: engineering.dependencyVersions, extractionRule: engineering.extractionRule })).rejects.toThrow(/candidate bytes/);
  });
});
