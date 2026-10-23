import { describe, expect, it, vi } from 'vitest';
import { ControlService } from '../../apps/launcher/src/control-service.js';
import { startControlRpc } from '../../apps/launcher/src/control-rpc.js';
import { createCtfAgentHooks } from '../../apps/opencode-plugin/src/index.js';

/** SDK stand-in: session.get answers from a table, nothing else is needed without a model. */
function fakeService(sessions: Record<string, { parentID?: string; agent?: string }>, options: {
  messages?: (input: { sessionID: string }) => Promise<{ data: [] }>;
  expiresAt?: number;
} = {}) {
  const client = { session: {
    get: async ({ sessionID }: { sessionID: string }) => ({ data: { id: sessionID, ...sessions[sessionID] } }),
    children: async () => ({ data: [] }), messages: options.messages ?? (async () => ({ data: [] })), abort: async () => ({ data: true })
  } };
  const service = new ControlService({ client: client as never, budget: { maxModelCalls: 10, maxObservableTokens: 1000 },
    expiresAt: options.expiresAt ?? Date.now() + 60000, workdir: '/nonexistent', skillRoot: '/nonexistent' });
  service.bindRoot('root');
  return service;
}
const task = (role: string, extra: object = {}) => ({ tool: 'task', callID: `call-${Math.random()}`, args: { subagent_type: role, ...extra } });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('model admission after an in-flight usage query', () => {
  it.each([
    { action: 'stop', reason: 'denied: run stopped' },
    { action: 'revoke', reason: 'denied: session revoked' },
    { action: 'expire', reason: 'denied: binding lapsed' },
    { action: 'active', reason: undefined }
  ] as const)('$action: rechecks validity before spending a call', async ({ action, reason }) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'));
    const started = deferred();
    const release = deferred();
    try {
      const expiresAt = Date.now() + 60000;
      const service = fakeService({ child: { parentID: 'root', agent: 'recon' } }, {
        expiresAt,
        messages: async ({ sessionID }) => {
          if (sessionID === 'child') {
            started.resolve();
            await release.promise;
          }
          return { data: [] }; // zero usage and ample budget: only validity may refuse admission
        }
      });
      await service.handle('root', 'model.call', { agent: 'coordinator' });
      await service.handle('root', 'tool.before', task('recon'));
      await service.handle('child', 'chat.message', { agent: 'recon' });
      const admittedBefore = service.admitted;
      const pending = service.handle('child', 'model.call', { agent: 'recon' });
      await started.promise;
      expect(service.admitted).toBe(admittedBefore);
      expect(service.audit.filter(r => r.sessionID === 'child' && r.op === 'model.call')).toEqual([]);

      if (action === 'stop') await service.stopAll('deadline');
      if (action === 'revoke') await service.revoke('child');
      if (action === 'expire') vi.setSystemTime(expiresAt); // expiry is inclusive
      release.resolve();

      if (reason) {
        await expect(pending).rejects.toThrow(reason);
        expect(service.admitted).toBe(admittedBefore);
        expect(service.audit.filter(r => r.sessionID === 'child' && r.op === 'model.call'))
          .toEqual([expect.objectContaining({ allow: false, reason })]);
      } else {
        await expect(pending).resolves.toEqual({ maxOutputTokens: 1000, admitNo: 2, role: 'recon' });
        expect(service.admitted).toBe(admittedBefore + 1);
        expect(service.audit.filter(r => r.sessionID === 'child' && r.op === 'model.call'))
          .toEqual([expect.objectContaining({ allow: true, detail: { maxOutputTokens: 1000, admitNo: 2, role: 'recon' } })]);
      }
    } finally {
      release.resolve();
      vi.useRealTimers();
    }
  });
});

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

const message = (id: string, input = 400, output = 150, reasoning = 50) => ({ info: {
  id, sessionID: 'root', role: 'assistant', tokens: { input, output, reasoning }, time: { completed: 1 }
} });

