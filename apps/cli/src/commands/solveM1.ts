import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArtifactStore } from '@ctf/artifacts';
import { ChallengeIdSchema, ImmutableArtifactRefSchema, LeaseIdSchema, OutcomeSchema, RunIdSchema, SessionIdSchema, SolveStateSchema, TaskIdSchema } from '@ctf/contracts';
import { ReferenceHost, type ReferenceService } from '@ctf/reference';
import { ToolRuntime } from '@ctf/runtime';
import { ProviderSolverDriver, ResponsibilityRegistry, SolverActionSchema, SolverLoop, createHttpLiteralProgressAdjudicator,
  type SolverAction, type SolverDriver } from '@ctf/supervisor';
import { StateStore } from '@ctf/state';
import { startLocalTarget, type LocalTarget } from '@ctf/local-target';
import type { ReleaseProfile } from '../composition/releaseProfile.js';
import { createLocalHttpCandidateResolver } from './localHttpCandidateResolver.js';

export interface SolveM1Options {
  target: string; description?: string; input?: string; profile: ReleaseProfile; out?: string;
  allowStub?: boolean; startLocalTarget?: boolean;
}

function stubDriver(): SolverDriver {
  const configured = process.env.M1_STUB_SOLVER_ACTIONS;
  if (!configured) throw new Error('blocked_configuration: --allow-stub M1 runs require M1_STUB_SOLVER_ACTIONS JSON actions');
  const parsed: unknown = JSON.parse(configured);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('M1_STUB_SOLVER_ACTIONS must be a non-empty JSON action array');
  const actions = parsed.map(value => SolverActionSchema.parse(value));
  return { async decide() {
    const action = actions.shift();
    if (!action) throw new Error('deterministic M1 stub action list exhausted');
    return { action, usage: { provenance: 'deterministic', input_tokens: 1, output_tokens: 1, model_calls: 0 } };
  } };
}

function providerDriver(profile: ReleaseProfile): SolverDriver {
  const model = profile.model;
  const anthropic = model.provider === 'anthropic_compatible' || model.provider === 'volcano_anthropic';
  const openai = model.provider === 'openai_compatible' || model.provider === 'volcano';
  if (!anthropic && !openai) throw new Error(`blocked_configuration: unsupported M1 provider ${model.provider}`);
  const keyName = model.apiKeyEnv ?? (model.provider.startsWith('volcano') ? 'ARK_API_KEY' : anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY');
  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`blocked_external_input: ${keyName} is missing`);
  const defaultBase = model.provider === 'volcano_anthropic' ? 'https://ark.cn-beijing.volces.com/api/coding'
    : model.provider === 'volcano' ? 'https://ark.cn-beijing.volces.com/api/v3' : '';
  const baseUrl = model.baseUrl ?? defaultBase;
  if (!baseUrl) throw new Error('blocked_configuration: M1 model.baseUrl is required');
  return new ProviderSolverDriver({ dialect: anthropic ? 'anthropic_compatible' : 'openai_compatible',
    id: model.id, baseUrl, apiKey, temperature: model.temperature });
}

