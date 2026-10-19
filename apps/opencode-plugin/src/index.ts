import { tool, type Hooks } from '@opencode-ai/plugin';
import type { OpenCodeBridge } from '@ctf/opencode-bridge';
import type { LeaseId, SessionId } from '@ctf/contracts';

export interface CTFPluginOptions {
  bridge?: OpenCodeBridge;
  resolveBinding?: (sessionID: SessionId) => { lease: LeaseId; scope: string };
  bridgeUrl?: string;
  bridgeToken?: string;
  tools?: string[];
}

export const pluginId = 'ctf-agent-host-foundation';
const schemas = {
  'workspace.list': { path: tool.schema.string().optional() },
  'workspace.read': { path: tool.schema.string() },
  'workspace.search': { path: tool.schema.string(), needle: tool.schema.string() },
  'workspace.patch': { path: tool.schema.string(), find: tool.schema.string().min(1), replace: tool.schema.string() },
  'job.run': { command: tool.schema.array(tool.schema.string()).min(2), timeout_ms: tool.schema.number().int().positive().optional() },
  'candidate.register': { value: tool.schema.string().min(1) }
};
export const managedToolId = (name: string) => `ctf_${name.replaceAll('.', '_')}`;

export function createCtfAgentHooks(options: CTFPluginOptions): Hooks {
  const direct = Boolean(options.bridge && options.resolveBinding);
  const remote = Boolean(options.bridgeUrl && options.bridgeToken && Array.isArray(options.tools));
  if (direct === remote) throw new Error('configure exactly one of direct bridge or authenticated bridge RPC');
  const allowlist = direct ? options.bridge!.allowlistedTools() : options.tools!;
  if (remote) {
    const url = new URL(options.bridgeUrl!);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || options.bridgeToken!.length < 32) throw new Error('invalid authenticated loopback bridge');
    if (allowlist.some(name => !Object.hasOwn(schemas, name))) throw new Error('tool is not in the managed trajectory manifest');
  }
  const invoke = async (sessionID: string, path: 'tool' | 'control', body: object, signal?: AbortSignal) => {
    const response = await fetch(new URL(`/${path}`, options.bridgeUrl!), {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.bridgeToken!}` },
      body: JSON.stringify({ sessionID, ...body })
    });
    if (!response.ok) throw new Error('host denied OpenCode operation');
    return (await response.json() as { result: unknown }).result;
  };
  const tools: NonNullable<Hooks['tool']> = {};
  for (const name of allowlist) {
    const id = direct ? name : managedToolId(name);
    tools[id] = tool({
      description: `CTF managed ${name}. Use workspace-relative paths. The host supplies all identities, evidence references and budgets.`,
      args: direct ? { args: tool.schema.any() } : schemas[name as keyof typeof schemas],
      async execute(args, context) {
        let result: unknown;
        if (direct) {
          const binding = options.resolveBinding!(context.sessionID as SessionId);
          result = await options.bridge!.executeBound({ sessionID: context.sessionID as SessionId, tool: name,
            args: (args as unknown as { args: unknown }).args }, binding.lease, binding.scope);
        } else result = await invoke(context.sessionID, 'tool', { tool: name, args }, context.abort);
        return { title: name, output: JSON.stringify(result) };
      }
    });
  }
  if (direct) return { tool: tools };
  const control = (sessionID: string, operation: string, input: unknown) => invoke(sessionID, 'control', { operation, input });
  return {
    tool: tools,
    async 'tool.execute.before'(input) {
      if (!Object.hasOwn(tools, input.tool)) throw new Error('unmanaged OpenCode tool denied');
      await control(input.sessionID, 'authorize', { tool: input.tool });
    },
    async 'experimental.chat.messages.transform'(_input, output) {
      const ids = new Set(output.messages.map(message => message.info.sessionID));
      if (ids.size !== 1) throw new Error('provider input requires one bound session');
      await control([...ids][0]!, 'model.input', output.messages);
    },
    async 'experimental.chat.system.transform'(input, output) {
      if (!input.sessionID) throw new Error('unbound provider system input denied');
      await control(input.sessionID, 'model.system', output.system);
    },
    async 'chat.params'(input, output) {
      const admitted = await control(input.sessionID, 'model.call', { provider: input.model.providerID, model: input.model.id,
        temperature: output.temperature }) as { maxOutputTokens: number };
      output.maxOutputTokens = Math.min(output.maxOutputTokens ?? admitted.maxOutputTokens, admitted.maxOutputTokens);
    }
  };
}

export const server = async (_input: unknown, options: CTFPluginOptions) => createCtfAgentHooks(options);
export const pluginModule = { id: pluginId, server };
