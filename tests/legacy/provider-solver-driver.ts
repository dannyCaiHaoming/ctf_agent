// Frozen historical protocol regression only. No product entry point imports this adapter.
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ModelDataGateway } from '@ctf/policy';
import { ExperimentSchema, HypothesisSchema, type ImmutableArtifactRef } from '@ctf/contracts';
import { SolverActionSchema, SolverFailure, type SolverAction, type SolverDriver, type SolverRequest, type SolverUsage } from './solver-loop.js';

export interface ProviderSolverDriverOptions {
  dialect: 'openai_compatible' | 'anthropic_compatible';
  id: string;
  baseUrl: string;
  apiKey: string;
  temperature?: number;
  responseFormat?: 'json_object' | 'prompt_only';
  fetchImpl?: typeof fetch;
}

const modelText = z.string().trim().min(1);
const ModelStepSchema = z.object({ tool: modelText, input: z.record(z.unknown()).default({}) }).strict();
const ModelDispatchSchema = z.object({
  kind: z.literal('dispatch'),
  claim: modelText,
  falsifier: modelText,
  expected_observation: modelText,
  expected_support: modelText,
  expected_refutation: modelText,
  procedure: z.array(ModelStepSchema).min(1),
  objective: modelText.optional(),
  preconditions: z.array(modelText).optional(),
  alternative_explanations: z.array(modelText).optional(),
  uses: z.array(modelText).optional()
}).strict();
const ModelToolSchema = z.object({
  kind: z.literal('tool'), tool: modelText, input: z.record(z.unknown()).default({}),
  uses: z.array(modelText).optional()
}).strict();
const ModelConcludeSchema = z.object({
  kind: z.literal('conclude'), verdict: z.enum(['supported', 'rejected', 'inconclusive', 'stale']),
  rationale: modelText, uses: z.array(modelText).optional()
}).strict();
const ModelCandidateSchema = z.object({
  kind: z.literal('candidate'), value: modelText, uses: z.array(modelText).optional()
}).strict();
const ModelStopSchema = z.object({ kind: z.literal('stop'), reason: modelText }).strict();
export const SolverModelActionSchema = z.union([
  ModelDispatchSchema, ModelToolSchema, ModelConcludeSchema, ModelCandidateSchema, ModelStopSchema
]);
export type SolverModelAction = z.infer<typeof SolverModelActionSchema>;
export interface SemanticSolverDecision {
  action: SolverAction; modelAction: SolverModelAction; usage: SolverUsage;
}

function uniqueRefs(refs: ImmutableArtifactRef[]): ImmutableArtifactRef[] {
  return [...new Map(refs.map(ref => [ref.hash, ref])).values()];
}

function refName(ref: ImmutableArtifactRef): string { return basename(ref.path); }

/** Accept provider transport framing (markdown fences/prose) but only the first balanced JSON object. */
function parseProviderJsonObject(actionText: string): unknown {
  try { return JSON.parse(actionText); }
  catch { /* continue with framed JSON recovery */ }
  const start = actionText.indexOf('{');
  if (start < 0) throw new Error('provider response contained no JSON object');
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < actionText.length; index++) {
    const char = actionText[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        const candidate = actionText.slice(start, index + 1);
        try { return JSON.parse(candidate); }
        catch { break; }
      }
    }
  }
  throw new Error('provider response contained malformed JSON action');
}

function resolveNamedRefs(request: SolverRequest, uses: string[] | undefined): ImmutableArtifactRef[] {
  if (!uses?.length) return [];
  const refs: ImmutableArtifactRef[] = [];
  for (const use of uses) {
    const ref = request.challenge.material_refs.find(candidate => candidate.path === use || refName(candidate) === use);
    if (!ref && request.challenge.workspace_files?.includes(use)) continue;
    if (!ref) throw new Error(`cannot resolve use "${use}" to an approved immutable artifact`);
    refs.push(ref);
  }
  return refs;
}

