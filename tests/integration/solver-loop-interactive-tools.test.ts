import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SolverActionSchema, SolverLoop, type SolverAction, type SolverDriver } from '../legacy/solver-loop.js';
import { setup } from './solver-loop-fixtures.js';

const usage = { provenance: 'deterministic' as const, input_tokens: 1, output_tokens: 1, model_calls: 0 };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('SolverLoop interactive job and channel tool routes', () => {
  it('starts a scoped PTY and exchanges bytes through the current session lease', async () => {
    const { runtime, artifacts, state, registry, close } = await setup('t1-script-error', { async decide() { throw new Error('unused'); } });
    const workspace = runtime.workspace('solver');
    await writeFile(join(workspace.path, 'interactive.mjs'), "process.stdin.setEncoding('utf8'); process.stdin.on('data', value => process.stdout.write('received:' + value));\n");
    const actions: SolverAction[] = [
      { kind: 'tool', tool: 'job.start', input: { mode: 'pty', command: [process.execPath, 'interactive.mjs'], timeout_ms: 5000 } },
      { kind: 'tool', tool: 'job.list', input: {} },
      { kind: 'tool', tool: 'job.status', input: { id: 'dynamic' } },
      { kind: 'tool', tool: 'job.write', input: { id: 'dynamic', data: { encoding: 'base64', data: Buffer.from('hello\n').toString('base64') } } },
      { kind: 'tool', tool: 'job.read', input: { id: 'dynamic', cursor: 0, max_bytes: 4096 } },
      { kind: 'tool', tool: 'job.cancel', input: { id: 'dynamic' } },
      { kind: 'stop', reason: 'interactive byte exchange completed' }
    ];
    expect(SolverActionSchema.safeParse(actions[0]).success).toBe(true);
    const driver: SolverDriver = { async decide(request) {
      if (request.observation?.tool === 'job.start') {
        const job = JSON.parse(request.observation.raw) as { id: string };
        for (const action of actions) if (action.kind === 'tool' && 'id' in action.input && action.input.id === 'dynamic') action.input.id = job.id;
      }
      if (request.observation?.tool === 'job.write') await pause(50);
      return { action: actions.shift()!, usage };
    } };
    const loop = new SolverLoop({ registry, sessionId: 'session', state, artifacts, runtime, driver,
      challenge: { ready: true, description: 'PTY route test', material_refs: [], snapshot: { generation: 1 } },
      budget: { wallClockMs: 8000, maxSteps: 20, maxToolJobs: 12, maxObservableTokens: 100 },
      authorizeCommand: async command => { if (command[0] !== process.execPath) throw new Error('denied'); },
      validateProgress: async () => { throw new Error('unused'); } });
    try {
      const result = await loop.run();
      expect(result.status, result.reason).toBe('no_route');
      const observations = state.events().filter(event => event.kind === 'solver.activity' && event.activity === 'tool.result')
        .map(event => event.kind === 'solver.activity' ? event.data.observation as { tool: string; raw: string; outcome: string } : null)
        .filter((value): value is NonNullable<typeof value> => value !== null);
      expect(observations.map(value => value.tool)).toEqual(['job.start', 'job.list', 'job.status', 'job.write', 'job.read', 'job.cancel']);
      expect(JSON.parse(observations[1]!.raw)).toHaveLength(1);
      const read = JSON.parse(observations[4]!.raw) as { bytes: string; encoding: string };
      expect(read.encoding).toBe('base64');
      expect(Buffer.from(read.bytes, 'base64').toString()).toContain('hello');
    } finally { await runtime.dispose(); await close(); }
  });

  it('opens an authorized TCP channel, exchanges one-shot bytes, and closes it', async () => {
    const server = createServer(socket => socket.on('data', bytes => socket.write(bytes)));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TCP test server did not bind');
    const actions: SolverAction[] = [
      { kind: 'tool', tool: 'channel.open', input: { host: '127.0.0.1', port: address.port, timeout_ms: 3000 } },
      { kind: 'tool', tool: 'channel.write', input: { id: 'dynamic', data: { encoding: 'base64', data: Buffer.from('channel-ping').toString('base64') } } },
      { kind: 'tool', tool: 'channel.read', input: { id: 'dynamic', cursor: 0, max_bytes: 4096 } },
      { kind: 'tool', tool: 'channel.close', input: { id: 'dynamic' } },
      { kind: 'stop', reason: 'channel exchange completed' }
    ];
    expect(SolverActionSchema.safeParse(actions[0]).success).toBe(true);
    const driver: SolverDriver = { async decide(request) {
      if (request.observation?.tool === 'channel.open') {
        const channel = JSON.parse(request.observation.raw) as { id: string };
        for (const action of actions) if (action.kind === 'tool' && 'id' in action.input && action.input.id === 'dynamic') action.input.id = channel.id;
      }
      if (request.observation?.tool === 'channel.write') await pause(25);
      return { action: actions.shift()!, usage };
    } };
    const prepared = await setup('t1-script-error', driver, { authorizeTcpEndpoint: endpoint => {
      if (endpoint.host !== '127.0.0.1' || endpoint.port !== address.port) throw new Error('outside test challenge scope');
    } });
    try {
      const result = await prepared.loop.run();
      expect(result.status, result.reason).toBe('no_route');
      const read = [...prepared.state.events()].reverse().find(event => event.kind === 'solver.activity' && event.activity === 'tool.result' && event.data.tool === 'channel.read');
      const observation = read?.kind === 'solver.activity' ? read.data.observation as { raw: string } : undefined;
      expect(Buffer.from((JSON.parse(observation!.raw) as { bytes: string }).bytes, 'base64').toString()).toBe('channel-ping');
    } finally {
      await prepared.runtime.dispose(); await prepared.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('starts a scoped TCP session through job.start and exchanges raw bytes', async () => {
    const server = createServer(socket => socket.on('data', bytes => socket.write(bytes)));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TCP test server did not bind');
    const actions: SolverAction[] = [
      { kind: 'tool', tool: 'job.start', input: { mode: 'tcp_session', endpoint: { host: '127.0.0.1', port: address.port }, timeout_ms: 3000 } },
      { kind: 'tool', tool: 'job.write', input: { id: 'dynamic', data: { encoding: 'bytes', data: [...Buffer.from('session-ping')] } } },
      { kind: 'tool', tool: 'job.read', input: { id: 'dynamic', cursor: 0, max_bytes: 4096 } },
      { kind: 'tool', tool: 'job.cancel', input: { id: 'dynamic' } },
      { kind: 'stop', reason: 'TCP session exchange completed' }
    ];
    const driver: SolverDriver = { async decide(request) {
      if (request.observation?.tool === 'job.start') {
        const job = JSON.parse(request.observation.raw) as { id: string };
        for (const action of actions) if (action.kind === 'tool' && 'id' in action.input && action.input.id === 'dynamic') action.input.id = job.id;
      }
      if (request.observation?.tool === 'job.write') await pause(25);
      return { action: actions.shift()!, usage };
    } };
    const prepared = await setup('t1-script-error', driver, { authorizeTcpEndpoint: endpoint => {
      if (endpoint.host !== '127.0.0.1' || endpoint.port !== address.port) throw new Error('outside test challenge scope');
    } });
    try {
      const result = await prepared.loop.run();
      expect(result.status).toBe('no_route');
      const read = [...prepared.state.events()].reverse().find(event => event.kind === 'solver.activity' && event.activity === 'tool.result' && event.data.tool === 'job.read');
      const observation = read?.kind === 'solver.activity' ? read.data.observation as { raw: string } : undefined;
      expect(Buffer.from((JSON.parse(observation!.raw) as { bytes: string }).bytes, 'base64').toString()).toBe('session-ping');
    } finally {
      await prepared.runtime.dispose(); await prepared.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('records a channel endpoint denied by the host before opening a socket', async () => {
    let denied = false;
    const scripted: SolverDriver = { async decide() {
      if (denied) return { action: { kind: 'stop', reason: 'scope_denied observed; change route' }, usage };
      denied = true;
      return { action: { kind: 'tool', tool: 'channel.open', input: { host: '127.0.0.1', port: 9, timeout_ms: 500 } }, usage };
    } };
    const prepared = await setup('t1-script-error', scripted, { authorizeTcpEndpoint: async () => { throw new Error('outside challenge origin'); } });
    try {
      const result = await prepared.loop.run();
      expect(result.status).toBe('no_route');
      expect(result.reason).toContain('scope_denied');
      expect(prepared.state.events().some(event => event.kind === 'solver.activity' && event.activity === 'tool.result' &&
        event.data.tool === 'channel.open' && (event.data.observation as { failure_code?: string }).failure_code === 'scope_denied')).toBe(true);
    } finally { await prepared.runtime.dispose(); await prepared.close(); }
  });

  it('returns a foreign-lease resource observation instead of ending the run', async () => {
    let denied = false;
    const scripted: SolverDriver = { async decide() {
      if (denied) return { action: { kind: 'stop', reason: 'blocked_data observed; change route' }, usage };
      denied = true;
      return { action: { kind: 'tool', tool: 'job.status', input: { id: 'job_from_another_lease' } }, usage };
    } };
    const prepared = await setup('t1-script-error', scripted);
    try {
      const result = await prepared.loop.run();
      expect(result.status).toBe('no_route');
      expect(result.reason).toContain('blocked_data');
    } finally { await prepared.runtime.dispose(); await prepared.close(); }
  });
});
