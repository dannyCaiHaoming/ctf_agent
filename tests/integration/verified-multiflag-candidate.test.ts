import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { Coordinator, PlatformService } from '@ctf/platform';
import { StateStore } from '@ctf/state';
import { aggregateM1RunMetrics } from '@ctf/reporting';
import { IndependentVerificationService, SolutionEngineeringService, VerifiedCoordinator,
  VerifiedMultiFlagCandidateResolver } from '@ctf/supervisor';
import { ResponsibilityRegistry } from '../../packages/supervisor/src/responsibilities.js';
import { createT6Oracle } from '../../fixtures/trajectories/t6-multiflag/oracle.js';
import type { CandidateResolverInput } from '../../packages/supervisor/src/solver-loop.js';
import type { ResponsibilityTask } from '../../packages/contracts/src/index.js';
import { dispatch, scripted, setup } from './solver-loop-fixtures.js';

const roots: string[] = []; const states: StateStore[] = [];
afterEach(async () => { for (const state of states.splice(0)) state.close(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('verified multi-flag candidate resolver', () => {
  it('verifies and submits each candidate through the guarded coordinator, persisting partial before completion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'verified-multiflag-')); roots.push(root);
    const artifacts = new ArtifactStore(join(root, 'artifacts'));
    const state = new StateStore(join(root, 'state'), 'verified-multiflag-run'); states.push(state);
    const registry = new ResponsibilityRegistry({ verifyArtifact: async ref => { await artifacts.verify(ref); return true; } });
    const verifier = new IndependentVerificationService(artifacts, registry, { makeTask: input => ({ run_id: 'verified-multiflag-run' as never,
      challenge_id: input.challengeId as never, task_id: input.taskId as never, attempt_id: input.attemptId as never,
      responsibility_set: ['verification'], lease: { lease_id: input.leaseId as never, expires_at: input.expiresAt } }) as ResponsibilityTask });
    const coordinator = new VerifiedCoordinator(new Coordinator(new PlatformService(state, createT6Oracle()), 'verified-multiflag-run' as never), verifier);
    const resolver = new VerifiedMultiFlagCandidateResolver({ artifacts, state, engineering: new SolutionEngineeringService(artifacts), verifier, coordinator,
      plan: async (input, candidate) => ({
        engineering: { command: [process.execPath, 'solve.js'], scriptRef: await artifacts.publish(Buffer.from('deterministic solver manifest')),
          inputRefs: [...input.evidenceRefs], dependencyVersions: [{ output_id: 'fixture-input', revision: 1 }],
          extractionRule: 'candidate bytes must equal the verified output bytes' },
        verification: { evidence: { transcriptRef: candidate.valueRef, transcriptComplete: true,
          candidateStartByte: 0, candidateEndByte: Buffer.byteLength(candidate.value) } },
        submission: { task: 'solver' as never, lease: 'lease-m1' as never },
        current: async () => ({ dependencyVersions: [{ output_id: 'fixture-input', revision: 1 }], generation: input.generation, unknownAffectedEffect: false })
      }) });

    const input = async (candidateId: string, value: string): Promise<CandidateResolverInput> => {
      const valueRef = await artifacts.publish(Buffer.from(value));
      const outputRef = await artifacts.publish(Buffer.from(value));
      return { candidateId, runId: 'verified-multiflag-run', challengeId: 't6-two-slots', taskId: 'solver', sessionId: 'session-solver', generation: 1, value, valueRef: valueRef as never,
        evidenceRefs: [outputRef as never], experimentId: `experiment-${candidateId}`,
        control: { signal: new AbortController().signal, deadline: new Date(Date.now() + 60000).toISOString(),
          remaining: () => ({ wallClockMs: 60000, maxSteps: 100, maxToolJobs: 100, maxObservableTokens: 10000 }), admit: () => ({ wallClockMs: 60000, maxSteps: 100, maxToolJobs: 100, maxObservableTokens: 10000 }) },
        stageEvent: () => undefined,
        experiment: { plan: { input_refs: [], state_dependencies: { generation: 1 }, procedure: [] }, fingerprint: `fingerprint-${candidateId}`,
          status: 'succeeded', events: [], activities: [], redispatch_reason: null, conclusion: null } as never };
    };

    const first = await resolver.resolve(await input('candidate-first', 'puzzle{first}'));
    expect(first).toMatchObject({ status: 'partial', authoritative: true, correct_flag_count: 1, total_flag_count: 2,
      matched_slot: 0, completed: false, verification: { status: 'verified', current: true } });
    expect(state.multiFlagProgress('t6-two-slots')).toMatchObject({ acceptedSlots: [0], progressState: 'partial' });

    const second = await resolver.resolve(await input('candidate-second', 'puzzle{second}'));
    expect(second).toMatchObject({ status: 'accepted', authoritative: true, correct_flag_count: 2, total_flag_count: 2,
      matched_slot: 1, completed: true, verification: { status: 'verified', current: true } });
    expect(state.multiFlagProgress('t6-two-slots')).toMatchObject({ acceptedSlots: [0, 1], progressState: 'completed' });
  });

  it('is wired as SolverLoop host resolver and solves both slots only after each verified submission', async () => {
    const first = [process.execPath, '-e', 'process.stdout.write("puzzle{first}\\n")'];
    const second = [process.execPath, '-e', 'process.stdout.write("puzzle{second}\\n")'];
    const { driver, requests } = scripted([
      dispatch('slot-a', first), { kind: 'tool', tool: 'job.run', input: { command: first }, step_id: 'run' },
      request => ({ kind: 'candidate', value: 'puzzle{first}', evidence_refs: request.observation!.artifact_refs }),
      request => { expect(request.observation?.tool).toBe('candidate.resolve'); expect(request.observation?.raw).toContain('accepted slot'); return dispatch('slot-b', second); },
      { kind: 'tool', tool: 'job.run', input: { command: second }, step_id: 'run' },
      request => ({ kind: 'candidate', value: 'puzzle{second}', evidence_refs: request.observation!.artifact_refs })
    ]);
    let resolver!: VerifiedMultiFlagCandidateResolver;
    const env = await setup('t2-falsified', driver, { resolveCandidate: input => resolver.resolve(input) });
    try {
      const verifier = new IndependentVerificationService(env.artifacts, env.registry, { makeTask: input => ({ run_id: 'run' as never,
        challenge_id: input.challengeId as never, task_id: input.taskId as never, attempt_id: input.attemptId as never,
        responsibility_set: ['verification'], lease: { lease_id: input.leaseId as never, expires_at: input.expiresAt } }) as ResponsibilityTask });
      resolver = new VerifiedMultiFlagCandidateResolver({ artifacts: env.artifacts, state: env.state,
        engineering: new SolutionEngineeringService(env.artifacts), verifier,
        coordinator: new VerifiedCoordinator(new Coordinator(new PlatformService(env.state, createT6Oracle()), 'run' as never), verifier),
        plan: async (input, candidate) => {
          const raw = await env.artifacts.read(input.evidenceRefs[0]!);
          const bytes = Buffer.from(candidate.value);
          const start = raw.indexOf(bytes);
          if (start < 0 || raw.indexOf(bytes, start + 1) >= 0) throw new Error('candidate transcript range is absent or ambiguous');
          const dependencies = Object.entries(input.experiment.plan.state_dependencies).map(([output_id, revision]) => {
            if (!Number.isSafeInteger(revision)) throw new Error('candidate dependency revision is not numeric');
            return { output_id, revision: revision as number };
          });
          const commands = input.experiment.plan.procedure.filter(step => step.tool === 'job.run').map(step => (step.input as { command: string[] }).command);
          if (commands.length !== 1) throw new Error('candidate engineering currently requires one replayable command');
          return { engineering: { command: commands[0]!,
            scriptRef: await env.artifacts.publish(Buffer.from(JSON.stringify(input.experiment.plan.procedure))),
            inputRefs: [...input.experiment.plan.input_refs], dependencyVersions: dependencies,
            extractionRule: 'unique candidate byte range in complete immutable output transcript' },
            verification: { evidence: { transcriptRef: input.evidenceRefs[0], transcriptComplete: true,
              candidateStartByte: start, candidateEndByte: start + bytes.length } },
            submission: { task: 'solver' as never, lease: 'lease' as never },
            current: async () => ({ dependencyVersions: dependencies, generation: input.generation, unknownAffectedEffect: false }) };
        }
      });
      const result = await env.loop.run();
      expect(result.status).toBe('solved');
      expect(env.state.multiFlagProgress('challenge')).toMatchObject({ acceptedSlots: [0, 1], correctFlagCount: 2, progressState: 'completed' });
      expect(aggregateM1RunMetrics(env.state.events()).candidateLifecycleMs).toMatchObject({ state: 'observed', value: {
        engineeringMs: { state: 'observed', value: [expect.any(Number), expect.any(Number)] },
        verificationMs: { state: 'observed', value: [expect.any(Number), expect.any(Number)] },
        oracleSubmitMs: { state: 'observed', value: [expect.any(Number), expect.any(Number)] },
        candidateToAcceptanceMs: { state: 'observed', value: [expect.any(Number), expect.any(Number)] }
      } });
    } finally { await env.close(); }
  });

  it('returns verifier-approved oracle rejection as diagnostic evidence and continues the same Solver route', async () => {
    const wrong = [process.execPath, '-e', 'process.stdout.write("puzzle{wrong}\\n")'];
    const first = [process.execPath, '-e', 'process.stdout.write("puzzle{first}\\n")'];
    const second = [process.execPath, '-e', 'process.stdout.write("puzzle{second}\\n")'];
    const { driver, requests } = scripted([
      dispatch('wrong-slot', wrong), { kind: 'tool', tool: 'job.run', input: { command: wrong }, step_id: 'run' },
      request => ({ kind: 'candidate', value: 'puzzle{wrong}', evidence_refs: request.observation!.artifact_refs }),
      request => {
        expect(request.phase).toBe('solver');
        expect(request.observation?.raw).toContain('diagnose extraction, encoding, slot, generation and hypothesis');
        return dispatch('first-slot', first);
      },
      { kind: 'tool', tool: 'job.run', input: { command: first }, step_id: 'run' },
      request => ({ kind: 'candidate', value: 'puzzle{first}', evidence_refs: request.observation!.artifact_refs }),
      request => { expect(request.observation?.tool).toBe('candidate.resolve'); return dispatch('second-slot', second); },
      { kind: 'tool', tool: 'job.run', input: { command: second }, step_id: 'run' },
      request => ({ kind: 'candidate', value: 'puzzle{second}', evidence_refs: request.observation!.artifact_refs })
    ]);
    let resolver!: VerifiedMultiFlagCandidateResolver;
    const env = await setup('t2-falsified', driver, { resolveCandidate: input => resolver.resolve(input) });
    try {
      const verifier = new IndependentVerificationService(env.artifacts, env.registry, { makeTask: input => ({ run_id: 'run' as never,
        challenge_id: input.challengeId as never, task_id: input.taskId as never, attempt_id: input.attemptId as never,
        responsibility_set: ['verification'], lease: { lease_id: input.leaseId as never, expires_at: input.expiresAt } }) as ResponsibilityTask });
      resolver = new VerifiedMultiFlagCandidateResolver({ artifacts: env.artifacts, state: env.state,
        engineering: new SolutionEngineeringService(env.artifacts), verifier,
        coordinator: new VerifiedCoordinator(new Coordinator(new PlatformService(env.state, createT6Oracle()), 'run' as never), verifier),
        plan: async (input, candidate) => {
          const raw = await env.artifacts.read(input.evidenceRefs[0]!);
          const bytes = Buffer.from(candidate.value);
          const start = raw.indexOf(bytes);
          if (start < 0 || raw.indexOf(bytes, start + 1) >= 0) throw new Error('candidate transcript range is absent or ambiguous');
          const dependencies = Object.entries(input.experiment.plan.state_dependencies).map(([output_id, revision]) => {
            if (!Number.isSafeInteger(revision)) throw new Error('candidate dependency revision is not numeric');
            return { output_id, revision: revision as number };
          });
          const commands = input.experiment.plan.procedure.filter(step => step.tool === 'job.run').map(step => (step.input as { command: string[] }).command);
          if (commands.length !== 1) throw new Error('candidate engineering currently requires one replayable command');
          return { engineering: { command: commands[0]!, scriptRef: await env.artifacts.publish(Buffer.from(JSON.stringify(input.experiment.plan.procedure))),
            inputRefs: [...input.experiment.plan.input_refs], dependencyVersions: dependencies,
            extractionRule: 'unique candidate byte range in complete immutable output transcript' },
            verification: { evidence: { transcriptRef: input.evidenceRefs[0], transcriptComplete: true,
              candidateStartByte: start, candidateEndByte: start + bytes.length } },
            submission: { task: 'solver' as never, lease: 'lease' as never },
            current: async () => ({ dependencyVersions: dependencies, generation: input.generation, unknownAffectedEffect: false }) };
        }
      });
      const result = await env.loop.run();
      expect(result.status).toBe('solved');
      expect(requests[3]?.observation?.raw).toContain('diagnose extraction');
      expect(env.state.multiFlagProgress('challenge')).toMatchObject({ acceptedSlots: [0, 1], progressState: 'completed' });
    } finally { await env.close(); }
  });
});
