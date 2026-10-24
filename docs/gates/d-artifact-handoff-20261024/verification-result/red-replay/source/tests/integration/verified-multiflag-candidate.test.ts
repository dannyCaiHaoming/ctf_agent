import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@ctf/artifacts';
import { ToolRuntime } from '@ctf/runtime';
import { Coordinator, PlatformService } from '@ctf/platform';
import { StateStore } from '@ctf/state';
import { IndependentVerificationService, SolutionEngineeringService, VerifiedCoordinator,
  VerifiedMultiFlagCandidateResolver, ResponsibilityRegistry } from '@ctf/supervisor';
import { createT6Oracle } from '../../fixtures/trajectories/t6-multiflag/oracle.js';
import type { CandidateResolverInput } from '../../packages/supervisor/src/candidate-control.js';
import type { ResponsibilityTask } from '../../packages/contracts/src/index.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

// Host component integration only. OpenCode multi-flag continuation belongs to M1b.
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'verified-multiflag-'));
  const artifacts = new ArtifactStore(join(root, 'artifacts'));
  const state = new StateStore(join(root, 'state'), 'run');
  const runtime = new ToolRuntime(artifacts, join(root, 'workspaces'), 'run', 'challenge');
  cleanups.push(async () => { await runtime.dispose(); state.close(); await rm(root, { recursive: true, force: true }); });
  const registry = new ResponsibilityRegistry({ verifyArtifact: ref => artifacts.verify(ref) });
  const verifier = new IndependentVerificationService(artifacts, registry, { makeTask: input => ({ run_id: 'run' as never,
    challenge_id: input.challengeId as never, task_id: input.taskId as never, attempt_id: input.attemptId as never,
    responsibility_set: ['verification'], lease: { lease_id: input.leaseId as never, expires_at: input.expiresAt } }) as ResponsibilityTask });
  const dependencies = [{ output_id: 'fixture-input', revision: 1 }];
  const resolver = new VerifiedMultiFlagCandidateResolver({ artifacts, state, engineering: new SolutionEngineeringService(artifacts), verifier,
    coordinator: new VerifiedCoordinator(new Coordinator(new PlatformService(state, createT6Oracle()), 'run' as never), verifier),
    plan: async (input, candidate) => {
      const raw = await artifacts.read(input.evidenceRefs[0]!);
      const start = raw.indexOf(Buffer.from(candidate.value));
      if (start < 0 || raw.indexOf(Buffer.from(candidate.value), start + 1) >= 0) throw new Error('candidate transcript range is absent or ambiguous');
      return {
        engineering: { command: [process.execPath, 'solve.mjs'], scriptRef: await artifacts.publish(await runtime.workspace('solver').read('solve.mjs')),
          inputRefs: [...input.evidenceRefs], dependencyVersions: dependencies, extractionRule: 'unique candidate byte range in complete immutable output transcript' },
        verification: { evidence: { transcriptRef: input.evidenceRefs[0], transcriptComplete: true,
          candidateStartByte: start, candidateEndByte: start + Buffer.byteLength(candidate.value) } },
        submission: { task: 'solver' as never, lease: 'lease' as never },
        current: async () => ({ dependencyVersions: dependencies, generation: input.generation, unknownAffectedEffect: false })
      };
    } });
  const stages: string[] = [];
  let sequence = 0;
  async function submitOutput(value: string) {
    const id = `candidate-${++sequence}`;
    await runtime.workspace('solver').patch('solve.mjs', `process.stdout.write(${JSON.stringify(value + '\n')});`);
    const job = await runtime.jobStart({ taskId: 'solver', command: [process.execPath, 'solve.mjs'], timeoutMs: 5000 });
    await vi.waitUntil(() => runtime.jobStatus(job.id)?.status !== 'running');
    expect(runtime.jobStatus(job.id)?.exitCode).toBe(0);
    const output = runtime.jobOutput(job.id);
    expect(output.complete).toBe(true);
    expect(output.stdout.toString()).toBe(value + '\n');
    const valueRef = await artifacts.publish(Buffer.from(value));
    const outputRef = await artifacts.publish(output.stdout);
    const budget = { wallClockMs: 60000, maxSteps: 100, maxToolJobs: 100, maxObservableTokens: 10000 };
    const input: CandidateResolverInput = { candidateId: id, runId: 'run', challengeId: 'challenge', taskId: 'solver', sessionId: 'component-solver',
      generation: 1, value, valueRef: valueRef as never, evidenceRefs: [outputRef as never], experimentId: `experiment-${id}`,
      control: { signal: new AbortController().signal, deadline: new Date(Date.now() + 60000).toISOString(), remaining: () => budget, admit: () => budget },
      stageEvent: (stage, status) => { stages.push(`${id}:${stage}:${status}`); },
      experiment: { plan: { input_refs: [], state_dependencies: { generation: 1 }, procedure: [] }, fingerprint: id,
        status: 'succeeded', events: [], activities: [], redispatch_reason: null, conclusion: null } as never };
    return resolver.resolve(input);
  }
  return { state, registry, verifier, stages, submitOutput };
}

