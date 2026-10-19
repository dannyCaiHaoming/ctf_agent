import { SessionIdSchema, type ChallengeId, type LeaseId, type SessionId, type TaskId } from '@ctf/contracts';
import { PolicyEngine, type SessionBinding } from '@ctf/policy';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

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

export interface BridgeRpcBinding {
  lease: LeaseId;
  scope: string;
}

/**
 * OpenCode runs plugins in its own server process. This loopback-only transport
 * keeps the policy/ToolRuntime owner in the CLI while preserving the session ID
 * supplied by OpenCode's ToolContext as the identity used for authorization.
 */
export class OpenCodeBridgeRpcServer {
  private server?: Server;

  constructor(
    private readonly bridge: OpenCodeBridge,
    private readonly resolveBinding: (sessionID: SessionId) => BridgeRpcBinding,
    private readonly token: string,
    private readonly createServerFactory: typeof createServer = createServer,
    private readonly control?: (sessionID: SessionId, operation: string, input: unknown) => Promise<unknown>
  ) {
    if (token.length < 32) throw new Error('bridge RPC token must be at least 32 characters');
  }

  async start(): Promise<{ url: string; close: () => Promise<void> }> {
    if (this.server) throw new Error('bridge RPC server already started');
    const server = this.createServerFactory((request, response) => {
      void this.handle(request, response);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('bridge RPC server did not bind a TCP port');
    return {
      url: `http://127.0.0.1:${address.port}/tool`,
      close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    };
  }

  private async handle(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    const supplied = request.headers.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice('Bearer '.length)
      : '';
    const expectedBytes = Buffer.from(this.token);
    const suppliedBytes = Buffer.from(supplied);
    const authorized = expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
    if (!authorized) {
      response.writeHead(401).end('unauthorized');
      return;
    }
    if (request.method !== 'POST' || !['/tool', '/control'].includes(request.url ?? '')) {
      response.writeHead(404).end('not found');
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 2 * 1024 * 1024) {
          response.writeHead(413).end('request too large');
          return;
        }
        chunks.push(bytes);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      const sessionID = SessionIdSchema.parse(body.sessionID);
      const binding = this.resolveBinding(sessionID);
      let result: unknown;
      if (request.url === '/control') {
        if (!this.control || typeof body.operation !== 'string') throw new Error('host control operation unavailable');
        result = await this.control(sessionID, body.operation, body.input);
      } else {
        if (typeof body.tool !== 'string' || !body.tool || !Object.hasOwn(body, 'args')) throw new Error('invalid bridge tool request');
        result = await this.bridge.executeBound({ sessionID, tool: body.tool, args: body.args }, binding.lease, binding.scope);
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }));
    } catch (error) {
      response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

export * from './compaction.js';
export * from './server.js';
