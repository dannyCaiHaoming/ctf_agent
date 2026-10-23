// Test-only decision prototype. Not registered as an OpenCode tool or product adapter.
import type { StateStore } from '../../packages/state/src/index.js';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
export interface Descriptor {
  id: string; effect: 'protected' | 'observation'; scope: string;
  method: string; path: string; maxSends?: number;
}
export async function createProtectedHost(options: {
  source: string; sourceHash: string; state: StateStore; origin: string; challenge: string;
  raw: (args: Record<string, unknown>) => Promise<any>;
}) {
  // source/hash are supplied by host setup, not tool arguments or challenge material.
  const bytes = await readFile(options.source);
  if (createHash('sha256').update(bytes).digest('hex') !== options.sourceHash) throw new Error('adapter source mismatch');
  const descriptors: Descriptor[] = JSON.parse(bytes.toString());
  const { state, challenge } = options;
  // This is deliberately a tiny fixture vocabulary, not a proposed universal descriptor schema.
  if (!Array.isArray(descriptors) || descriptors.some(d => !d.id || !d.scope || !d.path.startsWith('/') || d.path.includes('?') ||
    !['observation', 'protected'].includes(d.effect) || !['GET', 'POST'].includes(d.method) ||
    (d.effect === 'protected' && (!Number.isInteger(d.maxSends) || d.maxSends! < 1)))) throw new Error('adapter source invalid');
  if (new Set(descriptors.map(d => d.id)).size !== descriptors.length) throw new Error('adapter source duplicate');
  for (const d of descriptors.filter(d => d.effect === 'protected')) {
    if (descriptors.some(other => other.effect === 'protected' && other.scope === d.scope && other.maxSends !== d.maxSends)) throw new Error('adapter source inconsistent limit');
  }

  async function execute(id: string, args: Record<string, unknown>) {
    if (Object.keys(args).length) throw new Error('selector');
    const d = descriptors.find(d => d.id === id && d.effect === 'protected');
    if (!d) throw new Error('unclassified operation');
    // No await between admission, persistent reservation and marking dispatching.
    // A crash-left dispatching record is deliberately quarantined too.
    const prior = state.effectsFor({ operation: d.scope, challengeId: challenge });
    if (prior.some(e => e.state === 'unknown' || e.state === 'dispatching')) throw new Error('unknown operation scope');
    if (prior.filter(e => e.state !== 'failed_not_dispatched').length >= d.maxSends!) throw new Error('operation limit');
    const effect = state.prepareEffect({
      id: randomUUID(), runId: 'run-protected', operation: d.scope, kind: 'protected_effect', challengeId: challenge,
      payload: { sourceHash: options.sourceHash, operation: d.id, request: { method: d.method, url: options.origin + d.path } },
      generation: 1, budget: { wallClockMs: 3000, maxSteps: 1, maxToolJobs: 1, maxObservableTokens: 1 },
      deadline: new Date(Date.now() + 3000).toISOString(), expectedPostcondition: 'adapter business response',
    });
    state.dispatchEffect(effect.id);
    let receivedStatus: number | undefined;
    try {
      const response = await options.raw({ url: options.origin + d.path, method: d.method, follow_redirects: false });
      receivedStatus = response.status;
      const parsed = JSON.parse(response.preview);
      if (response.status !== 200 || response.bodyTruncated || !['accepted', 'rejected'].includes(parsed.outcome)) throw new Error('no authoritative response');
      state.confirmEffect(effect.id, { status: response.status, outcome: parsed.outcome }, parsed.outcome);
      return { effect: effect.id, transport: 'response', business: parsed.outcome };
    } catch {
      // Once dispatching is persisted even a transport failure may hide a completed effect.
      state.markUnknown(effect.id);
      return { effect: effect.id, transport: receivedStatus === undefined ? 'unknown' : 'response', httpStatus: receivedStatus, business: 'unknown' };
    }
  }

  async function request(args: Record<string, unknown>): Promise<any> {
    let current = { ...args };
    for (let hops = 0; hops <= 5; hops++) {
      const url = new URL(String(current.url));
      if (url.origin !== options.origin) throw new Error('unclassified origin');
      // Fixture adapter has no header/query/body dependent operations. Fail closed on those selectors;
      // real adapters must describe them, not copy this restriction to every CTF target.
      if (url.search || url.username || url.password || current.body !== undefined || current.body_base64 !== undefined ||
        Object.keys((current.headers ?? {}) as object).length) throw new Error('unclassified selector');
      const descriptor = descriptors.find(d => d.path === url.pathname && d.method === String(current.method ?? 'GET').toUpperCase());
      if (!descriptor) throw new Error('unclassified endpoint');
      if (descriptor.effect === 'protected') throw new Error('protected operation requires host intent');
      const response = await options.raw({ ...current, follow_redirects: false });
      const location = response.headers.location;
      if (!args.follow_redirects || ![301, 302, 303, 307, 308].includes(response.status) || typeof location !== 'string') return response;
      const method = String(current.method ?? 'GET').toUpperCase();
      current = { ...current, url: new URL(location, url).href,
        method: response.status === 303 || (method === 'POST' && [301, 302].includes(response.status)) ? 'GET' : method };
    }
    throw new Error('unclassified redirect limit');
  }
  return { execute, request };
}
