import type { ArtifactStore } from '@ctf/artifacts';
import type { ChallengeId, DependencyVersion, ImmutableArtifactRef, LeaseId, TaskId } from '@ctf/contracts';
import { Coordinator, PlatformService } from '@ctf/platform';
import type { ToolRuntime, RuntimeOwner } from '@ctf/runtime';
import type { StateStore } from '@ctf/state';
import { CanonicalExecutionReceiptRegistry, IndependentVerificationService, SolutionEngineeringService,
  VerifiedCoordinator, VerifiedMultiFlagCandidateResolver, type CandidateResolverInput } from '@ctf/supervisor';
import { ResponsibilityRegistry } from '@ctf/supervisor';
import { DurableJobWatchService } from '@ctf/supervisor';
import type { VerifierTaskContext } from '@ctf/supervisor';
import { LocalFlagOracle } from '@ctf/local-oracle';

/** Local-target-only composition. Ground truth is captured only by this host closure. */
export function createLocalHttpCandidateResolver(input: {
  artifacts: ArtifactStore; state: StateStore; runtime: ToolRuntime; registry: ResponsibilityRegistry;
  owner: RuntimeOwner & { taskId: string }; challengeId: ChallengeId; runId: string; deadline: string;
  targetOrigin: string; flag: string;
}) {
  const receipts = new CanonicalExecutionReceiptRegistry();
  const verifier = new IndependentVerificationService(input.artifacts, input.registry, { makeTask: task => ({
    run_id: input.runId as never, challenge_id: task.challengeId as never, task_id: task.taskId as never,
    attempt_id: task.attemptId as never, responsibility_set: ['verification'],
    lease: { lease_id: task.leaseId as never, expires_at: task.expiresAt }
  }) as never }, ref => receipts.has(ref));
  const coordinator = new VerifiedCoordinator(new Coordinator(new PlatformService(input.state, new LocalFlagOracle(input.flag)), input.runId as never), verifier);
  const resolver = new VerifiedMultiFlagCandidateResolver({ artifacts: input.artifacts, state: input.state,
    engineering: new SolutionEngineeringService(input.artifacts), verifier, coordinator,
    plan: async (request: CandidateResolverInput, candidate) => {
      const evidence = await findHttpResponse(input.artifacts, input.state, request);
      if (new URL(evidence.url).origin !== input.targetOrigin) throw new Error('candidate HTTP evidence is outside the authorized local target');
      const sourceBody = await input.artifacts.read(evidence.bodyRef);
      if (!sourceBody.equals(Buffer.from(candidate.value, 'utf8'))) throw new Error('candidate bytes do not equal the actual HTTP response body');
      const dependencyVersions: DependencyVersion[] = [{ output_id: `node-runtime-${process.version}`, revision: 1 },
        ...request.evidenceRefs.map((ref, index) => ({ output_id: `candidate-evidence-${index}-${ref.hash.slice(0, 12)}`, revision: 1 }))];
      const script = `void (async () => { const response = await fetch(${JSON.stringify(evidence.url)}, { redirect: 'error' }); if (!response.ok) process.exit(21); const bytes = Buffer.from(await response.arrayBuffer()); process.stdout.write(bytes); })().catch(() => process.exit(22));\n`;
      const scriptRef = await input.artifacts.publish(Buffer.from(script));
      const command = [process.execPath, scriptRef.path];
      const engineering = { command, scriptRef, inputRefs: [...request.evidenceRefs], dependencyVersions,
        extractionRule: 'independent same-origin HTTP GET; exact complete response bytes must equal candidate bytes' };
      return {
        engineering, verification: { evidence: {} },
        prepareVerification: async (_candidate, packageValue, signal, verifierContext: VerifierTaskContext) => {
          if (signal?.aborted) throw new Error('verification cancelled by run deadline');
          const verifierOwner = { sessionId: verifierContext.sessionId, leaseId: verifierContext.leaseId };
          input.runtime.registerTaskLease({ ...verifierOwner, taskId: verifierContext.taskId, expiresAt: verifierContext.expiresAt });
          let replayId: string | undefined;
          try {
            const base = input.runtime.workspace(verifierContext.taskId).path;
            const immutableScript = await input.artifacts.read(packageValue.scriptRef);
            if (!immutableScript.equals(Buffer.from(script)) || packageValue.command[0] !== process.execPath || packageValue.command[1] !== packageValue.scriptRef.path) throw new Error('immutable replay script differs from the host-built procedure');
            const replay = await input.runtime.jobStart({ taskId: verifierContext.taskId, owner: verifierOwner,
              cwd: base, command: [...packageValue.command], timeoutMs: Math.max(1, Math.min(5000, Date.parse(request.control.deadline) - Date.now())), maxRetainedBytes: 1024 * 1024 });
            replayId = replay.id;
            const watches = new DurableJobWatchService(input.runtime, input.state);
            try {
              await watches.watch({ jobId: replay.id, taskId: verifierContext.taskId, experimentId: request.experimentId,
                cursor: 0, continuationRef: `verification-replay:${request.candidateId}:${replay.id}`, deadline: request.control.deadline, owner: verifierOwner });
              const onAbort = () => { void input.runtime.jobCancel(replay.id, 'cancelled', verifierOwner).catch(() => undefined); };
              signal?.addEventListener('abort', onAbort, { once: true });
              try {
                const terminal = await watches.awaitContinuation(replay.id, verifierOwner);
                if (signal?.aborted) throw new Error('verification replay cancelled by shared run deadline');
                if (terminal.terminalState !== 'completed') throw new Error(`independent HTTP replay ended ${terminal.terminalState}`);
                watches.claimContinuation(replay.id); input.state.markOutboxDelivered(terminal.terminalEventId!);
              } finally { signal?.removeEventListener('abort', onAbort); }
            } finally { watches.dispose(); }
            const receiptRef = await receipts.issue({ artifacts: input.artifacts, runtime: input.runtime, jobId: replay.id,
              owner: verifierOwner, mode: 'replay', engineering: packageValue, generation: request.generation });
            return { evidence: { executionReceiptRef: receiptRef } };
          } finally {
            if (replayId && input.runtime.jobStatus(replayId, verifierOwner)?.status === 'running') await input.runtime.jobCancel(replayId, 'cancelled', verifierOwner);
            input.runtime.revokeTaskLease(verifierOwner);
          }
        },
        submission: { task: input.owner.taskId as TaskId, lease: input.owner.leaseId as LeaseId },
        current: async () => ({ dependencyVersions, generation: request.generation,
          unknownAffectedEffect: input.state.effectsFor({ challengeId: input.challengeId }).some(effect => effect.state === 'dispatching' || effect.state === 'unknown') })
      };
    }
  });
  return (request: CandidateResolverInput) => resolver.resolve(request);
}

