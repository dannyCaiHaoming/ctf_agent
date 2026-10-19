import { createHash, randomUUID } from 'node:crypto';
import type { ArtifactReference, ArtifactStore } from '@ctf/artifacts';
import type { DependencyVersion, ImmutableArtifactRef, LeaseId, ResponsibilityTask, TaskId } from '@ctf/contracts';
import type { Coordinator, SubmissionResult } from '@ctf/platform';
import type { ToolRuntime, RuntimeOwner } from '@ctf/runtime';
import type { StateStore } from '@ctf/state';
import { MultiFlagContinuation } from './multiflag.js';
import { ResponsibilityRegistry, type ReasoningContext } from './responsibilities.js';
import type { CandidateResolution, CandidateResolverInput } from './candidate-control.js';

export interface CandidateForVerification {
  candidateId: string; revision: number; value: string; valueRef: ArtifactReference;
  evidenceRefs: readonly ArtifactReference[]; challengeId: string; generation: number;
}
export interface EngineeringPackage {
  candidateId: string; candidateRevision: number; command: readonly string[]; scriptRef: ArtifactReference;
  inputRefs: readonly ArtifactReference[]; dependencyVersions: readonly DependencyVersion[];
  extractionRule: string; manifestRef: ArtifactReference;
}
export type VerificationMode = 'replay' | 'recompute' | 'evidence_audit';
export interface VerificationResult {
  id: string; candidateId: string; candidateRevision: number; candidateHash: string; solutionHash: string;
  dependencyVersions: DependencyVersion[]; challengeId: string; generation: number; mode: VerificationMode;
  status: 'verified' | 'rejected' | 'inconclusive' | 'stale'; checks: Array<{ name: string; passed: boolean; detail: string }>;
  evidenceRefs: ArtifactReference[]; validUntil: string; verifierTaskId: string; verifierSessionId: string;
}

/** Engineering publishes a replayable manifest; registration alone remains candidate_only. */
export class SolutionEngineeringService {
  constructor(private readonly artifacts: ArtifactStore) {}

  async publish(candidate: CandidateForVerification | undefined, input: Omit<EngineeringPackage, 'candidateId' | 'candidateRevision' | 'manifestRef'>): Promise<{ required: false } | EngineeringPackage> {
    if (!candidate) return { required: false };
    if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 0 || !Number.isSafeInteger(candidate.generation) || candidate.generation < 0) throw new Error('invalid candidate revision/generation');
    if (!input.command.length || input.command.some(value => !value || value.includes('\0')) || !input.extractionRule.trim()) throw new Error('solution command and extraction rule required');
    for (const ref of [candidate.valueRef, ...candidate.evidenceRefs, input.scriptRef, ...input.inputRefs]) await this.artifacts.verify(ref);
    const candidateBytes = await this.artifacts.read(candidate.valueRef);
    if (!candidateBytes.equals(Buffer.from(candidate.value, 'utf8'))) throw new Error('candidate bytes do not match immutable candidate value');
    const dependencyVersions = normalizeVersions(input.dependencyVersions);
    const manifest = { version: 1, candidate_id: candidate.candidateId, candidate_revision: candidate.revision,
      candidate_value_ref: candidate.valueRef, candidate_evidence_refs: [...candidate.evidenceRefs], command: [...input.command],
      script_ref: input.scriptRef, input_refs: [...input.inputRefs], dependency_versions: dependencyVersions, extraction_rule: input.extractionRule };
    const manifestRef = await this.artifacts.publish(Buffer.from(JSON.stringify(manifest)));
    return Object.freeze({ candidateId: candidate.candidateId, candidateRevision: candidate.revision, command: Object.freeze([...input.command]),
      scriptRef: fixed(input.scriptRef), inputRefs: Object.freeze(input.inputRefs.map(fixed)), dependencyVersions: Object.freeze(dependencyVersions),
      extractionRule: input.extractionRule, manifestRef: fixed(manifestRef) });
  }
}

