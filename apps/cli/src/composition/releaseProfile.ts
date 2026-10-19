import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface ReleaseProfile {
  profileId: string;
  solverMode?: 'm0' | 'm1';
  solverProfile?: { promptTemplateVersion: string; toolManifestVersion: string };
  model?: { provider: string; id: string; baseUrl?: string; apiKeyEnv?: string; temperature?: number; responseFormat?: 'json_object' | 'prompt_only' };
  opencode?: { configPath: string; binaryPath?: string };
  reference: { enabled: boolean };
  budget: { wallClockMs: number; maxSteps: number; maxToolJobs: number; maxObservableTokens: number };
  os: { platform: 'macos' | 'linux' };
}

export async function loadReleaseProfile(path: string): Promise<ReleaseProfile> {
  const raw = await readFile(path, 'utf8');
  if (/(?:api[_-]?key|secret|password|credential)\s*:/i.test(raw)) throw new Error('release profile must not contain secrets');
  const value = JSON.parse(raw);
  assertReleaseProfile(value);
  if (value.opencode) value.opencode.configPath = resolve(dirname(resolve(path)), value.opencode.configPath);
  return value;
}

function assertReleaseProfile(value: unknown): asserts value is ReleaseProfile {
  if (!value || typeof value !== 'object') throw new Error('invalid release profile');
  const profile = value as Record<string, unknown>;
  const allowed = new Set(['profileId', 'solverMode', 'solverProfile', 'model', 'opencode', 'reference', 'budget', 'os']);
  if (profile.opencode !== undefined) {
    const engine = profile.opencode as Record<string, unknown>;
    if (!engine || typeof engine !== 'object' || typeof engine.configPath !== 'string' || !engine.configPath ||
      Object.keys(engine).some(key => !['configPath', 'binaryPath'].includes(key)) ||
      (engine.binaryPath !== undefined && typeof engine.binaryPath !== 'string')) throw new Error('invalid opencode configuration');
    if (profile.model !== undefined) throw new Error('model settings must live in OpenCode config, not both profiles');
  } else if (typeof profile.model !== 'object' || profile.model === null) throw new Error('invalid model');
  const model = (profile.model ?? {}) as Record<string, unknown>;
  const modelAllowed = new Set(['provider', 'id', 'baseUrl', 'apiKeyEnv', 'temperature', 'responseFormat']);
  if (Object.keys(model).some(key => !modelAllowed.has(key))) throw new Error('model profile contains unknown fields');
  if (!profile.opencode && (typeof model.provider !== 'string' || !model.provider || typeof model.id !== 'string' || !model.id)) throw new Error('invalid model.provider/model.id');
  if (model.apiKeyEnv !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(String(model.apiKeyEnv))) throw new Error('invalid model.apiKeyEnv');
  if (model.temperature !== undefined && (typeof model.temperature !== 'number' || !Number.isFinite(model.temperature) || model.temperature < 0 || model.temperature > 2)) throw new Error('invalid model.temperature');
  if (model.responseFormat !== undefined && model.responseFormat !== 'json_object' && model.responseFormat !== 'prompt_only') throw new Error('invalid model.responseFormat');
  if (model.baseUrl !== undefined) {
    try { new URL(String(model.baseUrl)); } catch { throw new Error('invalid model.baseUrl'); }
  }
  if (Object.keys(profile).some(key => !allowed.has(key))) throw new Error('release profile contains unknown fields');
  for (const key of ['profileId', 'reference', 'budget', 'os']) if (!(key in profile)) throw new Error(`missing ${key}`);
  if (profile.solverMode !== undefined && profile.solverMode !== 'm0' && profile.solverMode !== 'm1') throw new Error('invalid solverMode');
  if (profile.solverMode === 'm1') {
    if (typeof profile.solverProfile !== 'object' || profile.solverProfile === null) throw new Error('M1 solverProfile is required');
    const solverProfile = profile.solverProfile as Record<string, unknown>;
    if (Object.keys(solverProfile).some(key => !['promptTemplateVersion', 'toolManifestVersion'].includes(key)) ||
      typeof solverProfile.promptTemplateVersion !== 'string' || !solverProfile.promptTemplateVersion ||
      typeof solverProfile.toolManifestVersion !== 'string' || !solverProfile.toolManifestVersion) throw new Error('invalid M1 solverProfile versions');
    if (!profile.opencode && (profile.reference as Record<string, unknown>).enabled !== true) throw new Error('M1 solve requires the approved Reference snapshot');
    if (!profile.opencode && typeof model.temperature !== 'number') throw new Error('M1 solve requires model.temperature');
  }
  const budget = profile.budget as Record<string, unknown>;
  for (const key of ['wallClockMs', 'maxSteps', 'maxToolJobs', 'maxObservableTokens']) {
    if (typeof budget[key] !== 'number' || budget[key] <= 0) throw new Error(`invalid budget.${key}`);
  }
}