async function findHttpResponse(artifacts: ArtifactStore, state: StateStore, request: CandidateResolverInput): Promise<{ url: string; bodyRef: ImmutableArtifactRef }> {
  if (request.experiment.plan.procedure.length !== 1 || request.experiment.events.length !== 1 || request.experiment.events[0]?.outcome !== 'success') throw new Error('replay currently supports exactly one successful declared HTTP request');
  if (request.experiment.events[0]?.step_id !== request.experiment.plan.procedure[0]?.id) throw new Error('runtime event is detached from the declared HTTP procedure step');
  const declared = request.experiment.plan.procedure.find(step => step.tool === 'http.request')!.input as { url?: unknown };
  if (typeof declared.url !== 'string') throw new Error('declared HTTP URL is missing');
  const receiptIds = new Set(request.experiment.events.map(event => event.id));
  const runtimeResults = state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'tool.result' &&
    receiptIds.has(String(event.data.receipt_id)) && event.runId === request.runId && event.challengeId === request.challengeId &&
    event.taskId === request.taskId && event.sessionId === request.sessionId && event.data.tool === 'http.request');
  if (runtimeResults.length !== 1) throw new Error('canonical same-run HTTP tool result is missing or ambiguous');
  const resultReceiptId = String(runtimeResults[0]!.kind === 'solver.activity' ? runtimeResults[0]!.data.receipt_id : '');
  const started = state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'tool.started' &&
    event.data.receipt_id === resultReceiptId && event.runId === request.runId && event.challengeId === request.challengeId &&
    event.taskId === request.taskId && event.sessionId === request.sessionId);
  if (started.length !== 1 || (started[0]!.kind === 'solver.activity' && JSON.stringify(started[0]!.data.input) !== JSON.stringify(declared))) throw new Error('canonical HTTP request input is missing or differs from the admitted experiment');
  const canonicalRaw = runtimeResults[0]?.kind === 'solver.activity' ? runtimeResults[0].data.observation as Record<string, unknown> : undefined;
  if (!canonicalRaw || canonicalRaw.complete !== true || canonicalRaw.outcome !== 'success' || canonicalRaw.tool !== 'http.request') throw new Error('canonical HTTP observation is incomplete or unsuccessful');
  const canonicalArtifactRefs = canonicalRaw.artifact_refs as ImmutableArtifactRef[];
  if (!Array.isArray(canonicalArtifactRefs) || request.evidenceRefs.length !== canonicalArtifactRefs.length || request.evidenceRefs.some(ref => !canonicalArtifactRefs.some(value => value.hash === ref.hash && value.size === ref.size && value.path === ref.path))) throw new Error('candidate evidence differs from canonical runtime HTTP artifacts');
  for (const ref of request.evidenceRefs) {
    let parsed: unknown;
    try { parsed = JSON.parse((await artifacts.read(ref)).toString('utf8')); } catch { continue; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const value = parsed as Record<string, unknown>;
    if (value.url !== declared.url || value.truncated !== false || !Number.isInteger(value.status) || (value.status as number) < 200 || (value.status as number) >= 400) continue;
    const response = value.response_ref as Record<string, unknown> | undefined;
    const bodyRef = request.evidenceRefs.find(candidate => response?.hash === candidate.hash && response.size === candidate.size && response.path === candidate.path);
    if (bodyRef) {
      const body = await artifacts.read(bodyRef);
      if (!body.equals(Buffer.from(String(value.body), 'utf8'))) throw new Error('HTTP wrapper body does not match the immutable raw body artifact');
      return { url: declared.url, bodyRef };
    }
  }
  throw new Error('candidate evidence is missing its complete canonical HTTP response wrapper and raw body');
}
