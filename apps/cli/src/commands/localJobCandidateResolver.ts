import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { ArtifactReference, ArtifactStore } from '@ctf/artifacts';
import { ImmutableArtifactRefSchema } from '@ctf/contracts';
import type { DependencyVersion, ImmutableArtifactRef, LeaseId, TaskId } from '@ctf/contracts';
import { Coordinator, PlatformService } from '@ctf/platform';
import type { ToolRuntime, RuntimeOwner } from '@ctf/runtime';
import type { StateStore } from '@ctf/state';
import { CanonicalExecutionReceiptRegistry, IndependentVerificationService, SolutionEngineeringService,
  VerifiedCoordinator, VerifiedMultiFlagCandidateResolver, type CandidateResolverInput } from '@ctf/supervisor';
import { ResponsibilityRegistry } from '@ctf/supervisor';
import { DurableJobWatchService } from '@ctf/supervisor';
import type { VerifierTaskContext } from '@ctf/supervisor';
import { LocalFlagOracle } from '@ctf/local-oracle';

type Event = Extract<ReturnType<StateStore['events']>[number], { kind: 'solver.activity' }>;

/** Local-target-only composition for the already-authorized local job route. */
export function createLocalJobCandidateResolver(input: {
  artifacts: ArtifactStore; state: StateStore; runtime: ToolRuntime; registry: ResponsibilityRegistry;
  owner: RuntimeOwner & { taskId: string }; challengeId: string; runId: string; deadline: string; flag: string;
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
      const evidence = await findLocalJobOutput(input.artifacts, input.state, input.runtime, input.owner.taskId, request);
      const sourceOutput = await input.artifacts.read(evidence.outputRef);
      const normalizedOutput = sourceOutput.at(-1) === 0x0a ? sourceOutput.subarray(0, -1) : sourceOutput;
      if (!normalizedOutput.equals(Buffer.from(candidate.value, 'utf8'))) {
        throw new Error('candidate bytes do not equal the normalized actual local job stdout');
      }
      const dependencyVersions: DependencyVersion[] = [{ output_id: `node-runtime-${process.version}`, revision: 1 },
        ...evidence.workspaceRefs.map((ref, index) => ({ output_id: `workspace-snapshot-${index}-${ref.hash.slice(0, 12)}`, revision: 1 })),
        ...request.evidenceRefs.map((ref, index) => ({ output_id: `candidate-evidence-${index}-${ref.hash.slice(0, 12)}`, revision: 1 }))];
      const script = replayScript(evidence.command, evidence.workspaceFiles);
      const scriptRef = await input.artifacts.publish(Buffer.from(script));
      const command = [process.execPath, scriptRef.path];
      const engineering = { command, scriptRef, inputRefs: [...evidence.workspaceRefs, ...request.evidenceRefs], dependencyVersions,
        extractionRule: 'independent local script replay; exact complete stdout after removing only one final LF must equal candidate bytes' };
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
                if (terminal.terminalState !== 'completed') throw new Error(`independent local job replay ended ${terminal.terminalState}`);
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
          unknownAffectedEffect: input.state.effectsFor({ challengeId: input.challengeId as never }).some(effect => effect.state === 'dispatching' || effect.state === 'unknown') })
      };
    }
  });
  return (request: CandidateResolverInput) => resolver.resolve(request);
}

