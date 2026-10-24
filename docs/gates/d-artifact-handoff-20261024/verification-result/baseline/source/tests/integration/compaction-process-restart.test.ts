import { describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { StateStore } from '@ctf/state';

const cli = resolve('apps/cli/src/main.ts');
function runCli(root: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', cli, 'resume', '--state-root', join(root, 'state'), '--run', 'compaction-run', '--authorization', join(root, 'local-authorization.json')], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    child.once('error', reject); child.once('exit', code => resolveResult({ code, stdout, stderr }));
  });
}
async function checkpointProcess(root: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('fixtures/trajectories/t4-compaction/checkpoint-process.ts'), '--deterministic-local-fixture', root], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  await new Promise<void>((ready, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`checkpoint process timed out: ${stderr}`)); }, 10000);
    child.stderr.on('data', data => { stderr += data; });
    child.stdout.on('data', data => { stdout += data; if (stdout.includes('"ready":true')) { clearTimeout(timeout); ready(); } });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { if (!stdout.includes('"ready":true')) { clearTimeout(timeout); reject(new Error(`checkpoint process exited ${code}: ${stderr}`)); } });
  });
  return child;
}
async function kill(child: ChildProcess) {
  const stopped = new Promise(resolveStopped => child.once('exit', resolveStopped));
  child.kill('SIGKILL'); await stopped;
}

describe('ctf-agent canonical local process restart', () => {
  it('kills the original process, ignores misleading JSON export, resumes original raw range and exact next action once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'compaction-process-')); let first: ChildProcess | undefined;
    try {
      first = await checkpointProcess(root);
      const before = new StateStore(join(root, 'state'), 'compaction-run');
      const original = before.loadRecoverableSnapshot()!; before.close();
      expect(original.snapshot.process.owner_pid).toBe(first.pid);
      expect(original.action_state).toBe('ready');
      expect(original.snapshot.failed_fingerprints).toHaveLength(1);
      expect(await readFile(join(root, 'workspaces', 'solver', 'inspection-count.txt'), 'utf8')).toBe('1');
      const alive = await runCli(root);
      expect(alive.code).toBe(1); expect(alive.stderr).toContain('still alive');
      await kill(first); first = undefined;
      await writeFile(join(root, 'state', 'state.json'), JSON.stringify({ checkpoint: { next_action: 'repeat rejected fingerprint', raw: 'DECODING_KEY=99' } }));
      const result = await runCli(root);
      expect(result.code, result.stderr).toBe(0);
      const message = JSON.parse(result.stdout.trim());
      expect(message.kind).toBe('local_checkpoint_resumed');
      expect(message.model_calls).toBe(0);
      expect((await readFile(message.output_ref.path, 'utf8')).trim()).toBe('decoded=compaction_correct_next_action');
      expect(await readFile(join(root, 'workspaces', 'solver', 'inspection-count.txt'), 'utf8')).toBe('1');
      const after = new StateStore(join(root, 'state'), 'compaction-run');
      const resumed = after.loadRecoverableSnapshot()!; after.close();
      expect(resumed.snapshot.snapshot_id).toBe(original.snapshot.snapshot_id);
      expect(resumed.snapshot.next_action).toEqual(original.snapshot.next_action);
      expect(resumed.action_state).toBe('completed');
      expect(resumed.result!.hypothesis_manager.experiments.find(value => value.plan.id === 'pending-experiment')!.status).toBe('succeeded');
      expect(resumed.result!.budget_used.tokens).toBe(7);
      expect(resumed.result!.budget_remaining.tokens).toBe(93);
      expect(resumed.result!.budget_remaining.time_ms).toBeLessThan(original.snapshot.budget.remaining.time_ms);
      expect(resumed.result!.session_id).not.toBe(original.snapshot.previous_session_id);
      const repeated = await runCli(root);
      expect(repeated.code).toBe(1); expect(repeated.stderr).toContain('refusing completed or unknown-action replay');
    } finally { if (first) await kill(first); await rm(root, { recursive: true, force: true }); }
  });

  it('two fresh CLI processes race for one canonical dispatch and execute once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'compaction-race-')); let first: ChildProcess | undefined;
    try {
      first = await checkpointProcess(root); await kill(first); first = undefined;
      const results = await Promise.all([runCli(root), runCli(root)]);
      expect(results.map(value => value.code).sort()).toEqual([0, 1]);
      expect(results.filter(value => value.code === 0)).toHaveLength(1);
      expect(await readFile(join(root, 'workspaces', 'solver', 'inspection-count.txt'), 'utf8')).toBe('1');
    } finally { if (first) await kill(first); await rm(root, { recursive: true, force: true }); }
  });
});
