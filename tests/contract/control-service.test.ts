import { describe, expect, it } from 'vitest';
import { ControlService } from '../../apps/launcher/src/control-service.js';
import { startControlRpc } from '../../apps/launcher/src/control-rpc.js';
import { createCtfAgentHooks } from '../../apps/opencode-plugin/src/index.js';

/** SDK stand-in: session.get answers from a table, nothing else is needed without a model. */
function fakeService(sessions: Record<string, { parentID?: string; agent?: string }>) {
  const client = { session: {
    get: async ({ sessionID }: { sessionID: string }) => ({ data: { id: sessionID, ...sessions[sessionID] } }),
    children: async () => ({ data: [] }), messages: async () => ({ data: [] }), abort: async () => ({ data: true })
  } };
  const service = new ControlService({ client: client as never, budget: { maxModelCalls: 10, maxObservableTokens: 1000 },
    expiresAt: Date.now() + 60000, workdir: '/nonexistent', skillRoot: '/nonexistent' });
  service.bindRoot('root');
  return service;
}
const task = (role: string, extra: object = {}) => ({ tool: 'task', callID: `call-${Math.random()}`, args: { subagent_type: role, ...extra } });

describe('control service permission layer', () => {
  it('refuses task from a non-coordinator even when visibility would allow it', async () => {
    const service = fakeService({ child: { parentID: 'root', agent: 'recon' } });
    await service.handle('root', 'tool.before', task('recon'));
    await service.handle('child', 'chat.message', { agent: 'recon' });
    expect(service.bindings.get('child')?.role).toBe('recon');
    await expect(service.handle('child', 'tool.before', task('verifier'))).rejects.toThrow('denied: tool not permitted');
    await expect(service.handle('child', 'tool.before', { tool: 'bash', callID: 'c', args: {} })).rejects.toThrow('denied: tool not permitted');
  });

  it('allows one pending dispatch per parent and role until it is consumed', async () => {
    const service = fakeService({ c1: { parentID: 'root', agent: 'recon' } });
    await service.handle('root', 'tool.before', task('recon'));
    await expect(service.handle('root', 'tool.before', task('recon'))).rejects.toThrow('denied: dispatch');
    await service.handle('root', 'tool.before', task('verifier')); // other roles are not limited
    await service.handle('c1', 'chat.message', { agent: 'recon' }); // consumes the recon dispatch
    await service.handle('root', 'tool.before', task('recon'));
  });

  it('releases unconsumed pending dispatches when the parent asks for its next model call', async () => {
    const service = fakeService({});
    await service.handle('root', 'tool.before', task('recon'));
    await expect(service.handle('root', 'tool.before', task('recon'))).rejects.toThrow('denied: dispatch'); // same round: still refused
    await service.handle('root', 'model.call', { agent: 'coordinator' });
    expect(service.audit.some(r => r.op === 'dispatch.release' && JSON.stringify(r.detail).includes('recon'))).toBe(true);
    await service.handle('root', 'tool.before', task('recon')); // next round: allowed again
  });

  it('releases pending dispatches even when the admission is refused for budget', async () => {
    const service = fakeService({});
    (service as unknown as { options: { budget: { maxModelCalls: number } } }).options.budget.maxModelCalls = 0;
    await service.handle('root', 'tool.before', task('recon'));
    await expect(service.handle('root', 'model.call', {})).rejects.toThrow('budget denied');
    expect(service.audit.some(r => r.op === 'dispatch.release')).toBe(true);
  });

  it('refuses a session that was never dispatched and refuses task_id of a foreign session', async () => {
    const service = fakeService({ stray: { parentID: 'root', agent: 'recon' } });
    await expect(service.handle('stray', 'chat.message', { agent: 'recon' })).rejects.toThrow('denied: unbound session');
    await expect(service.handle('stray', 'model.call', {})).rejects.toThrow('denied: unbound session');
    await expect(service.handle('root', 'tool.before', task('recon', { task_id: 'stray' }))).rejects.toThrow('denied: dispatch');
  });
});

describe('plugin denies when the control service cannot answer', () => {
  const hookInput = { sessionID: 'root', agent: 'coordinator', model: { providerID: 'p', id: 'm' } } as never;
  const output = () => ({ maxOutputTokens: 1000 } as never);

  it('rejects a wrong transport credential and accepts the right one', async () => {
    const rpc = await startControlRpc(async () => ({ maxOutputTokens: 500 }));
    try {
      const wrong = createCtfAgentHooks({ controlUrl: rpc.url, controlToken: 'x'.repeat(48), tools: [] });
      await expect(wrong['chat.params']!(hookInput, output())).rejects.toThrow('denied');
      const right = createCtfAgentHooks({ controlUrl: rpc.url, controlToken: rpc.token, tools: [] });
      const out = { maxOutputTokens: 1000 };
      await right['chat.params']!(hookInput, out as never);
      expect(out.maxOutputTokens).toBe(500);
    } finally { await rpc.close(); }
  });

  it('rejects when the service never replies, is unreachable, or replies with something unusable', async () => {
    const silent = await startControlRpc(() => new Promise(() => undefined));
    try {
      const hooks = createCtfAgentHooks({ controlUrl: silent.url, controlToken: silent.token, tools: [], requestTimeoutMs: 200 });
      await expect(hooks['chat.params']!(hookInput, output())).rejects.toThrow('denied');
      await expect(hooks['tool.execute.before']!({ tool: 'read', sessionID: 'root', callID: 'c' }, { args: {} })).rejects.toThrow('denied');
    } finally { await silent.close(); }
    const garbage = await startControlRpc(async () => 'not an admission');
    try {
      const hooks = createCtfAgentHooks({ controlUrl: garbage.url, controlToken: garbage.token, tools: [] });
      await expect(hooks['chat.params']!(hookInput, output())).rejects.toThrow('denied');
    } finally { await garbage.close(); }
    const gone = createCtfAgentHooks({ controlUrl: silent.url, controlToken: silent.token, tools: [] });
    await expect(gone['chat.message']!({ sessionID: 'root' }, {} as never)).rejects.toThrow('denied');
  });
});
