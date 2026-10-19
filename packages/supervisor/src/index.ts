// Reusable host services only. OpenCode owns model invocation and the Agent loop.
export { ResponsibilityRegistry } from './responsibilities.js';
export type { ResponsibilityBinding, ReasoningContext, VerifyArtifact, DeepReadonly } from './responsibilities.js';
export { PublishedRevisionService } from './revisions.js';
export type { PublishedOutput, AdoptedOutput, AdoptionResult } from './revisions.js';

export { HypothesisManager, experimentFingerprint } from './hypotheses.js';
export type { HypothesisManagerOptions, ExperimentRecord, ProgressRecord, ProgressAcceptance, ProgressWindow } from './hypotheses.js';
export type { CandidateResolverInput, CandidateResolverControl, CandidateResolution } from './candidate-control.js';
export { DurableJobWatchService } from './long-job-watch.js';
export * from './compaction.js';
export * from './local-resume.js';
export * from './candidate-verification.js';
export * from './http-progress-adjudicator.js';
export * from './multiflag.js';
