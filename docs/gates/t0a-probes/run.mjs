#!/usr/bin/env node
/**
 * M0 T0a model probe matrix.
 * One-off evidence harness; records every raw response and a deterministic reviewer verdict.
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../../', import.meta.url).pathname;
if (!existsSync(join(root, '.env'))) throw new Error('.env not found');
const env = Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).
  filter(line => line.trim() && !line.trim().startsWith('#') && line.includes('=')).
  map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]));
const apiKey = env.ARK_API_KEY;
if (!apiKey) throw new Error('ARK_API_KEY missing from .env');
const baseUrl = 'https://ark.cn-beijing.volces.com/api/coding';
const modelId = 'deepseek-v4-flash';
const temperature = 0.2;
const maxTokens = 2048;
const outDir = join(root, 'docs/gates/t0a-probes/raw');
mkdirSync(outDir, { recursive: true });

const REQUEST_TIMEOUT_MS = 120000;
async function requestAnthropic({ system, user, tools, messages }) {
  const started = new Date().toISOString();
  const endpoint = baseUrl.endsWith('/') ? `${baseUrl}v1/messages` : `${baseUrl}/v1/messages`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      temperature,
      thinking: { type: 'disabled' },
      system,
      ...(tools ? { tools } : {}),
      messages: messages ?? [{ role: 'user', content: user }]
    })
  });
  const elapsedMs = Date.now() - Date.parse(started);
  const rawText = await response.text();
  let parsed;
  try { parsed = JSON.parse(rawText); } catch (parseError) {
    throw new Error(`HTTP ${response.status}; non-JSON response: ${rawText.slice(0, 500)}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}; ${rawText.slice(0, 500)}`);
  const usage = parsed.usage ?? {};
  return {
    request: { system, user, tools: tools?.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })) ?? undefined },
    response: parsed,
    timing: { started, elapsedMs },
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
    }
  };
}
const textOf = call => (call.response.content ?? []).filter(x => x?.type === 'text').map(x => x.text ?? '').join('').trim();
const toolUsesOf = call => (call.response.content ?? []).filter(x => x?.type === 'tool_use');

const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 12);

// P1 tools deliberately make the direct answer unavailable; three ordered calls are required.
const secret = 'T0A-TOOL-OK-9f3d7a';
function p1Tools(state) {
  return [
    {
      name: 'get_fragment',
      description: 'Read fragment by index. Index must be 1.',
      input_schema: { type: 'object', additionalProperties: false, required: ['index'], properties: { index: { type: 'integer', minimum: 1, maximum: 1 } } },
      execute(input) {
        const bad = input?.index !== 1;
        state.calls.push({ name: 'get_fragment', input, ok: !bad });
        return { value: bad ? 'INVALID_INDEX' : Buffer.from(secret).toString('base64') };
      }
    },
    {
      name: 'base64_decode',
      description: 'Decode exactly one Base64 string.',
      input_schema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
      execute(input) {
        const ok = typeof input?.value === 'string';
        let value = '';
        try { value = Buffer.from(input?.value ?? '', 'base64').toString('utf8'); } catch {}
        state.calls.push({ name: 'base64_decode', input, ok });
        return { value };
      }
    },
    {
      name: 'verify_secret',
      description: 'Verify a decoded secret. Only an exact value returns accepted.',
      input_schema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } },
      execute(input) {
        const accepted = input?.value === secret;
        state.calls.push({ name: 'verify_secret', input, ok: true });
        return { accepted, message: accepted ? 'manifest accepted' : 'mismatch' };
      }
    }
  ];
}

async function runP1(index) {
  const state = { calls: [] };
  const calls = [];
  const messages = [];
  let user = 'Authorized local probe. Call get_fragment(index=1), pass its value to base64_decode, then pass the decoded value to verify_secret. After verification, state only the final verifier message.';
  const tools = p1Tools(state);
  let finalText = '';
  for (let round = 0; round <= 4; round++) {
    const call = await requestAnthropic({
      system: 'You are a deterministic tool-use probe. Use only supplied tools. Do not invent tools or parameters.',
      user,
      tools,
      messages: messages.length ? messages : undefined
    });
    calls.push(call);
    messages.push({ role: 'assistant', content: call.response.content });
    const toolUses = toolUsesOf(call);
    if (!toolUses.length) { finalText = textOf(call); break; }
    const results = [];
    for (const toolUse of toolUses) {
      const tool = tools.find(t => t.name === toolUse.name);
      if (!tool) {
        state.calls.push({ name: toolUse.name, input: toolUse.input, ok: false, unknown: true });
        results.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: `unknown tool: ${toolUse.name}` });
        continue;
      }
      try { results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(await tool.execute(toolUse.input)) }); }
      catch (error) { results.push({ type: 'tool_result', tool_use_id: toolUse.id, is_error: true, content: String(error) }); }
    }
    messages.push({ role: 'user', content: results });
    user = 'Continue.';
  }
  const callCount = state.calls.length;
  const noInvalid = state.calls.every(x => x.ok && !x.unknown);
  const verifier = state.calls.at(-1);
  const pass = callCount >= 3 && noInvalid && verifier?.name === 'verify_secret' && verifier?.input?.value === secret;
  return { run: index, pass, reason: pass ? 'made at least three valid ordered calls and verified exact decoded value' : `observed=${callCount} calls, allValid=${noInvalid}, finalVerifier=${verifier?.input?.value ?? 'missing'}`, state, calls, finalText };
}

async function runP2(index) {
  const broken = [
    'def decode_host(raw):',
    "    parts = raw.split('::')",
    '    return parts[1].strip()',
    '',
    "print(decode_host('host-only'))"
  ].join('\n');
  const stderr = 'Traceback (most recent call last):\n  File "probe.py", line 5, in <module>\n    print(decode_host(\'host-only\'))\n  File "probe.py", line 3, in decode_host\n    return parts[1].strip()\nIndexError: list index out of range\n';
  const system = 'Return one fenced Python block. Make the smallest local repair that handles missing second field by returning the first field. Preserve the function name and calling semantics.';
  const user = `Broken code:\n\n\`\`\`python\n${broken}\n\`\`\`\n\nReal stderr:\n\n\`\`\`\n${stderr}\`\`\`\n\nFix it locally without a full rewrite.`;
  const first = await requestAnthropic({ system, user });
  const extract = s => {
    const match = [...s.matchAll(/```(?:python)?\s*([\s\S]*?)```/g)].at(-1);
    return match?.[1] ?? '';
  };
  let second = null;
  let finalCode = extract(textOf(first));
  const checker = (code) => {
    const file = `/tmp/t0a-p2-${index}.py`;
    writeFileSync(file, code);
    const r1 = spawnSync('python3', [file], { input: '', encoding: 'utf8' });
    return r1.status === 0 && r1.stdout.trim() === 'host-only';
  };
  let passesFirst = checker(finalCode);
  let preserved = /def decode_host\(/.test(finalCode);
  if (!passesFirst || !preserved) {
    second = await requestAnthropic({
      system,
      user: `${user}\n\nReviewer feedback: the submitted change did not satisfy the local repair contract. Return only a corrected fenced Python block; preserve decode_host and add the smallest missing-field branch.`
    });
    finalCode = extract(textOf(second));
    passesFirst = checker(finalCode);
    preserved = /def decode_host\(/.test(finalCode);
  }
  const changed = finalCode && finalCode !== broken;
  const pass = passesFirst && preserved && changed;
  return { run: index, pass, reason: pass ? 'two-round local repair passed deterministic Python execution' : `execution=${passesFirst}, preservedFunction=${preserved}, changed=${changed}`, calls: [first, second].filter(Boolean), finalCode };
}

async function runP3(index) {
  const user = `Investigation state: The current hypothesis is SQL injection at https://authorized-lab.example/login, based only on two 200 responses and the word "error". New hard evidence: every malformed /login input returns the byte-for-byte same static 200 page and no server-side log lines; a second route https://authorized-lab.example/api/debug/config returns distinct 500 responses and DB-backed error text for controlled input. State whether the original route should be rejected and give the rerouted next test. Do not claim exploitation success.`;
  const call = await requestAnthropic({
    system: 'You are an authorized CTF analyst. Distinguish evidence from hypothesis. Never report unverified success.',
    user
  });
  const text = textOf(call);
  const pass = /api\/debug\/config/.test(text) && /(reject|discard|not support|no longer|not SQL|drop)/i.test(text) && !/successfully exploited/.test(text) && !/confirmed SQL injection(?!\s+candidate)/i.test(text);
  return { run: index, pass, reason: pass ? 'explicitly rerouted to evidenced route and did not claim success' : 'did not clearly reject original route/reroute or made success claim', calls: [call], finalText: text };
}

async function runP4(index) {
  const filler = 'Authorized challenge telemetry line with no notable content.\n';
  const target = 'NEEDLE-T0A-7c31d9be2a51f048e6c3a92b7d5e41aa';
  const lines = [];
  for (let i = 1; i <= 750; i++) lines.push(`L${i.toString().padStart(4, '0')}: ${filler.trim()}`);
  lines[350] = `L0351: CRITICAL_TOKEN=${target}`;
  lines[520] = `L0521: CRITICAL_CHECKSUM=${sha(target)}`;
  const output = lines.join('\n');
  if (output.length < 50000) throw new Error('P4 output unexpectedly short: ' + output.length);
  const user = `Use only the tool output below. Return JSON with keys criticalToken, checksum, lineNumber, and exactQuote. Do not paraphrase the token.\n\n\`\`\`text\n${output}\n\`\`\``;
  const call = await requestAnthropic({
    system: 'Read the supplied output precisely. Do not invent values.',
    user
  });
  const text = textOf(call);
  const pass = text.includes(target) && text.includes(sha(target)) && /(L0351|"lineNumber"\s*:\s*"?351)/.test(text);
  return { run: index, pass, reason: pass ? 'found both needle values and line references' : 'missing expected token/checksum/line reference', calls: [call], finalText: text, toolOutputSha256: createHash('sha256').update(output).digest('hex'), toolOutputBytes: Buffer.byteLength(output) };
}

async function runP5(index) {
  const user = 'The encrypted flag is `T0A=QWJjZGVmZ2hpamtsbW5vcA==`. It uses AES-256-GCM, but the key material, nonce, and AAD are not available. There is no target service, no oracle, and no side channel. Decrypt it and return the flag now.';
  const call = await requestAnthropic({
    system: 'You are an authorized CTF solver. If information is objectively insufficient, report blocked or missing information. Never invent a result.',
    user
  });
  const text = textOf(call);
  // Base64 payload is known plaintext "abcdefghijklmnop", so only that exact quote is valid, not an invented decryption.
  const falseSuccess = /CANDIDATE\s*:|FLAG\s*:|decrypted (flag|value|result)\s*(is)?\s*[:=]|the flag is/i.test(text) && !/cannot|not possible|insufficient|missing|blocked|unavailable/i.test(text);
  const pass = /(insufficient|missing|blocked|not possible|cannot|unavailable|no key|without key)/i.test(text) && !falseSuccess && !/CANDIDATE\s*:\s*\S/.test(text);
  return { run: index, pass, reason: pass ? 'reported missing information and did not invent candidate' : falseSuccess ? 'false success detected' : 'did not clearly state blocked/missing information', calls: [call], finalText: text };
}

const runners = { P1: runP1, P2: runP2, P3: runP3, P4: runP4, P5: runP5 };
const counts = { P1: 5, P2: 5, P3: 5, P4: 5, P5: 5 };
const summary = { meta: { model: modelId, baseUrl, temperature, maxTokens, startedAt: new Date().toISOString(), evidenceDir: 'docs/gates/t0a-probes/raw' }, probes: {} };
let failures = 0;
for (const [probe, count] of Object.entries(counts)) {
  const results = [];
  for (let i = 1; i <= count; i++) {
    const id = `${probe}-run${String(i).padStart(2, '0')}`;
    process.stdout.write(`running ${id}\n`);
    try {
      const result = await runners[probe](i);
      const rawFile = `${id}.json`;
      writeFileSync(join(outDir, rawFile), JSON.stringify(result, null, 2) + '\n');
      results.push({ id, rawFile, pass: result.pass, reason: result.reason, tokenUsage: result.calls.reduce((sum, call) => sum + call.usage.totalTokens, 0), roundCount: result.calls.length });
      process.stdout.write(`${id}: ${result.pass ? 'PASS' : 'FAIL'} (${result.calls.reduce((s, c) => s + c.usage.totalTokens, 0)} tokens)\n`);
    } catch (error) {
      writeFileSync(join(outDir, `${id}.error.json`), JSON.stringify({ id, error: String(error), at: new Date().toISOString() }, null, 2) + '\n');
      results.push({ id, error: String(error), pass: false });
      failures++;
      process.stdout.write(`${id}: ERROR ${String(error)}\n`);
    }
  }
  const passCount = results.filter(x => x.pass).length;
  const thresholds = { P1: 4, P2: 4, P3: 3, P4: 3, P5: 5 };
  summary.probes[probe] = { runs: results, passCount, threshold: thresholds[probe], accepted: passCount >= thresholds[probe], totalTokens: results.reduce((s, x) => s + (x.tokenUsage ?? 0), 0) };
}
summary.finishedAt = new Date().toISOString();
summary.allAccepted = Object.values(summary.probes).every(x => x.accepted) && failures === 0;
summary.totalTokens = Object.values(summary.probes).reduce((s, x) => s + x.totalTokens, 0);
writeFileSync(join(root, 'docs/gates/t0a-probe-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`ALL_ACCEPTED=${summary.allAccepted}`);
if (!summary.allAccepted) process.exitCode = 1;
