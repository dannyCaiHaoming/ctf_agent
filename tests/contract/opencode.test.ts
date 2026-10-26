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
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ result: { accepted: true } }), { status: 200 }));
    const { createCtfAgentHooks } = await import('../../apps/opencode-plugin/src/index.js');
    const hooks = createCtfAgentHooks({ controlUrl: 'http://127.0.0.1:43210/control',
      controlToken: 'bridge-test-token-that-is-long-enough-123', tools: ['workspace.read'] });
    const args = { path: 'x' };
    await hooks['tool.execute.before']!({ sessionID: 'session-1', tool: 'ctf_workspace_read', callID: 'call-from-hook' }, { args });
    await hooks.tool?.['ctf_workspace_read']!.execute(args as never, {
      sessionID: 'session-1', messageID: 'message-1', agent: 'solver', directory: '/tmp', worktree: '/tmp',
      abort: new AbortController().signal, metadata: () => undefined, ask: async () => undefined
    } as never);
    expect(fetchMock).toHaveBeenCalledWith(new URL('http://127.0.0.1:43210/control'), expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer bridge-test-token-that-is-long-enough-123' }),
      body: JSON.stringify({ sessionID: 'session-1', operation: 'tool.execute', input: { tool: 'workspace.read', args: { path: 'x' }, callID: 'call-from-hook' } })
    }));
  });

  it('writes only the host-approved task background and description into native args', async () => {
    const { createCtfAgentHooks } = await import('../../apps/opencode-plugin/src/index.js');
    const hooks = createCtfAgentHooks({ controlUrl: 'http://127.0.0.1:43210/control', controlToken: 'x'.repeat(40), tools: [] });
    for (const background of [true, false]) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: { taskBackground: background, taskDescription: 'trusted ref', prompt: 'old instruction' } }), { status: 200 }));
      const args = { task_id: 'child', prompt: 'current instruction', description: 'current task', command: 'current command' };
      await hooks['tool.execute.before']!({ sessionID: 'root', tool: 'task', callID: 'resume' }, { args });
      expect(args).toEqual({ task_id: 'child', prompt: 'current instruction', description: 'trusted ref', command: 'current command', background });
      vi.restoreAllMocks();
    }
  });

  it('advertises exact workspace virtual-root semantics in managed tool descriptions', async () => {
    const { createCtfAgentHooks } = await import('../../apps/opencode-plugin/src/index.js');
    const hooks = createCtfAgentHooks({ controlUrl: 'http://127.0.0.1:43210/control',
      controlToken: 'bridge-test-token-that-is-long-enough-123',
      tools: ['workspace.list', 'workspace.read', 'workspace.search', 'workspace.write'] });
    const description = (name: string) => (hooks.tool as Record<string, { description: string }>)[
      `ctf_${name.replaceAll('.', '_')}`
    ]!.description;

    expect(description('workspace.list')).toContain('Omit path to list exactly materials/, work/, published/');
    expect(description('workspace.read')).toContain('materials/statement.md');
    expect(description('workspace.read')).toContain('not materials/<challenge-id>/...');
    expect(description('workspace.write')).toContain('only under work/');
    expect(description('workspace.search')).toContain('Omit path to search all roots');
  });

  it('advertises bounded progress reads and structured Critic notes', async () => {
    const { createCtfAgentHooks } = await import('../../apps/opencode-plugin/src/index.js');
    const hooks = createCtfAgentHooks({ controlUrl: 'http://127.0.0.1:43210/control',
      controlToken: 'bridge-test-token-that-is-long-enough-123', tools: ['progress.read', 'progress.note'] });
    const description = (name: string) => (hooks.tool as Record<string, { description: string }>)[
      `ctf_${name.replaceAll('.', '_')}`
    ]!.description;
    expect(description('progress.read')).toContain('sanitized');
    expect(description('progress.note')).toContain('Recovery Critic');
    expect(description('progress.note')).toContain('Coordinator');
  });

  it('rejects a plugin configuration that is not an authenticated loopback control service', async () => {
    const { createCtfAgentHooks } = await import('../../apps/opencode-plugin/src/index.js');
    expect(() => createCtfAgentHooks({ controlUrl: 'http://127.0.0.1:1/control', controlToken: 'a'.repeat(31), tools: [] })).toThrow(/invalid/);
    expect(() => createCtfAgentHooks({ controlUrl: 'http://example.com/control', controlToken: 'a'.repeat(32), tools: [] })).toThrow(/invalid/);
  });

});


