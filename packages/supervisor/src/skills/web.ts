import { defineSkill } from './index.js';
export const skill = defineSkill({
  domain: 'web', scope: 'benign_synthetic_fixtures',
  applicabilityClues: ['A supplied local synthetic HTTP puzzle has ordinary documented parameters and a known session context.'],
  minimalExperiment: ['Capture normal, login and unified-error responses through the supplied transport; retain exact request and response references.', 'Change one benign query value while preserving endpoint, method, headers and session; compare the retained responses.'],
  failureBranches: ['Exclude login, unified error, redirect and declared client URL rewrites before interpreting a baseline.', 'A 500, reflection or timing difference is an observation only. Multiple changed variables require a fresh controlled pair.'],
  verification: ['Read both immutable responses and the comparison transcript. Register only an exactly framed synthetic candidate with evidence.', 'Use the independent local puzzle oracle for equality acceptance; this method makes no vulnerability or live-model capability claim.']
});
