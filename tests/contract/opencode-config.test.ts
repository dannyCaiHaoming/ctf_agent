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
