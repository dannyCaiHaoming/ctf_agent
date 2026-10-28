// Native scripted observation of the sync delivery chain (design §8.3). The scripted dialogue lives only in this file;
// the model is a local deterministic HTTP stub, the target is not used, and no real model, secret or original challenge is touched.
// Recon (sync) -> publish; Engineer (sync) -> read + package; Recon again (sync resume, same child) -> publish.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from '../../apps/launcher/src/launch.js';

const root = await mkdtemp(join(tmpdir(), 'g-sync-delivery-'));
const provider: any[] = [];
const steps = new Map<string, number>();
let seq = 0, phase = 0, reconID = '', failure: string | undefined;
const OBSERVED = Buffer.from([0, 255, 13, 10, 0x66, 0x6c, 0x61, 0x67]);
const stub = createServer((q, r) => { void (async () => {
  const chunks: Buffer[] = []; for await (const c of q) chunks.push(Buffer.from(c));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const first = JSON.stringify(body.messages.find((m: any) => m.role === 'user')?.content ?? '');
  const who = /TEAM_ROLE_(recon|engineer)/.exec(first)?.[1] ?? 'coordinator';
  const step = steps.get(who) ?? 0; steps.set(who, step + 1);
  const all = JSON.stringify(body.messages);
  const toolResults: string[] = body.messages.filter((m: any) => m.role === 'tool').map((m: any) => String(m.content));
  const lastRef = /"ref":"([\w-]+)"/.exec(toolResults.at(-1) ?? '')?.[1];
  const calls: Array<{ name: string; args: object }> = [];
  const call = (name: string, args: object = {}) => calls.push({ name, args });
  const task = (role: string, extra: object = {}, prompt = '') => call('task', { subagent_type: role, description: `SYNC ${role}`, prompt: `TEAM_ROLE_${role} ${prompt}`, background: false, ...extra });
  let content = '';
  if (who === 'coordinator') {
    switch (phase) {
      case 0: call('ctf_challenge_assign', { challenge: 'X', role: 'recon' }); phase++; break;
      case 1: task('recon'); phase++; break;
      case 2: if (all.includes('RECON_DONE')) {
        reconID = /<task id=\\"(ses_\w+)\\"/.exec(all)?.[1] ?? ''; assert(reconID);
        call('ctf_challenge_assign', { challenge: 'X', role: 'engineer' }); phase++;
      } break;
      case 3: task('engineer', {}, `REF=${/RECON_DONE ref=([\w-]+)/.exec(all)?.[1]}`); phase++; break;
      case 4: if (all.includes('ENGINEER_DONE')) { task('recon', { task_id: reconID, background: false }, 'ROUND2'); phase++; } break;
      case 5: if (all.includes('RECON_ROUND2_DONE')) { content = 'SYNC_CHAIN_COMPLETE'; phase++; } break;
      default: content = 'SYNC_CHAIN_COMPLETE';
    }
    content ||= 'WAIT';
  } else if (who === 'recon') {
    if (step === 0) call('ctf_workspace_write', { path: 'work/observed.bin', content: OBSERVED.toString('base64'), encoding: 'base64' });
    else if (step === 1) call('ctf_artifact_publish', { source: 'file', path: 'work/observed.bin' });
    else if (step === 2) content = `RECON_DONE ref=${lastRef}`;
    else if (step === 3) call('ctf_workspace_write', { path: 'work/round2.txt', content: 'second round bytes' });
    else if (step === 4) call('ctf_artifact_publish', { source: 'file', path: 'work/round2.txt' });
    else content = 'RECON_ROUND2_DONE';
  } else {
    const ref = /REF=([\w-]+)/.exec(first)?.[1] ?? '';
    if (step === 0) call('ctf_workspace_read', { path: `published/${ref}.bin` });
    else if (step === 1) call('ctf_package_publish', { candidate: { ref, start: 4, end: 8 }, files: [], extraction: 'bytes [4,8) of the recon observation', premises: [] });
    else content = 'ENGINEER_DONE';
  }
  provider.push({ seq: ++seq, who, step, phase, calls: calls.map(c => c.name), toolResults });
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
await writeFile(join(root, 'opencode.json'), JSON.stringify({ model: 'stub/scripted', enabled_providers: ['stub'], provider: { stub: { npm: '@ai-sdk/openai-compatible', options: { baseURL: `http://127.0.0.1:${(stub.address() as { port: number }).port}/v1`, apiKey: '{env:TEAM_STUB_KEY}' }, models: { scripted: { limit: { context: 65536, output: 2048 } } } } } }));
await writeFile(join(root, 'challenges.json'), JSON.stringify({ challenges: [{ id: 'X', statement: 'Local deterministic sync-delivery fixture; no oracle', materials: ['numbers.json'] }] }));
await writeFile(join(root, 'profile.json'), JSON.stringify({ profileId: 'g-sync-local', challenges: 'challenges.json', opencode: { configPath: 'opencode.json', binaryPath: '/Users/caihaoming/.opencode/bin/opencode' }, reference: { enabled: false }, budget: { wallClockMs: 60000, maxSteps: 60, maxObservableTokens: 100000, maxToolJobs: 3 }, os: { platform: 'macos' } }));
let result: Awaited<ReturnType<typeof launch>> | undefined;
try {
  result = await launch({ profile: join(root, 'profile.json'), runsRoot: join(root, 'runs'), runId: 'sync' });
  assert.equal(failure, undefined); assert.equal(result.status, 'completed'); assert.equal(phase, 6);
  const evidence = join(result.runDir!, 'evidence');
  const load = async (name: string) => JSON.parse(await readFile(join(evidence, name), 'utf8'));
  const executions = await load('task-executions.json'), audit = await load('control-audit.json'), publications = await load('publications.json'), bindings = await load('bindings.json');
  // Every dispatch was synchronous and minted exactly one execution, settled by the native return.
  assert.equal(executions.length, 3); assert(executions.every((e: any) => e.mode === 'sync' && e.state === 'completed' && e.delivered));
  const [recon1, engineer, recon2] = executions;
  assert.equal(recon1.role, 'recon'); assert.equal(engineer.role, 'engineer'); assert.equal(recon2.role, 'recon');
  assert.equal(recon1.childID, reconID); assert.equal(recon2.childID, reconID); assert.equal(new Set(executions.map((e: any) => e.ref)).size, 3);
  assert.equal(audit.filter((r: any) => !r.allow && /artifact execution|package execution/.test(r.reason ?? '')).length, 0);
  // Identity precedes the first managed tool and settlement follows the native return (audit order).
  const at = (pred: (r: any) => boolean) => audit.findIndex(pred);
  for (const e of executions) {
    const minted = at(r => r.op === 'task.execution' && r.detail?.ref === e.ref), bound = e === recon2 ? minted : at(r => r.op === 'bind' && r.sessionID === e.childID);
    const firstTool = at(r => r.op === 'tool.registered' && r.sessionID === e.childID && r.seq > audit[minted].seq), settled = at(r => r.op === 'sync.settled' && r.detail?.ref === e.ref);
    assert(minted >= 0 && bound >= minted && firstTool > bound && settled > firstTool, `order for ${e.ref}`);
  }
  // Exact bytes, execution-bound publications; package from the published recon artifact by the same-challenge Engineer.
  const art = publications.find((p: any) => p.source.kind === 'file' && p.source.execution === recon1.ref);
  assert(art); assert.equal(art.sha256, createHash('sha256').update(OBSERVED).digest('hex')); assert.equal(art.source.selectedExecution, recon1.ref);
  assert.deepEqual(await readFile(join(result.runDir!, 'workspace/X/published', `${art.ref}.bin`)), OBSERVED);
  const pkg = publications.find((p: any) => p.source.kind === 'package'); assert(pkg); assert.equal(pkg.source.execution, engineer.ref);
  const second = publications.find((p: any) => p.source.kind === 'file' && p.source.execution === recon2.ref); assert(second); assert.notEqual(second.source.execution, art.source.execution);
  assert.equal(art.source.execution, recon1.ref); // the old producer keeps its original round
  assert.equal(bindings.filter((b: any) => b.role === 'recon').length, 1); // the second round resumed the same child
  assert(provider.some(p => p.who === 'engineer' && p.toolResults.some((s: string) => s.includes('snapshotFixed'))));
  console.log(JSON.stringify({ status: result.status, runDir: result.runDir, requests: provider.length, executions: executions.map((e: any) => ({ role: e.role, mode: e.mode, state: e.state, childID: e.childID })), publications: publications.length, realModelCalls: 0, root }, null, 2));
} catch (e) { failure = failure ?? String(e); process.exitCode = 1; console.error(e, { root, runDir: result?.runDir, provider: provider.map(p => `${p.who}:${p.step}:${p.calls}`) }); }
finally { await new Promise<void>(r => { stub.close(() => r()); stub.closeAllConnections(); }); }
