import { describe, expect, it } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { StateStore } from '../../packages/state/src/index.js';
import { openCodeFixture, successfulRepair } from './opencode-fixture.js';

// Replaces the retired fixed-stage M0 loop. The existing local provider never
// contacts an external model; the real CLI/OpenCode own the solve path.
describe('product CLI smoke through OpenCode (migrated M0 coverage)', () => {
  it('submits actual tool output through independent verification and the authoritative oracle', async () => {
    const fixture = await openCodeFixture(successfulRepair);
    try {
      const run = await fixture.run();
      expect(run.code, run.stderr).toBe(0);
      expect(run.result).toMatchObject({ outcome: 'solved', solve_state: 'finished',
        engine: { name: 'opencode', model: 'local/local-perfect' } });
      const events = await fixture.events();
      expect(events.find(event => event.activity === 'started')).toMatchObject({
        runId: run.result.run_id, sessionId: run.result.session_id, data: { engine: 'opencode' }
      });
      const accepted = events.find(event => event.activity === 'candidate');
      expect(accepted).toMatchObject({ data: { status: 'accepted', authoritative: true,
        resolution: { completed: true, verification: { status: 'verified', current: true } } } });
      expect(events.at(-1)).toMatchObject({ activity: 'checkpoint', data: {
        outcome: run.result.outcome, solve_state: run.result.solve_state
      } });
    } finally { await fixture.close(); }
  }, 60000);

  it('records an infrastructure/bootstrap blocker without calling a model or claiming acceptance', async () => {
    const fixture = await openCodeFixture(successfulRepair);
    try {
      const profilePath = join(fixture.root, 'profile.json');
      const profile = JSON.parse(await readFile(profilePath, 'utf8'));
      profile.opencode.binaryPath = join(fixture.root, 'missing-opencode');
      await writeFile(profilePath, JSON.stringify(profile));
      const run = await fixture.run();
      expect(run.code).toBe(1);
      expect(run.result).toMatchObject({ session_id: null, status: 'blocked',
        outcome: 'inconclusive', solve_state: 'blocked_runtime',
        provider_usage: { availability: 'unavailable', model_calls: null } });
      expect(fixture.requests).toHaveLength(0);
      expect((await fixture.events()).some(event => event.activity === 'candidate')).toBe(false);
      const state = new StateStore(join(fixture.out, 'state'), run.result.run_id);
      try { expect(state.loadCheckpoint(run.result.run_id)).toMatchObject({ runId: run.result.run_id, stage: 'finalizing' }); }
      finally { state.close(); }
    } finally { await fixture.close(); }
  }, 60000);

  it('stops at the shared budget and persists the reason instead of advancing a fixed stage pipeline', async () => {
    const fixture = await openCodeFixture(successfulRepair, { maxSteps: 1 });
    try {
      const run = await fixture.run();
      expect(run.code).toBe(1);
      expect(run.result).toMatchObject({ outcome: 'inconclusive', status: 'resource_exhausted', solve_state: 'paused' });
      expect(run.result.reason).toMatch(/budget/);
      expect(fixture.requests).toHaveLength(1);
      expect((await fixture.events()).at(-1)).toMatchObject({ activity: 'checkpoint',
        data: { outcome: 'inconclusive', status: 'resource_exhausted', budget: { maxSteps: 1 } } });
    } finally { await fixture.close(); }
  }, 60000);
});