async function findLocalJobOutput(artifacts: ArtifactStore, state: StateStore, runtime: ToolRuntime, solverTaskId: string,
  request: CandidateResolverInput): Promise<{ command: string[]; outputRef: ImmutableArtifactRef; workspaceFiles: Array<{ path: string; data: Buffer }>; workspaceRefs: ImmutableArtifactRef[] }> {
  if (request.experiment.plan.procedure.length !== 1 || request.experiment.plan.procedure[0]?.tool !== 'job.run') {
    throw new Error('local job replay supports exactly one declared job.run procedure step');
  }
  const successEvents = request.experiment.events.filter(event => event.outcome === 'success');
  if (successEvents.length !== 1 || successEvents[0]!.step_id !== request.experiment.plan.procedure[0]!.id) {
    throw new Error('runtime success event is missing or detached from the declared job.run procedure step');
  }
  const declaredInput = request.experiment.plan.procedure[0]!.input as { command?: unknown };
  if (!Array.isArray(declaredInput.command) || declaredInput.command.length === 0) throw new Error('declared local job command is missing');
  const command = declaredInput.command[0] === 'node' ? [process.execPath, ...declaredInput.command.slice(1)] : [...declaredInput.command];
  if (command.length < 2 || command[0] !== process.execPath || typeof command[1] !== 'string' || command[1].startsWith('-')) {
    throw new Error('local job replay supports only the admitted Node script route');
  }
  const receiptId = successEvents[0]!.id;
  const activities = state.events().filter((event): event is Event => event.kind === 'solver.activity');
  const scoped = (activity: Event) => activity.runId === request.runId && activity.challengeId === request.challengeId &&
    activity.taskId === request.taskId && activity.sessionId === request.sessionId;
  const runtimeResults = activities.filter(event => scoped(event) && event.activity === 'tool.result' &&
    event.data.receipt_id === receiptId && event.data.tool === 'job.run');
  if (runtimeResults.length !== 1) throw new Error('canonical same-run local job result is missing or ambiguous');
  const successIndex = activities.indexOf(runtimeResults[0]!);
  if (successIndex < 0) throw new Error('canonical local job result ordering is unavailable');
  const canonicalRaw = runtimeResults[0]!.data.observation as Record<string, unknown> | undefined;
  const canonicalRefs = canonicalRaw?.artifact_refs as ImmutableArtifactRef[] | undefined;
  if (!canonicalRaw || canonicalRaw.complete !== true || canonicalRaw.outcome !== 'success' || canonicalRaw.tool !== 'job.run' ||
    !Array.isArray(canonicalRefs) || canonicalRefs.length !== 1) {
    throw new Error('canonical local job observation is incomplete or does not retain exactly one output artifact');
  }
  if (request.evidenceRefs.length !== 1 || !sameRef(request.evidenceRefs[0]!, canonicalRefs[0]!)) {
    throw new Error('candidate evidence differs from the successful local job output artifact');
  }
  await artifacts.verify(request.evidenceRefs[0]!);
  const output = await artifacts.read(request.evidenceRefs[0]!);
  if (!output.equals(Buffer.from(String(canonicalRaw.raw), 'utf8'))) throw new Error('canonical job output differs from its immutable raw artifact');

  const started = activities.find(event => scoped(event) && event.activity === 'started' );
  const challenge = (started?.data.challenge ?? {}) as { material_refs?: ImmutableArtifactRef[]; workspace_files?: string[] };
  const materialRefs: ArtifactReference[] = Array.isArray(challenge.material_refs) ? challenge.material_refs : [];
  const materialNames = Array.isArray(challenge.workspace_files) ? challenge.workspace_files : [];
  const files = new Map<string, ArtifactReference>();
  if (materialNames.length === materialRefs.length) for (const [index, name] of materialNames.entries()) files.set(name, materialRefs[index]!);
  for (const event of activities.slice(0, successIndex)) {
    if (!scoped(event) || event.activity !== 'tool.result' || event.data.tool !== 'workspace.patch') continue;
    const raw = (event.data.observation as Record<string, unknown> | undefined)?.raw;
    if (typeof raw !== 'string') throw new Error('canonical workspace patch result is missing its raw observation');
    let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new Error('canonical workspace patch observation is not valid JSON'); }
    const patch = parsed as { path?: unknown; after?: ImmutableArtifactRef };
    if (typeof patch.path !== 'string' || !patch.after || typeof patch.after.hash !== 'string') throw new Error('canonical workspace patch snapshot is incomplete');
    files.set(patch.path, patch.after);
  }
  const snapshotFiles = new Map<string, Buffer>();
  const workspaceRefs: ArtifactReference[] = [];
  for (const [path, ref] of files) {
    await artifacts.verify(ref);
    const bytes = await artifacts.read(ref);
    if (snapshotFiles.has(path)) throw new Error(`canonical workspace snapshot for ${path} is ambiguous`);
    snapshotFiles.set(path, bytes); workspaceRefs.push(ref);
  }
  const workspaceRoot = runtime.workspace(solverTaskId).path;
  for (const path of await listWorkspaceFiles(workspaceRoot, workspaceRoot)) {
    if (snapshotFiles.has(path)) continue;
    const bytes = await readFile(resolve(workspaceRoot, path));
    const ref = await artifacts.publish(bytes);
    snapshotFiles.set(path, bytes); workspaceRefs.push(ref);
  }
  if (![...snapshotFiles.keys()].some(path => path === command[1])) throw new Error('canonical workspace snapshot does not contain the declared script');
  const workspaceFiles = [...snapshotFiles.entries()].map(([path, data]) => ({ path, data }));
  return { command, outputRef: request.evidenceRefs[0]!, workspaceFiles,
    workspaceRefs: workspaceRefs.map(ref => ImmutableArtifactRefSchema.parse(ref)) };
}

async function listWorkspaceFiles(root: string, current: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.name === '.opencode' || entry.name === '.m1-verification-replay') continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await listWorkspaceFiles(root, path));
    else result.push(relative(root, path).split(sep).join('/'));
  }
  return result.sort();
}

function replayScript(command: string[], files: Array<{ path: string; data: Buffer }>): string {
  for (const file of files) {
    if (file.path.includes('\0') || file.path.startsWith('/') || file.path.split(/[\\/]/).includes('..')) {
      throw new Error('local replay workspace path is outside the replay sandbox');
    }
  }
  const manifest = JSON.stringify(files.map(file => ({ path: file.path, data: file.data.toString('base64') })));
  return `import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
void (async () => {
  const root = join(process.cwd(), '.m1-verification-replay');
  await mkdir(root, { recursive: true });
  for (const file of ${manifest}) await writeFile(join(root, file.path), Buffer.from(file.data, 'base64'));
  const result = spawnSync(${JSON.stringify(command[0]!)}, ${JSON.stringify(command.slice(1))}, { cwd: root, timeout: 4000, maxBuffer: 1024 * 1024, encoding: 'buffer' });
  if (result.error || result.status !== 0 || !Array.isArray(result.output)) process.exit(21);
  let stdout = result.stdout;
  if (stdout.at(-1) === 0x0a) stdout = stdout.subarray(0, -1);
  process.stdout.write(stdout);
})().catch(() => process.exit(22));
`;
}

function sameRef(left: ImmutableArtifactRef, right: ImmutableArtifactRef): boolean {
  return left.hash === right.hash && left.size === right.size && left.path === right.path;
}