function inferProcedureRefs(request: SolverRequest, input: unknown): ImmutableArtifactRef[] {
  const names = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const name = basename(value);
      if (request.challenge.material_refs.some(ref => ref.path === value || refName(ref) === name)) names.add(value);
      return;
    }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(visit); }
  };
  visit(input);
  return resolveNamedRefs(request, [...names]);
}

function expectedArtifacts(steps: Array<{ tool: string }>): string[] {
  if (steps.some(step => step.tool === 'job.run' || step.tool === 'job.start')) return ['stdout', 'stderr'];
  return ['tool_result'];
}

/** Host materializes the model's semantic kernel into the canonical system data model. */
export function materializeSolverAction(request: SolverRequest, modelAction: unknown): SolverAction {
  const parsed = SolverModelActionSchema.safeParse(modelAction);
  if (!parsed.success) throw new Error(`invalid model semantic action: ${parsed.error.toString()}`);
  const action = parsed.data;
  if (action.kind === 'dispatch') {
    const explicitRefs = resolveNamedRefs(request, action.uses);
    const inferredRefs = action.procedure.flatMap(step => inferProcedureRefs(request, step.input));
    const refs = uniqueRefs([...explicitRefs, ...inferredRefs]);
    const procedure = action.procedure.map((step, index) => ({ id: `step_${index + 1}`, tool: step.tool, input: step.input }));
    const budget = {
      wall_ms: Math.max(1, Math.floor(request.remaining.wall_ms)),
      tokens: Math.max(0, request.remaining.tokens),
      remote_units: 0
    };
    if (budget.wall_ms <= 0 || budget.tokens <= 0) throw new Error('remaining run budget cannot admit an experiment');
    const hypothesis = HypothesisSchema.parse({
      id: `hypothesis_${randomUUID()}`, claim: action.claim,
      preconditions: action.preconditions ?? [], missing_preconditions: [],
      supporting_refs: refs, contradicting_refs: [],
      alternative_explanations: action.alternative_explanations ?? [], falsifier: action.falsifier,
      minimal_experiment: 'Execute the admitted procedure and compare its observation with expected support/refutation.',
      expected_observation: action.expected_observation,
      state_dependencies: structuredClone(request.challenge.snapshot),
      required_capabilities: [...new Set(action.procedure.map(step => step.tool))],
      route_status: 'queued', next_action: 'Execute the admitted procedure.', cost: budget, state: 'proposed'
    });
    const experiment = ExperimentSchema.parse({
      id: `experiment_${randomUUID()}`, hypothesis_id: hypothesis.id,
      objective: action.objective ?? 'Execute the minimal experiment and distinguish the declared outcomes.',
      input_refs: refs, state_dependencies: structuredClone(request.challenge.snapshot), parameters: {},
      procedure, expected_support: action.expected_support, expected_refutation: action.expected_refutation,
      budget, repair_budget: 1, stop_condition: 'One bounded repair or experiment terminal observation.',
      expected_artifacts: expectedArtifacts(procedure)
    });
    return { kind: 'dispatch', hypothesis, experiment };
  }
  if (action.kind === 'tool') {
    const stepId = (() => {
      if (!request.experiment || request.experiment.status !== 'running') return undefined;
      const plan = request.experiment.plan;
      const exact = plan.procedure.find(step => step.tool === action.tool && JSON.stringify(step.input) === JSON.stringify(action.input));
      if (exact) return exact.id;
      if (action.tool === 'job.run') return plan.procedure.find(step => step.tool === action.tool)?.id;
      return undefined;
    })();
    return SolverActionSchema.parse({ kind: 'tool', tool: action.tool, input: action.input, ...(stepId ? { step_id: stepId } : {}) });
  }
  if (action.kind === 'stop') return action;
  const fallbackRefs = request.observation?.artifact_refs ?? [];
  const evidenceRefs = uniqueRefs([...resolveNamedRefs(request, action.uses), ...fallbackRefs]);
  if (action.kind === 'conclude') return SolverActionSchema.parse({ kind: 'conclude', verdict: action.verdict, rationale: action.rationale, evidence_refs: evidenceRefs });
  if (action.kind === 'candidate') return SolverActionSchema.parse({ kind: 'candidate', value: action.value, evidence_refs: evidenceRefs });
  throw new Error('unreachable model action kind');
}

