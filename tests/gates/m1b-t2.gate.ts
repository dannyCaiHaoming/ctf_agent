import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { falsifiedRoute, openCodeFixture } from '../integration/opencode-fixture.js';

const run = promisify(execFile);
async function grade(folder: string) {
  try { return JSON.parse((await run('python3', ['docs/gates/m1b-t2-acceptance.py', folder, '--deterministic'])).stdout); }
  catch (error) {
    const output = (error as { stdout: string }).stdout;
    if (!output) throw error;
    return JSON.parse(output);
  }
}

describe('trajectory 2 actual OpenCode interface with local deterministic provider', () => {
  it('retains a falsified premise, changes route, independently replays and receives authoritative acceptance', async () => {
    const fixture = await openCodeFixture(falsifiedRoute, { trajectory: 't2' });
    try {
      const result = await fixture.run();
      expect(result.code, JSON.stringify(result)).toBe(0);
      const proof = await grade(fixture.out);
      expect(proof.passed, JSON.stringify(proof)).toBe(true);
      expect(proof.evidence_kind).toBe('deterministic_local_provider');
      const firstInput = JSON.stringify(fixture.requests[0]);
      expect(firstInput).not.toContain('flag{changed_route}');
      expect(firstInput).not.toContain('switching to the independent payload-decoding route');
      expect(firstInput).not.toContain('local-fixture-key-never-in-model');
      const events = await fixture.events();
      expect(events.find(event => event.activity === 'started').data.challenge.workspace_files).toEqual(['target.mjs', 'decode.mjs', 'payload.txt']);
      expect(events.filter(event => event.activity === 'hypothesis.conclusion')).toHaveLength(1);
      expect(events.some(event => event.activity === 'candidate.stage' && event.data.stage === 'oracle_submit' && event.data.state === 'completed')).toBe(true);

      const files = await readdir(join(fixture.out, 'state'));
      const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
      const db = new DatabaseSync(join(fixture.out, 'state', files.find(file => file.endsWith('.sqlite'))!));
      try {
        const rows = db.prepare('SELECT seq,payload FROM events ORDER BY seq').all();
        const cases: Array<{ pick: (event: any) => boolean; change: (event: any) => void }> = [
          { pick: e => e.activity === 'tool.chunk' && e.data.stream === 'stdout', change: e => { e.data.delivered_to_model = false; } },
          { pick: e => e.activity === 'hypothesis.conclusion', change: e => { e.sessionId = 'ses_foreign'; } },
          { pick: e => e.activity === 'hypothesis.conclusion', change: e => { e.data.conclusion.evidence_refs = []; } },
          { pick: e => e.activity === 'strategy.switch', change: e => { e.data.rationale = ''; } },
          { pick: e => e.activity === 'candidate', change: e => { e.data.resolution.submit_effect_id = 'forged'; } },
          { pick: e => e.activity === 'experiment.started' && e.data.prediction === 'expression_evaluates',
            change: e => { delete e.data.proposal_receipt_id; } },
          { pick: e => e.activity === 'tool.result' && e.data.tool === 'job.run' && e.data.observation.raw.includes('literal'),
            change: e => { e.data.exit_code = 1; } }
        ];
        for (const mutation of cases) {
          const row = rows.find(row => mutation.pick(JSON.parse(String(row.payload))))!;
          const event = JSON.parse(String(row.payload)); mutation.change(event);
          db.prepare('UPDATE events SET payload=? WHERE seq=?').run(JSON.stringify(event), Number(row.seq));
          try { expect((await grade(fixture.out)).passed, JSON.stringify(event)).toBe(false); }
          finally { db.prepare('UPDATE events SET payload=? WHERE seq=?').run(String(row.payload), Number(row.seq)); }
        }
      } finally { db.close(); }
    } finally { await fixture.close(); }
  }, 60000);

  it('accepts another discriminating input without prescribing expression or patch bytes', async () => {
    const calls = structuredClone(falsifiedRoute);
    calls[0]!.args.command = [process.execPath, './target.mjs', '11-3'];
    calls[1]!.args.command = ['node', 'target.mjs', '11-3'];
    calls[2]!.args.rationale = 'Literal 11-3 is counterevidence to evaluation.';
    const fixture = await openCodeFixture(calls, { trajectory: 't2' });
    try {
      const result = await fixture.run(); expect(result.code, JSON.stringify(result)).toBe(0);
      const proof = await grade(fixture.out); expect(proof.passed, JSON.stringify(proof)).toBe(true);
    } finally { await fixture.close(); }
  }, 60000);

  it('does not count direct decoding and oracle acceptance as trajectory 2 evidence', async () => {
    const fixture = await openCodeFixture(falsifiedRoute.slice(4), { trajectory: 't2' });
    try {
      expect((await fixture.run()).code).toBe(0);
      expect((await grade(fixture.out)).passed).toBe(false);
    } finally { await fixture.close(); }
  }, 60000);

  it.each(['(7*6)', '(11 - (3 + 2))'])('accepts the full evidence chain for a valid parenthesized expression: %s', async expression => {
    const calls = structuredClone(falsifiedRoute);
    calls[0]!.args.command = ['node', 'target.mjs', expression];
    calls[1]!.args.command = ['node', 'target.mjs', expression];
    calls[2]!.args.rationale = `The actual literal output ${expression} refutes expression evaluation.`;
    const fixture = await openCodeFixture(calls, { trajectory: 't2' });
    try {
      const result = await fixture.run(); expect(result.code, JSON.stringify(result)).toBe(0);
      const proof = await grade(fixture.out); expect(proof.passed, JSON.stringify(proof)).toBe(true);
    } finally { await fixture.close(); }
  }, 60000);

  it.each(['7*6', '(7*6)', '9+3'])('rejects a retry after evidence delivery but before conclusion registration: %s', async expression => {
    const calls = structuredClone(falsifiedRoute);
    calls.splice(2, 0, { name: 'ctf_job_run', args: { command: ['node', './target.mjs', expression] } });
    const fixture = await openCodeFixture(calls, { trajectory: 't2' });
    try {
      expect((await fixture.run()).code).toBe(0);
      const events = await fixture.events();
      const delivery = events.findIndex(e => e.activity === 'tool.chunk' && e.data.stream === 'stdout');
      const repeat = events.findIndex(e => e.activity === 'tool.result' && e.data.tool === 'job.run' && e.data.observation.outcome === 'failure');
      const conclusion = events.findIndex(e => e.activity === 'hypothesis.conclusion');
      expect(delivery).toBeGreaterThan(-1);
      expect(repeat).toBeGreaterThan(delivery); expect(conclusion).toBeGreaterThan(repeat);
      const proof = await grade(fixture.out);
      expect(proof.passed).toBe(false);
      expect(proof.checks.no_rejected_route_retry).toBe(false);
    } finally { await fixture.close(); }
  }, 60000);

  it.each(['7*6', '9+3'])('does not count a host-blocked evaluation retry (%s) as autonomous route change', async expression => {
    const calls = structuredClone(falsifiedRoute);
    calls.splice(3, 0, { name: 'ctf_job_run', args: { command: ['node', './target.mjs', expression] } });
    const fixture = await openCodeFixture(calls, { trajectory: 't2' });
    try {
      expect((await fixture.run()).code).toBe(0);
      const proof = await grade(fixture.out);
      expect(proof.passed).toBe(false);
      expect(proof.checks.no_rejected_route_retry).toBe(false);
    } finally { await fixture.close(); }
  }, 60000);
});
