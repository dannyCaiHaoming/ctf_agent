import { describe, expect, it } from 'vitest';
import {
  BudgetSchema, EventDeltaSchema, IntentSchema, ModelFacingDTOSchema, ObservationSchema,
  pipelineStages, progressStates, resourceStates, cleanupStates, runStates, solveStates,
  CleanupStateSchema, ProgressStateSchema, ResourceStateSchema, RunStateSchema, SolveStateSchema, PipelineStageSchema,
  outcomes, effectLevels, dataClasses
} from '../../packages/contracts/src/index.js';

const enumFixture = {
  pipeline_stage: ['intake', 'recon', 'strategy', 'solving', 'engineering', 'verifying', 'submitting', 'finalizing'],
  solve_state: ['queued', 'active', 'paused', 'blocked_auth', 'blocked_capability', 'blocked_data', 'blocked_platform', 'blocked_runtime', 'finished', 'deadline_exceeded'],
  progress_state: ['no_candidate', 'candidate', 'candidate_only', 'partial', 'completed', 'unknown_total'],
  resource_state: ['absent', 'starting', 'ready', 'retained', 'closing', 'closed', 'unknown'],
  cleanup_state: ['not_needed', 'pending', 'succeeded', 'failed', 'unknown'],
  run_state: ['draft', 'prepared', 'starting', 'admitting', 'running', 'interrupted', 'finalizing', 'completed', 'failed', 'invalid', 'aborted']
};

describe('contracts', () => {
  it('locks every state vocabulary to spec §7.1', () => {
    expect([...pipelineStages]).toEqual(enumFixture.pipeline_stage);
    expect([...solveStates]).toEqual(enumFixture.solve_state);
    expect([...progressStates]).toEqual(enumFixture.progress_state);
    expect([...resourceStates]).toEqual(enumFixture.resource_state);
    expect([...cleanupStates]).toEqual(enumFixture.cleanup_state);
    expect([...runStates]).toEqual(enumFixture.run_state);
    expect(CleanupStateSchema.safeParse('failed').success).toBe(true);
    expect(CleanupStateSchema.safeParse('failed_not_dispatched').success).toBe(false);
    expect(ProgressStateSchema.safeParse('solved').success).toBe(false);
    expect(ResourceStateSchema.safeParse('running').success).toBe(false);
    expect(RunStateSchema.safeParse('active').success).toBe(false);
    expect(SolveStateSchema.safeParse('completed').success).toBe(false);
    expect(PipelineStageSchema.safeParse('verify').success).toBe(false);
  });

  it('accepts valid IDs, budgets, observations and intents; rejects malformed values', () => {
    expect(BudgetSchema.safeParse({ wallClockMs: 1, maxSteps: 1, maxToolJobs: 1, maxObservableTokens: 1 }).success).toBe(true);
    expect(BudgetSchema.safeParse({ wallClockMs: 0, maxSteps: 1, maxToolJobs: 1, maxObservableTokens: 1 }).success).toBe(false);
    expect(ObservationSchema.safeParse({ cursor: 1, bytes: 1, effect: 'retryable_observation', immutableRange: { startCursor: 0, endCursor: 1, complete: true, publishedAt: new Date().toISOString() } }).success).toBe(true);
    expect(ObservationSchema.safeParse({ cursor: 1, bytes: 1, effect: 'protected_effect', immutableRange: { startCursor: 2, endCursor: 1, complete: true, publishedAt: new Date().toISOString() } }).success).toBe(false);
    expect(IntentSchema.safeParse({ intent: 'candidate.submit', candidate: 'flag{x}', challengeId: 'c1', task: 't1', lease: 'l1' }).success).toBe(true);
    expect(IntentSchema.safeParse({ intent: 'candidate.submit', candidate: '', challengeId: 'c1', task: 't1', lease: 'l1' }).success).toBe(false);
  });

  it('keeps outcome and data/effect vocabularies exact', () => {
    expect(outcomes).toEqual(['solved', 'partial', 'candidate_only', 'unsolved', 'inconclusive', 'infrastructure_invalid']);
    expect(effectLevels).toEqual(['local_rebuildable', 'retryable_observation', 'protected_effect']);
    expect(dataClasses).toEqual(['control_secret', 'challenge_auth_reference', 'challenge_analysis_data', 'artifact_bulk', 'allowed_excerpt', 'unknown']);
  });

  it('gives control secrets no path into model-facing DTOs', () => {
    expect(ModelFacingDTOSchema.safeParse({ kind: 'model_facing', challengeId: 'c', data: 'safe' }).success).toBe(true);
  });

  it('validates event deltas', () => {
    expect(EventDeltaSchema.safeParse({ kind: 'run.state', runId: 'r', from: 'draft', to: 'starting', at: new Date().toISOString() }).success).toBe(true);
    expect(EventDeltaSchema.safeParse({ kind: 'run.state', runId: 'r', from: 'blocked_runtime', to: 'starting', at: new Date().toISOString() }).success).toBe(false);
  });
});
