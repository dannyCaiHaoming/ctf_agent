import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface ContextSettings { index: 'summary' | 'full'; workbook: boolean }
export const DEFAULT_CONTEXT: ContextSettings = { index: 'summary', workbook: true };
/** Effective projection settings: omitted keys take the defaults. */
export function effectiveContext(value: Partial<ContextSettings> | undefined): ContextSettings { return { ...DEFAULT_CONTEXT, ...(value ?? {}) }; }

export interface ReleaseProfile {
  profileId: string;
  solverMode?: 'm1';
  solverProfile?: { promptTemplateVersion: string; toolManifestVersion: string };
  opencode: { configPath: string; binaryPath?: string };
  challenges?: string;
  reference: { enabled: boolean };
  learning?: { enabled?: boolean; maxObservableTokens: number; wallClockMs: number };
  /** Projection content (Recon redesign §4): step index as a summary (default) or in full, and the challenge workbook on (default) or off. */
  context?: Partial<ContextSettings>;
  budget: { wallClockMs: number; maxSteps: number; maxToolJobs: number; maxObservableTokens: number;
    /** Explicit pathological recon ceiling B per run/challenge, selected by the run owner before launch; not a natural handoff target. Absent pair means OFF/unavailable, with global budgets unchanged. */
    reconMaxModelCalls?: number;
    /** Reserve R within B (0<R<B): closure starts at B-R, exhaustion at B. Configure both safe integers together; no implicit defaults. */
    reconClosureReserve?: number;
    /** G §4.6 HTTP limits per run: sustained hops/s and burst per target origin, total sent hops. Absent takes the launcher defaults (20, 50, 5000). */
    httpRatePerSecond?: number; httpBurst?: number; maxHttpHops?: number };
  os: { platform: 'macos' | 'linux' };
}

export async function loadReleaseProfile(path: string): Promise<ReleaseProfile> {
  const raw = await readFile(path, 'utf8');
  if (/(?:api[_-]?key|secret|password|credential)\s*:/i.test(raw)) throw new Error('release profile must not contain secrets');
  const value = JSON.parse(raw);
  assertReleaseProfile(value);
  value.opencode.configPath = resolve(dirname(resolve(path)), value.opencode.configPath);
  if (value.challenges !== undefined) value.challenges = resolve(dirname(resolve(path)), value.challenges);
  return value;
}

function assertReleaseProfile(value: unknown): asserts value is ReleaseProfile {
  if (!value || typeof value !== 'object') throw new Error('invalid release profile');
  const profile = value as Record<string, unknown>;
  const allowed = new Set(['profileId', 'solverMode', 'solverProfile', 'opencode', 'challenges', 'reference', 'budget', 'os', 'learning', 'context']);
  if (Object.keys(profile).some(key => !allowed.has(key) && key !== 'model')) throw new Error('release profile contains unknown fields');
  if (profile.model !== undefined || profile.solverMode === 'm0') throw new Error('direct-provider profiles are retired; use an OpenCode release profile');
  if (profile.opencode === undefined) throw new Error('OpenCode opencode.configPath is required');
  const engine = profile.opencode as Record<string, unknown>;
  if (!engine || typeof engine !== 'object' || typeof engine.configPath !== 'string' || !engine.configPath ||
    Object.keys(engine).some(key => !['configPath', 'binaryPath'].includes(key)) ||
    (engine.binaryPath !== undefined && typeof engine.binaryPath !== 'string')) throw new Error('invalid opencode configuration');
  if (Object.keys(profile).some(key => !allowed.has(key))) throw new Error('release profile contains unknown fields');
  for (const key of ['profileId', 'reference', 'budget', 'os']) if (!(key in profile)) throw new Error(`missing ${key}`);
  if (profile.challenges !== undefined && (typeof profile.challenges !== 'string' || !profile.challenges)) throw new Error('invalid challenges path');
  if (profile.solverMode !== undefined && profile.solverMode !== 'm1') throw new Error('invalid solverMode');
  if (profile.solverMode === 'm1') {
    if (typeof profile.solverProfile !== 'object' || profile.solverProfile === null) throw new Error('M1 solverProfile is required');
    const solverProfile = profile.solverProfile as Record<string, unknown>;
    if (Object.keys(solverProfile).some(key => !['promptTemplateVersion', 'toolManifestVersion'].includes(key)) ||
      typeof solverProfile.promptTemplateVersion !== 'string' || !solverProfile.promptTemplateVersion ||
      typeof solverProfile.toolManifestVersion !== 'string' || !solverProfile.toolManifestVersion) throw new Error('invalid M1 solverProfile versions');
  }
  if(profile.learning!==undefined) {
    const learning=profile.learning as Record<string,unknown>;
    if(!learning||typeof learning!=='object'||Object.keys(learning).some(k=>!['enabled','maxObservableTokens','wallClockMs'].includes(k))||
      learning.enabled!==undefined&&typeof learning.enabled!=='boolean'||
      !Number.isSafeInteger(learning.maxObservableTokens)||Number(learning.maxObservableTokens)<=0||!Number.isSafeInteger(learning.wallClockMs)||Number(learning.wallClockMs)<=0)throw new Error('invalid learning budget');
  }
  if (profile.context !== undefined) {
    const context = profile.context as Record<string, unknown>;
    if (!context || typeof context !== 'object' || Array.isArray(context) || Object.keys(context).some(k => !['index', 'workbook'].includes(k)) ||
      (context.index !== undefined && context.index !== 'summary' && context.index !== 'full') ||
      (context.workbook !== undefined && typeof context.workbook !== 'boolean')) throw new Error('invalid context settings');
  }
  const budget = profile.budget as Record<string, unknown>;
  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) throw new Error('invalid budget');
  const requiredBudgetKeys = ['wallClockMs', 'maxSteps', 'maxToolJobs', 'maxObservableTokens'];
  const httpBudgetKeys = ['httpRatePerSecond', 'httpBurst', 'maxHttpHops'];
  const allowedBudgetKeys = new Set([...requiredBudgetKeys, ...httpBudgetKeys, 'reconMaxModelCalls', 'reconClosureReserve']);
  for (const key of Object.keys(budget)) {
    if (!allowedBudgetKeys.has(key)) throw new Error(`unknown budget field ${key}`);
  }
  for (const key of requiredBudgetKeys) {
    if (typeof budget[key] !== 'number' || budget[key] <= 0) throw new Error(`invalid budget.${key}`);
  }
  for (const key of httpBudgetKeys) {
    const v = budget[key];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || (key !== 'httpRatePerSecond' && !Number.isSafeInteger(v)))) throw new Error(`invalid budget.${key}`);
  }
  const b = budget.reconMaxModelCalls, r = budget.reconClosureReserve;
  if (b !== undefined || r !== undefined) {
    if (typeof b !== 'number' || !Number.isSafeInteger(b) || typeof r !== 'number' || !Number.isSafeInteger(r) || r <= 0 || r >= b) {
      throw new Error('invalid recon budget: reconMaxModelCalls and reconClosureReserve require integers with 0<R<B');
    }
  }
}
