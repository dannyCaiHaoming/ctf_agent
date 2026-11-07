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
      body: JSON.stringify({ sessionID: 'session-1', operation: 'tool.execute', input: { tool: 'workspace.read', args: { path: 'x' }, callID: 'call-from-hook', messageID: 'message-1' } })
    }));
  });

  it('exposes every recon trace selector the host store accepts', async () => {
    const { createCtfAgentHooks } = await import('../../apps/opencode-plugin/src/index.js');
    const hooks = createCtfAgentHooks({ controlUrl: 'http://127.0.0.1:43210/control',
      controlToken: 'bridge-test-token-that-is-long-enough-123', tools: ['recon.read'] });
    const args = Object.keys((hooks.tool?.['ctf_recon_read'] as { args: Record<string, unknown> }).args).sort();
    expect(args).toEqual(['after_id', 'cursor', 'end_sequence', 'ids', 'kind', 'limit', 'start_sequence', 'step_id']);
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
it('forwards complete native tool errors and outputs while excluding managed result bodies',async()=>{
 const {createCtfAgentHooks}=await import('../../apps/opencode-plugin/src/index.js');
 const requests:Array<{sessionID:string;operation:string;input:any}>=[];const mocked=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
  requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({result:{}}),{status:200});
 });
 const part=(tool:string,state:any)=>({type:'tool',sessionID:'root',messageID:'message',callID:'call-'+requests.length,tool,state});
 try {
  const h=createCtfAgentHooks({controlUrl:'http://127.0.0.1:12345',controlToken:'x'.repeat(40),tools:[]});
  const output='completed-'+'o'.repeat(13_000),error='failed-'+'e'.repeat(13_000);
  await h.event!({event:{type:'message.part.updated',properties:{part:part('workspace.read',{status:'completed',output})}}} as never);
  expect((requests.at(-1)!.input.part.state as any).output).toBe(output);
  await h.event!({event:{type:'message.part.updated',properties:{part:part('workspace.read',{status:'error',error})}}} as never);
  expect((requests.at(-1)!.input.part.state as any).error).toBe(error);
  await h.event!({event:{type:'message.part.updated',properties:{part:part('ctf_workspace_read',{status:'completed',output})}}} as never);
  expect((requests.at(-1)!.input.part.state as any)).not.toHaveProperty('output');
  await h.event!({event:{type:'message.part.updated',properties:{part:part('bash',{status:'running',input:{command:'echo synthetic'},metadata:{secret:'x'}})}}} as never);
  expect((requests.at(-1)!.input.part.state as any)).toEqual({status:'running',input:{command:'echo synthetic'}});
  await h.event!({event:{type:'message.part.updated',properties:{part:part('bash',{status:'running'})}}} as never);
  expect((requests.at(-1)!.input.part.state as any)).not.toHaveProperty('input');
  await h.event!({event:{type:'message.part.updated',properties:{part:part('task',{status:'error',error})}}} as never);
  expect(requests.slice(-2).map(request=>request.operation)).toEqual(['process.event','task.event']);
  expect((requests.at(-2)!.input.part.state as any).error).toBe(error);
  expect(requests.at(-1)!.input).toEqual({callID:'call-5',state:'error',error});
 }finally{mocked.mockRestore();}
});
it('admission without a user or prepared snapshot still reaches authenticated control',async()=>{
 const {createCtfAgentHooks}=await import('../../apps/opencode-plugin/src/index.js');
 const requests:any[]=[];const mocked=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({result:{maxOutputTokens:100}}),{status:200});});
 try {const h=createCtfAgentHooks({controlUrl:'http://127.0.0.1:12345',controlToken:'x'.repeat(40),tools:[]});await h['chat.params']!({sessionID:'root',model:{providerID:'stub',id:'scripted'}} as never,{} as never);expect(requests[0].input.requestMessageIDs).toEqual([]);}finally{mocked.mockRestore();}
});