export interface VerifierTaskFactory {
  makeTask(input: { challengeId: string; candidateId: string; taskId: string; attemptId: string; leaseId: string; expiresAt: string }): ResponsibilityTask;
}
export interface VerificationEvidence {
  /** Host-issued receipt binding a completed Runtime job to this Engineering package. */
  executionReceiptRef?: ArtifactReference;
  /** Complete immutable transcript for a non-replayable one-shot/randomized result. */
  transcriptRef?: ArtifactReference;
  transcriptComplete?: boolean;
  candidateStartByte?: number;
  candidateEndByte?: number;
}
export interface HostExecutionReceipt {
  schema: 'ctf-host-execution-receipt/v1'; mode: 'replay' | 'recompute';
  jobId: string; status: 'completed'; exitCode: 0; command: string[]; cwd: string;
  scriptRef: ArtifactReference; inputRefs: ArtifactReference[]; dependencyVersions: DependencyVersion[];
  generation: number; outputRef: ArtifactReference; outputStartCursor: 0; outputEndCursor: number;
}
export interface VerifyCandidateInput {
  candidate: CandidateForVerification; engineering: EngineeringPackage; now?: number; validForMs?: number;
  evidence: VerificationEvidence;
  currentDependencyVersions: readonly DependencyVersion[]; currentGeneration: number;
  signal?: AbortSignal;
  verifierContext?: VerifierTaskContext;
  runDeadline?: string;
}
export interface VerifierTaskContext { taskId: string; attemptId: string; leaseId: string; sessionId: string; expiresAt: string }

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('verification cancelled by run deadline');
}

export interface VerifiedCandidatePlan {
  engineering: Omit<EngineeringPackage, 'candidateId' | 'candidateRevision' | 'manifestRef'>;
  verification: Pick<VerifyCandidateInput, 'evidence'>;
  /** Optional host-only replay run after shared verification budget admission. */
  prepareVerification?: (candidate: CandidateForVerification, engineering: EngineeringPackage, signal: AbortSignal | undefined,
    verifierContext: VerifierTaskContext) => Promise<Pick<VerifyCandidateInput, 'evidence'>>;
  submission: { task: TaskId; lease: LeaseId };
  current: () => Promise<{ dependencyVersions: readonly DependencyVersion[]; generation: number; unknownAffectedEffect: boolean }>;
}

/** Build a replay/recompute receipt from a terminal Runtime job, never from Solver-provided claims. */
export async function publishHostExecutionReceipt(input: { artifacts: ArtifactStore; runtime: ToolRuntime; jobId: string;
  owner?: RuntimeOwner; mode: 'replay' | 'recompute'; engineering: EngineeringPackage; generation: number }): Promise<ArtifactReference> {
  const job = input.runtime.jobStatus(input.jobId, input.owner);
  if (!job || job.status !== 'completed' || job.exitCode !== 0) throw new Error('execution receipt requires a completed successful Runtime job');
  if (job.mode !== 'batch' || job.retainedStartCursor !== 0 || !Number.isSafeInteger(job.endCursor) || job.endCursor < 0) throw new Error('execution receipt requires a complete retained batch transcript');
  if (JSON.stringify([...job.command]) !== JSON.stringify([...input.engineering.command])) throw new Error('Runtime command differs from published Engineering package');
  if (!Number.isSafeInteger(input.generation) || input.generation < 0) throw new Error('invalid execution generation');
  await input.artifacts.verify(input.engineering.manifestRef);
  await input.artifacts.verify(input.engineering.scriptRef);
  for (const ref of input.engineering.inputRefs) await input.artifacts.verify(ref);
  const outputRef = await input.runtime.publishJobEvidence(input.jobId, 0, job.endCursor, input.owner);
  await input.artifacts.verify(outputRef);
  const receipt: HostExecutionReceipt = { schema: 'ctf-host-execution-receipt/v1', mode: input.mode, jobId: job.id,
    status: 'completed', exitCode: 0, command: [...job.command], cwd: job.cwd, scriptRef: fixed(input.engineering.scriptRef),
    inputRefs: input.engineering.inputRefs.map(fixed), dependencyVersions: normalizeVersions(input.engineering.dependencyVersions),
    generation: input.generation, outputRef: fixed(outputRef), outputStartCursor: 0, outputEndCursor: job.endCursor };
  return fixed(await input.artifacts.publish(Buffer.from(JSON.stringify(receipt))));
}