/**
 * One provider request produces exactly one host-validated SolverAction.
 * Tool execution remains in SolverLoop; model responses never execute tools inline.
 */
export class ProviderSolverDriver implements SolverDriver {
  private readonly fetchImpl: typeof fetch;
  private readonly gateway = new ModelDataGateway();

  constructor(private readonly options: ProviderSolverDriverOptions) {
    if (!options.id || !options.baseUrl || !options.apiKey) throw new Error('provider driver requires model id, base URL and API key');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async decide(request: SolverRequest, control: { signal: AbortSignal; maxTokens: number }): Promise<{ action: SolverAction; usage: SolverUsage }> {
    const decision = await this.decideSemantic(request, control);
    return { action: decision.action, usage: decision.usage };
  }

  async decideSemantic(request: SolverRequest, control: { signal: AbortSignal; maxTokens: number }): Promise<SemanticSolverDecision> {
    if (!Number.isSafeInteger(control.maxTokens) || control.maxTokens <= 0) throw new Error('provider driver requires a positive admitted token limit');
    const user = this.gateway.request({ dataClass: 'challenge_analysis_data', operation: 'solver.decide', value: request });
    const system = [
      'You are an authorized CTF solver operating under a host-controlled SolverLoop.',
      'Return exactly one JSON object representing one SolverAction. Do not use markdown or add prose.',
      'The host executes tools and validates authority, budgets, evidence, and candidate submission.',
      'Workspace tool paths are relative to the task workspace root. Use only paths listed in challenge.workspace_files (or list the workspace first).',
      'challenge.material_refs are immutable artifact evidence references, not filesystem paths; never pass their path fields to workspace.read/search/patch or job commands.',
      'For supplied material, add it to optional uses by workspace short name; the host resolves immutable artifact refs. Never write hashes, IDs, step IDs, or budget numbers.',
      'A dispatch contains only semantic fields: required claim, falsifier, expected_observation, expected_support, expected_refutation, and procedure:[{tool,input}]; optional objective, preconditions, alternative_explanations, and uses.',
      'Dispatch a runnable experiment before job.run. Use tool input {command:[...], timeout_ms?:number, max_retained_bytes?:number} for job.run and do not include cwd or step_id; the host assigns and matches the admitted step.',
      'If the request says the workspace evidence is already inspected, dispatch the next experiment without repeating workspace.read.',
      'If the admitted experiment already succeeded and the latest observation contains the result, use conclude or candidate; do not repeat workspace.read.',
      'Never submit a candidate inferred from static workspace material. First dispatch and execute an experiment; a candidate requires actual successful runtime evidence.',
      'After a job.run error, read the complete raw observation first. A local workspace.patch takes {path,find,replace}; it may make one bounded correction. Retry only the same failed procedure step with its original step_id.',
      'Allowed action shapes:',
      '{"kind":"dispatch","claim":string,"falsifier":string,"expected_observation":string,"expected_support":string,"expected_refutation":string,"procedure":[{"tool":"...","input":{}}]}',
      '{"kind":"tool","tool":"workspace.read|workspace.search|workspace.patch|reference.search|reference.get|skill.load|http.request|job.run|job.start|job.status|job.read|job.write|job.list|job.cancel|channel.open|channel.status|channel.read|channel.write|channel.close","input":object}',
      'Interactive job.start supports {mode:"pty",command:[...]} or {mode:"tcp_session",endpoint:{host,port}}; channel.open takes {host,port}. The host checks every command/endpoint against challenge scope and current lease.',
      'job.read/channel.read take {id,cursor,max_bytes?} and return explicit base64 bytes with nextCursor. Writes are one-shot; never retry a write after an unknown result. Resources belong to this session lease; only the host may transfer them.',
      '{"kind":"conclude","verdict":"supported|rejected|inconclusive|stale","rationale":string,"uses":[approved workspace short names]}',
      '{"kind":"candidate","value":string,"uses":[approved workspace short names]}',
      '{"kind":"stop","reason":string}',
      'Follow the supplied phase, admitted experiment procedure, responsibility binding, and remaining budget.'
    ].join('\n');
    const userText = JSON.stringify(user);
    // A UTF-8 byte count is a conservative upper bound for tokenized prompt size.
    // Keep space for provider message framing before admitting output tokens.
    const maxOutputTokens = control.maxTokens - Buffer.byteLength(system, 'utf8') - Buffer.byteLength(userText, 'utf8') - 256;
    if (maxOutputTokens < 1) throw new Error('admitted run token budget cannot fit the provider prompt and one output token');
    const base = this.options.baseUrl.endsWith('/') ? this.options.baseUrl : `${this.options.baseUrl}/`;
    let actionText: string;
    let usage: SolverUsage;
    if (this.options.dialect === 'anthropic_compatible') {
      const response = await this.fetchImpl(new URL('v1/messages', base), {
        method: 'POST',
        headers: {
          'x-api-key': this.options.apiKey,
          authorization: `Bearer ${this.options.apiKey}`,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        signal: control.signal,
        body: JSON.stringify({
          model: this.options.id,
          max_tokens: maxOutputTokens,
          temperature: this.options.temperature ?? 0.2,
          system,
          messages: [{ role: 'user', content: userText }]
        })
      });
      const body = await response.json().catch(() => null) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(`provider request failed (${response.status}): ${body?.error?.message ?? 'no error detail'}`);
      actionText = body?.content?.filter(part => part.type === 'text').map(part => part.text ?? '').join('').trim() ?? '';
      if (!Number.isSafeInteger(body?.usage?.input_tokens) || !Number.isSafeInteger(body?.usage?.output_tokens)) throw new Error('provider response omitted authoritative token usage');
      usage = { provenance: 'provider_reported', input_tokens: body!.usage!.input_tokens!, output_tokens: body!.usage!.output_tokens!, model_calls: 1 };
    } else {
      const response = await this.fetchImpl(new URL('chat/completions', base), {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        signal: control.signal,
        body: JSON.stringify({
          model: this.options.id,
          temperature: this.options.temperature ?? 0.2,
          max_tokens: maxOutputTokens,
          ...(this.options.responseFormat !== 'prompt_only' ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: system }, { role: 'user', content: userText }]
        })
      });
      const body = await response.json().catch(() => null) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(`provider request failed (${response.status}): ${body?.error?.message ?? 'no error detail'}`);
      actionText = body?.choices?.[0]?.message?.content?.trim() ?? '';
      if (!Number.isSafeInteger(body?.usage?.prompt_tokens) || !Number.isSafeInteger(body?.usage?.completion_tokens)) throw new Error('provider response omitted authoritative token usage');
      usage = { provenance: 'provider_reported', input_tokens: body!.usage!.prompt_tokens!, output_tokens: body!.usage!.completion_tokens!, model_calls: 1 };
    }
    if (!actionText) throw new Error('provider response contained no SolverAction JSON');
    let modelAction: unknown;
    try { modelAction = parseProviderJsonObject(actionText); }
    catch (error) { throw new SolverFailure('output_parse_error', error instanceof Error ? error.message : String(error), 0, usage); }
    let materialized: SolverAction;
    try { materialized = materializeSolverAction(request, modelAction); }
    catch (error) { throw new SolverFailure('output_parse_error', error instanceof Error ? error.message : String(error), 0, usage); }
    return { action: materialized, modelAction: modelAction as SolverModelAction, usage };
  }
}
