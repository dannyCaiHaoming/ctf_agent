import { SessionIdSchema, type ChallengeId, type LeaseId, type SessionId, type TaskId } from '@ctf/contracts';
import { PolicyEngine, type SessionBinding } from '@ctf/policy';
import { createOpencodeServer } from '@opencode-ai/sdk/server';

export interface OpenCodeToolContext {
  sessionID: SessionId;
  tool: string;
  args: unknown;
}

export type OpenCodeTool = (context: OpenCodeToolContext) => Promise<unknown>;

export interface BridgeBindingInput {
  sessionId: SessionId;
  challengeId: ChallengeId;
  task: TaskId;
  lease: LeaseId;
  capabilities: string[];
  scope: string;
  expiresAt: string;
}

export class OpenCodeBridge {
  constructor(private readonly policy: PolicyEngine, private readonly tools = new Map<string, OpenCodeTool>()) {}

  expose(name: string, tool: OpenCodeTool): void { this.tools.set(name, tool); }

  allowlistedTools(): string[] { return [...this.tools.keys()].sort(); }

  bind(input: BridgeBindingInput): SessionBinding {
    const binding: SessionBinding = { ...input, capabilities: new Set(input.capabilities) };
    this.policy.register(binding);
    return binding;
  }

  async execute(context: OpenCodeToolContext): Promise<unknown> {
    SessionIdSchema.parse(context.sessionID);
    // No host-provided binding means fail closed, even if a model supplies identity data.
    let decision;
    try {
      decision = this.policy.authorizeTool({
        sessionId: context.sessionID,
        capability: context.tool,
        scope: 'unknown',
        lease: '00000000-0000-0000-0000-000000000000' as LeaseId
      });
    } catch (error) {
      throw new Error(error instanceof Error && /unbound|expired/.test(error.message) ? 'tool denied: no host binding' : (error instanceof Error ? error.message : String(error)));
    }
    if (!decision.allowed) throw new Error(decision.reason ?? 'tool denied');
    const tool = this.tools.get(context.tool);
    if (!tool) throw new Error('tool not exposed');
    return tool(context);
  }

  async executeBound(context: OpenCodeToolContext, lease: LeaseId, scope: string): Promise<unknown> {
    const decision = this.policy.authorizeTool({
      claimedSessionId: (context.args as { selfReportedSessionId?: string } | undefined)?.selfReportedSessionId,
      sessionId: context.sessionID,
      capability: context.tool,
      scope,
      lease
    });
    if (!decision.allowed) throw new Error(decision.reason ?? 'tool denied');
    const tool = this.tools.get(context.tool);
    if (!tool) throw new Error('tool not exposed');
    return tool(context);
  }
}

export interface StubProviderStep {
  tool?: string;
  args?: unknown;
  error?: string;
  response?: unknown;
  path: 'main' | 'subagent' | 'retry' | 'compaction' | 'summary';
}

export class StubProvider {
  private index = 0;
  readonly transcript: Array<{ path: string; tool?: string; ok: boolean }> = [];

  constructor(private readonly steps: StubProviderStep[]) {}

  async step(bridge: OpenCodeBridge, sessionId: SessionId, lease: LeaseId, scope: string): Promise<unknown> {
    const step = this.steps[this.index++];
    if (!step) throw new Error('stub provider exhausted');
    this.transcript.push({ path: step.path, tool: step.tool, ok: !step.error });
    if (step.error) throw new Error(step.error);
    if (!step.tool) return step.response;
    return bridge.executeBound({ sessionID: sessionId, tool: step.tool, args: step.args }, lease, scope);
  }
}

export const OPENCODE_PINNED_VERSION = '1.19.0';

export interface OpenCodeServerHandle {
  url: string;
  close(): void;
}

export type OpenCodeServerFactory = typeof createOpencodeServer;

export class OpenCodeServerLifecycle {
  constructor(private readonly factory: OpenCodeServerFactory = createOpencodeServer) {}

  async start(input: { port?: number; timeoutMs?: number } = {}): Promise<OpenCodeServerHandle> {
    const server = await this.factory({
      hostname: '127.0.0.1',
      port: input.port ?? 0,
      timeout: input.timeoutMs ?? 5000
    });
    return { url: server.url, close: () => server.close() };
  }
}