it('R2 transform snapshots require matching current user, clear after use/rejection and reject mixed/empty input',async()=>{
 const {createCtfAgentHooks}=await import('../../apps/opencode-plugin/src/index.js');
 const requests:any[]=[];let denied=false;
 const mocked=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));if(denied)throw Error('offline');return new Response(JSON.stringify({result:{maxOutputTokens:100}}),{status:200});});
 try {
 const h=createCtfAgentHooks({controlUrl:'http://127.0.0.1:12345',controlToken:'x'.repeat(40),tools:[]});
 const msg=(id:string,sessionID='root',ignored=false)=>({info:{id,sessionID,role:'user'},parts:[{type:'text',synthetic:true,ignored,text:'Background task completed:'}]});
 const transform=async(messages:any[])=>h['experimental.chat.messages.transform']!({}, {messages} as never);
 const params=async(id:string)=>h['chat.params']!({sessionID:'root',message:{id},model:{providerID:'stub',id:'scripted'}} as never,{} as never);
 await transform([msg('one'),msg('two')]);await params('two');expect(requests.at(-1).input.requestMessageIDs).toEqual(['one','two']);
 await params('two');expect(requests.at(-1).input.requestMessageIDs).toEqual([]);
 const failed=msg('failed');failed.parts[0]!.text='Background task failed:';await transform([failed]);await params('failed');expect(requests.at(-1).input.requestMessageIDs).toEqual(['failed']);
 await transform([msg('one')]);await params('new');expect(requests.at(-1).input.requestMessageIDs).toEqual([]);
 await transform([msg('one')]);await transform([msg('one'),msg('other','other')]);await params('one');expect(requests.at(-1).input.requestMessageIDs).toEqual([]);
 await transform([msg('one')]);await transform([]);await params('one');expect(requests.at(-1).input.requestMessageIDs).toEqual([]);
 await transform([msg('one', 'root',true)]);await params('one');expect(requests.at(-1).input.requestMessageIDs).toEqual([]);
 await transform([msg('one')]);denied=true;await expect(params('one')).rejects.toThrow('denied');denied=false;await params('one');expect(requests.at(-1).input.requestMessageIDs).toEqual([]);
 } finally {mocked.mockRestore();}
});

it('appends complete native TextParts and preserves synchronous output and metadata',async()=>{
 const {createCtfAgentHooks}=await import('../../apps/opencode-plugin/src/index.js');
 const fact={role:'intake',completeness:'incomplete',reason:'length',finish:'length',textChars:0,source:'associated'};
 const mocked=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  return new Response(JSON.stringify({result:body.operation==='chat.message'?{completionDisplays:[{ref:'ref',...fact}]}:{syncDisplay:{callID:'call',...fact}}}),{status:200});
 });
 try {
  const h=createCtfAgentHooks({controlUrl:'http://127.0.0.1:12345',controlToken:'x'.repeat(40),tools:[]});
  const original={type:'text',text:'native notice',synthetic:true};const output:any={message:{id:'notice'},parts:[original]};
  await h['chat.message']!({sessionID:'root',messageID:'notice'} as never,output);
  expect(output.parts[0]).toBe(original);expect(output.parts[1]).toMatchObject({id:expect.stringMatching(/^prt_/),sessionID:'root',messageID:'notice',type:'text',synthetic:true});
  expect(output.parts[1].text).toContain(JSON.stringify({ref:'ref',...fact}));
  const metadata={sessionId:'child',parentSessionId:'root',truncated:false};const after={title:'native',output:'native envelope\n<task_result>PARTIAL</task_result>',metadata};
  await h['tool.execute.after']!({sessionID:'root',tool:'task',callID:'call',args:{}},after);
  expect(after.metadata).toBe(metadata);expect(after.output.startsWith('native envelope\n<task_result>PARTIAL</task_result>\n')).toBe(true);
  expect(after.output).toContain('[CTF host synchronous result facts]');
 }finally{mocked.mockRestore();}
});
it('admission without a user or prepared snapshot still reaches authenticated control',async()=>{
 const {createCtfAgentHooks}=await import('../../apps/opencode-plugin/src/index.js');
 const requests:any[]=[];const mocked=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({result:{maxOutputTokens:100}}),{status:200});});
 try {const h=createCtfAgentHooks({controlUrl:'http://127.0.0.1:12345',controlToken:'x'.repeat(40),tools:[]});await h['chat.params']!({sessionID:'root',model:{providerID:'stub',id:'scripted'}} as never,{} as never);expect(requests[0].input.requestMessageIDs).toEqual([]);}finally{mocked.mockRestore();}
});