it.each(['completed','promotion','running','missing'] as const)('native %s task reply reaches real host classification without rewriting envelope or identity',async(mode)=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {ControlService}=await import('../../apps/launcher/src/control-service.js');
 const {createCtfAgentHooks}=await import('../../apps/opencode-plugin/src/index.js');
 const dir=await mkdtemp(join(tmpdir(),'c-native-contract-'));
 const c=new ControlService({client:{session:{get:async()=>({data:{parentID:'root',agent:'intake'}}),messages:async({sessionID}:any)=>({data:sessionID==='root'?[{info:{id:'parent',role:'assistant'},parts:[{type:'tool',tool:'task',callID:'call',state:{metadata:{sessionId:'child'}}}]}]:[
  {info:{id:'source',sessionID:'child',role:'user'}},
  {info:{id:'step',sessionID:'child',role:'assistant',parentID:'source',finish:'tool-calls',time:{created:1,completed:9}},parts:[{type:'tool',tool:'read',callID:'read',state:{status:'completed',input:{},output:'public',time:{start:2,end:8}}}]},
  {info:{id:'terminal',sessionID:'child',role:'assistant',parentID:'source',finish:'stop',time:{created:10,completed:11}},parts:[{type:'text',text:'report'}]},
 ]}),children:async()=>({data:[]}),abort:async()=>({data:true})}} as never,budget:{maxModelCalls:10,maxObservableTokens:1000},expiresAt:Date.now()+60000,workdir:dir,skillRoot:dir,challenges:[]});
 c.bindRoot('root');
 const mocked=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
  const b=JSON.parse(String(init?.body));return new Response(JSON.stringify({result:await c.handle(b.sessionID,b.operation,b.input)}),{status:200});
 });
 try {
  const h=createCtfAgentHooks({controlUrl:'http://127.0.0.1:12345',controlToken:'x'.repeat(40),tools:[]});
  await h['tool.execute.before']!({sessionID:'root',tool:'task',callID:'call'},{args:{subagent_type:'intake',background:false}});
  await c.handle('child','chat.message',{agent:'intake',messageID:'source'});
  const metadata={parentSessionId:'root',sessionId:'child',...(mode==='promotion'?{background:true,jobId:'child'}:{})};
  const envelope=mode==='missing'?'unrecognized native reply':`<task id="child" state="${mode==='completed'?'completed':'running'}">\n<task_result>native payload</task_result>\n</task>`;
  const after={title:'native',metadata,output:envelope};
  await h['tool.execute.after']!({sessionID:'root',tool:'task',callID:'call',args:{}},after);
  expect(after.metadata).toBe(metadata);expect(after.output.startsWith(envelope+'\n')).toBe(true);
  expect(after.output).toContain(`"completeness":"${mode==='completed'?'complete':'unknown'}"`);
  const facts=c.audit.filter(a=>a.op==='sync.result').map(a=>(a.detail as any).facts);
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({userMessageID:'source',assistantMessageID:mode==='completed'?'terminal':null,completeness:mode==='completed'?'complete':'unknown'});
 } finally {mocked.mockRestore();await c.stopAll('cleanup');await rm(dir,{recursive:true,force:true});}
});

