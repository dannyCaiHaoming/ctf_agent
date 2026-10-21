import { describe, expect, it } from 'vitest';
import { openCodeFixture, successfulRepair } from './opencode-fixture.js';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('product solve through actual OpenCode', () => {
  it('loads the versioned generic Web session method into the actual OpenCode input', async () => {
    const fixture = await openCodeFixture([], { webBody: 'Challenge statement is supplied separately.' });
    try {
      const run = await fixture.run(['--description', 'Explore the authorized Web challenge and report what you found.']);
      expect(run.result.outcome).not.toBe('solved');
      expect(fixture.requests).toHaveLength(1);
      const input = JSON.stringify(fixture.requests[0]);
      expect(input).toContain('Task objective: solve the authorized Web CTF challenge');
      expect(input).toContain('Operator-provided challenge context');
      expect(input).toContain('Explore the authorized Web challenge and report what you found.');
      expect(input).toContain('Do not infer host-oracle status');
      expect(input).not.toContain('without claiming a verified solve');
      expect(input).toContain('Web Session Diagnosis');
      expect(input).toContain('cookie_names_sent');
      expect(input).toContain('workspace.unpack');
      expect(input).toContain('no local oracle is configured');
      expect(input).not.toContain('DVGA');
      const started = (await fixture.events()).find(event => event.activity === 'started');
      expect(started.data.challenge.method_material).toMatchObject({ id: 'web-session-diagnosis', version: 2, status: 'loaded' });
      expect(started.data.challenge.method_material.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(run.result.postmortem_path).toBe(join(fixture.out, 'postmortem.md'));
      const report = await readFile(run.result.postmortem_path, 'utf8');
      expect(report).toContain('Run 復盤');
      expect(report).toContain('candidate');
      await expect(access(join(fixture.out, 'canonical-events.jsonl'))).resolves.toBeUndefined();
      await expect(access(join(fixture.out, 'result.json'))).resolves.toBeUndefined();
    } finally { await fixture.close(); }
  }, 60000);

  it('does not route generic Web candidates into the DVGA-only verifier', async () => {
    const fixture = await openCodeFixture([
      { name: 'ctf_http_request', args: { url: '$TARGET' } },
      { name: 'ctf_candidate_register', args: { value: 'flag{fixture-only}' } }
    ], { webBody: 'flag{fixture-only}' });
    try {
      const run = await fixture.run();
      expect(run.result.outcome).not.toBe('solved');
      const inputs = JSON.stringify(fixture.requests);
      expect(inputs).toContain('candidate registered with HTTP evidence; no independent verifier or local oracle is configured');
      expect(inputs).not.toContain('DVGA');
    } finally { await fixture.close(); }
  }, 60000);

  it('keeps the configured local oracle answer and path out of OpenCode input and canonical events', async () => {
    const fixture = await openCodeFixture([], { webBody: 'Challenge statement is supplied separately.' });
    const oraclePath = join(fixture.root, 'private-oracle.txt');
    const answer = 'flag{private-local-oracle-answer}';
    try {
      await writeFile(oraclePath, `${answer}\n`, { mode: 0o600 });
      const run = await fixture.run(['--local-oracle-file', oraclePath]);
      expect(run.result.outcome).not.toBe('solved');
      const input = JSON.stringify(fixture.requests);
      expect(input).toContain('Task objective: solve the authorized Web CTF challenge');
      expect(input).toContain('a local oracle is configured');
      expect(input).toContain('candidate.register');
      expect(input).toContain('The target application’s own CTFd challenge list');
      expect(input).not.toContain(answer);
      expect(input).not.toContain(oraclePath);
      const events = JSON.stringify(await fixture.events());
      expect(events).not.toContain(answer);
      expect(events).not.toContain(oraclePath);
    } finally { await fixture.close(); }
  }, 60000);

  it.skipIf(!process.env.THROWBACK_TEMPLATES_ARCHIVE)('lets the managed Web tools list, unpack, read and search the original Throwback attachment', async () => {
    const archivePath = process.env.THROWBACK_TEMPLATES_ARCHIVE!;
    const original = await readFile(archivePath);
    const fixture = await openCodeFixture([
      { name: 'ctf_workspace_list', args: { path: '.' } },
      { name: 'ctf_workspace_read', args: { path: 'throwback_templates.tar.gz' } },
      { name: 'ctf_workspace_unpack', args: { path: 'throwback_templates.tar.gz' } },
      { name: 'ctf_workspace_list', args: { path: '$UNPACK_DIR/CTFd/templates' } },
      { name: 'ctf_workspace_read', args: { path: '$BASE_HTML' } },
      { name: 'ctf_workspace_search', args: { path: '$BASE_HTML', needle: '{% block' } }
    ], { webBody: 'challenge is supplied separately', webMaterials: [archivePath] });
    try {
      const run = await fixture.run();
      expect(run.result.outcome).not.toBe('solved');
      expect(fixture.requests).toHaveLength(7);
      expect(JSON.stringify(fixture.requests[0]?.tools)).toContain('ctf_workspace_unpack');
      const events = await fixture.events();
      const binaryRead = events.find(event => event.activity === 'tool.result' && event.data.tool === 'workspace.read');
      expect(binaryRead.data.observation.outcome).toBe('success');
      expect(JSON.parse(binaryRead.data.observation.raw)).toMatchObject({ encoding: 'binary', next_steps: expect.arrayContaining([
        expect.stringContaining('workspace.unpack')
      ]) });
      const unpack = events.find(event => event.activity === 'tool.result' && event.data.tool === 'workspace.unpack');
      expect(unpack).toBeDefined();
      const details = JSON.parse(unpack.data.observation.raw);
      expect(details.source.path).toBe('throwback_templates.tar.gz');
      expect(details.source.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(details.members.some((member: any) => member.path === 'CTFd/templates/base.html' && member.type === 'file')).toBe(true);
      expect(details.members.filter((member: any) => member.type === 'file').every((member: any) => member.artifact_ref?.hash)).toBe(true);
      const workspaceArchive = join(fixture.out, 'workspaces', 'task_solver', 'throwback_templates.tar.gz');
      expect(await readFile(workspaceArchive)).toEqual(original);
      const basePage = events.filter(event => event.activity === 'tool.result' && event.data.tool === 'workspace.read').at(-1);
      expect(basePage.data.observation.outcome).toBe('success');
      const readResult = JSON.parse(basePage.data.observation.raw);
      expect(readResult.source).toMatchObject({ source_path: 'throwback_templates.tar.gz', member_path: 'CTFd/templates/base.html' });
      expect(readResult.encoding).toBe('utf-8');
      expect(readResult.content.length).toBeGreaterThan(100);
      const searched = events.find(event => event.activity === 'tool.result' && event.data.tool === 'workspace.search');
      expect(searched.data.observation.outcome).toBe('success');
      expect(JSON.parse(searched.data.observation.raw).matches.length).toBeGreaterThan(0);
      expect(JSON.stringify(events)).not.toContain('ARK_API_KEY');
    } finally { await fixture.close(); }
  }, 60000);

  it('continues Web observations with host-owned cursors and measures context without trimming it', async () => {
    const body = Array.from({ length: 6144 }, (_, index) => String.fromCharCode(97 + index % 26)).join('');
    const fixture = await openCodeFixture([
      { name: 'ctf_http_request', args: { url: '$TARGET' } },
      { name: 'ctf_observation_read', args: { ref: '$LAST_OBSERVATION_REF', max_bytes: 1024 } },
      { name: 'ctf_observation_read', args: { ref: '$LAST_OBSERVATION_REF', max_bytes: 1024 } }
    ], { webBody: body });
    try {
      const run = await fixture.run();
      expect(run.result.outcome).not.toBe('solved');
      const events = await fixture.events();
      const request = events.find(event => event.activity === 'tool.result' && event.data.tool === 'http.request');
      const requestRaw = JSON.parse(request.data.observation.raw);
      expect(requestRaw).toMatchObject({ status: 200, body_size: body.length, body_fully_inline: false });
      expect(requestRaw.body).toBeUndefined();
      expect(requestRaw.body_preview.content).toBe(body.slice(0, 2048));
      expect(requestRaw.observation_ref).toMatch(/^observation_/);
      const bodyRef = request.data.observation.artifact_refs.find((ref: { size: number }) => ref.size === body.length);
      expect(await readFile(bodyRef.path, 'utf8')).toBe(body);

      const page = events.find(event => event.activity === 'tool.result' && event.data.tool === 'observation.read');
      const pageRaw = JSON.parse(page.data.observation.raw);
      expect(pageRaw).toMatchObject({ cursor: 2048, next_cursor: 3072, size: body.length, encoding: 'utf8' });
      expect(pageRaw.chunk).toBe(body.slice(2048, 3072));
      const range = page.data.observation.artifact_refs.find((ref: { hash: string }) => ref.hash === pageRaw.range_ref.hash);
      expect(await readFile(range.path, 'utf8')).toBe(pageRaw.chunk);
      const pages = events.filter(event => event.activity === 'tool.result' && event.data.tool === 'observation.read');
      expect(pages).toHaveLength(2);
      expect(JSON.parse(pages[1].data.observation.raw)).toMatchObject({ cursor: 3072, next_cursor: 4096, chunk: body.slice(3072, 4096) });
      const definitions = fixture.requests[0]!.tools as any[];
      const schema = definitions.find(tool => tool.function.name === 'ctf_observation_read').function.parameters;
      expect(schema.properties.cursor).toBeUndefined();
      expect(schema.required).toContain('ref');
      const calls = events.filter(event => event.activity === 'driver.call');
      expect(calls).toHaveLength(fixture.requests.length);
      expect(calls.every(event => event.data.context_measurement?.method === 'utf8-json-bytes/v1')).toBe(true);
      const measured = calls.at(-1).data.context_measurement;
      expect(measured.categories.history_candidate.bytes).toBeGreaterThan(0);
      expect(measured.categories.working_set.bytes).toBeGreaterThan(0);
      expect(Object.values(measured.categories).reduce((sum: number, item: any) => sum + item.bytes, 0)).toBe(measured.parts_bytes);
      expect(measured.counterfactual.retained_parts_bytes).toBe(measured.parts_bytes - measured.categories.history_candidate.bytes);
      expect(measured.counterfactual.applied).toBe(false);
      expect(measured.token_estimate).toBeNull();
      expect(measured.system_bytes).toBeGreaterThan(0);
      expect(calls.map(event => event.data.context_measurement.prior_usage_message_ids.length)).toEqual([0, 1, 2, 3]);
      expect(run.result.provider_usage.messages).toHaveLength(fixture.requests.length);
      expect(run.result.provider_usage.messages.every((item: any) => item.input_tokens === 20)).toBe(true);
      // Old observations still reach the local provider: measuring never edits the session.
      expect(JSON.stringify(fixture.requests.at(-1))).toContain(body.slice(0, 2048));
      expect(JSON.stringify(calls.map(event => event.data.context_measurement))).not.toContain(body.slice(0, 100));
      expect(JSON.stringify(fixture.requests)).not.toContain(body);
      expect(JSON.stringify(fixture.requests)).not.toContain('artifacts-store');
    } finally { await fixture.close(); }
  }, 60000);

  it('lets OpenCode own model/tool turns and reaches independent replay plus oracle accepted', async () => {
    const fixture = await openCodeFixture(successfulRepair);
    try {
      const run = await fixture.run();
      expect(run.code, run.stderr).toBe(0);
      expect(run.result).toMatchObject({ outcome: 'solved', engine: { name: 'opencode', model: 'local/local-perfect' } });
      const report = await readFile(run.result.postmortem_path, 'utf8');
      expect(report).toContain('結果：** solved');
      expect(report).toContain('candidate 狀態：** 已登記');
      expect(report).not.toContain('flag{local_repair}');
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