/** In-memory proof that this host process issued a receipt from a real Runtime job. */
export class CanonicalExecutionReceiptRegistry {
  private readonly issued = new Set<string>();
  async issue(input: Parameters<typeof publishHostExecutionReceipt>[0]): Promise<ArtifactReference> {
    const ref = await publishHostExecutionReceipt(input);
    this.issued.add(`${ref.hash}:${ref.size}:${ref.path}`);
    return ref;
  }
  has(ref: ArtifactReference): boolean { return this.issued.has(`${ref.hash}:${ref.size}:${ref.path}`); }
}

/** Host-owned adapter composing Engineering, independent Verification, guarded submission, and durable slot progress. */
export class VerifiedMultiFlagCandidateResolver {
  constructor(private readonly input: { artifacts: ArtifactStore; state: StateStore; engineering: SolutionEngineeringService;
    verifier: IndependentVerificationService; coordinator: VerifiedCoordinator;
    plan: (input: CandidateResolverInput, candidate: CandidateForVerification) => Promise<VerifiedCandidatePlan> }) {}

  async resolve(input: CandidateResolverInput): Promise<CandidateResolution> {
    const candidate: CandidateForVerification = { candidateId: input.candidateId, revision: 1, value: input.value,
      valueRef: input.valueRef, evidenceRefs: input.evidenceRefs, challengeId: input.challengeId as never, generation: input.generation };
    input.control.admit('engineering');
    input.stageEvent('engineering', 'started');
    let plan: VerifiedCandidatePlan; let engineering: EngineeringPackage;
    try {
      plan = await this.input.plan(input, candidate);
      assertNotAborted(input.control.signal);
      engineering = await this.input.engineering.publish(candidate, plan.engineering) as EngineeringPackage;
      assertNotAborted(input.control.signal);
    } catch (error) { input.stageEvent('engineering', 'failed'); throw error; }
    input.stageEvent('engineering', 'completed');
    input.control.admit('verification');
    input.stageEvent('verification', 'started');
    const verifierContext = this.input.verifier.createTaskContext(candidate);
    let before: Awaited<ReturnType<VerifiedCandidatePlan['current']>>;
    let verification: VerificationResult;
    try {
      before = await plan.current();
      assertNotAborted(input.control.signal);
      if (plan.prepareVerification) input.control.admit('verification_replay');
      const verificationEvidence = plan.prepareVerification
        ? await plan.prepareVerification(candidate, engineering, input.control.signal, verifierContext) : plan.verification;
      assertNotAborted(input.control.signal);
      verification = await this.input.verifier.verify({ candidate, engineering, ...verificationEvidence,
        currentDependencyVersions: before.dependencyVersions, currentGeneration: before.generation, signal: input.control.signal,
        verifierContext, runDeadline: input.control.deadline });
    } catch (error) { input.stageEvent('verification', 'failed'); throw error; }
    input.stageEvent('verification', 'completed');
    if (verification.status !== 'verified' || before.generation !== input.generation) {
      return { status: 'inconclusive', authoritative: true,
        detail: `candidate held before submission: verification is ${verification.status} or resource generation changed`,
        evidence_refs: [...input.evidenceRefs, ...verification.evidenceRefs.map(immutableRef)],
        verification: { id: verification.id, status: verification.status, candidateHash: verification.candidateHash,
          generation: verification.generation, current: false } };
    }

    let submitted: SubmissionResult | undefined;
    let oracleNextAction: string | undefined;
    const continuation = new MultiFlagContinuation(this.input.state, async (submission, submissionGeneration) => {
      if (submission.candidate !== candidate.value) throw new Error('multi-flag continuation changed the verified candidate');
      input.stageEvent('oracle_submit', 'started');
      try {
        const current = await plan.current();
        submitted = await this.input.coordinator.submitCandidate({ candidateValue: candidate.value, candidate, engineering,
          verificationId: verification.id, currentDependencyVersions: current.dependencyVersions, currentGeneration: current.generation,
          unknownAffectedEffect: current.unknownAffectedEffect, challengeId: candidate.challengeId as never,
          task: submission.task as never, lease: submission.lease as never, generation: submissionGeneration,
          budget: input.control.remaining(), deadline: input.control.deadline,
          beforeDispatch: () => { input.control.admit('oracle_submit'); } });
        oracleNextAction = this.input.verifier.recordOracleOutcome(verification.id, submitted.businessOutcome, submitted.result.completed === true).nextAction;
        input.stageEvent('oracle_submit', 'completed');
      } catch (error) { input.stageEvent('oracle_submit', 'failed'); throw error; }
      return submitted;
    });
    const continued = await continuation.run({ challengeId: candidate.challengeId as never, task: plan.submission.task as never,
      lease: plan.submission.lease as never, firstCandidate: candidate.value, maxCandidates: 1, nextCandidate: async () => undefined });
    const authoritative = submitted?.result.authoritative === true;
    const shared = { detail: oracleNextAction ?? `candidate oracle result: ${submitted?.businessOutcome ?? continued.outcome}`,
      evidence_refs: [...input.evidenceRefs, ...verification.evidenceRefs.map(immutableRef)],
      verification: { id: verification.id, status: verification.status, candidateHash: verification.candidateHash,
        generation: verification.generation, current: true },
      ...(submitted?.effectId ? { submit_effect_id: submitted.effectId } : {}),
      ...(submitted?.result.correctFlagCount === undefined ? {} : { correct_flag_count: submitted.result.correctFlagCount }),
      ...(submitted?.result.totalFlagCount === undefined ? {} : { total_flag_count: submitted.result.totalFlagCount }),
      ...(submitted?.result.matchedSlot === undefined ? {} : { matched_slot: submitted.result.matchedSlot }),
      ...(submitted?.result.completed === undefined ? {} : { completed: submitted.result.completed }) };
    if (!submitted || !authoritative) return { status: 'inconclusive', authoritative: false, ...shared };
    if (continued.outcome === 'completed') return { status: 'accepted', authoritative: true, ...shared, completed: true };
    if ((submitted.businessOutcome === 'accepted' || submitted.businessOutcome === 'duplicate') && continued.outcome === 'partial' && continued.progress) {
      return { status: 'partial', authoritative: true, ...shared, completed: false,
        correct_flag_count: continued.progress.correctFlagCount, total_flag_count: continued.progress.totalFlagCount };
    }
    if (submitted.businessOutcome === 'rejected') return { status: 'rejected', authoritative: true, ...shared };
    return { status: 'inconclusive', authoritative: true, ...shared };
  }
}