describe('Recon append-only context wiring (design §4)',()=>{
 type Call={sessionID:string;operation:string;input:any};
 // Scripted control service: per-session projection versions, optional failure, delivery log.
 function harness(){
  const calls:Call[]=[],versions=new Map<string,number>([['A',1],['B',1]]),failing=new Set<string>();
  const mocked=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
   const b=JSON.parse(String(init?.body)) as Call;calls.push(b);
   const reply=(result:unknown)=>new Response(JSON.stringify({result}),{status:200});
   if(b.operation==='context.prepare'){
    if(failing.has(b.sessionID))return new Response(JSON.stringify({error:'denied: context projection unavailable'}),{status:403});
    const version=`${b.sessionID}-v${versions.get(b.sessionID)}`;
    if(b.input.visibleVersion===version)return reply({version,unchanged:true});
    return reply({version,text:`[CTF investigation context]\n${JSON.stringify({session:b.sessionID,version,mode:b.input.visibleVersion?'delta':'full'})}`});
   }
   if(b.operation==='model.call')return failing.has('model:'+b.sessionID)?new Response(JSON.stringify({error:'denied: context projection unavailable'}),{status:403}):reply({maxOutputTokens:100});
   return reply({});
  });
  return {calls,versions,failing,mocked};
 }
 const hooks=async()=>{const {createCtfAgentHooks}=await import('../../apps/opencode-plugin/src/index.js');return createCtfAgentHooks({controlUrl:'http://127.0.0.1:12345',controlToken:'x'.repeat(40),tools:['recon.note','recon.read']});};
 const message=async(h:any,sessionID:string,id:string)=>{const output:any={message:{id,sessionID},parts:[{id:'prt_user',type:'text',text:'dispatch'}]};await h['chat.message']({sessionID,agent:'recon',messageID:id},output);return output;};
 const after=async(h:any,sessionID:string,callID:string)=>{const output={title:'t',output:'native result',metadata:{m:1}};await h['tool.execute.after']({sessionID,tool:'ctf_workspace_read',callID,args:{}},output);return output;};
 const params=(h:any,sessionID:string,id:string)=>h['chat.params']({sessionID,agent:'recon',message:{id},model:{providerID:'stub',id:'scripted'}},{});
 const contextParts=(output:any)=>output.parts.filter((p:any)=>p.type==='text'&&p.text.startsWith('[CTF investigation context]'));

 it('messages.transform never adds, removes or rewrites messages and does not prepare context',async()=>{
  const {calls,mocked}=harness();
  try{
   const h=await hooks();
   const messages=[{info:{id:'u1',sessionID:'A',role:'user'},parts:[{id:'p1',type:'text',text:'task'},{id:'p2',type:'text',synthetic:true,text:'[CTF investigation context]\n{"version":"old"}'}]},
    {info:{id:'a1',sessionID:'A',role:'assistant'},parts:[{id:'p3',type:'tool',callID:'c1',state:{status:'completed',output:'x'}}]},
    {info:{id:'u2',sessionID:'A',role:'user'},parts:[{id:'p4',type:'text',text:'next'}]}];
   const before=structuredClone(messages),output={messages};
   await h['experimental.chat.messages.transform']!({},output as never);
   expect(output.messages).toBe(messages);expect(messages).toEqual(before);
   expect(calls.filter(c=>c.operation==='context.prepare')).toHaveLength(0);
  }finally{mocked.mockRestore();}
 });

 it('appends on chat.message and tool.execute.after only, deduplicating by sessionID + version',async()=>{
  const {calls,versions,mocked}=harness();
  try{
   const h=await hooks();
   const first=await message(h,'A','u1');
   expect(first.parts[0]).toEqual({id:'prt_user',type:'text',text:'dispatch'});
   expect(contextParts(first)).toHaveLength(1);expect(contextParts(first)[0]).toMatchObject({synthetic:true,sessionID:'A',messageID:'u1'});
   const same=await after(h,'A','c1');expect(same.output).toBe('native result');expect(same.metadata).toEqual({m:1});
   versions.set('A',2);
   const changed=await after(h,'A','c2');
   expect(changed.output.startsWith('native result\n[CTF investigation context]\n')).toBe(true);expect(changed.output).toContain('A-v2');
   expect(calls.filter(c=>c.operation==='context.prepare').map(c=>[c.input.placement,c.input.visibleVersion,c.input.callID])).toEqual([['chat.message',undefined,undefined],['tool.execute.after','A-v1','c1'],['tool.execute.after','A-v1','c2']]);
   const resumed=await message(h,'A','u2');expect(contextParts(resumed)).toHaveLength(0);
  }finally{mocked.mockRestore();}
 });

 it('isolates visible versions per session',async()=>{
  const {calls,mocked}=harness();
  try{
   const h=await hooks();
   const [a,b]=await Promise.all([message(h,'A','ua'),message(h,'B','ub')]);
   expect(contextParts(a)[0].text).toContain('"session":"A"');expect(contextParts(b)[0].text).toContain('"session":"B"');
   await after(h,'B','cb');
   expect(calls.filter(c=>c.operation==='context.prepare'&&c.sessionID==='B').at(-1)!.input.visibleVersion).toBe('B-v1');
   await Promise.all([params(h,'A','ua'),params(h,'B','ub')]);
   const deliveries=Object.fromEntries(calls.filter(c=>c.operation==='model.call').map(c=>[c.sessionID,c.input.contextDeliveries]));
   expect(deliveries).toEqual({A:[{version:'A-v1',placement:'chat.message',messageID:'ua'}],B:[{version:'B-v1',placement:'chat.message',messageID:'ub'}]});
  }finally{mocked.mockRestore();}
 });

 it('re-presents full state after compaction and resumes after a cancelled request',async()=>{
  const {calls,versions,failing,mocked}=harness();
  try{
   const h=await hooks();
   await message(h,'A','u1');await params(h,'A','u1');
   const compacting={context:[] as string[]};
   await h['experimental.session.compacting']!({sessionID:'A'},compacting);
   expect(compacting.context).toHaveLength(1);expect(compacting.context[0]).toContain('"mode":"full"');
   expect(calls.at(-1)).toMatchObject({operation:'context.prepare',input:{placement:'compacting'}});expect(calls.at(-1)!.input.visibleVersion).toBeUndefined();
   await h.event!({event:{type:'session.compacted',properties:{sessionID:'A'}}} as never);
   const post=await message(h,'A','u2');expect(contextParts(post)).toHaveLength(1);expect(contextParts(post)[0].text).toContain('"mode":"full"');
   // A cancelled/denied request keeps the appended delivery pending until a request actually goes out.
   failing.add('model:A');await expect(params(h,'A','u2')).rejects.toThrow('denied');failing.delete('model:A');
   versions.set('A',2);const resumed=await message(h,'A','u3');expect(contextParts(resumed)).toHaveLength(1);
   await params(h,'A','u3');
   expect(calls.filter(c=>c.operation==='model.call').at(-1)!.input.contextDeliveries).toEqual([{version:'A-v1',placement:'chat.message',messageID:'u2'},{version:'A-v2',placement:'chat.message',messageID:'u3'}]);
   await params(h,'A','u3');expect(calls.filter(c=>c.operation==='model.call').at(-1)!.input.contextDeliveries).toEqual([]);
  }finally{mocked.mockRestore();}
 });

 it('fails closed: projection failure throws from the hook and is never silently skipped',async()=>{
  const {failing,mocked}=harness();
  try{
   const h=await hooks();failing.add('A');
   await expect(message(h,'A','u1')).rejects.toThrow('context projection');
   await expect(after(h,'A','c1')).rejects.toThrow('context projection');
   await expect(h['experimental.session.compacting']!({sessionID:'A'},{context:[]})).rejects.toThrow('context projection');
  }finally{mocked.mockRestore();}
 });
});

