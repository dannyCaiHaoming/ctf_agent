import { ImmutableArtifactRefSchema, type DependencyVersion, type LeaseId } from '@ctf/contracts';
import type { ArtifactStore } from '@ctf/artifacts';
import type { ToolRuntime, RuntimeOwner } from '@ctf/runtime';
import type { StateStore } from '@ctf/state';
import { CanonicalExecutionReceiptRegistry, DurableJobWatchService, IndependentVerificationService,
  SolutionEngineeringService, type CandidateForVerification, type CandidateResolution, type VerificationResult,
  type VerifierTaskContext } from '@ctf/supervisor';
import type { ResponsibilityRegistry } from '@ctf/supervisor';
import type { WebCandidateRegistration } from './openCodeTask.js';

const query = '{ pastes(public: false) { id } }';

/** Narrow Web finding verifier for the authorized DVGA private-paste-ID task; it never submits to an oracle. */
export function createLocalHttpFindingResolver(input: {
  artifacts: ArtifactStore; state: StateStore; runtime: ToolRuntime; registry: ResponsibilityRegistry;
  owner: RuntimeOwner & { taskId: string }; challengeId: string; runId: string; deadline: string;
  targetOrigin: string;
}) {
  const receipts = new CanonicalExecutionReceiptRegistry();
  const verifier = new IndependentVerificationService(input.artifacts, input.registry, { makeTask: task => ({
    run_id: input.runId as never, challenge_id: task.challengeId as never, task_id: task.taskId as never,
    attempt_id: task.attemptId as never, responsibility_set: ['verification'],
    lease: { lease_id: task.leaseId as never, expires_at: task.expiresAt }
  }) as never }, ref => receipts.has(ref));
  const engineering = new SolutionEngineeringService(input.artifacts);

  return async (request: WebCandidateRegistration): Promise<CandidateResolution> => {
    validateRequest(request, input.targetOrigin);
    const source = JSON.parse(request.responseBody.toString('utf8')) as { errors?: unknown; data?: { pastes?: unknown } };
    if (request.status !== 200 || source.errors !== undefined || !Array.isArray(source.data?.pastes) || source.data.pastes.length === 0 ||
      source.data.pastes.some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 1 || typeof (row as { id?: unknown }).id !== 'string')) {
      throw new Error('HTTP evidence did not demonstrate anonymous non-public paste IDs');
    }
    if (!request.responseBody.equals(Buffer.from(request.value, 'utf8'))) throw new Error('candidate differs from the complete HTTP response body');
    for (const ref of request.evidenceRefs) await input.artifacts.verify(ref);

    const candidate: CandidateForVerification = { candidateId: request.candidateId, revision: 1, value: request.value,
      valueRef: request.valueRef, evidenceRefs: request.evidenceRefs, challengeId: input.challengeId, generation: 1 };
    const dependencyVersions: DependencyVersion[] = [{ output_id: `node-runtime-${process.version}`, revision: 1 },
      ...request.evidenceRefs.map((ref, index) => ({ output_id: `web-evidence-${index}-${ref.hash.slice(0, 12)}`, revision: 1 }))];
    const script = replayScript(input.targetOrigin, request.request.body!);
    const scriptRef = await input.artifacts.publish(Buffer.from(script));
    request.stageEvent('engineering', 'started');
    const packageValue = await engineering.publish(candidate, { command: [process.execPath, scriptRef.path], scriptRef,
      inputRefs: [...request.evidenceRefs], dependencyVersions,
      extractionRule: 'replay unauthenticated DVGA GraphQL POST; require only non-empty paste IDs and emit exact response bytes' });
    if (!('manifestRef' in packageValue)) throw new Error('candidate engineering package was not published');

    request.stageEvent('engineering', 'completed');
    request.stageEvent('verification', 'started');
    const verifierContext = verifier.createTaskContext(candidate);
    const verifierOwner = { sessionId: verifierContext.sessionId, leaseId: verifierContext.leaseId };
    input.runtime.registerTaskLease({ ...verifierOwner, taskId: verifierContext.taskId, expiresAt: verifierContext.expiresAt });
    let replayId: string | undefined;
    try {
      if (Date.parse(input.deadline) <= Date.now()) throw new Error('verification deadline has expired');
      const replay = await input.runtime.jobStart({ taskId: verifierContext.taskId, owner: verifierOwner,
        cwd: input.runtime.workspace(verifierContext.taskId).path, command: [...packageValue.command],
        timeoutMs: Math.max(1, Math.min(8000, Date.parse(input.deadline) - Date.now())), maxRetainedBytes: 1024 * 1024 });
      replayId = replay.id;
      const watches = new DurableJobWatchService(input.runtime, input.state);
      try {
        await watches.watch({ jobId: replay.id, taskId: verifierContext.taskId, experimentId: request.candidateId,
          cursor: 0, continuationRef: `dvga-finding-replay:${request.candidateId}:${replay.id}`, deadline: input.deadline, owner: verifierOwner });
        const terminal = await watches.awaitContinuation(replay.id, verifierOwner);
        if (terminal.terminalState !== 'completed') throw new Error(`independent GraphQL replay ended ${terminal.terminalState}`);
        watches.claimContinuation(replay.id); input.state.markOutboxDelivered(terminal.terminalEventId!);
      } finally { watches.dispose(); }
      const receiptRef = await receipts.issue({ artifacts: input.artifacts, runtime: input.runtime, jobId: replay.id,
        owner: verifierOwner, mode: 'replay', engineering: packageValue, generation: 1 });
      const verification: VerificationResult = await verifier.verify({ candidate, engineering: packageValue,
        evidence: { executionReceiptRef: receiptRef }, currentDependencyVersions: dependencyVersions,
        currentGeneration: 1, runDeadline: input.deadline, verifierContext });
      request.stageEvent('verification', 'completed');
      return { status: 'inconclusive', authoritative: false,
        detail: verification.status === 'verified'
          ? 'independent replay verified anonymous non-public paste IDs; local finding only, no authoritative oracle, candidate_only'
          : `local finding verification ${verification.status}; no authoritative oracle`,
        evidence_refs: [...request.evidenceRefs, ...verification.evidenceRefs.map(ref => ImmutableArtifactRefSchema.parse(ref))],
        verification: { id: verification.id, status: verification.status, candidateHash: verification.candidateHash,
          generation: verification.generation, current: true } };
    } catch (error) {
      request.stageEvent('verification', 'failed');
      throw error;
    } finally {
      if (replayId && input.runtime.jobStatus(replayId, verifierOwner)?.status === 'running') {
        await input.runtime.jobCancel(replayId, 'cancelled', verifierOwner);
      }
      input.runtime.revokeTaskLease(verifierOwner);
    }
  };
}

