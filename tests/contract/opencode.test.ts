import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeBridge, OpenCodeBridgeRpcServer } from '../../packages/opencode-bridge/src/index.js';
import { PolicyEngine } from '../../packages/policy/src/index.js';
import type { ChallengeId, LeaseId, SessionId, TaskId } from '../../packages/contracts/src/index.js';

const sessionId = 'session-1' as SessionId;
const lease = 'lease-1' as LeaseId;
const scope = 'http://127.0.0.1:9999';

function bridgeWithWorkspaceTool() {
  const policy = new PolicyEngine();
  const bridge = new OpenCodeBridge(policy);
  bridge.expose('workspace.read', async context => ({ session: context.sessionID, args: context.args }));
  return bridge;
}

describe('OpenCode bridge', () => {
  it('exposes only allowlisted tools and rejects unbound sessions', async () => {
    const bridge = bridgeWithWorkspaceTool();
    expect(bridge.allowlistedTools()).toEqual(['workspace.read']);
    await expect(bridge.execute({ sessionID: 'unbound' as SessionId, tool: 'workspace.read', args: {} })).rejects.toThrow(/denied/);
  });

  it('uses ToolContext identity and ignores model self-reported identity', async () => {
    const bridge = bridgeWithWorkspaceTool();
    const policy = bridge['policy'];
    policy.register({ sessionId, challengeId: 'c' as ChallengeId, task: 't' as TaskId, lease, capabilities: new Set(['workspace.read']), scope, expiresAt: new Date(Date.now() + 60000).toISOString() });
    const result = await bridge.executeBound({ sessionID: sessionId, tool: 'workspace.read', args: { path: 'x', selfReportedSessionId: 'other' } }, lease, scope);
    expect(result).toMatchObject({ session: 'session-1' });
  });

  it('requires a separate host binding for another session rather than granting child authority', async () => {
    const bridge = bridgeWithWorkspaceTool();
    const policy = bridge['policy'];
    policy.register({ sessionId, challengeId: 'c' as ChallengeId, task: 't' as TaskId, lease, capabilities: new Set(['workspace.read']), scope, expiresAt: new Date(Date.now() + 60000).toISOString() });
    await expect(bridge.executeBound({ sessionID: 'unbound-child' as SessionId, tool: 'workspace.read', args: {} }, lease, scope)).rejects.toThrow(/unbound/);
  });

  it('rejects injected tools and returns design-safe failure for unavailable hooks', async () => {
    const bridge = bridgeWithWorkspaceTool();
    await expect(bridge.executeBound({ sessionID: sessionId, tool: 'channel.send', args: {} }, lease, scope)).rejects.toThrow();
  });
});

