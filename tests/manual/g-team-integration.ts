// Scripted dialogue exists only in this acceptance fixture; production launch/C never chooses the team sequence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launch } from '../../apps/launcher/src/launch.js';

// Optional (tool image design §4): TEAM_TOOL_IMAGE runs every job in per-session containers of that image, with the
// image's own node; TEAM_OUT then names an output directory outside the repository. Unset keeps the original batch.
const toolImage = process.env.TEAM_TOOL_IMAGE || undefined;
const out = process.env.TEAM_OUT ? resolve(process.env.TEAM_OUT) : resolve('docs/gates/g-solver-verification-20261023/integration-20261024/team-runtime');
if (toolImage && (!process.env.TEAM_OUT || out.startsWith(resolve('.')))) throw new Error('TEAM_OUT outside the repository is required with TEAM_TOOL_IMAGE');
const node = toolImage ? 'node' : process.execPath;
// Optional (design §7): TEAM_CRATE_SAMPLE names a self-written Cargo project (Cargo.toml, Cargo.lock, src/main.rs printing
// {"n":42}); it is zipped into the materials, the launcher prefetches its crates, and the Engineer builds it offline.
// TEAM_CRATE_CACHE reuses already verified .crate files. Requires TEAM_TOOL_IMAGE.
const crateSample = process.env.TEAM_CRATE_SAMPLE ? resolve(process.env.TEAM_CRATE_SAMPLE) : undefined;
if (crateSample && !toolImage) throw new Error('TEAM_CRATE_SAMPLE requires TEAM_TOOL_IMAGE');
const CRATE_BUILD = 'unzip -q ../../materials/crate-sample.zip -d crate && cd crate/proj && cargo build --quiet && ./target/debug/sample';
await mkdir(out); // Refuse to overwrite a previous batch.
const root = await mkdtemp(join(tmpdir(), 'g-team-runtime-'));
const provider: any[] = [], events: any[] = [], targetRequests: string[] = [];
const RECOMPUTE = "const fs=require('fs'); const n=JSON.parse(fs.readFileSync('../../materials/numbers.json','utf8')); console.log(n.a*n.b)";
const PACKAGED = "const n=JSON.parse(require('fs').readFileSync('data/numbers.json','utf8')); process.stdout.write(String(n.a*n.b))";
const steps = new Map<string, number>();
let seq = 0, phase = 0, solverID = '', currentRole = '', packageVersion = '', failure: string | undefined;
let result: Awaited<ReturnType<typeof launch>> | undefined;
const abort = new AbortController();
const target = createServer((q, r) => { targetRequests.push(q.url!); r.writeHead(200, { 'content-type': 'text/plain' }); r.end('authorized-local-observation'); });
await new Promise<void>(r => target.listen(0, '127.0.0.1', r));
const targetURL = `http://127.0.0.1:${(target.address() as { port: number }).port}`;
const stub = createServer((q, r) => { void (async () => {
  assert(q.url?.endsWith('/chat/completions'));
  const chunks: Buffer[] = []; for await (const c of q) chunks.push(Buffer.from(c));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const first = JSON.stringify(body.messages.find((m: any) => m.role === 'user')?.content ?? '');
  const who = /TEAM_ROLE_(intake|recon|domain-solver|engineer|verifier|reference|strategy)/.exec(first)?.[1] ?? 'coordinator';
  const step = steps.get(who) ?? 0; steps.set(who, step + 1);
  const all = JSON.stringify(body.messages);
  const toolResults = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => String(m.content));
  const calls: Array<{ name: string; args: object }> = [];
  const call = (name: string, args: object = {}) => calls.push({ name, args });
  const task = (role: string, background = false, taskID?: string) => call('task', {
    subagent_type: role, description: `TEAM ${role}`, prompt: `TEAM_ROLE_${role}${taskID ? ' TEAM_REPAIR correct the failed script in the same task' : ''}`,
    ...(background ? { background: true } : {}), ...(taskID ? { task_id: taskID } : {})
  });
  let content = '';
  if (who === 'coordinator') {
    // Parent may idle after an early ref; only a native completion advances the fixture.
    switch (phase) {
      case 0: task('intake'); phase++; break;
      case 1: assert(all.includes('INTAKE_DONE')); task('reference'); phase++; break;
      case 2: task('strategy'); phase++; break;
      case 3: call('ctf_challenge_assign', { challenge: 'X', role: 'recon' }); phase++; break;
      case 4: task('recon', true); currentRole = 'recon'; phase++; break;
      case 5: if (all.includes('RECON_DONE')) { call('ctf_challenge_assign', { challenge: 'X', role: 'domain-solver' }); phase++; } break;
      case 6: task('domain-solver', true); currentRole = 'domain-solver'; phase++; break;
      case 7:
        if (all.includes('SOLVER_NEEDS_FIX')) {
          const initial = toolResults.filter((s: string) => s.includes('Background task started')).at(-1);
          solverID = /<task id="(ses_[\w]+)"/.exec(initial ?? '')?.[1] ?? '';
          assert(solverID); task('domain-solver', true, solverID); phase++;
        } break;
      case 8: if (all.includes('SOLVER_FIXED')) { call('ctf_challenge_assign', { challenge: 'X', role: 'engineer' }); phase++; } break;
      case 9: task('engineer', true); currentRole = 'engineer'; phase++; break;
      // The Verifier is bound to the package version the Engineer handed back (D: version-bound verification).
      case 10: { const v = /ENGINEER_PACKAGED version=(\S+)/.exec(all)?.[1]; if (v) { packageVersion = v; call('ctf_challenge_assign', { challenge: 'X', role: 'verifier', version: v }); phase++; } } break;
      case 11: task('verifier', true); currentRole = 'verifier'; phase++; break;
      case 12: if (all.includes('VERIFIER_RECOMPUTED')) { content = 'G_WIRING_COMPLETE; packaged candidate recomputed by the version-bound Verifier; no verification report or solved claim'; phase++; } break;
      default: content = 'G_WIRING_COMPLETE';
    }
    content ||= `WAIT_FOR_${currentRole || 'TEAM'}`;
  } else if (who === 'intake') {
    if (step === 0) call('ctf_challenge_list');
    else if (step === 1) call('ctf_challenge_read', { id: 'X', path: 'numbers.json' });
    else content = 'INTAKE_DONE X numbers.json public materials; authorized loopback target; oracle unavailable';
  } else if (who === 'reference' || who === 'strategy') {
    content = `${who.toUpperCase()}_DONE: use supplied materials; preserve evidence, counterexamples and unknowns`;
  } else if (who === 'recon') {
    if (step === 0) call('ctf_workspace_list');
    else if (step === 1) call('ctf_http_request', { url: targetURL, timeout_ms: 3000 });
    else if (step === 2) call('ctf_workspace_write', { path: 'work/observation.txt', content: 'local HTTP observation; private until D publishes' });
    else content = 'RECON_DONE authorized-local-observation; work is private; no completion oracle';
  } else if (who === 'domain-solver') {
    if (step === 0) call('ctf_job_run', { argv: [node, '-e', "console.error('fixture-script-error');process.exit(1)"], timeout_ms: 5000 });
    else if (step === 1) content = 'SOLVER_NEEDS_FIX script exit 1; repair locally in the same task';
    else if (step === 2) { assert(all.includes('TEAM_REPAIR')); call('ctf_workspace_write', { path: 'work/solve.cjs', content: "console.log(6*7)" }); }
    else if (step === 3) call('ctf_job_run', { argv: [node, 'solve.cjs'], timeout_ms: 5000 });
    else content = 'SOLVER_FIXED local output 42; script stays private; D publication missing';
  } else if (who === 'engineer') {
    // Recompute locally, then fix the job output and a packaged script into one candidate package.
    const last = (re: RegExp) => toolResults.map((t: string) => re.exec(t)?.[1]).filter(Boolean).at(-1);
    if (step === 0) call('ctf_workspace_read', { path: 'materials/numbers.json' });
    else if (step === 1) call('ctf_workspace_write', { path: 'work/recompute.cjs', content: RECOMPUTE });
    else if (step === 2) call('ctf_job_run', { argv: [node, 'recompute.cjs'], timeout_ms: 5000 });
    else if (step === 3) call('ctf_artifact_publish', { source: 'job', job: last(/"job":"([^"]+)"/), stream: 'stdout' });
    else if (step === 4) call('ctf_workspace_write', { path: 'work/package.cjs', content: PACKAGED });
    else if (step === 5) call('ctf_artifact_publish', { source: 'file', path: 'work/package.cjs' });
    else if (step === 6) {
      const refs = toolResults.map((t: string) => /"ref":"([^"]+)"/.exec(t)?.[1]).filter(Boolean);
      assert.equal(refs.length, 2);
      call('ctf_package_publish', { candidate: { ref: refs[0], start: 0, end: 2 },
        files: [{ kind: 'artifact', ref: refs[1], path: 'package.cjs', purpose: 'script' }, { kind: 'material', name: 'numbers.json', path: 'data/numbers.json', purpose: 'input' }],
        argv: [node, 'package.cjs'], extraction: 'Bytes [0,2) of the recompute job stdout; no normalization', premises: ['Fixture materials are the only input'] });
    } else if (step === 7 && crateSample) call('ctf_job_run', { argv: ['/bin/sh', '-c', CRATE_BUILD], timeout_ms: 50000 });
    else content = `ENGINEER_PACKAGED version=${last(/"version":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/)} candidate from recompute job stdout; not verified or solved`;
  } else {
    // Verifier: prepare the bound version and run the packaged script on the prepared inputs only.
    if (step === 0) call('ctf_package_prepare', {});
    else if (step === 1) call('ctf_job_run', { preparation: /"preparation":"([^"]+)"/.exec(toolResults.at(-1) ?? '')?.[1], argv: [node, 'package.cjs'], timeout_ms: 5000 });
    else content = 'VERIFIER_RECOMPUTED 42 from the prepared package; no verification report or solved claim';
  }
  provider.push({ at: Date.now(), seq: ++seq, who, step, phase, calls, toolResults, messages: body.messages, tools: body.tools });
  const base = { id: `chatcmpl-${seq}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'scripted' };
  const delta = calls.length ? { role: 'assistant', tool_calls: calls.map((c, i) => ({ index: i, id: `call_${seq}_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : { role: 'assistant', content };
  r.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const v of [{ ...base, choices: [{ index: 0, delta, finish_reason: null }] }, { ...base, choices: [{ index: 0, delta: {}, finish_reason: calls.length ? 'tool_calls' : 'stop' }] }, { ...base, choices: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }]) r.write(`data: ${JSON.stringify(v)}\n\n`);
  r.end('data: [DONE]\n\n');
})().catch(e => { failure = String(e); r.writeHead(500).end('{}'); }); });
await new Promise<void>(r => stub.listen(0, '127.0.0.1', r));
process.env.TEAM_STUB_KEY = 'local-only';
process.env.HTTP_PROXY = process.env.HTTPS_PROXY = process.env.ALL_PROXY = 'http://127.0.0.1:9';
process.env.NO_PROXY = '127.0.0.1,localhost';
await writeFile(join(root, 'numbers.json'), JSON.stringify({ a: 6, b: 7 }));
if (crateSample) {
  const { execFileSync } = await import('node:child_process');
  execFileSync('python3', ['-I', '-c', 'import sys, zipfile, os\nz = zipfile.ZipFile(sys.argv[1], "w")\nfor f in ("Cargo.toml", "Cargo.lock", "src/main.rs"): z.write(os.path.join(sys.argv[2], f), "proj/" + f)\nz.close()',
    join(root, 'crate-sample.zip'), crateSample]);
}
await writeFile(join(root, 'opencode.json'), JSON.stringify({ model: 'stub/scripted', enabled_providers: ['stub'], provider: { stub: { npm: '@ai-sdk/openai-compatible', options: { baseURL: `http://127.0.0.1:${(stub.address() as { port: number }).port}/v1`, apiKey: '{env:TEAM_STUB_KEY}' }, models: { scripted: { limit: { context: 65536, output: 2048 } } } } } }));
await writeFile(join(root, 'challenges.json'), JSON.stringify({ challenges: [{ id: 'X', statement: 'Local deterministic G wiring fixture; no oracle', materials: ['numbers.json', ...(crateSample ? ['crate-sample.zip'] : [])], target: { protocol: 'http', url: targetURL } }] }));
await writeFile(join(root, 'profile.json'), JSON.stringify({ profileId: 'g-team-local', challenges: 'challenges.json', opencode: { configPath: 'opencode.json', binaryPath: '/Users/caihaoming/.opencode/bin/opencode' }, reference: { enabled: false }, budget: { wallClockMs: 60000, maxSteps: 80, maxObservableTokens: 100000, maxToolJobs: 5 }, os: { platform: 'macos' } }));
try {
  result = await launch({ profile: join(root, 'profile.json'), runsRoot: join(root, 'runs'), runId: 'team', toolImage, crateCache: process.env.TEAM_CRATE_CACHE || undefined, onStarted: async ({ client }) => {
    const stream = await client.event.subscribe({}, { signal: abort.signal, throwOnError: true });
    void (async () => { try { for await (const e of stream.stream) events.push({ at: Date.now(), ...e }); } catch { /* closed */ } })();
  } });
  assert.equal(failure, undefined); assert.equal(result.status, 'completed'); assert.equal(phase, 13);
  const evidence = join(result.runDir!, 'evidence');
  const load = async (name: string) => JSON.parse(await readFile(join(evidence, name), 'utf8'));
  const bindings = await load('bindings.json'), executions = await load('task-executions.json'), resources = await load('tool-resources.json'), audit = await load('control-audit.json');
  assert.equal(provider.length, audit.filter((r: any) => r.op === 'model.call' && r.allow).length);
  assert.equal(targetRequests.length, 1);
  assert(resources.every((r: any) => r.state === 'settled')); assert(resources.some((r: any) => r.result === 'exited'));
  const solverExecutions = executions.filter((e: any) => e.role === 'domain-solver');
  assert.equal(solverExecutions.length, 2); assert.equal(solverExecutions[0].childID, solverID); assert.equal(solverExecutions[1].childID, solverID); assert.notEqual(solverExecutions[0].ref, solverExecutions[1].ref);
  // Sync tasks are delivered in the call itself and carry no delivery state; background ones must be consumed.
  assert(executions.every((e: any) => e.state === 'completed' && (e.mode === 'sync' ? e.delivery === undefined : e.delivery === 'consumed')));
  for (const role of ['engineer', 'verifier']) {
    const binding = bindings.find((b: any) => b.role === role); assert(binding); assert.equal(binding.challengeId, 'X');
    assert(resources.some((r: any) => r.sessionID === binding.sessionID && r.tool === 'job.run' && r.result === 'exited'));
    assert(provider.filter(p => p.who === role).every(p => !p.tools.some((t: any) => t.function.name === 'ctf_http_request')));
  }
  const engineer = bindings.find((b: any) => b.role === 'engineer');
  assert.equal(await readFile(join(result.runDir!, 'workspace/X/work', engineer.sessionID, 'recompute.cjs'), 'utf8'), RECOMPUTE);
  // D version binding: assign, Verifier execution and the prepared job all carry the Engineer's package version.
  assert(packageVersion);
  assert(audit.some((r: any) => r.op === 'assign' && r.allow && r.detail?.role === 'verifier' && r.detail?.version === packageVersion));
  assert.equal(executions.find((e: any) => e.role === 'verifier')?.version, packageVersion);
  const verifierInput = audit.find((r: any) => r.op === 'verification.job.input');
  assert.equal(verifierInput?.detail?.version, packageVersion); assert.deepEqual(verifierInput?.detail?.argv, [node, 'package.cjs']);
  assert(provider.some(p => p.who === 'verifier' && p.toolResults.some((s: string) => s.includes('"exitCode":0') && s.includes('42'))));
  assert((await readdir(join(result.runDir!, 'workspace/X/published'))).length > 0);
  assert(provider.some(p => p.who === 'domain-solver' && p.toolResults.some((s: string) => s.includes('"exitCode":1'))));
  assert(provider.some(p => p.who === 'domain-solver' && p.step > 1 && p.toolResults.some((s: string) => s.includes('"exitCode":0'))));
  for (const p of provider.filter(p => ['domain-solver', 'engineer', 'verifier'].includes(p.who))) {
    const schema = p.tools.find((t: any) => t.function.name === 'ctf_job_run').function.parameters.properties;
    assert(!('wait_ms' in schema)); assert(!('completion' in schema));
  }
  let toolImageCheck: Record<string, unknown> | undefined;
  if (toolImage) {
    const { execFileSync } = await import('node:child_process');
    const evidenceImage = await load('tool-image.json');
    assert.match(evidenceImage.id, /^sha256:/); assert.match(evidenceImage.inventorySha256, /^[0-9a-f]{64}$/);
    const described = provider.filter(p => p.tools?.some((t: any) => t.function.name === 'ctf_job_run'))
      .every(p => p.tools.find((t: any) => t.function.name === 'ctf_job_run').function.description.includes(evidenceImage.inventoryPath));
    assert(described);
    const left = execFileSync('docker', ['ps', '-aq', '--filter', 'name=ctf-team-'], { encoding: 'utf8' }).trim();
    assert.equal(left, '');
    const jobSessions = new Set(resources.filter((r: any) => r.tool === 'job.run').map((r: any) => r.sessionID));
    let crates: Record<string, unknown> | undefined;
    if (crateSample) {
      // Design §7 end to end: lockfile found in the zip, crates prefetched and mounted, Engineer builds offline in its container.
      const prefetch = await load('crate-prefetch.json');
      assert.equal(prefetch.result, 'ready'); assert.equal(prefetch.mounts.length, 2);
      assert.deepEqual(prefetch.lockfiles.map((l: any) => l.path), ['crate-sample.zip!proj/Cargo.lock']);
      const engineerJobs = resources.filter((r: any) => r.tool === 'job.run' && r.sessionID === bindings.find((b: any) => b.role === 'engineer').sessionID);
      const build = engineerJobs.at(-1);
      const settled = audit.find((r: any) => r.op === 'tool.settled' && r.detail?.callID === build.callID)?.detail;
      assert.equal(build.result, 'exited'); assert.equal(settled?.exitCode, 0);
      const stdout = await readFile(join(result.runDir!, 'state/jobs', build.sessionID, settled.job, 'stdout.bin'), 'utf8');
      assert.equal(stdout.trim(), '{"n":42}');
      crates = { prefetch: prefetch.result, lockfiles: prefetch.lockfiles.length, crates: prefetch.crates, downloaded: prefetch.downloaded, cacheHits: prefetch.cacheHits,
        engineerBuild: build.result, engineerBuildOutputMatches: true };
    }
    toolImageCheck = { image: toolImage, ...(crates ? { crates } : {}), id: evidenceImage.id, inventorySha256: evidenceImage.inventorySha256, jobDescriptionPointsToInventory: described,
      jobSessions: jobSessions.size, jobResults: resources.filter((r: any) => r.tool === 'job.run').map((r: any) => r.result), containersLeftAfterRun: 0 };
  }
  const summary = { status: result.status, phase, requests: provider.length, executions: executions.length, resources: resources.length, targetRequests, realModelCalls: 0,
    ...(toolImageCheck ? { toolImage: toolImageCheck } : {}),
    gWiring: 'passed', packageVersion, completeTeamSolve: 'Engineer package and version-bound Verifier recompute pass; verification.report and completion not exercised', realModelAbility: 'unverified', solved: false,
    recoveryCritic: 'not triggered: one ordinary script failure, no persistent stagnation', isolation: 'not verified; known same-uid/direct-network limitations retained' };
  await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary));
} catch (e) { failure = failure ?? String(e); process.exitCode = 1; console.error(e); }
finally {
  abort.abort();
  if (result?.runDir) {
    for (const name of await readdir(join(result.runDir, 'evidence'))) if (/^(control-audit|tool-resources|bindings|admissions|sessions|messages-|task-executions|challenges)/.test(name)) await writeFile(join(out, name), await readFile(join(result.runDir, 'evidence', name)));
    await writeFile(join(out, 'run.json'), await readFile(join(result.runDir, 'state/run.json')));
    const jobs = join(result.runDir, 'state/jobs');
    for (const sid of await readdir(jobs)) for (const jid of await readdir(join(jobs, sid))) for (const stream of ['stdout.bin', 'stderr.bin']) {
      await mkdir(join(out, 'job-output', sid, jid), { recursive: true }); await writeFile(join(out, 'job-output', sid, jid, stream), await readFile(join(jobs, sid, jid, stream)));
    }
  }
  await writeFile(join(out, 'provider.json'), JSON.stringify(provider, null, 2));
  await writeFile(join(out, 'events.json'), JSON.stringify(events, null, 2));
  await writeFile(join(out, 'result.json'), JSON.stringify({ result, failure, root, usage: 'scripted provider reports zero; real model usage unavailable' }, null, 2));
  await new Promise<void>(r => { stub.close(() => r()); stub.closeAllConnections(); }); await new Promise<void>(r => { target.close(() => r()); target.closeAllConnections(); });
}
