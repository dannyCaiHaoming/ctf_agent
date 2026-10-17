import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPlaywrightLauncherIfAvailable } from '@ctf/browser';
import type { ReleaseProfile } from '../composition/releaseProfile.js';

const run = promisify(execFile);

export interface Capability {
  name: string;
  available: boolean;
  evidence: string;
}

async function commandVersion(command: string, args: string[] = ['--version']): Promise<Capability> {
  try {
    const result = await run(command, args, { timeout: 5000 });
    return { name: `command:${command}`, available: true, evidence: result.stdout.trim() };
  } catch (error) {
    return { name: `command:${command}`, available: false, evidence: error instanceof Error ? error.message : String(error) };
  }
}

async function chromiumCapability(): Promise<Capability> {
  try {
    const launcher = await createPlaywrightLauncherIfAvailable();
    if (!launcher) return { name: 'browser:chromium', available: false, evidence: 'Playwright package is not installed' };
    const handle = await launcher.launch({ headless: true });
    await handle.page();
    await handle.close();
    return { name: 'browser:chromium', available: true, evidence: 'headless Chromium started and closed' };
  } catch (error) {
    return { name: 'browser:chromium', available: false, evidence: error instanceof Error ? error.message : String(error) };
  }
}

function modelApiKeyEnv(profile: ReleaseProfile): string {
  return profile.model.apiKeyEnv ?? (
    profile.model.provider === 'volcano' || profile.model.provider === 'volcano_anthropic'
      ? 'ARK_API_KEY'
      : `${profile.model.provider.toUpperCase()}_API_KEY`
  );
}

function modelCapability(profile: ReleaseProfile): Capability {
  if (profile.model.provider === 'stub') {
    return {
      name: `model:${profile.model.provider}/${profile.model.id}`,
      available: false,
      evidence: 'stub provider is for deterministic tests only; real model input unavailable'
    };
  }
  const key = modelApiKeyEnv(profile);
  const baseUrl = profile.model.baseUrl ?? (
    profile.model.provider === 'volcano' ? 'https://ark.cn-beijing.volces.com/api/v3'
      : profile.model.provider === 'volcano_anthropic' ? 'https://ark.cn-beijing.volces.com/api/coding'
      : undefined
  );
  if (!baseUrl) {
    return {
      name: `model:${profile.model.provider}/${profile.model.id}`,
      available: false,
      evidence: `baseUrl is required for provider ${profile.model.provider}`
    };
  }
  return {
    name: `model:${profile.model.provider}/${profile.model.id}`,
    available: !!process.env[key],
    evidence: `${key} ${process.env[key] ? 'present' : 'missing'}; baseUrl=${baseUrl} (credential value not shown)`
  };
}

export async function doctor(profile: ReleaseProfile): Promise<{ capabilities: Capability[] }> {
  const capabilities: Capability[] = [];
  capabilities.push(modelCapability(profile));
  for (const command of ['node', 'npm', 'git', 'curl']) capabilities.push(await commandVersion(command));
  capabilities.push({ name: 'runtime:sqlite', available: true, evidence: 'node:sqlite module loaded by deterministic StateStore' });
  capabilities.push(await chromiumCapability());
  return { capabilities };
}
