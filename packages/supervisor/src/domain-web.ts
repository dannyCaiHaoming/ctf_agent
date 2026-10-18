import type { ArtifactReference, ArtifactStore } from '@ctf/artifacts';
import { randomUUID } from 'node:crypto';

export interface WebRequest { url: string; method: string; headers?: Record<string, string>; body?: string }
export interface WebCapture {
  request: WebRequest;
  requestRef: ArtifactReference;
  responseRef: ArtifactReference;
  transcriptRef: ArtifactReference;
  status: number;
  effectiveUrl: string;
  clientPage?: { url: string; evidenceRef: ArtifactReference };
}
export interface WebBaseline {
  normal: WebCapture; login: WebCapture; error: WebCapture;
  valid: boolean; reason: 'normal' | 'login_page' | 'unified_error' | 'redirect' | 'client_rewrite' | 'server_error' | 'unexpected_status';
}
export interface InputEffectHypothesis {
  id: string; status: 'supported' | 'inconclusive'; claim: string; inputName: string; inputValue: string;
  evidenceRefs: readonly ArtifactReference[]; alternativeExplanations: readonly string[]; falsifier: string;
  minimalExperiment: string; vulnerabilityClaim: false;
}
export type WebTransport = (request: WebRequest) => Promise<{ status: number; body: Uint8Array; effectiveUrl: string }>;

/** Benign response comparison only. The host supplies its authorized challenge transport. */
export class WebMethod {
  constructor(private readonly artifacts: ArtifactStore, private readonly transport: WebTransport) {}

  async capture(request: WebRequest): Promise<WebCapture> {
    const fixed = structuredClone(request);
    const result = await this.transport(structuredClone(fixed));
    const requestRef = await this.artifacts.publish(Buffer.from(JSON.stringify(fixed)));
    const responseRef = await this.artifacts.publish(result.body);
    const transcriptRef = await this.artifacts.publish(Buffer.from(JSON.stringify({ request: fixed, requestRef, responseRef, status: result.status, effectiveUrl: result.effectiveUrl })));
    return { request: fixed, requestRef, responseRef, transcriptRef, status: result.status, effectiveUrl: result.effectiveUrl };
  }

  private async check(capture: WebCapture): Promise<void> {
    for (const ref of [capture.requestRef, capture.responseRef, capture.transcriptRef]) await this.artifacts.verify(ref);
    if (capture.clientPage) await this.artifacts.verify(capture.clientPage.evidenceRef);
    const recorded = JSON.parse((await this.artifacts.read(capture.transcriptRef)).toString('utf8')) as WebCapture;
    const request = JSON.parse((await this.artifacts.read(capture.requestRef)).toString('utf8')) as WebRequest;
    if (JSON.stringify(recorded.request) !== JSON.stringify(capture.request) || JSON.stringify(request) !== JSON.stringify(capture.request) || recorded.requestRef.hash !== capture.requestRef.hash || recorded.status !== capture.status || recorded.effectiveUrl !== capture.effectiveUrl || recorded.responseRef.hash !== capture.responseRef.hash) throw new Error('capture does not match retained transcript');
  }

  private async classify(capture: WebCapture, controls: { login: WebCapture; error: WebCapture }): Promise<WebBaseline['reason']> {
    if (capture.clientPage && capture.clientPage.url !== capture.effectiveUrl) return 'client_rewrite';
    if (capture.effectiveUrl !== capture.request.url || (capture.status >= 300 && capture.status < 400)) return 'redirect';
    const text = (await this.artifacts.read(capture.responseRef)).toString('utf8');
    if (capture.responseRef.hash === controls.login.responseRef.hash || /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(text)) return 'login_page';
    if (capture.responseRef.hash === controls.error.responseRef.hash) return 'unified_error';
    if (capture.status >= 500) return 'server_error';
    if (capture.status < 200 || capture.status >= 400) return 'unexpected_status';
    return 'normal';
  }

  async establishBaseline(input: { normal: WebCapture; login: WebCapture; error: WebCapture }): Promise<WebBaseline> {
    for (const capture of [input.normal, input.login, input.error]) await this.check(capture);
    const reason = await this.classify(input.normal, input);
    return structuredClone({ ...input, valid: reason === 'normal', reason });
  }