/**
 * Verifier has only ArtifactStore reads and a dedicated verification task. It is
 * never given PlatformService, reset, hint, or mutation adapters.
 */
export class IndependentVerificationService {
  private readonly results = new Map<string, VerificationResult>();
  private readonly byCandidate = new Map<string, string>();
  private readonly issuedContexts = new WeakMap<VerifierTaskContext, CandidateForVerification>();
  constructor(private readonly artifacts: ArtifactStore, private readonly registry: ResponsibilityRegistry, private readonly tasks: VerifierTaskFactory,
    private readonly canonicalReceipt?: (ref: ArtifactReference) => boolean) {}

  createTaskContext(candidate: CandidateForVerification, now = Date.now(), validForMs = 5 * 60_000): VerifierTaskContext {
    if (!Number.isFinite(now) || !Number.isSafeInteger(validForMs) || validForMs < 1) throw new Error('invalid verification task context lifetime');
    const taskId = `verify_${randomUUID()}`; const sessionId = `session_${randomUUID()}`;
    const attemptId = `attempt_${randomUUID()}`; const leaseId = `lease_${randomUUID()}`;
    const expiresAt = new Date(now + Math.min(validForMs, 5 * 60_000)).toISOString();
    const task = this.tasks.makeTask({ challengeId: candidate.challengeId, candidateId: candidate.candidateId, taskId, attemptId, leaseId, expiresAt });
    if (task.task_id !== taskId || task.challenge_id !== candidate.challengeId || task.responsibility_set.length !== 1 || task.responsibility_set[0] !== 'verification') throw new Error('Verifier must use an isolated verification-only task');
    this.registry.createTask(task);
    const context = this.registry.createReasoningContext();
    this.registry.bindSession({ task_id: taskId, session_id: sessionId, context });
    const result = Object.freeze({ taskId, attemptId, leaseId, sessionId, expiresAt });
    this.issuedContexts.set(result, candidate);
    return result;
  }