describe('retained usage evidence', () => {
  it('retains usage by SDK message identity across abort, rereads and a new message', async () => {
    const service = fakeService({});
    service.observeUsage('root', [message('m1')]);
    const aborted = { info: { ...message('m1', 0, 0, 0).info, error: { name: 'MessageAbortedError' } } };
    service.observeUsage('root', [aborted]);
    service.observeUsage('root', [aborted]);
    expect(service.observed).toBe(600);
    expect(service.usageSnapshot().total).toMatchObject({ input: 400, output: 150, reasoning: 50, incomplete: true });
    service.observeUsage('root', [aborted, message('m2', 100, 0, 0)]);
    expect(service.observed).toBe(700);
    // Mutation of a snapshot must not change the ledger.
    service.usageSnapshot().sessions.root!.input = 0;
    expect(service.observed).toBe(700);
    expect(() => service.observeUsage('foreign', [message('m1')])).toThrow();
  });

  it('marks missing usage, including completed messages, while accepting reported zero', () => {
    const missing = { info: { id: 'missing', sessionID: 'root', role: 'assistant', time: { completed: 1 } } };
    const service = fakeService({});
    service.observeUsage('root', [missing]);
    expect(service.usageSnapshot().total).toMatchObject({ availability: 'unavailable', incomplete: true });
    service.observeUsage('root', [missing, message('known')]);
    expect(service.usageSnapshot().total).toMatchObject({ availability: 'reported', input: 400, incomplete: true });
    const zero = fakeService({});
    zero.observeUsage('root', [message('zero', 0, 0, 0)]);
    expect(zero.usageSnapshot().total).toMatchObject({ availability: 'reported', incomplete: false, input: 0 });
    zero.observeUsage('root', [{ info: { role: 'assistant', tokens: { input: 9, output: 0, reasoning: 0 }, time: { completed: 1 } } }]);
    expect(zero.usageSnapshot().total).toMatchObject({ input: 0, incomplete: true });
  });

  it('retains an earlier session observation when a later SDK read fails and denies the threshold', async () => {
    const service = fakeService({ child: { parentID: 'root', agent: 'recon' } });
    await service.handle('root', 'tool.before', task('recon'));
    await service.handle('child', 'chat.message', {});
    const options = (service as unknown as { options: { client: { session: { messages: Function } } } }).options;
    options.client.session.messages = async ({ sessionID }: { sessionID: string }) => {
      if (sessionID === 'child') throw new Error('usage read failed');
      return { data: [message('m1', 1000, 0, 0)] };
    };
    await expect(service.checkBudget()).rejects.toThrow('usage read failed');
    expect(service.observed).toBe(1000);
    expect(service.usageSnapshot().total.incomplete).toBe(true);
    options.client.session.messages = async () => ({ data: [] });
    await expect(service.handle('root', 'model.call', {})).rejects.toThrow('budget denied');
    expect(service.admitted).toBe(0);
  });
});

describe('abort evidence', () => {
  it('records enumeration and revoke failures without claiming successful abort', async () => {
    const service = fakeService({ child: { parentID: 'root', agent: 'recon' } });
    await service.handle('root', 'tool.before', task('recon'));
    await service.handle('child', 'chat.message', {});
    const session = (service as unknown as { options: { client: { session: { abort: Function; children: Function } } } }).options.client.session;
    const attempted: string[] = [];
    session.abort = async ({ sessionID }: { sessionID: string }) => { attempted.push(sessionID); if (sessionID === 'child') throw new Error('abort refused'); return { data: true }; };
    session.children = async () => { throw new Error('enumeration failed'); };
    await service.revoke('child');
    expect(service.audit).toContainEqual(expect.objectContaining({ op: 'aborted', sessionID: 'child', allow: false, detail: expect.stringContaining('abort refused') }));
    await service.stopAll('test');
    expect(attempted).toContain('root');
    expect(service.audit).toContainEqual(expect.objectContaining({ op: 'stop_enumerated', allow: false }));
    expect(service.audit.filter(r => r.op === 'aborted' && r.allow).every(r => r.sessionID !== 'child')).toBe(true);
  });
});

describe('usage SDK edge cases', () => {
  it('marks disappearing messages and malformed tokens incomplete without losing known consumption', () => {
    const service = fakeService({});
    service.observeUsage('root', [message('m')]);
    service.observeUsage('root', []);
    expect(service.usageSnapshot().total).toMatchObject({ input: 400, incomplete: true });
    service.observeUsage('root', [message('bad', Number.NaN, 0, 0)]);
    expect(service.usageSnapshot().total).toMatchObject({ input: 400, incomplete: true });
  });
  it('allows an in-progress reading to become complete when the SDK reports completion', () => {
    const service = fakeService({});
    service.observeUsage('root', [{ info: { ...message('m').info, time: {} } }]);
    expect(service.usageSnapshot().total.incomplete).toBe(true);
    service.observeUsage('root', [message('m')]);
    expect(service.usageSnapshot().total.incomplete).toBe(false);
  });
});
