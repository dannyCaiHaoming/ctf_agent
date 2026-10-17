import { tool, type Hooks } from '@opencode-ai/plugin';
import type { OpenCodeBridge } from '@ctf/opencode-bridge';
import type { LeaseId, SessionId } from '@ctf/contracts';

export interface CTFPluginOptions {
  bridge: OpenCodeBridge;
  resolveBinding: (sessionID: SessionId) => { lease: LeaseId; scope: string };
}

export const pluginId = 'ctf-agent-host-foundation';

// The bridge owns the allowlist; this adapter only converts public OpenCode tools.
export function createCtfAgentHooks(options: CTFPluginOptions): Pick<Hooks, 'tool'> {
  const tools: Pick<Hooks, 'tool'>['tool'] = {};
  for (const name of options.bridge.allowlistedTools()) {
    tools[name] = tool({
      description: `CTF Agent managed tool: ${name}`,
      args: { args: tool.schema.any() },
      async execute(args, context) {
        const binding = options.resolveBinding(context.sessionID as SessionId);
        const result = await options.bridge.executeBound(
          { sessionID: context.sessionID as SessionId, tool: name, args: (args as { args: unknown }).args },
          binding.lease,
          binding.scope
        );
        return { title: name, output: JSON.stringify(result) };
      }
    });
  }
  return { tool: tools };
}

export const server = async (input: unknown, options: CTFPluginOptions): Promise<Pick<Hooks, 'tool'>> => {
  void input;
  return createCtfAgentHooks(options);
};

export const pluginModule: { id: typeof pluginId; server: typeof server } = { id: pluginId, server };
