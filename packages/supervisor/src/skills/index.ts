export type Domain = 'web' | 'misc' | 'crypto';
export interface DomainSkill {
  readonly domain: Domain;
  readonly scope: 'benign_synthetic_fixtures';
  readonly applicabilityClues: readonly string[];
  readonly minimalExperiment: readonly string[];
  readonly failureBranches: readonly string[];
  readonly verification: readonly string[];
}

export function defineSkill(skill: DomainSkill): DomainSkill {
  for (const field of ['applicabilityClues', 'minimalExperiment', 'failureBranches', 'verification'] as const) Object.freeze(skill[field]);
  return Object.freeze(skill);
}

/** Domain details stay outside the general Solver prompt and load only on request. */
export async function loadDomainSkill(domain: Domain): Promise<DomainSkill> {
  switch (domain) {
    case 'web': return (await import('./web.js')).skill;
    case 'misc': return (await import('./misc.js')).skill;
    case 'crypto': return (await import('./crypto.js')).skill;
    default: throw new Error(`unsupported domain: ${String(domain)}`);
  }
}
