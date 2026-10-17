import { readFile } from 'node:fs/promises';

export interface ReleaseProfile {
  profileId: string;
  model: { provider: string; id: string; baseUrl?: string; apiKeyEnv?: string };
  reference: { enabled: boolean };
  budget: { wallClockMs: number; maxSteps: number; maxToolJobs: number; maxObservableTokens: number };
  os: { platform: 'macos' | 'linux' };
}

export async function loadReleaseProfile(path: string): Promise<ReleaseProfile> {
  const raw = await readFile(path, 'utf8');
  if (/(?:api[_-]?key|secret|password|credential)\s*:/i.test(raw)) throw new Error('release profile must not contain secrets');
  const value = JSON.parse(raw);
  assertReleaseProfile(value);
  return value;
}

function assertReleaseProfile(value: unknown): asserts value is ReleaseProfile {
  if (!value || typeof value !== 'object') throw new Error('invalid release profile');
  const profile = value as Record<string, unknown>;
  const allowed = new Set(['profileId', 'model', 'reference', 'budget', 'os']);
  if (typeof profile.model !== 'object' || profile.model === null) throw new Error('invalid model');
  const model = profile.model as Record<string, unknown>;
  const modelAllowed = new Set(['provider', 'id', 'baseUrl', 'apiKeyEnv']);
  if (Object.keys(model).some(key => !modelAllowed.has(key))) throw new Error('model profile contains unknown fields');
  if (typeof model.provider !== 'string' || !model.provider || typeof model.id !== 'string' || !model.id) throw new Error('invalid model.provider/model.id');
  if (model.apiKeyEnv !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(String(model.apiKeyEnv))) throw new Error('invalid model.apiKeyEnv');
  if (model.baseUrl !== undefined) {
    try { new URL(String(model.baseUrl)); } catch { throw new Error('invalid model.baseUrl'); }
  }
  if (Object.keys(profile).some(key => !allowed.has(key))) throw new Error('release profile contains unknown fields');
  for (const key of allowed) if (!(key in profile)) throw new Error(`missing ${key}`);
  const budget = profile.budget as Record<string, unknown>;
  for (const key of ['wallClockMs', 'maxSteps', 'maxToolJobs', 'maxObservableTokens']) {
    if (typeof budget[key] !== 'number' || budget[key] <= 0) throw new Error(`invalid budget.${key}`);
  }
}
