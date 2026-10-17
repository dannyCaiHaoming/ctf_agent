import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.{test,gate}.ts'],
    testTimeout: 20000,
    pool: 'forks'
  },
  resolve: {
    alias: {
      '@ctf/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@ctf/state': fileURLToPath(new URL('./packages/state/src/index.ts', import.meta.url)),
      '@ctf/artifacts': fileURLToPath(new URL('./packages/artifacts/src/index.ts', import.meta.url)),
      '@ctf/policy': fileURLToPath(new URL('./packages/policy/src/index.ts', import.meta.url)),
      '@ctf/runtime': fileURLToPath(new URL('./packages/runtime/src/index.ts', import.meta.url)),
      '@ctf/browser': fileURLToPath(new URL('./packages/browser/src/index.ts', import.meta.url)),
      '@ctf/opencode-plugin': fileURLToPath(new URL('./apps/opencode-plugin/src/index.ts', import.meta.url)),
      '@ctf/opencode-bridge': fileURLToPath(new URL('./packages/opencode-bridge/src/index.ts', import.meta.url)),
      '@ctf/local-oracle': fileURLToPath(new URL('./packages/local-oracle/src/index.ts', import.meta.url)),
      '@ctf/local-target': fileURLToPath(new URL('./fixtures/local-target/src/server.ts', import.meta.url)),
      '@ctf/platform': fileURLToPath(new URL('./packages/platform/src/index.ts', import.meta.url)),
      '@ctf/supervisor': fileURLToPath(new URL('./packages/supervisor/src/index.ts', import.meta.url))
    }
  }
});
