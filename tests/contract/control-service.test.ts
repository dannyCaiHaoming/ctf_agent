import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControlService } from '../../apps/launcher/src/control-service.js';
import { startControlRpc } from '../../apps/launcher/src/control-rpc.js';
import { createCtfAgentHooks } from '../../apps/opencode-plugin/src/index.js';

const fixtureRoot = mkdtempSync(join(tmpdir(), 'control-contract-'));
let fixtureNo = 0;
function materials(id: string) { const dir = join(fixtureRoot, String(++fixtureNo), id, 'materials'); mkdirSync(dir, { recursive: true }); return dir; }
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

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
    expiresAt: options.expiresAt ?? Date.now() + 60000, workdir: '/nonexistent', skillRoot: '/nonexistent', challenges: [{ id: 'C-fixture', title: null, target: null, reachability: null, materials: [], materialsDir: materials('C-fixture') }] });
  service.bindRoot('root');
  // C tests exercise identity/budget independently; provide required G declarations before fresh dispatch.
  const handle = service.handle.bind(service);
  service.handle = async (id, op, input) => {
    const b = input as { tool?: string; args?: { subagent_type?: string; task_id?: string } };
    if (id === 'root' && op === 'tool.before' && b.tool === 'task' && !b.args?.task_id &&
        ['recon', 'domain-solver', 'engineer', 'verifier'].includes(b.args?.subagent_type ?? '')) {
      // A duplicate while pending must still reach C's original assertion.
      let version:string|undefined;
      if(b.args!.subagent_type==='verifier'&&![...service.bindings.values()].some(v=>v.role==='engineer')){
        sessions['d-engineer']={parentID:'root',agent:'engineer'};
        await handle('root','tool.execute',{tool:'challenge.assign',args:{role:'engineer',challenge:'C-fixture'}});
        await handle('root','tool.before',{tool:'task',callID:'d-engineer',args:{subagent_type:'engineer',background:true}});
        await handle('root','tool.after',{tool:'task',callID:'d-engineer',metadata:{sessionId:'d-engineer'},output:'running'});
        await handle('d-engineer','chat.message',{agent:'engineer'});
      const engineer=[...service.bindings.values()].find(b=>b.role==='engineer')!.sessionID;
      await service.handle(engineer,'tool.execute',{tool:'workspace.write',callID:'d-input-write',args:{path:'work/d-input',content:'x'}});
      const a=await service.handle(engineer,'tool.execute',{tool:'artifact.publish',callID:'d-input-publish',args:{source:'file',path:'work/d-input'}}) as {ref:string};
      const p=await service.handle(engineer,'tool.execute',{tool:'package.publish',callID:'d-package-publish',args:{candidate:{ref:a.ref,start:0,end:1},files:[],extraction:'all',premises:[]}}) as {version:string};
      version=p.version;
      }
      try { await handle(id, 'tool.execute', { tool: 'challenge.assign', args: { role: b.args!.subagent_type, challenge: 'C-fixture',...(version?{version}:{}) } }); }
      catch (error) { if (!(error instanceof Error) || error.message !== 'denied: dispatch') throw error; }
    }
    return handle(id, op, input);
  };
  return service;
}
const task = (role: string, extra: object = {}) => ({ tool: 'task', callID: `call-${Math.random()}`, args: { subagent_type: role,...(role==='verifier'?{background:true}:{}), ...extra } });

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

  it('preserves unconsumed pending dispatches across parent admission', async () => {
    const service = fakeService({});
    await service.handle('root', 'tool.before', task('recon'));
    await expect(service.handle('root', 'tool.before', task('recon'))).rejects.toThrow('denied: dispatch'); // same round: still refused
    await service.handle('root', 'model.call', { agent: 'coordinator' });
    expect(service.audit.some(r => r.op === 'dispatch.release')).toBe(false);
    await expect(service.handle('root', 'tool.before', task('recon'))).rejects.toThrow('denied: dispatch');
  });

  it('budget refusal stops the run and clears pending without granting another dispatch', async () => {
    const service = fakeService({});
    (service as unknown as { options: { budget: { maxModelCalls: number } } }).options.budget.maxModelCalls = 0;
    await service.handle('root', 'tool.before', task('recon'));
    await expect(service.handle('root', 'model.call', {})).rejects.toThrow('budget denied');
    expect(service.stopReason).toBe('budget');
    await expect(service.handle('root', 'tool.before', task('recon'))).rejects.toThrow('run stopped');
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


// G-V1: explicit declarations; unlike the C fixtures these tests never auto-declare.
describe('G-V1 cross-round challenge binding', () => {
  function fixture(get?: (id: string) => Promise<{ parentID?: string; agent?: string }>) {
    const sessions: Record<string, { parentID?: string; agent?: string }> = { child: { parentID: 'root', agent: 'recon' } };
    const client = { session: {
      get: async ({ sessionID }: { sessionID: string }) => ({ data: get ? await get(sessionID) : sessions[sessionID] }),
      messages: async () => ({ data: [] }), children: async () => ({ data: [] }), abort: async () => ({ data: true })
    } };
    const service = new ControlService({ client: client as never, budget: { maxModelCalls: 100, maxObservableTokens: 1000 },
      expiresAt: Date.now() + 60000, workdir: '/nonexistent', skillRoot: '/nonexistent',
      challenges: ['X', 'Y'].map(id => ({ id, title: null, target: null, reachability: null, materials: [], materialsDir: materials(id) })) });
    service.bindRoot('root');
    return service;
  }
  const assign = (s: ControlService, challenge = 'X', role = 'recon', id = 'root') =>
    s.handle(id, 'tool.execute', { tool: 'challenge.assign', args: { challenge, role } });
  const unassign = (s: ControlService, role = 'recon', id = 'root') =>
    s.handle(id, 'tool.execute', { tool: 'challenge.unassign', args: { role } });
  const dispatch = (s: ControlService, extra = {}) => s.handle('root', 'tool.before', task('recon', extra));
  const bind = (s: ControlService) => s.handle('child', 'chat.message', { agent: 'recon' });
  const topic = (s: ControlService) => (s.bindings.get('child') as { challengeId?: string } | undefined)?.challengeId;

  it('T1 assign execute succeeds, parent readmission preserves it, binding precedes child admission', async () => {
    const s = fixture();
    await expect(assign(s)).resolves.toEqual({ challenge: 'X' });
    await s.handle('root', 'model.call', {});
    await dispatch(s); await bind(s); await s.handle('child', 'model.call', {});
    expect(topic(s)).toBe('X');
    expect(s.audit.find(r => r.op === 'bind' && r.sessionID === 'child')!.seq)
      .toBeLessThan(s.audit.find(r => r.op === 'model.call' && r.sessionID === 'child')!.seq);
  });
  it('T2 precheck and free text do not declare or authorize task', async () => {
    const s = fixture();
    await s.handle('root', 'tool.before', { tool: 'ctf_challenge_assign', args: { challenge: 'X', role: 'recon' } });
    await expect(dispatch(s, { prompt: 'challenge X' })).rejects.toThrow('denied: dispatch');
    await expect(bind(s)).rejects.toThrow('denied: unbound session');
    expect(s.bindings.size).toBe(1);
    await assign(s); await dispatch(s); await bind(s); expect(topic(s)).toBe('X');
  });
  it('T3 duplicate declarations preserve original, unassign is idempotent, pending cannot be cancelled', async () => {
    const s = fixture(); await assign(s);
    await expect(assign(s)).rejects.toThrow('denied: dispatch');
    await expect(assign(s, 'Y')).rejects.toThrow('denied: dispatch');
    await dispatch(s); await expect(unassign(s)).rejects.toThrow('denied: dispatch');
    await bind(s); expect(topic(s)).toBe('X');
    await expect(unassign(s)).resolves.toEqual({ cleared: false });
    await assign(s); await expect(unassign(s)).resolves.toEqual({ cleared: true });
    await expect(unassign(s)).resolves.toEqual({ cleared: false }); await assign(s, 'Y');
  });
  it.each(['stop', 'revoke', 'expire'] as const)('T4 declaration survives rounds but is cleared on %s', async action => {
    const s = fixture(); await assign(s);
    await s.handle('root', 'model.call', {}); await s.handle('root', 'model.call', {});
    await expect(assign(s, 'Y')).rejects.toThrow('denied: dispatch');
    if (action === 'stop') await s.stopAll('test');
    if (action === 'revoke') { await dispatch(s); await bind(s); await assign(s); s.bindings.get('root')!.state = 'revoked'; }
    if (action === 'expire') s.bindings.get('root')!.expiresAt = 0;
    await expect(dispatch(s)).rejects.toThrow('denied:');
    // Inspect absence only for terminal cleanup; positive behaviour is asserted through dispatch above.
    expect((s as unknown as { declarations: Map<string, unknown> }).declarations.get('root')).toBeUndefined();
  });
  it('T5 resume keeps topic; no/same declaration creates no pending, foreign/conflict preserves declaration', async () => {
    const s = fixture(); await assign(s); await dispatch(s); await bind(s);
    const finish = async () => {
      const callID = s.audit.filter(a => a.op === 'dispatch.register' || a.op === 'tool.before').map(a => a.detail as {callID?:string}).filter(d => d?.callID).at(-1)!.callID;
      await s.handle('root','tool.after',{tool:'task',callID,metadata:{parentSessionId:'root',sessionId:'child'}});
    };
    await finish(); await dispatch(s, { task_id: 'child' }); await finish();
    await assign(s); await dispatch(s, { task_id: 'child' }); await finish();
    await assign(s, 'Y'); // same declaration was consumed, no pending
    await expect(dispatch(s, { task_id: 'foreign' })).rejects.toThrow('denied: dispatch');
    await expect(dispatch(s, { task_id: 'child' })).rejects.toThrow('denied: dispatch');
    await expect(assign(s)).rejects.toThrow('denied: dispatch');
    expect(topic(s)).toBe('X');
    await expect(unassign(s)).resolves.toEqual({ cleared: true }); // no pending from resume
    await dispatch(s, { task_id: 'child' });
  });
  it('T6 only coordinator, solver roles and in-run topics may declare', async () => {
    const s = fixture(); await assign(s); await dispatch(s); await bind(s);
    await expect(assign(s, 'X', 'recon', 'child')).rejects.toThrow('denied: tool not permitted');
    await expect(unassign(s, 'recon', 'child')).rejects.toThrow('denied: tool not permitted');
    for (const role of ['intake','reference','strategy','recovery-critic']) {
      await expect(assign(s, 'X', role)).rejects.toThrow('denied: dispatch');
      await expect(unassign(s, role)).rejects.toThrow('denied: dispatch');
    }
    await expect(assign(s, 'OTHER')).rejects.toThrow('denied: dispatch');
  });
  it('T7 task before delayed assign execute rejects; later declaration survives and next round succeeds', async () => {
    const s = fixture(); const start = deferred(); const release = deferred();
    const laterAssign = (async () => { start.resolve(); await release.promise; return assign(s); })();
    await start.promise; await expect(dispatch(s)).rejects.toThrow('denied: dispatch');
    release.resolve(); await laterAssign; await s.handle('root', 'model.call', {});
    await dispatch(s); await bind(s); expect(topic(s)).toBe('X');
    // Opposite same-round order is already covered by T3's successful assign→task without admission.
  });
  it('T8 pre-registration refusal preserves declaration; unknown registered task stays pending across admission', async () => {
    const s = fixture(); await assign(s);
    await expect(s.handle('root', 'tool.before', { tool: 'task', args: { subagent_type: 'recon' } })).rejects.toThrow('denied: dispatch');
    await dispatch(s); // task fails before child hook; no tool.after
    await expect(assign(s)).rejects.toThrow('denied: dispatch');
    await s.handle('root', 'model.call', {});
    await expect(dispatch(s)).rejects.toThrow('denied: dispatch');
    await expect(assign(s, 'Y')).rejects.toThrow('denied: dispatch');
  });
  it.each(['stop', 'revoke', 'expire'] as const)('T9 %s during SDK binding wait cannot create valid binding', async action => {
    const started = deferred(); const release = deferred();
    const s = fixture(async () => { started.resolve(); await release.promise; return { parentID: 'root', agent: 'recon' }; });
    await assign(s); await dispatch(s); const binding = bind(s); await started.promise;
    if (action === 'stop') await s.stopAll('test');
    if (action === 'revoke') s.bindings.get('root')!.state = 'revoked';
    if (action === 'expire') s.bindings.get('root')!.expiresAt = 0;
    release.resolve(); await expect(binding).rejects.toThrow('denied:'); expect(s.bindings.has('child')).toBe(false);
    expect((s as unknown as { pending: Map<string, unknown> }).pending.get('root')).toBeUndefined();
  });
  it('T9 stop while assign/task are queued behind an SDK wait rejects both without new state', async () => {
    const started = deferred(); const release = deferred();
    const s = fixture(async () => { started.resolve(); await release.promise; return { parentID: 'root', agent: 'intake' }; });
    await s.handle('root', 'tool.before', task('intake'));
    const binding = s.handle('unknown', 'chat.message', { agent: 'intake' }); await started.promise;
    const a = assign(s); const d = dispatch(s);
    await s.stopAll('test'); release.resolve();
    await expect(binding).rejects.toThrow('denied:'); await expect(a).rejects.toThrow('denied:'); await expect(d).rejects.toThrow('denied:');
    expect(s.bindings.size).toBe(1);
    expect((s as unknown as { declarations: Map<string, unknown> }).declarations.size).toBe(0);
  });
});
