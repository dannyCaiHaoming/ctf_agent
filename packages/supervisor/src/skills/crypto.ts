import { defineSkill } from './index.js';
export const skill = defineSkill({
  domain: 'crypto', scope: 'benign_synthetic_fixtures',
  applicabilityClues: ['A synthetic byte/integer or modular arithmetic puzzle specifies byte width, endian, domain and padding assumptions.'],
  minimalExperiment: ['Preserve bytes as exact hex plus integer, leading/trailing zero counts, width, endian, padding and source ref.', 'Functionally self-check local Python integer gcd, modular inverse and modular exponentiation; then run a bounded computation after necessary-condition checks.'],
  failureBranches: ['Reject overflow, ambiguous integer spelling, non-coprime inverse inputs and out-of-range budgets before starting a job.', 'Unprobed SageMath/symbolic capabilities return a specific needs_capability together with genuinely verified integer alternatives.'],
  verification: ['Recompute integer arithmetic independently in the host and retain the actual job transcript and exact input.', 'Preserve byte width on reverse conversion; separate local oracle equality acceptance from candidate registration and full verifier work.']
});