  async verify(input: VerifyCandidateInput): Promise<VerificationResult> {
    const { candidate, engineering } = input;
    assertNotAborted(input.signal);
    if (input.verifierContext) this.assertVerifierContext(input.verifierContext, candidate);
    if (engineering.candidateId !== candidate.candidateId || engineering.candidateRevision !== candidate.revision) throw new Error('engineering package does not bind this candidate revision');
    for (const ref of [candidate.valueRef, ...candidate.evidenceRefs, engineering.manifestRef, engineering.scriptRef, ...engineering.inputRefs]) { await this.artifacts.verify(ref); assertNotAborted(input.signal); }
    const manifest = JSON.parse((await this.artifacts.read(engineering.manifestRef)).toString('utf8')) as { candidate_id?: string; candidate_revision?: number; candidate_value_ref?: ArtifactReference };
    assertNotAborted(input.signal);
    if (manifest.candidate_id !== candidate.candidateId || manifest.candidate_revision !== candidate.revision || manifest.candidate_value_ref?.hash !== candidate.valueRef.hash) throw new Error('solution manifest does not bind the exact candidate revision');
    if (input.evidence.executionReceiptRef) {
      const receiptRef = input.evidence.executionReceiptRef;
      if (this.canonicalReceipt && !this.canonicalReceipt(receiptRef)) return this.recordResult(input, 'inconclusive', 'recompute',
        [{ name: 'host_receipt_issuance', passed: false, detail: 'receipt was not issued by the current host Runtime execution path' }], [receiptRef]);
      await this.artifacts.verify(receiptRef);
      assertNotAborted(input.signal);
      let receipt: HostExecutionReceipt;
      try { receipt = JSON.parse((await this.artifacts.read(receiptRef)).toString('utf8')) as HostExecutionReceipt; }
      catch { return this.recordResult(input, 'inconclusive', 'recompute', [{ name: 'execution_receipt', passed: false, detail: 'host execution receipt is not valid JSON' }], [receiptRef]); }
      assertNotAborted(input.signal);
      const mode = receipt.mode === 'replay' || receipt.mode === 'recompute' ? receipt.mode : 'recompute';
      const evidenceRefs = [receiptRef, ...(receipt.outputRef ? [receipt.outputRef] : [])];
      if (receipt.schema !== 'ctf-host-execution-receipt/v1' || !receipt.outputRef || !Array.isArray(receipt.command) ||
        !Array.isArray(receipt.inputRefs) || !Array.isArray(receipt.dependencyVersions) || !Number.isSafeInteger(receipt.generation) ||
        receipt.status !== 'completed' || receipt.exitCode !== 0 || receipt.outputStartCursor !== 0 || receipt.outputEndCursor !== receipt.outputRef.size) {
        return this.recordResult(input, 'inconclusive', mode, [{ name: 'execution_receipt', passed: false, detail: 'host execution receipt is incomplete or not successful' }], evidenceRefs);
      }
      await this.artifacts.verify(receipt.outputRef);
      assertNotAborted(input.signal);
      const commandMatches = same(receipt.command, engineering.command) && sameRef(receipt.scriptRef, engineering.scriptRef) &&
        sameRefs(receipt.inputRefs, engineering.inputRefs);
      const versionMatches = equalVersions(normalizeVersions(receipt.dependencyVersions), normalizeVersions(engineering.dependencyVersions)) &&
        equalVersions(normalizeVersions(engineering.dependencyVersions), normalizeVersions(input.currentDependencyVersions));
      const generationMatches = receipt.generation === candidate.generation && candidate.generation === input.currentGeneration;
      const output = await this.artifacts.read(receipt.outputRef);
      assertNotAborted(input.signal);
      const candidateBytes = await this.artifacts.read(candidate.valueRef);
      assertNotAborted(input.signal);
      const outputMatches = output.equals(candidateBytes);
      const checks = [
        { name: 'runtime_execution', passed: receipt.status === 'completed' && receipt.exitCode === 0, detail: 'receipt records successful completed Runtime execution' },
        { name: 'execution_binding', passed: commandMatches, detail: commandMatches ? 'command, script and input refs match Engineering manifest' : 'execution is detached from the published Engineering package' },
        { name: 'candidate_bytes', passed: outputMatches, detail: outputMatches ? 'Runtime output bytes equal candidate bytes' : 'Runtime output bytes differ from candidate bytes' },
        { name: 'dependency_versions', passed: versionMatches, detail: versionMatches ? 'receipt and current dependency versions match' : 'dependency version changed or receipt is detached' },
        { name: 'resource_generation', passed: generationMatches, detail: generationMatches ? 'receipt and current generation match' : 'resource generation changed or receipt is detached' }
      ];
      const status = checks.every(check => check.passed) ? 'verified' : !versionMatches || !generationMatches ? 'stale' : 'rejected';
      return this.recordResult(input, status, mode, checks, evidenceRefs);
    }
    const mode: VerificationMode = 'evidence_audit';
    if (!input.evidence.transcriptRef || input.evidence.transcriptComplete !== true) {
      return this.recordResult(input, 'inconclusive', mode, [{ name: 'complete_transcript', passed: false, detail: 'complete immutable transcript is missing; an output hash or mode claim is not sufficient' }], input.evidence.transcriptRef ? [input.evidence.transcriptRef] : []);
    }
    const evidenceRefs = [input.evidence.transcriptRef];
    await this.artifacts.verify(input.evidence.transcriptRef);
    assertNotAborted(input.signal);
    const candidateBytes = await this.artifacts.read(candidate.valueRef);
    assertNotAborted(input.signal);
    const output = await this.artifacts.read(input.evidence.transcriptRef);
    assertNotAborted(input.signal);
    const start = input.evidence.candidateStartByte; const end = input.evidence.candidateEndByte;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start! < 0 || end! <= start! || end! > output.length) {
      return this.recordResult(input, 'inconclusive', mode, [{ name: 'candidate_byte_range', passed: false, detail: 'candidate byte range is missing or truncated' }], evidenceRefs);
    }
    const actual = output.subarray(start!, end!);
    const outputMatches = actual.equals(candidateBytes);
    const versionMatches = equalVersions(normalizeVersions(engineering.dependencyVersions), normalizeVersions(input.currentDependencyVersions));
    const generationMatches = candidate.generation === input.currentGeneration;
    const checks = [
      { name: 'candidate_bytes', passed: outputMatches, detail: outputMatches ? 'audited transcript byte range equals candidate bytes' : 'audited transcript byte range differs from candidate bytes' },
      { name: 'dependency_versions', passed: versionMatches, detail: versionMatches ? 'current dependency versions match' : 'dependency version changed' },
      { name: 'resource_generation', passed: generationMatches, detail: generationMatches ? 'resource generation matches' : 'resource generation changed' }
    ];
    return this.recordResult(input, checks.every(check => check.passed) ? 'verified' : !versionMatches || !generationMatches ? 'stale' : 'rejected', mode, checks, evidenceRefs);
  }

  private async recordResult(input: VerifyCandidateInput, status: VerificationResult['status'], mode: VerificationMode,
    checks: VerificationResult['checks'], evidenceRefs: ArtifactReference[]): Promise<VerificationResult> {
    assertNotAborted(input.signal);
    const { candidate, engineering } = input;
    const now = input.now ?? Date.now(); const validForMs = input.validForMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(validForMs) || validForMs < 1 || !Number.isFinite(now)) throw new Error('invalid verification validity window');
    const context = input.verifierContext ?? this.createTaskContext(candidate, now, validForMs);
    this.assertVerifierContext(context, candidate);
    const validUntilMs = Math.min(Date.parse(context.expiresAt), now + validForMs,
      input.runDeadline ? Date.parse(input.runDeadline) : Infinity);
    if (validUntilMs <= now) throw new Error('verification validity window is already expired');
    const result: VerificationResult = Object.freeze({ id: `verification_${randomUUID()}`, candidateId: candidate.candidateId,
      candidateRevision: candidate.revision, candidateHash: candidate.valueRef.hash, solutionHash: engineering.manifestRef.hash,
      dependencyVersions: normalizeVersions(engineering.dependencyVersions), challengeId: candidate.challengeId, generation: candidate.generation,
      mode, status, checks: Object.freeze(checks.map(check => Object.freeze({ ...check }))) as unknown as VerificationResult['checks'],
      evidenceRefs: Object.freeze(evidenceRefs.map(fixed)) as unknown as ArtifactReference[], validUntil: new Date(validUntilMs).toISOString(), verifierTaskId: context.taskId, verifierSessionId: context.sessionId });
    this.results.set(result.id, result); this.byCandidate.set(`${candidate.candidateId}:${candidate.revision}`, result.id);
    return result;
  }

  private assertVerifierContext(context: VerifierTaskContext, candidate: CandidateForVerification): void {
    const issued = this.issuedContexts.get(context);
    if (!issued || issued.candidateId !== candidate.candidateId || issued.challengeId !== candidate.challengeId || issued.revision !== candidate.revision) {
      throw new Error('verification task context was not issued for this exact candidate');
    }
    const binding = this.registry.binding(context.sessionId);
    if (binding.task_id !== context.taskId || binding.attempt_id !== context.attemptId || binding.lease_id !== context.leaseId ||
      binding.challenge_id !== candidate.challengeId || binding.responsibility_set.length !== 1 || binding.responsibility_set[0] !== 'verification' ||
      Date.parse(binding.expires_at) <= Date.now()) throw new Error('verification task context is foreign, expired, or not verification-only');
  }

  current(resultId: string, input: { candidate: CandidateForVerification; engineering: EngineeringPackage; currentDependencyVersions: readonly DependencyVersion[]; currentGeneration: number; now?: number }): VerificationResult {
    const result = this.results.get(resultId); if (!result) throw new Error('unknown verification result');
    const stale = result.candidateId !== input.candidate.candidateId || result.candidateRevision !== input.candidate.revision ||
      result.candidateHash !== input.candidate.valueRef.hash || result.solutionHash !== input.engineering.manifestRef.hash ||
      result.generation !== input.currentGeneration || input.currentGeneration !== input.candidate.generation ||
      !equalVersions(result.dependencyVersions, normalizeVersions(input.currentDependencyVersions)) || Date.parse(result.validUntil) <= (input.now ?? Date.now());
    if (stale && result.status !== 'stale') {
      const updated = Object.freeze({ ...result, status: 'stale' as const }); this.results.set(resultId, updated); return updated;
    }
    return result;
  }

  async assertSubmittable(resultId: string, input: { candidate: CandidateForVerification; engineering: EngineeringPackage; currentDependencyVersions: readonly DependencyVersion[]; currentGeneration: number; unknownAffectedEffect: boolean; now?: number }): Promise<void> {
    if (input.unknownAffectedEffect) throw new Error('submission blocked by affected unknown effect');
    await this.artifacts.verify(input.candidate.valueRef);
    await this.artifacts.verify(input.engineering.manifestRef);
    if (!(await this.artifacts.read(input.candidate.valueRef)).equals(Buffer.from(input.candidate.value, 'utf8'))) throw new Error('submission candidate value differs from verified bytes');
    const result = this.current(resultId, input);
    if (result.status !== 'verified') throw new Error(`submission requires current verified result; got ${result.status}`);
  }

  recordOracleOutcome(resultId: string, status: 'accepted' | 'rejected' | 'duplicate' | 'invalid_state' | 'closed', completed = true):
    { outcome: 'accepted' | 'rejected' | 'inconclusive'; solved: boolean; nextAction: string } {
    const result = this.results.get(resultId); if (!result || result.status !== 'verified') throw new Error('oracle outcome requires a verified candidate');
    if (status === 'accepted') return { outcome: 'accepted', solved: completed,
      nextAction: completed ? 'record authoritative challenge completion' : 'record accepted slot and continue finding remaining flags' };
    if (status === 'duplicate') return { outcome: 'accepted', solved: completed,
      nextAction: 'reconcile authoritative duplicate and continue from persisted slot progress' };
    if (status === 'rejected') return { outcome: 'rejected', solved: false, nextAction: 'diagnose extraction, encoding, slot, generation and hypothesis, then continue Solver route' };
    return { outcome: 'inconclusive', solved: false, nextAction: 'reconcile platform state and continue only when current state is known' };
  }
}