it('renders decision facts as one numbers-only line after the completeness facts, without duplicating them in the JSON',async()=>{
 const {createCtfAgentHooks}=await import('../../apps/opencode-plugin/src/index.js');
 const fact={role:'domain-solver',completeness:'complete',reason:'stop',finish:'stop',textChars:4,source:'associated'};
 const decisionFacts={remainingMs:760000,turnMs:785000,dispatches:{'domain-solver':4,'recovery-critic':1},packaged:false};
 const mocked=vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  return new Response(JSON.stringify({result:body.operation==='chat.message'?{completionDisplays:[{ref:'ref',...fact,decisionFacts}]}:{syncDisplay:{callID:'call',...fact,decisionFacts}}}),{status:200});
 });
 try{
  const h=createCtfAgentHooks({controlUrl:'http://127.0.0.1:12345',controlToken:'x'.repeat(40),tools:[]});
  const line='decision facts: remaining=12m40s, turn=13m05s, dispatches=domain-solver×4, recovery-critic×1, packaged=no';
  const output:any={message:{id:'notice'},parts:[]};
  await h['chat.message']!({sessionID:'root',messageID:'notice'} as never,output);
  const text:string=output.parts[0].text;
  expect(text).toContain(JSON.stringify({ref:'ref',...fact}));expect(text.endsWith('\n'+line)).toBe(true);expect(text).not.toContain('remainingMs');
  const after={title:'native',output:'native',metadata:{}};
  await h['tool.execute.after']!({sessionID:'root',tool:'task',callID:'call',args:{}},after);
  expect(after.output).toContain(JSON.stringify({callID:'call',...fact}));expect(after.output.endsWith('\n'+line)).toBe(true);
 }finally{mocked.mockRestore();}
});