export async function solveM1(options: SolveM1Options): Promise<{ code: number; message: string }> {
  let localTarget: LocalTarget | undefined;
  let referenceHost: ReferenceHost | undefined;
  let reference: ReferenceService | undefined;
  let state: StateStore | undefined;
  let runtime: ToolRuntime | undefined;
  try {
    let target = options.target === 'auto' ? 'http://127.0.0.1' : new URL(options.target).toString();
    if (options.startLocalTarget || options.target === 'auto') { localTarget = await startLocalTarget(); target = localTarget.url; }
    const profile = options.profile;
    if (profile.solverMode !== 'm1' || !profile.solverProfile) throw new Error('M1 solve requires solverMode=m1 and versioned solverProfile');
    const runId = RunIdSchema.parse(`run_${randomUUID()}`);
    const challengeId = ChallengeIdSchema.parse(`challenge_${randomUUID()}`);
    const taskId = TaskIdSchema.parse('task_solver');
    const sessionId = SessionIdSchema.parse(`session_${randomUUID()}`);
    const attemptId = `attempt_${randomUUID()}`;
    const leaseId = LeaseIdSchema.parse(randomUUID());
    const deadline = new Date(Date.now() + profile.budget.wallClockMs).toISOString();
    const out = resolve(options.out ?? 'runs/local');
    await mkdir(out, { recursive: true });
    state = new StateStore(join(out, 'state'), runId);
    const artifacts = new ArtifactStore(join(out, 'artifacts-store'));
    const runtimeScope = new URL(target).origin;
    runtime = new ToolRuntime(artifacts, join(out, 'workspaces'), runId, challengeId, runtimeScope);
    const workspace = runtime.workspace(taskId);
    const materialRefs = [];
    if (options.input) {
      const bytes = await readFile(resolve(options.input));
      const inputPath = join(workspace.path, 'challenge-input.bin');
      await writeFile(inputPath, bytes, { flag: 'wx' });
      const artifact = ImmutableArtifactRefSchema.parse(await artifacts.publish(bytes));
      state.addCanonicalArtifact(artifact);
      materialRefs.push(artifact);
    }
    let referenceSnapshot: Record<string, unknown> | null = null;
    if (profile.reference.enabled) {
      const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
      const snapshotRoot = join(repoRoot, 'fixtures/reference-snapshot');
      const approval = JSON.parse(await readFile(join(snapshotRoot, 'approval.json'), 'utf8')) as unknown;
      referenceHost = new ReferenceHost();
      reference = referenceHost.open({ runId, root: snapshotRoot, mode: 'production', approval: approval as never });
      referenceSnapshot = { ...reference.identity };
    }
    const registry = new ResponsibilityRegistry({ verifyArtifact: async ref => { await artifacts.verify(ref); return true; } });
    registry.createTask({ run_id: runId, challenge_id: challengeId, task_id: taskId, attempt_id: attemptId,
      responsibility_set: ['strategy', 'domain_solver'], lease: { lease_id: leaseId, expires_at: deadline } });
    registry.bindSession({ session_id: sessionId, task_id: taskId, context: registry.createReasoningContext() });
    const driver = options.profile.model.provider === 'stub' && options.allowStub ? stubDriver() : providerDriver(profile);
    const loop = new SolverLoop({ registry, sessionId, state, artifacts, runtime, driver, budget: profile.budget,
      deadline,
      challenge: { ready: true,
        description: options.description ?? `Authorized CTF challenge at ${runtimeScope}. Use only the scoped HTTP tool and supplied materials.`,
        material_refs: materialRefs,
        snapshot: { generation: 1, target: runtimeScope, profileId: profile.profileId,
          model: { provider: profile.model.provider, id: profile.model.id, temperature: profile.model.temperature },
          promptTemplateVersion: profile.solverProfile.promptTemplateVersion,
          toolManifestVersion: profile.solverProfile.toolManifestVersion, reference: referenceSnapshot } },
      reference,
      authorizeCommand: async (command, cwd) => {
        if (command[0] !== process.execPath || !command[1] || command[1].startsWith('-')) throw new Error('only Node scripts inside the run workspace are admitted');
        const [base, script] = await Promise.all([realpath(cwd), realpath(resolve(cwd, command[1]))]);
        if (script !== base && !script.startsWith(base + sep) || script.includes(`${sep}.opencode${sep}`)) throw new Error('job script outside authorized run workspace');
      },
      authorizeTcpEndpoint: endpoint => {
        const targetUrl = new URL(runtimeScope);
        const targetPort = Number(targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80));
        if (endpoint.host.toLowerCase() !== targetUrl.hostname.toLowerCase() || endpoint.port !== targetPort) {
          throw new Error('TCP endpoint must exactly match the authorized challenge origin host and port');
        }
      },
      validateProgress: createHttpLiteralProgressAdjudicator({ readArtifact: ref => artifacts.read(ref) }),
      ...(localTarget ? { resolveCandidate: createLocalHttpCandidateResolver({ artifacts, state, runtime, registry,
        owner: { sessionId, leaseId, taskId }, challengeId, runId, deadline, targetOrigin: runtimeScope, flag: localTarget.flag }) } : {})
    });
    await loop.run();
    const events = state.events();
    const started = events.find(event => event.kind === 'solver.activity' && event.activity === 'started');
    const finalEvent = [...events].reverse().find(event => event.kind === 'solver.activity' && event.activity === 'checkpoint');
    if (started?.kind !== 'solver.activity' || finalEvent?.kind !== 'solver.activity') throw new Error('canonical M1 start/final event missing');
    const finalData = finalEvent.data;
    const status = finalData.status;
    if (typeof status !== 'string' || !['solved', 'partial', 'candidate_only', 'blocked', 'resource_exhausted', 'no_route'].includes(status)) {
      throw new Error('canonical M1 terminal status is invalid');
    }
    const solveState = SolveStateSchema.parse(finalData.solve_state);
    const outcome = OutcomeSchema.parse(finalData.outcome);
    const reason = typeof finalData.reason === 'string' ? finalData.reason : 'canonical result reason unavailable';
    const candidateEvent = [...events].reverse().find(event => event.kind === 'solver.activity' && event.activity === 'candidate' &&
      event.data.candidate && typeof event.data.candidate === 'object');
    const canonicalCandidate = candidateEvent?.kind === 'solver.activity' ? candidateEvent.data.candidate as Record<string, unknown> : undefined;
    const valueRef = canonicalCandidate?.value_ref ? ImmutableArtifactRefSchema.parse(canonicalCandidate.value_ref) : undefined;
    const evidenceRefs = canonicalCandidate?.evidence_refs ? ImmutableArtifactRefSchema.array().parse(canonicalCandidate.evidence_refs) : [];
    const challenge = started.data.challenge as { snapshot?: { reference?: Record<string, unknown> | null } } | undefined;
    const canonicalReference = challenge?.snapshot?.reference ?? null;
    const usageEvents = events.filter(event => event.kind === 'solver.activity' && event.activity === 'driver.call');
    const usageReports = usageEvents.map(event => event.kind === 'solver.activity' ? event.data.usage as { provenance?: string; input_tokens?: number; output_tokens?: number; model_calls?: number } | null : null);
    const observedUsage = usageReports.filter((value): value is NonNullable<typeof value> => value !== null);
    const usage = { availability: usageReports.length === 0 || observedUsage.length !== usageReports.length ? 'unavailable' : 'observed',
      provenance: [...new Set(observedUsage.map(value => value.provenance ?? 'unknown'))],
      input_tokens: observedUsage.reduce((sum, value) => sum + (value.input_tokens ?? 0), 0),
      output_tokens: observedUsage.reduce((sum, value) => sum + (value.output_tokens ?? 0), 0),
      model_calls: observedUsage.reduce((sum, value) => sum + (value.model_calls ?? 0), 0) };
    const checkpoint = state.loadCheckpoint(runId);
    if (!checkpoint) throw new Error('canonical M1 checkpoint missing');
    const message = JSON.stringify({ run_id: started.runId, challenge_id: started.challengeId, session_id: started.sessionId,
      status, solve_state: solveState, outcome, reason,
      candidate: valueRef ? { value_ref: valueRef, evidence_refs: evidenceRefs } : null,
      budget: checkpoint?.usedBudget ?? null, provider_usage: usage, checkpoint: checkpoint?.nextAction ?? null,
      canonical_event_count: events.length, reference: canonicalReference }, null, 2);
    return { code: status === 'solved' ? 0 : 1, message };
  } finally {
    await runtime?.dispose();
    referenceHost?.close();
    state?.close();
    await localTarget?.close();
  }
}
