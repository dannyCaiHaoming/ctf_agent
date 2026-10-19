import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import * as supervisor from '../../packages/supervisor/src/index.js';

const retired = ['SolverSupervisor', 'ScriptedSolverModel', 'OpenAICompatibleModel', 'AnthropicCompatibleModel'];

describe('supervisor production boundary (replaces retired M0 adapter contracts)', () => {
  it('does not export a second model pipeline or direct-provider adapters', () => {
    for (const name of retired) expect(Object.hasOwn(supervisor, name), name).toBe(false);
  });

  it('retains reusable host services rather than deleting the supervisor package', () => {
    for (const name of ['ResponsibilityRegistry', 'PublishedRevisionService', 'HypothesisManager', 'experimentFingerprint',
      'DurableJobWatchService', 'IndependentVerificationService', 'VerifiedCoordinator', 'MultiFlagContinuation']) {
      expect(supervisor[name as keyof typeof supervisor], name).toBeTypeOf('function');
    }
  });

  it('keeps retired implementations and test-only legacy imports out of production sources', async () => {
    async function inspect(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await inspect(path);
        else if (entry.isFile() && path.endsWith('.ts')) {
          const source = await readFile(path, 'utf8');
          expect(source, path).not.toMatch(/\bclass\s+(?:SolverSupervisor|ScriptedSolverModel|OpenAICompatibleModel|AnthropicCompatibleModel)\b/);
          expect(source, path).not.toMatch(/(?:from\s*|import\s*\()\s*['"][^'"]*(?:tests\/legacy|legacy\/(?:solver-loop|provider-solver-driver))/);
        }
      }
    }
    await inspect(resolve('apps'));
    await inspect(resolve('packages'));
  });
});
