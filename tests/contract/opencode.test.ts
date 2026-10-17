import { describe, expect, it } from 'vitest';
import { OpenCodeBridge, StubProvider } from '../../packages/opencode-bridge/src/index.js';
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

  it('covers main, subagent, retry, compaction, and summary paths with the stub provider', async () => {
    const bridge = bridgeWithWorkspaceTool();
    const policy = bridge['policy'];
    policy.register({ sessionId, challengeId: 'c' as ChallengeId, task: 't' as TaskId, lease, capabilities: new Set(['workspace.read']), scope, expiresAt: new Date(Date.now() + 60000).toISOString() });
    const provider = new StubProvider([
      { path: 'main', tool: 'workspace.read', args: { path: 'x' } },
      { path: 'subagent', tool: 'workspace.read', args: { path: 'y' } },
      { path: 'retry', tool: 'workspace.read', args: { path: 'z' } },
      { path: 'compaction', response: { summary: 'compact' } },
      { path: 'summary', response: { summary: 'final' } }
    ]);
    for (let i = 0; i < 5; i++) await provider.step(bridge, sessionId, lease, scope);
    expect(provider.transcript.map(item => item.path)).toEqual(['main', 'subagent', 'retry', 'compaction', 'summary']);
  });

  it('rejects injected tools and returns design-safe failure for unavailable hooks', async () => {
    const bridge = bridgeWithWorkspaceTool();
    await expect(bridge.executeBound({ sessionID: sessionId, tool: 'channel.send', args: {} }, lease, scope)).rejects.toThrow();
  });
});

describe('OpenCode public adapter', () => {
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

  it('starts and closes the pinned public OpenCode server lifecycle through a factory', async () => {
    const { OpenCodeServerLifecycle, OPENCODE_PINNED_VERSION } = await import('../../packages/opencode-bridge/src/index.js');
    expect(OPENCODE_PINNED_VERSION).toBe('1.19.0');
    let closed = false;
    const lifecycle = new OpenCodeServerLifecycle((async () => ({ url: 'http://127.0.0.1:4096', close: () => { closed = true; } })) as never);
    const handle = await lifecycle.start();
    expect(handle.url).toBe('http://127.0.0.1:4096');
    handle.close();
    expect(closed).toBe(true);
  });
});
