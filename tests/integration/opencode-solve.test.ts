import { describe, expect, it } from 'vitest';
import { openCodeFixture, successfulRepair } from './opencode-fixture.js';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

describe('product solve through actual OpenCode', () => {
  it('lets OpenCode own model/tool turns and reaches independent replay plus oracle accepted', async () => {
    const fixture = await openCodeFixture(successfulRepair);
    try {
      const run = await fixture.run();
      expect(run.code, run.stderr).toBe(0);
      expect(run.result).toMatchObject({ outcome: 'solved', engine: { name: 'opencode', model: 'local/local-perfect' } });
      expect(fixture.requests.length).toBeGreaterThanOrEqual(5);
      const events = await fixture.events();
      expect(events.some(event => event.activity === 'started' && event.sessionId.startsWith('ses_'))).toBe(true);
      expect(events.some(event => event.activity === 'candidate.stage' && event.data.stage === 'oracle_submit' && event.data.state === 'completed')).toBe(true);
      expect(JSON.stringify(fixture.requests)).toContain('SyntaxError');
      expect(JSON.stringify(fixture.requests)).not.toContain('local-fixture-key-never-in-model');
      const definitions = fixture.requests.flatMap(request => request.tools as Array<{ function: { name: string } }>);
      expect(definitions.every(tool => tool.function.name.startsWith('ctf_'))).toBe(true);
      expect(definitions.some(tool => tool.function.name === 'ctf_job_run')).toBe(true);
    } finally { await fixture.close(); }
  }, 60000);
  it('rejects an invented candidate before any successful execution', async () => {
    const fixture = await openCodeFixture([{ name: 'ctf_candidate_register', args: { value: 'flag{local_repair}' } }]);
    try {
      const result = await fixture.run();
      expect(result.result.outcome).not.toBe('solved');
      const events = await fixture.events();
      expect(events.some(event => event.activity === 'candidate.stage' && event.data.stage === 'oracle_submit')).toBe(false);
      expect(JSON.stringify(fixture.requests)).toContain('candidate requires a successful complete local job output');
    } finally { await fixture.close(); }
  }, 60000);
  it('does not execute a forged unmanaged shell tool', async () => {
    const calls = [{ name: 'bash', args: { command: '' } }];
    const fixture = await openCodeFixture(calls);
    const escaped = join(fixture.root, 'unmanaged-shell-executed');
    calls[0]!.args.command = `touch ${escaped}`;
    try {
      const result = await fixture.run();
      expect(result.result.outcome).not.toBe('solved');
      await expect(access(escaped)).rejects.toThrow();
      expect((await fixture.events()).some(event => event.activity === 'tool.started')).toBe(false);
    } finally { await fixture.close(); }
  }, 60000);
  it('stops at the shared step limit and saves a canonical checkpoint', async () => {
    const fixture = await openCodeFixture(successfulRepair, { maxSteps: 1 });
    try {
      const result = await fixture.run();
      expect(result.result).toMatchObject({ status: 'resource_exhausted', solve_state: 'paused', outcome: 'inconclusive' });
      expect(fixture.requests).toHaveLength(1);
      expect((await fixture.events()).at(-1)).toMatchObject({ activity: 'checkpoint', data: { status: 'resource_exhausted' } });
    } finally { await fixture.close(); }
  }, 60000);
  it('reports unavailable provider usage as null when OpenCode normalizes missing usage to zero', async () => {
    const fixture = await openCodeFixture([], { omitUsage: true });
    try {
      const result = await fixture.run();
      expect(result.result.provider_usage).toMatchObject({ availability: 'unavailable', input_tokens: null, output_tokens: null, model_calls: null });
    } finally { await fixture.close(); }
  }, 60000);
});