describe('frozen verified multi-flag host components', () => {
  it('persists each verified accepted slot before a subsequent candidate is processed', async () => {
    const { state, submitOutput } = await setup();
    expect(await submitOutput('puzzle{first}')).toMatchObject({ status: 'partial', authoritative: true, correct_flag_count: 1,
      total_flag_count: 2, matched_slot: 0, completed: false, verification: { status: 'verified', current: true } });
    expect(state.multiFlagProgress('challenge')).toMatchObject({ acceptedSlots: [0], progressState: 'partial' });
    expect(await submitOutput('puzzle{second}')).toMatchObject({ status: 'accepted', authoritative: true, correct_flag_count: 2,
      total_flag_count: 2, matched_slot: 1, completed: true, verification: { status: 'verified', current: true } });
    expect(state.multiFlagProgress('challenge')).toMatchObject({ acceptedSlots: [0, 1], progressState: 'completed' });
  });

  it('uses independent verification sessions and emits all guarded lifecycle stages for both candidates', async () => {
    const { registry, verifier, stages, submitOutput } = await setup();
    const verification = vi.spyOn(verifier, 'verify');
    await submitOutput('puzzle{first}');
    await submitOutput('puzzle{second}');
    expect(verification).toHaveBeenCalledTimes(2);
    const records = await Promise.all(verification.mock.results.map(result => result.value));
    const sessions = records.map(record => {
      expect(registry.binding(record.verifierSessionId).responsibility_set).toEqual(['verification']);
      expect(record.verifierSessionId).not.toBe('component-solver');
      return record.verifierSessionId;
    });
    expect(new Set(sessions).size).toBe(2);
    expect(stages).toEqual(['candidate-1', 'candidate-2'].flatMap(id => ['engineering', 'verification', 'oracle_submit']
      .flatMap(stage => [`${id}:${stage}:started`, `${id}:${stage}:completed`])));
  });

  it('returns verified oracle rejection with diagnostics and permits later candidates without losing accepted slots', async () => {
    const { state, submitOutput } = await setup();
    expect(await submitOutput('puzzle{wrong}')).toMatchObject({ status: 'rejected', authoritative: true,
      verification: { status: 'verified' }, detail: expect.stringContaining('diagnose extraction, encoding, slot, generation and hypothesis') });
    expect(state.multiFlagProgress('challenge')).toBeUndefined();
    expect(await submitOutput('puzzle{first}')).toMatchObject({ status: 'partial', completed: false });
    expect(await submitOutput('puzzle{another_wrong}')).toMatchObject({ status: 'rejected' });
    expect(state.multiFlagProgress('challenge')).toMatchObject({ acceptedSlots: [0], progressState: 'partial' });
    expect(await submitOutput('puzzle{second}')).toMatchObject({ status: 'accepted', completed: true });
    expect(state.multiFlagProgress('challenge')).toMatchObject({ acceptedSlots: [0, 1], progressState: 'completed' });
  });
});
