import { IntentSchema, type ChallengeId, type TaskId, type LeaseId } from '@ctf/contracts';
import type { StateStore } from '@ctf/state';

export interface OracleResult {
  authoritative: true;
  status: 'accepted' | 'rejected' | 'duplicate' | 'invalid_state' | 'closed';
  requiredSlots: number;
  correctFlagCount?: number;
  totalFlagCount?: number;
  matchedSlot?: number;
  completed?: boolean;
}

export interface LocalOracleAdapter {
  name: 'local_oracle';
  submit(candidate: string): Promise<OracleResult>;
}

export class MockPlatformAdapter implements LocalOracleAdapter {
  readonly name = 'local_oracle' as const;
  private submitted = new Set<string>();
  private closed = false;
  private state: 'pending' | 'available' | 'stopped' = 'available';

  constructor(private readonly correctFlag: string, private readonly requiredSlots = 1) {}

  async submit(candidate: string): Promise<OracleResult> {
    if (this.closed || this.state !== 'available') return { authoritative: true, status: 'invalid_state', requiredSlots: this.requiredSlots };
    if (this.submitted.has(candidate)) return { authoritative: true, status: 'duplicate', requiredSlots: this.requiredSlots };
    this.submitted.add(candidate);
    return { authoritative: true, status: candidate === this.correctFlag ? 'accepted' : 'rejected', requiredSlots: this.requiredSlots };
  }

  stop(): void { this.state = 'stopped'; }
}

export interface SubmissionResult {
  effectId: string;
  result: OracleResult;
  businessOutcome: OracleResult['status'];
}

export class PlatformService {
  constructor(private readonly state: StateStore, private readonly oracle: LocalOracleAdapter) {}

  async executeIntent(input: {
    runId: string;
    intent: unknown;
    actor: 'coordinator' | 'solver' | 'verifier';
    generation?: number;
    budget?: { wallClockMs: number; maxSteps: number; maxToolJobs: number; maxObservableTokens: number };
    deadline?: string;
    beforeDispatch?: () => void;
  }): Promise<SubmissionResult> {
    if (input.actor !== 'coordinator') throw new Error('only Coordinator may submit platform intent');
    const intent = IntentSchema.parse(input.intent);
    const generation = input.generation ?? 1;
    const prepared = this.state.prepareEffect({
      id: `effect_${intent.lease}_${generation}`,
      runId: input.runId,
      operation: 'candidate.submit',
      kind: 'protected_effect',
      payload: intent,
      challengeId: intent.challengeId,
      generation,
      budget: input.budget ?? { wallClockMs: 1, maxSteps: 1, maxToolJobs: 1, maxObservableTokens: 1 },
      deadline: input.deadline ?? new Date(Date.now() + 30000).toISOString(),
      expectedPostcondition: 'authoritative oracle response recorded'
    });
    if (prepared.state === 'confirmed' && prepared.authoritativeResponse) {
      return { effectId: prepared.id, result: prepared.authoritativeResponse as OracleResult, businessOutcome: prepared.businessOutcome! };
    }
    try { input.beforeDispatch?.(); }
    catch (error) { this.state.failNotDispatched(prepared.id); throw error; }
    const dispatching = this.state.dispatchEffect(prepared.id);
    try {
      const result = await this.oracle.submit(intent.candidate);
      const confirmed = this.state.confirmEffect(dispatching.id, result, result.status);
      return { effectId: confirmed.id, result, businessOutcome: confirmed.businessOutcome! };
    } catch (error) {
      await this.state.markUnknown(dispatching.id);
      throw error;
    }
  }
}

export class Coordinator {
  constructor(private readonly platform: PlatformService, private readonly runId: string) {}

  submitCandidate(input: {
    candidate: string;
    challengeId: ChallengeId;
    task: TaskId;
    lease: LeaseId;
    generation?: number;
    budget?: { wallClockMs: number; maxSteps: number; maxToolJobs: number; maxObservableTokens: number };
    deadline?: string;
    beforeDispatch?: () => void;
  }): Promise<SubmissionResult> {
    return this.platform.executeIntent({
      runId: this.runId,
      intent: { intent: 'candidate.submit', candidate: input.candidate, challengeId: input.challengeId, task: input.task, lease: input.lease },
      actor: 'coordinator',
      generation: input.generation,
      budget: input.budget,
      deadline: input.deadline,
      beforeDispatch: input.beforeDispatch
    });
  }
}
