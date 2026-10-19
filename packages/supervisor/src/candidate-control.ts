import type { Budget, ImmutableArtifactRef } from '@ctf/contracts';
import type { HypothesisManager } from './hypotheses.js';

/** Host-owned candidate/replay control, independent of any model action protocol. */
export interface CandidateResolution {
  status: 'accepted' | 'partial' | 'rejected' | 'inconclusive';
  authoritative: boolean;
  detail: string;
  evidence_refs?: ImmutableArtifactRef[];
  correct_flag_count?: number;
  total_flag_count?: number;
  matched_slot?: number;
  submit_effect_id?: string;
  completed?: boolean;
  verification?: { id: string; status: 'verified' | 'rejected' | 'inconclusive' | 'stale'; candidateHash: string; generation: number; current: boolean };
}
export interface CandidateResolverInput {
  candidateId: string; runId: string; challengeId: string; taskId: string; sessionId: string; generation: number; value: string;
  valueRef: ImmutableArtifactRef; evidenceRefs: ImmutableArtifactRef[]; experimentId: string;
  experiment: ReturnType<HypothesisManager['experiment']>;
  control: CandidateResolverControl;
  stageEvent: (stage: 'engineering' | 'verification' | 'oracle_submit', state: 'started' | 'completed' | 'failed') => void;
}
export interface CandidateResolverControl {
  signal: AbortSignal;
  deadline: string;
  remaining: () => Budget;
  admit: (stage: 'engineering' | 'verification' | 'verification_replay' | 'oracle_submit') => Budget;
}
