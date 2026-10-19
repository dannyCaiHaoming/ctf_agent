import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { openCodeFixture, successfulRepair } from '../integration/opencode-fixture.js';

const run = promisify(execFile);
async function grade(folder: string) {
  try { return JSON.parse((await run('python3', ['docs/gates/m1-t1-acceptance.py', 'grade', folder, '--deterministic'])).stdout); }
  catch (error) { return JSON.parse((error as { stdout: string }).stdout); }
}

describe('M1 golden path on actual OpenCode', () => {
  it('passes behavior grading with complete stderr and a local repair through OpenCode', async () => {
    const fixture = await openCodeFixture(successfulRepair);
    try {
      const result = await fixture.run();
      expect(result.code, JSON.stringify(result)).toBe(0);
      const graded = await grade(fixture.out);
      expect(graded.passed, JSON.stringify(graded)).toBe(true);
      expect(result.result.provider_usage).toMatchObject({ availability: 'observed', model_calls: 6 });
      const controlRoots = await readdir(join(fixture.out, '.opencode-control'));
      const control = join(fixture.out, '.opencode-control', controlRoots[0]!);
      expect(await readdir(control)).not.toContain('.npm');
      expect(await readFile(join(control, 'config/opencode/package-lock.json'), 'utf8')).toBe(await readFile('package-lock.json', 'utf8'));
    } finally { await fixture.close(); }
  }, 60000);

  it('accepts another repair with two patches, a preset ending at failure, and a changed OpenCode model', async () => {
    const alternative = [successfulRepair[1]!, {
      name: 'ctf_workspace_patch', args: { path: 'solve.mjs',
        find: "console.log(Buffer.from(input, 'base64').toString('utf8');",
        replace: "const decoded = Buffer.from(input, 'base64').toString('utf8'); console.log(decoded);" }
    }, { name: 'ctf_workspace_patch', args: { path: 'solve.mjs', find: 'Preserve this script', replace: 'Keep this script' } },
    successfulRepair[3]!, successfulRepair[4]!];
    const fixture = await openCodeFixture(alternative, { preset: true, model: 'alternate-local-model' });
    try {
      const result = await fixture.run();
      expect(result.code, JSON.stringify(result)).toBe(0);
      const graded = await grade(fixture.out);
      expect(graded.passed, JSON.stringify(graded)).toBe(true);
      expect(fixture.requests.every(request => request.model === 'alternate-local-model')).toBe(true);
      const events = await fixture.events();
      expect(events.filter(event => event.activity === 'tool.result' && event.data.tool === 'workspace.patch' && event.data.observation.outcome === 'success')).toHaveLength(2);
      const firstCall = events.findIndex(event => event.activity === 'driver.call');
      expect(events.slice(0, firstCall).some(event => event.activity === 'tool.result' && event.data.preset === true && event.data.exit_code !== 0)).toBe(true);
      expect(JSON.stringify(fixture.requests[0])).toContain('SyntaxError');
    } finally { await fixture.close(); }
  }, 60000);

  it('rejects missing failure, unread stderr, whole-file replacement and detached oracle acceptance', async () => {
    const fixture = await openCodeFixture(successfulRepair);
    try {
      expect((await fixture.run()).code).toBe(0);
      const files = await readdir(join(fixture.out, 'state'));
      const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
      const db = new DatabaseSync(join(fixture.out, 'state', files.find(file => file.endsWith('.sqlite'))!));
      try {
        const originalSource = await readFile('fixtures/trajectories/t1-script-error/solve.mjs', 'utf8');
        const rows = db.prepare('SELECT seq,payload FROM events ORDER BY seq').all();
        const cases: Array<{ pick: (event: any) => boolean; change: (event: any) => void; check: string }> = [
          { pick: event => event.activity === 'tool.result' && event.data.tool === 'job.run' && event.data.exit_code !== 0,
            change: event => { event.data.exit_code = 0; }, check: 'failed_stderr_model_patch_success_chain' },
          { pick: event => event.activity === 'tool.chunk', change: event => { event.data.delivered_to_model = false; },
            check: 'failed_stderr_model_patch_success_chain' },
          { pick: event => event.activity === 'tool.started' && event.data.tool === 'workspace.patch',
            change: event => { event.data.input.find = originalSource; }, check: 'local_patch_operations' },
          { pick: event => event.activity === 'candidate', change: event => { event.data.resolution.submit_effect_id = 'forged-effect'; },
            check: 'oracle_accepted' },
          { pick: event => event.activity === 'candidate', change: event => { event.data.candidate.value_ref.path = '/outside-run/same-hash'; },
            check: 'artifact_integrity' }
        ];
        for (const test of cases) {
          const row = rows.find(row => test.pick(JSON.parse(String(row.payload))))!;
          const event = JSON.parse(String(row.payload)); test.change(event);
          db.prepare('UPDATE events SET payload=? WHERE seq=?').run(JSON.stringify(event), Number(row.seq));
          try {
            const result = await grade(fixture.out);
            expect(result.passed, JSON.stringify(result)).toBe(false);
            expect(result.checks[test.check]).toBe(false);
          } finally { db.prepare('UPDATE events SET payload=? WHERE seq=?').run(String(row.payload), Number(row.seq)); }
        }
      } finally { db.close(); }
    } finally { await fixture.close(); }
  }, 60000);
});