describe('OpenCode public adapter', () => {
  afterEach(() => vi.restoreAllMocks());
  it('maps bridge allowlist to OpenCode tools using ToolContext sessionID', async () => {
    const { createCtfAgentHooks } = await import('../../apps/opencode-plugin/src/index.js');
    const bridge = bridgeWithWorkspaceTool();
    const policy = bridge['policy'];
    policy.register({ sessionId, challengeId: 'c' as ChallengeId, task: 't' as TaskId, lease, capabilities: new Set(['workspace.read']), scope, expiresAt: new Date(Date.now() + 60000).toISOString() });
    const hooks = createCtfAgentHooks({ bridge, resolveBinding: () => ({ lease, scope }) });
    const workspaceTool = hooks.tool?.['workspace.read']!;
    const result = await workspaceTool.execute({ args: { path: 'x' } } as never, {
      sessionID: 'session-1',
      messageID: 'message-1',
      agent: 'solver',
      directory: '/tmp',
      worktree: '/tmp',
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined
    } as never);
    expect(JSON.parse((result as { output: string }).output)).toEqual({ session: 'session-1', args: { path: 'x' } });
  });

  it('uses authenticated loopback RPC while retaining OpenCode session identity', async () => {
    const bridge = bridgeWithWorkspaceTool();
    const policy = bridge['policy'];
    policy.register({ sessionId, challengeId: 'c' as ChallengeId, task: 't' as TaskId, lease,
      capabilities: new Set(['workspace.read']), scope, expiresAt: new Date(Date.now() + 60000).toISOString() });
    let requestHandler: ((request: never, response: never) => void) | undefined;
    const fakeServer = {
      once: () => fakeServer,
      off: () => fakeServer,
      listen: (_port: number, _host: string, callback: () => void) => { callback(); return fakeServer; },
      address: () => ({ port: 43210, address: '127.0.0.1', family: 'IPv4' }),
      close: (callback: (error?: Error) => void) => { callback(); return fakeServer; }
    };
    const rpc = new OpenCodeBridgeRpcServer(bridge, id => {
      if (id !== sessionId) throw new Error('unbound session');
      return { lease, scope };
    }, 'bridge-test-token-that-is-long-enough-123', ((handler: unknown) => {
      requestHandler = handler as typeof requestHandler;
      return fakeServer as never;
    }) as never);
    const server = await rpc.start();
    try {
      const invoke = async (auth: string, body: Record<string, unknown>) => {
        let status = 0;
        let output = '';
        const request = {
          method: 'POST', url: '/tool', headers: { authorization: auth },
          async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); }
        };
        const response = {
          writeHead(code: number) { status = code; return response; },
          end(value?: string) { output = value ?? ''; return response; }
        };
        requestHandler!(request as never, response as never);
        await new Promise(resolve => setTimeout(resolve, 0));
        return { status, output };
      };
      expect(server.url).toBe('http://127.0.0.1:43210/tool');
      expect((await invoke('', { sessionID: sessionId, tool: 'workspace.read', args: {} })).status).toBe(401);
      expect((await invoke('Bearer bridge-test-token-that-is-long-enough-123', {
        sessionID: 'session-unbound', tool: 'workspace.read', args: {}
      })).status).toBe(403);
      const allowed = await invoke('Bearer bridge-test-token-that-is-long-enough-123', {
        sessionID: sessionId, tool: 'workspace.read', args: { path: 'x', selfReportedSessionId: 'forged' }
      });
      expect(allowed.status).toBe(200);
      expect(JSON.parse(allowed.output)).toEqual({ result: {
        session: 'session-1', args: { path: 'x', selfReportedSessionId: 'forged' }
      } });
    } finally {
      await server.close();
    }
  });

  it('forwards the OpenCode ToolContext session ID over RPC without adding identity arguments', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: { accepted: true } }), { status: 200 }));
    const { createCtfAgentHooks } = await import('../../apps/opencode-plugin/src/index.js');
    const hooks = createCtfAgentHooks({ bridgeUrl: 'http://127.0.0.1:43210/tool',
      bridgeToken: 'bridge-test-token-that-is-long-enough-123', tools: ['workspace.read'] });
    await hooks.tool?.['ctf_workspace_read']!.execute({ path: 'x' } as never, {
      sessionID: 'session-1', messageID: 'message-1', agent: 'solver', directory: '/tmp', worktree: '/tmp',
      abort: new AbortController().signal, metadata: () => undefined, ask: async () => undefined
    } as never);
    expect(fetchMock).toHaveBeenCalledWith(new URL('http://127.0.0.1:43210/tool'), expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer bridge-test-token-that-is-long-enough-123' }),
      body: JSON.stringify({ sessionID: 'session-1', tool: 'workspace.read', args: { path: 'x' } })
    }));
  });

  it('does not create plugin tools without an explicit bridge allowlist', async () => {
    const { createCtfAgentHooks } = await import('../../apps/opencode-plugin/src/index.js');
    expect(() => createCtfAgentHooks({ bridgeUrl: 'http://127.0.0.1:1/tool', bridgeToken: 'a'.repeat(32) })).toThrow(/exactly one/);
  });

});
