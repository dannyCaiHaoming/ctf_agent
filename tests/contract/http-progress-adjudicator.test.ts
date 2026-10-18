import { describe, expect, it } from 'vitest';
import { createHttpLiteralProgressAdjudicator } from '@ctf/supervisor';
import type { Hypothesis, ImmutableArtifactRef, SemanticProgress } from '@ctf/contracts';
import type { ExperimentRecord } from '../../packages/supervisor/src/hypotheses.js';

const marker = 'path=/static/opaque.txt';
const body = Buffer.from(`User-agent: *\n${marker}\n`);
const wrapperRef = { hash: 'a'.repeat(64), size: 150, path: 'wrapper.json' } as unknown as ImmutableArtifactRef;
const bodyRef = { hash: 'b'.repeat(64), size: body.length, path: 'body.txt' } as unknown as ImmutableArtifactRef;
const requestUrl = 'http://127.0.0.1:8787/robots.txt';
const hypothesis = { id: 'h-http', claim: `HTTP response body from ${requestUrl} contains literal marker: ${marker}`, state: 'testing' } as Hypothesis;
const experiment = { status: 'succeeded', plan: { id: 'e-http', hypothesis_id: 'h-http', expected_support: `http.body.contains:${marker}`,
  expected_refutation: `http.body.absent:${marker}`, procedure: [{ tool: 'http.request', input: { url: 'http://127.0.0.1:8787/robots.txt' } }] },
  events: [{ outcome: 'success', artifact_refs: [wrapperRef, bodyRef] }] } as unknown as ExperimentRecord;
const claim: Extract<SemanticProgress, { kind: 'evidence' }> = { kind: 'evidence', experiment_id: 'e-http', hypothesis_id: hypothesis.id,
  verdict: 'supported', rationale: `HTTP response body contains literal marker: ${marker}`, evidence_refs: [wrapperRef, bodyRef] };

const wrapper = (responseBody: Buffer, status = 200) => Buffer.from(JSON.stringify({ status, url: requestUrl, body: responseBody.toString(), response_ref: bodyRef, truncated: false }));

describe('finite HTTP literal progress adjudicator', () => {
  it('accepts only a declared marker proven by the canonical wrapper and its exact raw body', async () => {
    const adjudicate = createHttpLiteralProgressAdjudicator({ readArtifact: async ref => ref.hash === wrapperRef.hash
      ? wrapper(body) : body });
    await expect(adjudicate(claim, experiment, hypothesis)).resolves.toMatchObject({ substantiation: expect.stringContaining('predeclared literal marker') });
  });

  it('rejects model-selected, cross-experiment, incomplete, and detached evidence', async () => {
    const adjudicate = createHttpLiteralProgressAdjudicator({ readArtifact: async ref => ref.hash === wrapperRef.hash ? wrapper(body) : body });
    await expect(adjudicate({ ...claim, rationale: 'HTTP works, therefore my hypothesis is supported' }, experiment, hypothesis)).resolves.toMatchObject({ substantiation: expect.stringContaining('predeclared literal marker') });
    await expect(adjudicate({ ...claim, evidence_refs: [{ ...wrapperRef, hash: 'c'.repeat(64) as ImmutableArtifactRef['hash'] }, bodyRef] }, experiment, hypothesis)).rejects.toThrow('runtime wrapper');
    await expect(adjudicate({ ...claim, evidence_refs: [bodyRef] }, experiment, hypothesis)).rejects.toThrow('runtime wrapper');
    await expect(adjudicate({ ...claim, experiment_id: 'foreign' }, experiment, hypothesis)).rejects.toThrow('identities');
    await expect(adjudicate(claim, experiment, { ...hypothesis, claim: 'SQL injection is present' })).rejects.toThrow('outside the literal HTTP marker capability');
  });

  it('does not interpret failed, truncated, or tool-error observations as counterevidence', async () => {
    const adjudicate = createHttpLiteralProgressAdjudicator({ readArtifact: async ref => ref.hash === wrapperRef.hash
      ? wrapper(Buffer.alloc(0), 500) : body });
    await expect(adjudicate({ ...claim, verdict: 'rejected', rationale: `HTTP response body does not contain literal marker: ${marker}` }, experiment, hypothesis)).rejects.toThrow('failed');
    await expect(adjudicate(claim, { ...experiment, events: [{ outcome: 'failure', artifact_refs: [wrapperRef, bodyRef] }] } as unknown as ExperimentRecord, hypothesis)).rejects.toThrow('runtime wrapper');
  });

  it('accepts a supported contrary observation only when a successful complete body lacks the declared marker', async () => {
    const noMarker = Buffer.from('User-agent: *\\nDisallow: /public/\\n');
    const exactBodyRef = { ...bodyRef, hash: 'c'.repeat(64) as ImmutableArtifactRef['hash'], size: noMarker.length };
    const validExperiment = { ...experiment, events: [{ outcome: 'success', artifact_refs: [wrapperRef, exactBodyRef] }] } as unknown as ExperimentRecord;
    const validClaim = { ...claim, verdict: 'rejected' as const, rationale: `HTTP response body does not contain literal marker: ${marker}`, evidence_refs: [wrapperRef, exactBodyRef] };
    const validAdjudicator = createHttpLiteralProgressAdjudicator({ readArtifact: async ref => ref.hash === wrapperRef.hash
      ? Buffer.from(JSON.stringify({ status: 200, url: requestUrl, body: noMarker.toString(), response_ref: exactBodyRef, truncated: false })) : noMarker });
    await expect(validAdjudicator(validClaim, validExperiment, hypothesis)).resolves.toMatchObject({ substantiation: expect.stringContaining('does not contain') });
  });
});
