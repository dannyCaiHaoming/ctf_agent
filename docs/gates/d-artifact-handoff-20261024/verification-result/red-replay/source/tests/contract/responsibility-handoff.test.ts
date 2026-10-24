import { describe, expect, it } from 'vitest';
import { HandoffEnvelopeSchema, HandoffSubmissionSchema, ResponsibilitySetSchema, responsibilities } from '../../packages/contracts/src/index.js';

export const ref = (letter = 'a') => ({ hash: letter.repeat(64), size: 3, path: `/artifacts/${letter.repeat(64)}` });
export const submission = () => ({
  responsibility: 'domain_solver', revision: 0, consumed_snapshot_sequence: 2,
  input_refs: [ref()], dependency_versions: [{ output_id: 'recon', revision: 0 }],
  status: 'completed', outputs: [
    { kind: 'artifact', name: 'candidate', ref: ref() },
    { kind: 'decision', statement: 'Try the smallest probe', basis_refs: [ref()] }
  ],
  observation_refs: [ref()], evidence_refs: [ref()],
  assumptions: [{ statement: 'Endpoint parses input', basis_refs: [ref()] }],
  rejected_assumptions: [{ statement: 'Input is trusted', reason: 'Probe contradicts it', basis_refs: [ref()] }],
  unresolved_questions: ['Is decoding repeated?'], next_action: 'Replay candidate', failure_code: null,
  actual_cost: { wall_clock_ms: 0, model_calls: 0, tool_jobs: 0, observable_tokens: 0, monetary_cost: 0 }
});
const envelope = () => ({ task_id: 'task-1', attempt_id: 'attempt-1', ...submission() });

describe('responsibility handoff contracts', () => {
  it('locks the exact responsibility vocabulary and bounded unique task sets', () => {
    expect(responsibilities).toEqual(['coordination', 'intake_triage', 'target_recon', 'reference', 'strategy', 'domain_solver', 'solution_engineering', 'verification', 'recovery_critic']);
    expect(ResponsibilitySetSchema.safeParse(['intake_triage', 'target_recon', 'strategy', 'domain_solver']).success).toBe(true);
    for (const invalid of [[], ['recon'], ['strategy', 'strategy'], ['verification', 'domain_solver'], [...responsibilities]]) {
      expect(ResponsibilitySetSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it('keeps observation, assumptions and decisions structurally distinct', () => {
    expect(HandoffEnvelopeSchema.parse(envelope())).toEqual(envelope());
    expect(HandoffSubmissionSchema.safeParse({ ...submission(), outputs: [{ kind: 'observation', statement: 'a guess' }] }).success).toBe(false);
    expect(HandoffSubmissionSchema.safeParse({ ...submission(), assumptions: [ref()] }).success).toBe(false);
  });
  it.each(Object.keys(envelope()))('requires envelope field %s', key => {
    const value: Record<string, unknown> = envelope();
    delete value[key];
    expect(HandoffEnvelopeSchema.safeParse(value).success).toBe(false);
  });
  const invalidFields: Record<string, unknown> = {
    task_id: '', attempt_id: '', responsibility: 'verifier', revision: -1, consumed_snapshot_sequence: 0.5,
    input_refs: [{ ...ref(), hash: 'mutable-log' }], dependency_versions: [{ output_id: '', revision: 0 }],
    status: 'solved', outputs: [{ kind: 'artifact', name: '', ref: ref() }],
    observation_refs: [{ ...ref(), size: -1 }], evidence_refs: [{ ...ref(), path: '' }],
    assumptions: [{ statement: '', basis_refs: [] }], rejected_assumptions: [{ statement: 'x', reason: '', basis_refs: [] }],
    unresolved_questions: [''], next_action: '', failure_code: '', actual_cost: { ...submission().actual_cost, model_calls: -1 }
  };
  it.each(Object.keys(invalidFields))('validates envelope field %s', key => {
    expect(HandoffEnvelopeSchema.safeParse({ ...envelope(), [key]: invalidFields[key] }).success).toBe(false);
  });
  it('rejects model identity, unknown nested fields, nonfinite costs, and duplicate dependency keys', () => {
    for (const key of ['task_id', 'attempt_id', 'run_id', 'challenge_id', 'session_id', 'responsibility_set']) {
      expect(HandoffSubmissionSchema.safeParse({ ...submission(), [key]: 'forged' }).success).toBe(false);
    }
    for (const field of Object.keys(submission().actual_cost)) {
      for (const invalid of [-1, Infinity, NaN]) {
        expect(HandoffSubmissionSchema.safeParse({ ...submission(), actual_cost: { ...submission().actual_cost, [field]: invalid } }).success).toBe(false);
      }
    }
    expect(HandoffSubmissionSchema.safeParse({ ...submission(), input_refs: [{ ...ref(), mutable: true }] }).success).toBe(false);
    expect(HandoffSubmissionSchema.safeParse({ ...submission(), dependency_versions: [{ output_id: 'x', revision: 0 }, { output_id: 'x', revision: 1 }] }).success).toBe(false);
  });
});
