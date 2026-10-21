import type { ArtifactStore } from '@ctf/artifacts';
import { ImmutableArtifactRefSchema, type DependencyVersion, type ImmutableArtifactRef, type LeaseId, type TaskId } from '@ctf/contracts';
import { Coordinator, PlatformService } from '@ctf/platform';
import type { ToolRuntime, RuntimeOwner } from '@ctf/runtime';
import type { StateStore } from '@ctf/state';
import { CanonicalExecutionReceiptRegistry, DurableJobWatchService, IndependentVerificationService,
  SolutionEngineeringService, VerifiedCoordinator, type CandidateForVerification, type CandidateResolution,
  type ResponsibilityRegistry } from '@ctf/supervisor';
import { LocalFlagOracle } from '@ctf/local-oracle';
import type { WebCandidateRegistration } from './openCodeTask.js';

/** Independent replay and local oracle for safe, repeatable same-origin GET candidates. */
export function createLocalHttpCandidateResolver(input: {
  artifacts: ArtifactStore; state: StateStore; runtime: ToolRuntime; registry: ResponsibilityRegistry;
  owner: RuntimeOwner & { taskId: string }; challengeId: string; runId: string; deadline: string;
  targetOrigin: string; flag: string;
}) {
  const receipts = new CanonicalExecutionReceiptRegistry();
  const verifier = new IndependentVerificationService(input.artifacts, input.registry, { makeTask: task => ({
    run_id: input.runId as never, challenge_id: task.challengeId as never, task_id: task.taskId as never,
    attempt_id: task.attemptId as never, responsibility_set: ['verification'],
    lease: { lease_id: task.leaseId as never, expires_at: task.expiresAt }
  }) as never }, ref => receipts.has(ref));
  const coordinator = new VerifiedCoordinator(new Coordinator(new PlatformService(input.state, new LocalFlagOracle(input.flag)), input.runId as never), verifier);
  const engineering = new SolutionEngineeringService(input.artifacts);

  return async (request: WebCandidateRegistration): Promise<CandidateResolution> => {
    request.control.signal.throwIfAborted();
    const url = new URL(request.request.url);
    if (url.origin !== input.targetOrigin || url.username || url.password || url.hash) {
      return held('candidate is outside the authorized same-origin replay scope; no oracle submission was made');
    }
    if (request.request.method !== 'GET') return held('candidate is preserved; independent replay is unsupported for this potentially state-changing request');
    const body = await input.artifacts.read(request.responseBodyRef);
    if (!body.equals(request.responseBody) || !body.includes(Buffer.from(request.value, 'utf8')) ||
      !request.evidenceRefs.some(ref => sameRef(ref, request.responseBodyRef))) {
      return held('candidate is not bound to the immutable complete HTTP response; no oracle submission was made');
    }
    const wrapperRef = request.evidenceRefs.find(ref => !sameRef(ref, request.responseBodyRef));
    if (!wrapperRef) return held('canonical HTTP response metadata is missing; no oracle submission was made');
    const wrapper = JSON.parse((await input.artifacts.read(wrapperRef)).toString('utf8')) as Record<string, unknown>;
    const bodyRef = wrapper.body_ref as Record<string, unknown> | undefined;
    if (wrapper.url !== url.toString() || wrapper.method !== 'GET' || wrapper.status !== request.status || wrapper.complete !== true ||
      wrapper.body_size !== request.responseBodyRef.size || bodyRef?.hash !== request.responseBodyRef.hash ||
      bodyRef.size !== request.responseBodyRef.size) return held('HTTP request differs from canonical run evidence; no oracle submission was made');
    const sentCookies = wrapper.cookie_names_sent;
    const setCookies = wrapper.set_cookie_names;
    if (!Array.isArray(sentCookies) || sentCookies.length !== 0 || !Array.isArray(setCookies) || setCookies.length !== 0) {
      return held('candidate depends on HTTP session state; independent anonymous replay is not safe to infer');
    }
    for (const ref of request.evidenceRefs) await input.artifacts.verify(ref);

    const candidate: CandidateForVerification = { candidateId: request.candidateId, revision: 1, value: request.value,
      valueRef: request.valueRef, evidenceRefs: request.evidenceRefs, challengeId: input.challengeId, generation: 1 };
    const dependencyVersions: DependencyVersion[] = [{ output_id: `node-runtime-${process.version}`, revision: 1 },
      ...request.evidenceRefs.map((ref, index) => ({ output_id: `http-evidence-${index}-${ref.hash.slice(0, 12)}`, revision: 1 }))];
    const script = replayScript(url.toString(), request.value);
    const scriptRef = await input.artifacts.publish(Buffer.from(script));
    request.control.admit('engineering'); request.stageEvent('engineering', 'started');
    let packageValue;
    try {
      packageValue = await engineering.publish(candidate, { command: [process.execPath, scriptRef.path], scriptRef,
        inputRefs: request.evidenceRefs, dependencyVersions,
        extractionRule: 'independent same-origin GET replay must return HTTP 200 and contain the exact candidate bytes' });
      if (!('manifestRef' in packageValue)) return held('candidate engineering package is unavailable; no oracle submission was made');
      request.control.signal.throwIfAborted(); request.stageEvent('engineering', 'completed');
    } catch (error) { request.stageEvent('engineering', 'failed'); throw error; }

    request.control.admit('verification'); request.stageEvent('verification', 'started');
    const verifierContext = verifier.createTaskContext(candidate);
    const verifierOwner = { sessionId: verifierContext.sessionId, leaseId: verifierContext.leaseId };
    input.runtime.registerTaskLease({ ...verifierOwner, taskId: verifierContext.taskId, expiresAt: verifierContext.expiresAt });
    let replayId: string | undefined;
    try {
      request.control.admit('verification_replay');
      const replay = await input.runtime.jobStart({ taskId: verifierContext.taskId, owner: verifierOwner,
        cwd: input.runtime.workspace(verifierContext.taskId).path, command: [...packageValue.command],
        timeoutMs: Math.max(1, Math.min(5000, Date.parse(request.control.deadline) - Date.now())), maxRetainedBytes: 1024 * 1024 });
      replayId = replay.id;
      const watches = new DurableJobWatchService(input.runtime, input.state);
      try {
        await watches.watch({ jobId: replay.id, taskId: verifierContext.taskId, experimentId: `http-verification-${request.candidateId}`,
          cursor: 0, continuationRef: `http-verification:${request.candidateId}:${replay.id}`, deadline: request.control.deadline, owner: verifierOwner });
        const onAbort = () => { void input.runtime.jobCancel(replay.id, 'cancelled', verifierOwner).catch(() => undefined); };
        request.control.signal.addEventListener('abort', onAbort, { once: true });
        try {
          const terminal = await watches.awaitContinuation(replay.id, verifierOwner);
          request.control.signal.throwIfAborted();
          if (terminal.terminalState !== 'completed') return held(`independent GET replay ended ${terminal.terminalState}; no oracle submission was made`);
          watches.claimContinuation(replay.id); input.state.markOutboxDelivered(terminal.terminalEventId!);
        } finally { request.control.signal.removeEventListener('abort', onAbort); }
      } finally { watches.dispose(); }
      const job = input.runtime.jobStatus(replay.id, verifierOwner);
      if (!job || job.status !== 'completed' || job.exitCode !== 0) return held('independent GET replay did not reproduce the candidate; no oracle submission was made');
      const receiptRef = await receipts.issue({ artifacts: input.artifacts, runtime: input.runtime, jobId: replay.id,
        owner: verifierOwner, mode: 'replay', engineering: packageValue, generation: 1 });
      const verification = await verifier.verify({ candidate, engineering: packageValue, evidence: { executionReceiptRef: receiptRef },
        currentDependencyVersions: dependencyVersions, currentGeneration: 1, signal: request.control.signal,
        verifierContext, runDeadline: request.control.deadline });
      request.control.signal.throwIfAborted(); request.stageEvent('verification', 'completed');
      const verificationSummary = { id: verification.id, status: verification.status, candidateHash: verification.candidateHash,
        generation: verification.generation, current: verification.status !== 'stale' } as const;
      const proofRefs = [...request.evidenceRefs, ...verification.evidenceRefs.map(ref => ImmutableArtifactRefSchema.parse(ref))];
      if (verification.status !== 'verified') return { status: 'inconclusive', authoritative: false,
        detail: `independent verification is ${verification.status}; no oracle submission was made`, evidence_refs: proofRefs,
        verification: verificationSummary };
      request.stageEvent('oracle_submit', 'started');
      const current = { dependencyVersions, generation: 1, unknownAffectedEffect: input.state.effectsFor({ challengeId: input.challengeId as never })
        .some(effect => effect.state === 'dispatching' || effect.state === 'unknown') };
      let submission;
      try {
        submission = await coordinator.submitCandidate({ candidateValue: request.value, candidate, engineering: packageValue,
          verificationId: verification.id, currentDependencyVersions: current.dependencyVersions, currentGeneration: current.generation,
          unknownAffectedEffect: current.unknownAffectedEffect,
          challengeId: input.challengeId as never, task: input.owner.taskId as TaskId, lease: input.owner.leaseId as LeaseId,
          generation: 1, budget: request.control.remaining(), deadline: request.control.deadline,
          beforeDispatch: () => { request.control.admit('oracle_submit'); } });
        request.stageEvent('oracle_submit', 'completed');
      } catch (error) { request.stageEvent('oracle_submit', 'failed'); throw error; }
      verifier.recordOracleOutcome(verification.id, submission.businessOutcome, submission.result.completed === true);
      const shared = { evidence_refs: proofRefs, verification: verificationSummary,
        submit_effect_id: submission.effectId, correct_flag_count: submission.result.correctFlagCount,
        total_flag_count: submission.result.totalFlagCount, matched_slot: submission.result.matchedSlot,
        completed: submission.result.completed };
      if (!submission.result.authoritative) return { status: 'inconclusive', authoritative: false,
        detail: 'oracle response was not authoritative; completion remains unknown', ...shared };
      if (submission.businessOutcome === 'rejected') return { status: 'rejected', authoritative: true,
        detail: 'independent verification passed; authoritative oracle rejected the candidate', ...shared };
      if ((submission.businessOutcome === 'accepted' || submission.businessOutcome === 'duplicate') && submission.result.completed === true) {
        return { status: 'accepted', authoritative: true, detail: 'independent verification passed and authoritative oracle completed the challenge', ...shared };
      }
      return { status: submission.businessOutcome === 'accepted' || submission.businessOutcome === 'duplicate' ? 'partial' : 'inconclusive',
        authoritative: true, detail: 'candidate accepted but authoritative whole-challenge completion is not confirmed', ...shared };
    } catch (error) { request.stageEvent('verification', 'failed'); throw error; }
    finally {
      if (replayId && input.runtime.jobStatus(replayId, verifierOwner)?.status === 'running') await input.runtime.jobCancel(replayId, 'cancelled', verifierOwner);
      input.runtime.revokeTaskLease(verifierOwner);
    }
  };
}

function replayScript(url: string, candidate: string): string {
  return `void (async () => {\n` +
    `  const response = await fetch(${JSON.stringify(url)}, { method: 'GET', redirect: 'error' });\n` +
    `  if (response.status !== 200) process.exit(21);\n` +
    `  const bytes = Buffer.from(await response.arrayBuffer());\n` +
    `  if (!bytes.includes(Buffer.from(${JSON.stringify(candidate)}, 'utf8'))) process.exit(23);\n` +
    `  process.stdout.write(Buffer.from(${JSON.stringify(candidate)}, 'utf8'));\n` +
    `})().catch(() => process.exit(22));\n`;
}
function held(detail: string): CandidateResolution { return { status: 'inconclusive', authoritative: false, detail }; }
function sameRef(a: ImmutableArtifactRef, b: ImmutableArtifactRef): boolean { return a.hash === b.hash && a.size === b.size && a.path === b.path; }