function validateRequest(request: WebCandidateRegistration, targetOrigin: string): void {
  const url = new URL(request.request.url);
  if (url.origin !== targetOrigin || url.pathname !== '/graphql' || url.search || url.hash || url.username || url.password) {
    throw new Error('finding request is outside the authorized DVGA GraphQL endpoint');
  }
  if (request.request.method !== 'POST' || !request.request.body || !/^application\/json(?:\s*;|$)/i.test(request.request.contentType ?? '')) {
    throw new Error('finding requires one JSON GraphQL POST');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(request.request.body); } catch { throw new Error('finding GraphQL request body is not valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as { query?: unknown }).query !== query ||
    Object.keys(parsed).some(key => key !== 'query')) throw new Error('finding request must be exactly the authorized non-public paste ID query');
}

function replayScript(targetOrigin: string, requestBody: string): string {
  const url = `${targetOrigin}/graphql`;
  return `void (async () => {
  const response = await fetch(${JSON.stringify(url)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(requestBody)}, redirect: 'error' });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (response.status !== 200) process.exit(21);
  let parsed; try { parsed = JSON.parse(bytes.toString('utf8')); } catch { process.exit(22); }
  if (parsed.errors !== undefined || !Array.isArray(parsed.data?.pastes) || parsed.data.pastes.length === 0 ||
      parsed.data.pastes.some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 1 || typeof row.id !== 'string')) process.exit(23);
  process.stdout.write(bytes);
})().catch(() => process.exit(24));\n`;
}
