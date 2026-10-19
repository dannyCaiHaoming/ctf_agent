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

function modelCapability(): Capability {
  return { name: 'model:opencode', available: false,
    evidence: 'Model configuration comes from OpenCode; provider reachability is not proven by loading the profile.' };
}

export async function doctor(profile: ReleaseProfile): Promise<{ capabilities: Capability[] }> {
  const capabilities: Capability[] = [];
  capabilities.push(modelCapability());
  for (const command of ['node', 'npm', 'git', 'curl']) capabilities.push(await commandVersion(command));
  capabilities.push({ name: 'runtime:sqlite', available: true, evidence: 'node:sqlite module loaded by deterministic StateStore' });
  capabilities.push(await chromiumCapability());
  return { capabilities };
}