  async compare(baseline: WebBaseline, variant: WebCapture): Promise<{
    classification: WebBaseline['reason'] | 'controlled_difference' | 'unchanged';
    changedVariables: string[]; vulnerabilityClaim: false; transcriptRef: ArtifactReference;
  }> {
    const rechecked = await this.establishBaseline(baseline);
    if (!rechecked.valid) throw new Error(`invalid normal baseline: ${rechecked.reason}`);
    await this.check(variant);
    const changedVariables = requestChanges(rechecked.normal.request, variant.request);
    if (changedVariables.length !== 1 || !changedVariables[0]!.startsWith('query:')) throw new Error('controlled comparison requires exactly one variable in a benign query with the same endpoint, method, URL credentials and session headers');
    const reason = await this.classify(variant, rechecked);
    const classification = reason !== 'normal' ? reason : variant.responseRef.hash === rechecked.normal.responseRef.hash ? 'unchanged' : 'controlled_difference';
    const transcriptRef = await this.artifacts.publish(Buffer.from(JSON.stringify({ normal: rechecked.normal, variant, changedVariables, classification, vulnerabilityClaim: false })));
    return { classification, changedVariables, vulnerabilityClaim: false, transcriptRef };
  }

  /**
   * Join retained source, rendered DOM and request evidence into a testable,
   * explicitly non-vulnerability hypothesis. This never executes an exploit.
   */
  async inputEffectHypothesis(input: { baseline: WebBaseline; variant: WebCapture;
    sourceRef: ArtifactReference; domRef: ArtifactReference; inputName: string; inputValue: string }): Promise<InputEffectHypothesis> {
    if (!input.inputName || !input.inputValue || /[\r\n\0]/.test(input.inputName + input.inputValue)) throw new Error('input name and value must be explicit single-line strings');
    for (const ref of [input.sourceRef, input.domRef, input.variant.requestRef]) await this.artifacts.verify(ref);
    const comparison = await this.compare(input.baseline, input.variant);
    const expectedChange = `query:${input.inputName}`;
    const source = (await this.artifacts.read(input.sourceRef)).toString('utf8');
    const dom = (await this.artifacts.read(input.domRef)).toString('utf8');
    const request = JSON.parse((await this.artifacts.read(input.variant.requestRef)).toString('utf8')) as WebRequest;
    const queryValue = new URL(request.url).searchParams.getAll(input.inputName);
    const sourceMentionsInput = source.includes(input.inputName);
    const requestBindsValue = queryValue.length === 1 && queryValue[0] === input.inputValue;
    const renderedValueObserved = dom.includes(input.inputValue);
    const supported = comparison.classification === 'controlled_difference' && comparison.changedVariables.length === 1 &&
      comparison.changedVariables[0] === expectedChange && sourceMentionsInput && requestBindsValue && renderedValueObserved;
    const refs = [input.sourceRef, input.domRef, input.variant.requestRef, input.variant.responseRef,
      input.variant.transcriptRef, comparison.transcriptRef].map(ref => ({ hash: ref.hash, size: ref.size, path: ref.path }));
    return Object.freeze({ id: `web_hypothesis_${randomUUID()}`, status: supported ? 'supported' : 'inconclusive',
      claim: `the controlled value for ${input.inputName} may flow from the source path into the observed DOM`,
      inputName: input.inputName, inputValue: input.inputValue, evidenceRefs: Object.freeze(refs) as unknown as ArtifactReference[],
      alternativeExplanations: Object.freeze(['client-side rendering may independently insert the value', 'the observed text may be static or unrelated to the input']),
      falsifier: 'repeat a one-variable control with a distinct value and show the DOM effect does not track it',
      minimalExperiment: `change only query parameter ${input.inputName} to a second benign value and compare retained source, request, response and DOM evidence`,
      vulnerabilityClaim: false });
  }
}

function requestChanges(normal: WebRequest, variant: WebRequest): string[] {
  const a = new URL(normal.url); const b = new URL(variant.url);
  const changes: string[] = [];
  if (a.origin !== b.origin) changes.push('origin');
  if (a.username !== b.username) changes.push('username');
  if (a.password !== b.password) changes.push('password');
  if (a.pathname !== b.pathname) changes.push('path');
  if (a.hash !== b.hash) changes.push('fragment');
  if (normal.method !== variant.method) changes.push('method');
  if (normal.body !== variant.body) changes.push('body');
  const headerEntries = (headers?: Record<string, string>) => Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const ah = headerEntries(normal.headers); const bh = headerEntries(variant.headers);
  for (const name of new Set([...Object.keys(ah), ...Object.keys(bh)])) if (ah[name] !== bh[name]) changes.push(`header:${name}`);
  for (const name of new Set([...a.searchParams.keys(), ...b.searchParams.keys()])) {
    if (JSON.stringify(a.searchParams.getAll(name)) !== JSON.stringify(b.searchParams.getAll(name))) changes.push(`query:${name}`);
  }
  return changes;
}
