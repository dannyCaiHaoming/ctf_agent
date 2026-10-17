import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../../packages/artifacts/src/index.js';
import { StateStore } from '../../packages/state/src/index.js';
import { Coordinator, PlatformService } from '../../packages/platform/src/index.js';
import { LocalFlagOracle } from '../../packages/local-oracle/src/index.js';
import { SolverSupervisor, type ModelAdapter, type ModelResponse } from '../../packages/supervisor/src/index.js';
import { startLocalTarget } from '../../fixtures/local-target/src/server.js';
import type { Budget } from '../../packages/contracts/src/index.js';

function budget(overrides: Partial<Budget> = {}): Budget {
  return { wallClockMs: 60000, maxSteps: 20, maxToolJobs: 10, maxObservableTokens: 10000, ...overrides };
}

class ObservationModel implements ModelAdapter {
  readonly id = 'stub-m0-model';
  constructor(private readonly flag: string) {}
  async invoke(turn: any): Promise<ModelResponse> {
    if (turn.stage === 'solving') return { text: `CANDIDATE: flag{not-the-flag}`, observableTokens: 10 };
    if (turn.stage === 'verifying') return { text: `CANDIDATE: ${this.flag}`, observableTokens: 10 };
    return { text: turn.stage, observableTokens: 5 };
  }
}

describe('M0 local solve loop', () => {
  it('runs intake through finalizing, submits through Coordinator, and is accepted by local_oracle', async () => {
    const target = await startLocalTarget();
    try {
      const root = await mkdtemp(join(tmpdir(), 'smoke-solve-'));
      const runId = 'run_smoke';
      const state = new StateStore(root, runId);
      const artifacts = new ArtifactStore(join(root, 'artifacts'));
      const http = await artifacts.publish(Buffer.from(await (await fetch(`${target.url}/robots.txt`)).text()));
      state.addCanonicalArtifact(http);
      state.addEvidence({ id: 'robots', runId, source: 'observation', artifact: http, startCursor: 0, endCursor: 15 });
      const platform = new PlatformService(state, new LocalFlagOracle(target.flag));
      const supervisor = new SolverSupervisor({
        runRoot: join(root, 'run'),
        challengeId: 'challenge_local_target',
        challengeTarget: target.url,
        description: 'Authorized local HTTP challenge',
        budget: budget(),
        coordinator: new Coordinator(platform, runId),
        model: new ObservationModel(target.flag),
        lease: 'lease_smoke' as never,
        state,
        evidenceRefs: [{ hash: http.hash, path: http.path, size: http.size }],
        task: 'task_solver' as never,
        runId
      });
      const result = await supervisor.run();
      expect(result.outcome).toBe('solved');
      expect(result.solveState).toBe('finished');
      expect(result.steps).toBeGreaterThanOrEqual(6);
      const resultJson = JSON.parse(await readFile(join(root, 'run', 'result.json'), 'utf8'));
      expect(resultJson.model).toBe('stub-m0-model');
      expect(resultJson.observableTokens).toBeGreaterThan(0);
      expect(await readFile(join(root, 'run', 'events.jsonl'), 'utf8')).toContain('pipeline_stage');
      state.close();
    } finally {
      await target.close();
    }
  });

  it('reports infrastructure invalid instead of pretending to solve when target is down', async () => {
    const root = await mkdtemp(join(tmpdir(), 'smoke-down-'));
    const state = new StateStore(root, 'run_down');
    const platform = new PlatformService(state, new LocalFlagOracle('flag{unused}'));
    const supervisor = new SolverSupervisor({
      runRoot: join(root, 'run'),
      challengeId: 'challenge_local_target',
      challengeTarget: 'http://127.0.0.1:1',
      description: 'down target',
      budget: budget(),
      coordinator: new Coordinator(platform, 'run_down'),
      model: new ObservationModel('flag{unused}'),
      lease: 'lease_down' as never,
      task: 'task_solver' as never
    });
    const result = await supervisor.run();
    expect(result.outcome).toBe('infrastructure_invalid');
    expect(result.solveState).toBe('blocked_runtime');
    expect(result.stopReason).toMatch(/target unavailable/i);
    state.close();
  }, 10000);

  it('stops on a small step budget and records the reason', async () => {
    const target = await startLocalTarget();
    try {
      const root = await mkdtemp(join(tmpdir(), 'smoke-budget-'));
      const state = new StateStore(root, 'run_budget');
      const platform = new PlatformService(state, new LocalFlagOracle(target.flag));
      const supervisor = new SolverSupervisor({
        runRoot: join(root, 'run'),
        challengeId: 'challenge_local_target',
        challengeTarget: target.url,
        description: 'budgeted',
        budget: budget({ maxSteps: 5 }),
        coordinator: new Coordinator(platform, 'run_budget'),
        model: new ObservationModel(target.flag),
        lease: 'lease_budget' as never,
        task: 'task_solver' as never,
        runId: 'run_budget'
      });
      const result = await supervisor.run();
      expect(result.steps).toBe(5);
      expect(result.outcome).toBe('candidate_only');
      expect(result.stopReason).toBe('step budget exhausted');
      state.close();
    } finally {
      await target.close();
    }
  });
});
