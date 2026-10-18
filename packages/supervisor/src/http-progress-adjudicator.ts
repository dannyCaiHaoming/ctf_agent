import type { ImmutableArtifactRef, SemanticProgress } from '@ctf/contracts';
import type { DeepReadonly } from './responsibilities.js';
import type { ExperimentRecord } from './hypotheses.js';
import type { Hypothesis } from '@ctf/contracts';

/**
 * Deliberately narrow host adjudicator for literal HTTP body probes. The
 * experiment must predeclare `http.body.contains:<literal>` as expected_support
 * and `http.body.absent:<literal>` as expected_refutation; all other claims remain
 * inconclusive. References must be the runtime-published wrapper and raw body.
 */
export function createHttpLiteralProgressAdjudicator(input: {
  readArtifact(ref: DeepReadonly<ImmutableArtifactRef>): Promise<Buffer>;
}): (claim: DeepReadonly<SemanticProgress>, experiment: DeepReadonly<ExperimentRecord>, hypothesis: DeepReadonly<Hypothesis>) => Promise<{ substantiation: string }> {
  return async (claim, experiment, hypothesis) => {
    if (claim.kind !== 'evidence' || experiment.status !== 'succeeded' || claim.hypothesis_id !== hypothesis.id) {
      throw new Error('inconclusive: supported progress is limited to successful literal HTTP evidence probes');
    }
    if (claim.experiment_id !== experiment.plan.id || claim.hypothesis_id !== experiment.plan.hypothesis_id) {
      throw new Error('inconclusive: progress identities do not match the completed experiment and hypothesis');
    }
    const rule = experiment.plan.expected_support;
    if (!/^http\.body\.contains:[^\r\n]+$/.test(rule)) {
      throw new Error('inconclusive: experiment has no supported literal HTTP marker rule');
    }
    const marker = rule.slice('http.body.contains:'.length);
    const expectedRefutation = `http.body.absent:${marker}`;
    if (experiment.plan.expected_refutation !== expectedRefutation) {
      throw new Error('inconclusive: experiment has no matching predeclared support/refutation pair');
    }
    const procedure = experiment.plan.procedure.filter(step => step.tool === 'http.request');
    if (procedure.length !== 1 || !procedure[0]) throw new Error('inconclusive: exactly one HTTP GET is required');
    const requestedUrl = (procedure[0].input as { url?: unknown }).url;
    if (typeof requestedUrl !== 'string') throw new Error('inconclusive: HTTP request URL is unavailable');
    if (hypothesis.claim !== `HTTP response body from ${requestedUrl} contains literal marker: ${marker}`) {
      throw new Error('inconclusive: hypothesis claim is outside the literal HTTP marker capability');
    }
    const produced = experiment.events.filter(event => event.outcome === 'success').flatMap(event => event.artifact_refs);
    if (claim.evidence_refs.length !== 2 || claim.evidence_refs.some(ref => !produced.some(value => value.hash === ref.hash && value.size === ref.size && value.path === ref.path))) {
      throw new Error('inconclusive: progress must bind the complete runtime wrapper and raw HTTP body from this experiment');
    }
    let wrapper: Record<string, unknown> | undefined;
    let bodyRef: ImmutableArtifactRef | undefined;
    for (const ref of claim.evidence_refs) {
      let parsed: unknown;
      try { parsed = JSON.parse((await input.readArtifact(ref)).toString('utf8')); } catch { continue; }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'response_ref' in parsed) wrapper = parsed as Record<string, unknown>;
    }
    if (!wrapper || wrapper.url !== requestedUrl || wrapper.truncated !== false || typeof wrapper.body !== 'string' || !Number.isInteger(wrapper.status) || (wrapper.status as number) < 200 || (wrapper.status as number) >= 400) {
      throw new Error('inconclusive: HTTP wrapper is missing, truncated, failed, or detached from the declared request');
    }
    bodyRef = claim.evidence_refs.find(ref => ref.hash === (wrapper.response_ref as Record<string, unknown> | undefined)?.hash && ref.size === (wrapper.response_ref as Record<string, unknown> | undefined)?.size && ref.path === (wrapper.response_ref as Record<string, unknown> | undefined)?.path);
    if (!bodyRef) throw new Error('inconclusive: raw body artifact is not bound by the HTTP wrapper');
    const body = await input.readArtifact(bodyRef);
    if (!body.equals(Buffer.from(wrapper.body, 'utf8'))) throw new Error('inconclusive: wrapper body differs from immutable raw response bytes');
    const contains = body.includes(Buffer.from(marker, 'utf8'));
    if ((claim.verdict === 'supported') !== contains) throw new Error('inconclusive: observation does not satisfy the predeclared support or refutation condition');
    return { substantiation: `complete canonical HTTP response from ${requestedUrl} ${contains ? 'contains' : 'does not contain'} the predeclared literal marker; raw body and wrapper artifacts match` };
  };
}
