import { tool, type Hooks } from '@opencode-ai/plugin';

export interface CTFPluginOptions {
  controlUrl: string;
  controlToken: string;
  /** Managed tools to register; this version passes an empty list. */
  tools: string[];
  /** Per-request limit; an unanswered request is a denial. */
  requestTimeoutMs?: number;
}

export const pluginId = 'ctf-agent-host-foundation';
const schemas = {
  'workspace.list': { path: tool.schema.string().optional() },
  'workspace.read': { path: tool.schema.string() },
  'workspace.search': { path: tool.schema.string(), needle: tool.schema.string() },
  'workspace.unpack': { path: tool.schema.string() },
  'workspace.patch': { path: tool.schema.string(), find: tool.schema.string().min(1), replace: tool.schema.string() },
  'job.run': { command: tool.schema.array(tool.schema.string()).min(2), timeout_ms: tool.schema.number().int().positive().optional() },
  'hypothesis.propose': { claim: tool.schema.string().min(1), falsifier: tool.schema.string().min(1),
    prediction: tool.schema.enum(['expression_evaluates', 'other']), command: tool.schema.array(tool.schema.string()).min(2),
    route_reason: tool.schema.string().min(1).optional() },
  'hypothesis.conclude': { verdict: tool.schema.enum(['rejected', 'inconclusive']), rationale: tool.schema.string().min(1) },
  'http.request': { url: tool.schema.string().url(), method: tool.schema.enum(['GET', 'POST']).optional(),
    body: tool.schema.string().max(65536).optional(), content_type: tool.schema.string().max(256).optional() },
  'observation.read': { ref: tool.schema.string().regex(/^observation_[a-f0-9-]{36}$/), mode: tool.schema.enum(['continue', 'start']).optional(),
    max_bytes: tool.schema.number().int().positive().max(4096).optional() },
  'candidate.register': { value: tool.schema.string().min(1) }
};
export const managedToolId = (name: string) => `ctf_${name.replaceAll('.', '_')}`;

export function createCtfAgentHooks(options: CTFPluginOptions): Hooks {
  const url = new URL(options.controlUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || typeof options.controlToken !== 'string' || options.controlToken.length < 32 ||
    !Array.isArray(options.tools)) throw new Error('invalid authenticated loopback control service');
  if (options.tools.some(name => !Object.hasOwn(schemas, name))) throw new Error('tool is not in the managed tool manifest');
  // The plugin decides nothing: it forwards and obeys. Any transport failure, bad reply or silence is a denial.
  const control = async (sessionID: string, operation: string, input: unknown, signal?: AbortSignal): Promise<unknown> => {
    let response: Response;
    try {
      const limit = AbortSignal.timeout(options.requestTimeoutMs ?? 15000);
      response = await fetch(url, {
        method: 'POST', signal: signal ? AbortSignal.any([signal, limit]) : limit,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.controlToken}` },
        body: JSON.stringify({ sessionID, operation, input })
      });
    } catch { throw new Error('denied: control unavailable'); }
    let payload: { result?: unknown; error?: unknown } = {};
    try { payload = await response.json() as typeof payload; } catch { /* handled below */ }
    if (!response.ok || !('result' in payload)) throw new Error(typeof payload.error === 'string' && payload.error.length <= 200 ? payload.error : 'denied: control reply');
    return payload.result;
  };
  const tools: NonNullable<Hooks['tool']> = {};
  for (const name of options.tools) {
    tools[managedToolId(name)] = tool({
      description: `CTF managed ${name}. Use workspace-relative paths. The host supplies all identities, evidence references and budgets.`,
      args: schemas[name as keyof typeof schemas],
      async execute(args, context) {
        const result = await control(context.sessionID, 'tool.execute', { tool: name, args }, context.abort);
        return { title: name, output: JSON.stringify(result) };
      }
    });
  }
  return {
    tool: tools,
    async 'chat.message'(input) { await control(input.sessionID, 'chat.message', { agent: input.agent }); },
    async 'chat.params'(input, output) {
      const admitted = await control(input.sessionID, 'model.call', { agent: input.agent, provider: input.model.providerID, model: input.model.id }) as { maxOutputTokens: number };
      if (!Number.isFinite(admitted?.maxOutputTokens) || admitted.maxOutputTokens < 1) throw new Error('denied: control reply');
      output.maxOutputTokens = Math.min(output.maxOutputTokens ?? admitted.maxOutputTokens, admitted.maxOutputTokens);
    },
    async 'tool.execute.before'(input, output) { await control(input.sessionID, 'tool.before', { tool: input.tool, callID: input.callID, args: output.args }); },
    async 'tool.execute.after'(input, output) { await control(input.sessionID, 'tool.after', { tool: input.tool, callID: input.callID, metadata: output.metadata }); }
  };
}

export const server = async (_input: unknown, options: CTFPluginOptions) => createCtfAgentHooks(options);
export const pluginModule = { id: pluginId, server };
