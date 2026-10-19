import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface ReleaseProfile {
  profileId: string;
  solverMode?: 'm1';
  solverProfile?: { promptTemplateVersion: string; toolManifestVersion: string };
  opencode: { configPath: string; binaryPath?: string };
  reference: { enabled: boolean };
  budget: { wallClockMs: number; maxSteps: number; maxToolJobs: number; maxObservableTokens: number };
  os: { platform: 'macos' | 'linux' };
}

export async function loadReleaseProfile(path: string): Promise<ReleaseProfile> {
  const raw = await readFile(path, 'utf8');
  if (/(?:api[_-]?key|secret|password|credential)\s*:/i.test(raw)) throw new Error('release profile must not contain secrets');
  const value = JSON.parse(raw);
  assertReleaseProfile(value);
  value.opencode.configPath = resolve(dirname(resolve(path)), value.opencode.configPath);
  return value;
}

function assertReleaseProfile(value: unknown): asserts value is ReleaseProfile {
  if (!value || typeof value !== 'object') throw new Error('invalid release profile');
  const profile = value as Record<string, unknown>;
  const allowed = new Set(['profileId', 'solverMode', 'solverProfile', 'opencode', 'reference', 'budget', 'os']);
  if (Object.keys(profile).some(key => !allowed.has(key) && key !== 'model')) throw new Error('release profile contains unknown fields');
  if (profile.model !== undefined || profile.solverMode === 'm0') throw new Error('direct-provider profiles are retired; use an OpenCode release profile');
  if (profile.opencode === undefined) throw new Error('OpenCode opencode.configPath is required');
  const engine = profile.opencode as Record<string, unknown>;
  if (!engine || typeof engine !== 'object' || typeof engine.configPath !== 'string' || !engine.configPath ||
    Object.keys(engine).some(key => !['configPath', 'binaryPath'].includes(key)) ||
    (engine.binaryPath !== undefined && typeof engine.binaryPath !== 'string')) throw new Error('invalid opencode configuration');
  if (Object.keys(profile).some(key => !allowed.has(key))) throw new Error('release profile contains unknown fields');
  for (const key of ['profileId', 'reference', 'budget', 'os']) if (!(key in profile)) throw new Error(`missing ${key}`);
  if (profile.solverMode !== undefined && profile.solverMode !== 'm1') throw new Error('invalid solverMode');
  if (profile.solverMode === 'm1') {
    if (typeof profile.solverProfile !== 'object' || profile.solverProfile === null) throw new Error('M1 solverProfile is required');
    const solverProfile = profile.solverProfile as Record<string, unknown>;
    if (Object.keys(solverProfile).some(key => !['promptTemplateVersion', 'toolManifestVersion'].includes(key)) ||
      typeof solverProfile.promptTemplateVersion !== 'string' || !solverProfile.promptTemplateVersion ||
      typeof solverProfile.toolManifestVersion !== 'string' || !solverProfile.toolManifestVersion) throw new Error('invalid M1 solverProfile versions');
  }
  const budget = profile.budget as Record<string, unknown>;
  for (const key of ['wallClockMs', 'maxSteps', 'maxToolJobs', 'maxObservableTokens']) {
    if (typeof budget[key] !== 'number' || budget[key] <= 0) throw new Error(`invalid budget.${key}`);
  }
}
