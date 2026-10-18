import { ModelDataGateway } from '@ctf/policy';
import type { SolverAction, SolverDriver, SolverRequest, SolverUsage } from './solver-loop.js';

export interface ProviderSolverDriverOptions {
  dialect: 'openai_compatible' | 'anthropic_compatible';
  id: string;
  baseUrl: string;
  apiKey: string;
  temperature?: number;
  fetchImpl?: typeof fetch;
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
    if (!Number.isSafeInteger(control.maxTokens) || control.maxTokens <= 0) throw new Error('provider driver requires a positive admitted token limit');
    const user = this.gateway.request({ dataClass: 'challenge_analysis_data', operation: 'solver.decide', value: request });
    const system = [
      'You are an authorized CTF solver operating under a host-controlled SolverLoop.',
      'Return exactly one JSON object representing one SolverAction. Do not use markdown or add prose.',
      'The host executes tools and validates authority, budgets, evidence, and candidate submission.',
      'Allowed action shapes:',
      '{"kind":"dispatch","hypothesis": optional hypothesis, "experiment": experiment}',
      '{"kind":"tool","tool":"workspace.read|workspace.search|workspace.patch|reference.search|reference.get|skill.load|http.request|job.run|job.start|job.status|job.read|job.write|job.list|job.cancel|channel.open|channel.status|channel.read|channel.write|channel.close","input":object,"step_id":optional string}',
      'Interactive job.start supports {mode:"pty",command:[...]} or {mode:"tcp_session",endpoint:{host,port}}; channel.open takes {host,port}. The host checks every command/endpoint against challenge scope and current lease.',
      'job.read/channel.read take {id,cursor,max_bytes?} and return explicit base64 bytes with nextCursor. Writes are one-shot; never retry a write after an unknown result. Resources belong to this session lease; only the host may transfer them.',
      '{"kind":"conclude","verdict":"supported|rejected|inconclusive|stale","rationale":string,"evidence_refs":[]}',
      '{"kind":"candidate","value":string,"evidence_refs":[immutable artifact refs]}',
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
          response_format: { type: 'json_object' },
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
    let action: unknown;
    try { action = JSON.parse(actionText); }
    catch { throw new Error('provider response was not a JSON SolverAction'); }
    return { action: action as SolverAction, usage };
  }
}
