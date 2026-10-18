import { createHash } from 'node:crypto';
import type { ChallengeId, TaskId, LeaseId } from '@ctf/contracts';
import type { SubmissionResult } from '@ctf/platform';
import type { StateStore } from '@ctf/state';

export interface MultiFlagProgress { acceptedSlots: number[]; correctFlagCount: number; totalFlagCount: number; progressState: 'partial' | 'completed' }
export type MultiFlagSubmit = (input: { candidate: string; challengeId: ChallengeId; task: TaskId; lease: LeaseId }, generation: number) => Promise<SubmissionResult>;

/** Submits each newly found flag immediately, checkpoints authoritative slots, and asks Solver for the next one after partial. */
export class MultiFlagContinuation {
  constructor(private readonly state: StateStore, private readonly submit: MultiFlagSubmit) {}

  async run(input: { challengeId: ChallengeId; task: TaskId; lease: LeaseId; firstCandidate: string; maxCandidates: number;
    nextCandidate: (progress: MultiFlagProgress, previous: SubmissionResult) => Promise<string | undefined> }): Promise<{
      outcome: 'partial' | 'completed' | 'inconclusive'; progress?: MultiFlagProgress; submissions: SubmissionResult[];
    }> {
    if (!Number.isSafeInteger(input.maxCandidates) || input.maxCandidates < 1 || input.maxCandidates > 100) throw new Error('candidate continuation bound must be 1..100');
    const seen = new Set<string>(); const submissions: SubmissionResult[] = [];
    let candidate: string | undefined = input.firstCandidate; let turns = 0;
    let progress = this.state.multiFlagProgress(input.challengeId);
    while (candidate && submissions.length < input.maxCandidates && turns++ < input.maxCandidates) {
      if (!candidate.trim()) throw new Error('empty flag candidate');
      if (seen.has(candidate)) { candidate = progress && submissions.length ? await input.nextCandidate(progress, submissions.at(-1)!) : undefined; continue; }
      seen.add(candidate);
      const generation = this.state.allocateSubmissionGeneration(input.challengeId);
      const result = await this.submit({ candidate, challengeId: input.challengeId, task: input.task, lease: input.lease }, generation);
      submissions.push(result);
      if (!result.result.authoritative || !result.result.totalFlagCount || result.result.correctFlagCount === undefined || result.result.completed === undefined) {
        return { outcome: 'inconclusive', ...(progress ? { progress } : {}), submissions };
      }
      if (result.businessOutcome === 'accepted') {
        if (result.result.matchedSlot === undefined) return { outcome: 'inconclusive', ...(progress ? { progress } : {}), submissions };
        const candidateHash = createHash('sha256').update(Buffer.from(candidate, 'utf8')).digest('hex');
        progress = this.state.recordAcceptedFlag({ challengeId: input.challengeId, slot: result.result.matchedSlot,
          candidateHash, correctFlagCount: result.result.correctFlagCount, totalFlagCount: result.result.totalFlagCount, completed: result.result.completed });
        if (result.result.completed && progress.progressState === 'completed') return { outcome: 'completed', progress, submissions };
        // Every accepted slot is durable before the next Solver continuation is requested.
        candidate = await input.nextCandidate(progress, result);
        continue;
      }
      if (result.businessOutcome === 'duplicate') {
        progress = this.state.multiFlagProgress(input.challengeId);
        if (progress?.progressState === 'completed') return { outcome: 'completed', progress, submissions };
      }
      candidate = progress ? await input.nextCandidate(progress, result) : undefined;
    }
    return { outcome: progress?.progressState === 'completed' ? 'completed' : progress ? 'partial' : 'inconclusive', ...(progress ? { progress } : {}), submissions };
  }
}
