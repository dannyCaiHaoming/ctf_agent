import { tool, type Hooks } from '@opencode-ai/plugin';

export interface CTFPluginOptions {
  controlUrl: string;
  controlToken: string;
  /** Managed tools to register by name; the launcher passes the intake tools. */
  tools: string[];
  /** Per-request limit; an unanswered request is a denial. */
  requestTimeoutMs?: number;
}

export const pluginId = 'ctf-agent-host-foundation';
const schemas = {
  'challenge.assign': { role: tool.schema.enum(['recon', 'domain-solver', 'engineer', 'verifier']), challenge: tool.schema.string().min(1) },
  'challenge.unassign': { role: tool.schema.enum(['recon', 'domain-solver', 'engineer', 'verifier']) },
  'workspace.list': { path: tool.schema.string().optional() },
  'workspace.read': { path: tool.schema.string(), cursor: tool.schema.string().optional() },
  'workspace.search': { path: tool.schema.string().optional(), needle: tool.schema.string().min(1) },
  'workspace.write': { path: tool.schema.string(), content: tool.schema.string(), encoding: tool.schema.enum(['utf8', 'base64']).optional() },
  'job.run': { argv: tool.schema.array(tool.schema.string()).min(1).max(32), timeout_ms: tool.schema.number().int().positive().max(600000).optional(), wait_ms: tool.schema.number().int().min(0).max(30000).optional() },
  'job.read': { job: tool.schema.string().uuid(), stream: tool.schema.enum(['stdout', 'stderr']), cursor: tool.schema.string().optional() },
  'task.stop': { task_id: tool.schema.string().min(1).max(128) },
  'job.cancel': { job: tool.schema.string().uuid() },
  'http.request': { url: tool.schema.string().url(), method: tool.schema.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).optional(),
    body: tool.schema.string().max(65536).optional(), body_base64: tool.schema.string().optional(), headers: tool.schema.record(tool.schema.string(), tool.schema.string()).optional(),
    follow_redirects: tool.schema.boolean().optional(), timeout_ms: tool.schema.number().int().positive().max(60000).optional() },
  'challenge.list': {},
  'challenge.read': { id: tool.schema.string().min(1), path: tool.schema.string().min(1), cursor: tool.schema.string().regex(/^\d{1,15}$/).optional() }
};
const descriptions: Record<string, string> = {
  'task.stop': 'Stop a directly dispatched task using its native task_id. Revokes further work, cancels its HTTP/jobs and preserves saved output. Other tasks cannot be stopped. Unknown cleanup is reported explicitly; repeating this call returns the existing result.',
  'challenge.list': 'List every challenge of this run: id, title, authorized network target (or "無網路目標"), time of the start-up reachability check, and the pinned material files with size and sha256. Takes no arguments. The statement is the material statement.md.',
  'challenge.read': 'Read one pinned material file of a challenge. Arguments: id (challenge id from challenge.list), path (file name relative to that challenge\'s materials, e.g. "statement.md"), cursor (optional, the nextCursor of the previous page). Text is returned in pages with nextCursor (null on the last page); a binary file returns only its size and first 8 bytes as hex. Read-only.'
};
export const managedToolId = (name: string) => `ctf_${name.replaceAll('.', '_')}`;

export function createCtfAgentHooks(options: CTFPluginOptions): Hooks {
  const url = new URL(options.controlUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || typeof options.controlToken !== 'string' || options.controlToken.length < 32 ||
    !Array.isArray(options.tools)) throw new Error('invalid authenticated loopback control service');
  if (options.tools.some(name => !Object.hasOwn(schemas, name))) throw new Error('tool is not in the managed tool manifest');
  // The plugin decides nothing: it forwards and obeys. Any transport failure, bad reply or silence is a denial.
  const callMarker = Symbol('ctf trusted call');
  type Marked = Record<symbol, { sessionID: string; callID: string; tool: string; timeoutMs: number } | undefined>;
  const control = async (sessionID: string, operation: string, input: unknown, signal?: AbortSignal, timeoutMs?: number): Promise<unknown> => {
    let response: Response;
    try {
      const limit = AbortSignal.timeout(timeoutMs ?? options.requestTimeoutMs ?? 15000);
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
      description: descriptions[name] ?? `CTF managed ${name}. Use workspace-relative paths. The host supplies all identities, evidence references and budgets.`,
      args: schemas[name as keyof typeof schemas],
      async execute(args, context) {
        const mark = (args as Marked)[callMarker];
        if (!mark || mark.sessionID !== context.sessionID || mark.tool !== managedToolId(name)) throw new Error('denied: missing trusted call');
        delete (args as Marked)[callMarker]; // single consumption; an error or disconnect never retries the same call
        const result = await control(context.sessionID, 'tool.execute', { tool: name, args, callID: mark.callID }, context.abort, mark.timeoutMs);
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
    async 'tool.execute.before'(input, output) {
      const approval = await control(input.sessionID, 'tool.before', { tool: input.tool, callID: input.callID, args: output.args }) as { rpcTimeoutMs?: number };
      if (input.tool.startsWith('ctf_')) {
        const timeoutMs = approval?.rpcTimeoutMs ?? options.requestTimeoutMs ?? 15000;
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 65000) throw new Error('denied: control reply');
        (output.args as Marked)[callMarker] = { sessionID: input.sessionID, callID: input.callID, tool: input.tool, timeoutMs };
      }
    },
    async 'tool.execute.after'(input, output) { await control(input.sessionID, 'tool.after', { tool: input.tool, callID: input.callID, metadata: output.metadata }); }
  };
}

export const server = async (_input: unknown, options: CTFPluginOptions) => createCtfAgentHooks(options);
export const pluginModule = { id: pluginId, server };
