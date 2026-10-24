import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadOpenCodeConfig } from '../../packages/opencode-bridge/src/server.js';

describe('OpenCode solve configuration admission', () => {
  it('rejects plaintext credentials and uninstalled provider adapters before server startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencode-config-'));
    const path = join(root, 'opencode.json');
    try {
      await writeFile(path, JSON.stringify({ model: 'local/model', provider: { local: {
        npm: '@ai-sdk/openai-compatible', options: { apiKey: 'must-never-be-loaded-as-plaintext' }
      } } }));
      await expect(loadOpenCodeConfig(path)).rejects.toThrow(/env reference/);
      await writeFile(path, JSON.stringify({ model: 'local/model', provider: { local: { npm: 'uninstalled-adapter' } } }));
      await expect(loadOpenCodeConfig(path)).rejects.toThrow(/preinstalled/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

it('isolated prototype grants package tools only to Engineer and keeps verification/submission unavailable', async () => {
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(new URL('../../product/opencode/opencode.json', import.meta.url), 'utf8'));
  const workspace = ['ctf_workspace_list', 'ctf_workspace_read', 'ctf_workspace_search', 'ctf_workspace_write'];
  const jobs = ['ctf_job_run', 'ctf_job_read', 'ctf_job_cancel'];
  const artifacts = ['ctf_artifact_publish', 'ctf_artifact_read'];
  const allowed: Record<string, string[]> = {
    coordinator: ['ctf_challenge_assign', 'ctf_challenge_unassign', 'ctf_task_stop'], intake: ['ctf_challenge_list', 'ctf_challenge_read'],
    recon: [...workspace, ...jobs, ...artifacts, 'ctf_http_request'], 'domain-solver': [...workspace, ...jobs, ...artifacts, 'ctf_http_request'],
    engineer: [...workspace, ...jobs, ...artifacts, 'ctf_package_publish', 'ctf_package_read'], verifier: [...workspace, ...jobs, 'ctf_artifact_read'], reference: [], strategy: [], 'recovery-critic': []
  };
  for (const [role, tools] of Object.entries(allowed)) {
    const permission = config.agent[role].permission;
    expect(permission['*']).toBe('deny');
    expect(Object.keys(permission).filter(k => k.startsWith('ctf_') && permission[k] === 'allow').sort()).toEqual(tools.sort());
    expect(permission.task ?? permission['*']).toBe(role === 'coordinator' ? 'allow' : 'deny');
  }
});
