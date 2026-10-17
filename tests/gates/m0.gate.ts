import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

describe('M0 deterministic gate', () => {
  it('keeps the required scripts and source/test files present', async () => {
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['gate:m0']).toContain('tests/gates');
    for (const path of [
      'packages/contracts/src/index.ts',
      'packages/state/src/index.ts',
      'packages/artifacts/src/index.ts',
      'packages/policy/src/index.ts',
      'packages/runtime/src/index.ts',
      'packages/browser/src/index.ts',
      'packages/opencode-bridge/src/index.ts',
      'packages/platform/src/index.ts',
      'packages/supervisor/src/index.ts',
      'tests/contract/contracts.test.ts',
      'tests/contract/state.test.ts',
      'tests/contract/artifacts.test.ts',
      'tests/contract/policy.test.ts',
      'tests/contract/runtime.test.ts',
      'tests/contract/browser.test.ts',
      'tests/contract/opencode.test.ts'
    ]) await expect(access(resolve(root, path))).resolves.toBeUndefined();
  });

  it('runs the complete deterministic contract suite without external model input', () => {
    execFileSync('npm', ['run', 'test:deterministic'], { cwd: root, stdio: 'inherit' });
  });
});
