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
const packageEntry={path:tool.schema.string(),purpose:tool.schema.enum(['script','input','evidence'])};
const schemas = {
  'package.publish': {candidate:tool.schema.object({ref:tool.schema.string(),start:tool.schema.number().int().nonnegative(),end:tool.schema.number().int().nonnegative()}),files:tool.schema.array(tool.schema.discriminatedUnion('kind',[tool.schema.object({kind:tool.schema.literal('artifact'),ref:tool.schema.string(),...packageEntry}),tool.schema.object({kind:tool.schema.literal('material'),name:tool.schema.string(),...packageEntry})])).max(32),argv:tool.schema.array(tool.schema.string()).max(32).optional(),extraction:tool.schema.string(),premises:tool.schema.array(tool.schema.string()).max(32)},
  'package.read': {version:tool.schema.string(),component:tool.schema.enum(['manifest','candidate','file']),path:tool.schema.string().optional(),cursor:tool.schema.string().optional()},
  'artifact.publish': {source:tool.schema.enum(['file','job','http']),path:tool.schema.string().optional(),job:tool.schema.string().optional(),stream:tool.schema.enum(['stdout','stderr']).optional(),resource:tool.schema.string().optional(),start:tool.schema.number().int().nonnegative().optional(),end:tool.schema.number().int().nonnegative().optional()},
  'artifact.read': {ref:tool.schema.string(),cursor:tool.schema.string().optional()},
  'challenge.assign': { role: tool.schema.enum(['recon', 'domain-solver', 'engineer', 'verifier']), challenge: tool.schema.string().min(1) },
  'challenge.unassign': { role: tool.schema.enum(['recon', 'domain-solver', 'engineer', 'verifier']) },
  'workspace.list': { path: tool.schema.string().optional() },
  'workspace.read': { path: tool.schema.string(), cursor: tool.schema.string().optional() },
  'workspace.search': { path: tool.schema.string().optional(), needle: tool.schema.string().min(1) },
  'workspace.write': { path: tool.schema.string(), content: tool.schema.string(), encoding: tool.schema.enum(['utf8', 'base64']).optional() },
  'task.stop': { task_id: tool.schema.string().min(1).max(128) },
  'job.run': { argv: tool.schema.array(tool.schema.string()).min(1).max(32), timeout_ms: tool.schema.number().int().positive().max(600000).optional() },
  'job.read': { job: tool.schema.string().uuid(), stream: tool.schema.enum(['stdout', 'stderr']), cursor: tool.schema.string().optional() },
  'job.cancel': { job: tool.schema.string().uuid() },
  'http.request': { url: tool.schema.string().url(), method: tool.schema.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).optional(),
    body: tool.schema.string().max(65536).optional(), body_base64: tool.schema.string().optional(), headers: tool.schema.record(tool.schema.string(), tool.schema.string()).optional(),
    follow_redirects: tool.schema.boolean().optional(), timeout_ms: tool.schema.number().int().positive().max(60000).optional() },
  'challenge.list': {},
  'challenge.read': { id: tool.schema.string().min(1), path: tool.schema.string().min(1), cursor: tool.schema.string().regex(/^\d{1,15}$/).optional() }
};
const descriptions: Record<string, string> = {
  'package.publish': 'Disposable D interface-two prototype, Engineer only. Fix a whole package once: candidate is a published ref and exact nonempty half-open byte range; files select published refs or E material names, each with an unambiguous relative path and script/input/evidence purpose. Supply proposed argv (optional), extraction explanation and premises. No text normalization or automatic execution. Returned version refers to the whole package. Incomplete/unknown provenance stays incomplete/unknown. Not verified or solved. Transport failure can follow commit: pause unconfirmed handoff; never blindly republish or rerun source. No unknown lock or recovery.',
  'package.read': 'Read one explicit whole-package version from this run/challenge. component manifest or candidate, or file with exact manifest path. Base64 pages (32768 bytes); follow nextCursor until null. Rechecks immutable package and every dependency. No latest alias. No validation/solved claim.',
  'artifact.publish': 'Fix an immutable snapshot from your own completed source in a native background task. Use exactly one source: {source:"file",path:"work/..."} after all writes/jobs finish; {source:"job",job,stream:"stdout"|"stderr"} after job cleanup; or {source:"http",resource} from the HTTP reply. Optional start/end select a half-open byte range [start,end), default all captured bytes. Files/streams are bounded to 1 MiB. The host returns ref/path/sha256/size and snapshotFixed (fixed bytes), rangeComplete (selected captured range), originalComplete (source completeness; null means unknown). A fixed range does not prove complete original output; unknown file producers are not inferred. Hand off the actual returned ref and necessary explanation through native task completion, never a private work path or invented identity/hash. Publication is not Engineer receipt, candidate registration, verified or solved. A transport error may follow a committed publication: keep this handoff unconfirmed and paused; do not rerun the source job/HTTP or blindly republish. There is no recovery or automatic unknown lock.',
  'artifact.read': 'Read a host-issued ref from the same run and challenge: {ref,cursor?}. Decode data as base64; pages contain at most 32768 bytes. Pass the previous nextCursor unchanged until it is null for all bytes you need. Check snapshotFixed, rangeComplete and originalComplete separately; fixed bytes or a complete selected range do not prove the original source was complete. Confirm receipt only after actually reading the required bytes and completeness markers. No sibling work access. Edit in your own work and publish a new ref for changes; publication/read alone do not register a candidate or set verified/solved.',
  'job.run': 'Start one managed job and wait in this call until terminal cleanup. Output remains bounded and readable after completion. Host timeout and lifetime bound execution.',
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
    async event({event}) {
      if (event.type !== 'message.part.updated') return;
      const part = event.properties.part;
      if (part.type === 'tool' && part.tool === 'task' && part.state.status === 'error')
        await control(part.sessionID, 'task.event', {callID: part.callID, state: part.state.status, error: part.state.error});
    },
    async 'chat.message'(input, output) { await control(input.sessionID, 'chat.message', { agent: input.agent, messageID: input.messageID ?? output.message?.id, parts: output.parts }); },
    async 'chat.params'(input, output) {
      const admitted = await control(input.sessionID, 'model.call', { agent: input.agent, provider: input.model.providerID, model: input.model.id, messageID: input.message?.id }) as { maxOutputTokens: number };
      if (!Number.isFinite(admitted?.maxOutputTokens) || admitted.maxOutputTokens < 1) throw new Error('denied: control reply');
      output.maxOutputTokens = Math.min(output.maxOutputTokens ?? admitted.maxOutputTokens, admitted.maxOutputTokens);
    },
    async 'tool.execute.before'(input, output) {
      const approval = await control(input.sessionID, 'tool.before', { tool: input.tool, callID: input.callID, args: output.args }) as { rpcTimeoutMs?: number; taskDescription?: string };
      if (input.tool === 'task' && approval.taskDescription) output.args.description = approval.taskDescription;
      if (input.tool.startsWith('ctf_')) {
        const timeoutMs = approval?.rpcTimeoutMs ?? options.requestTimeoutMs ?? 15000;
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 609000) throw new Error('denied: control reply');
        (output.args as Marked)[callMarker] = { sessionID: input.sessionID, callID: input.callID, tool: input.tool, timeoutMs };
      }
    },
    async 'tool.execute.after'(input, output) { await control(input.sessionID, 'tool.after', { tool: input.tool, callID: input.callID, metadata: output.metadata, output: output.output }); }
  };
}

export const server = async (_input: unknown, options: CTFPluginOptions) => createCtfAgentHooks(options);
export const pluginModule = { id: pluginId, server };