/** M1 submission facade: the caller cannot reach Coordinator before the current verification gate. */
export class VerifiedCoordinator {
  constructor(private readonly coordinator: Coordinator, private readonly verifier: IndependentVerificationService) {}
  async submitCandidate(input: Omit<Parameters<Coordinator['submitCandidate']>[0], 'candidate'> & {
    candidateValue: string; verificationId: string; candidate: CandidateForVerification; engineering: EngineeringPackage;
    currentDependencyVersions: readonly DependencyVersion[]; currentGeneration: number; unknownAffectedEffect: boolean; now?: number;
  }): Promise<SubmissionResult> {
    if (input.candidateValue !== input.candidate.value) throw new Error('candidate value binding mismatch');
    await this.verifier.assertSubmittable(input.verificationId, input);
    const { candidate, engineering, verificationId: _verificationId, currentDependencyVersions: _currentVersions,
      currentGeneration: _generation, unknownAffectedEffect: _unknownEffect, now: _now, candidateValue, ...submission } = input;
    return this.coordinator.submitCandidate({ ...submission, candidate: candidateValue });
  }
}

function normalizeVersions(input: readonly DependencyVersion[]): DependencyVersion[] {
  const values = input.map(value => ({ output_id: value.output_id, revision: value.revision })).sort((a, b) => a.output_id.localeCompare(b.output_id));
  if (new Set(values.map(value => value.output_id)).size !== values.length) throw new Error('duplicate dependency version');
  return values;
}
function equalVersions(a: readonly DependencyVersion[], b: readonly DependencyVersion[]): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function sameRef(a: ArtifactReference | undefined, b: ArtifactReference): boolean { return !!a && a.hash === b.hash && a.size === b.size && a.path === b.path; }
function sameRefs(a: readonly ArtifactReference[], b: readonly ArtifactReference[]): boolean { return a.length === b.length && a.every((ref, index) => sameRef(ref, b[index]!)); }
function fixed(ref: ArtifactReference): ArtifactReference { return Object.freeze({ hash: ref.hash, size: ref.size, path: ref.path }); }
function immutableRef(ref: ArtifactReference): ImmutableArtifactRef { return { hash: ref.hash as ImmutableArtifactRef['hash'], size: ref.size, path: ref.path }; }
