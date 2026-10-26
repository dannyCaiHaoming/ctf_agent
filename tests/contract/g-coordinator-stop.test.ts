import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { ControlService } from '../../apps/launcher/src/control-service.js';
import { startControlRpc } from '../../apps/launcher/src/control-rpc.js';
import { createCtfAgentHooks } from '../../apps/opencode-plugin/src/index.js';
const clean: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of clean.splice(0).reverse()) await f(); });
async function fixture(target?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'gdec-coordinator-stop-')); clean.push(() => rm(dir, { recursive: true, force: true }));
  const materialsDir = join(dir, 'X/materials'); await mkdir(materialsDir, { recursive: true });
  const abort = vi.fn(async (_: unknown) => ({ data: true }));
  const identities: Record<string, { parentID: string; agent: string }> = {};
  const c = new ControlService({ runId: dir, client: { session: { get: async ({ sessionID }: { sessionID: string }) => ({ data: identities[sessionID] }), messages: async ({ sessionID }: { sessionID: string }) => ({ data: sessionID === 'root' ? [{ info: { id: 'dispatches', sessionID: 'root', role: 'user' }, parts: c.audit.filter(r => r.op === 'dispatch.register').map(r => { const callID = (r.detail as { callID: string }).callID; return { type: 'tool', tool: 'task', callID, state: { metadata: { sessionId: callID.slice(9) } } }; }) }] : [] }), children: async () => ({ data: [] }), abort } } as never,
    budget: { maxModelCalls: 100, maxObservableTokens: 1000 }, expiresAt: Date.now()+60000, workdir: join(dir,'opencode'), skillRoot: dir,
    challenges: [{ id: 'X', title: null, materialsDir, materials: [], reachability: null, target: target ? { protocol: 'http', url: target, host: '127.0.0.1', port: Number(new URL(target).port) } : null }] });
  c.bindRoot('root'); clean.push(() => c.stopAll('cleanup'));
  async function bind(id: string, role = 'recon') {
    identities[id] = { parentID: 'root', agent: role };
    let version:string|undefined;
    if(role==='verifier'){if(![...c.bindings.values()].some(b=>b.role==='engineer'))await bind('d-engineer','engineer');
      const engineer=[...c.bindings.values()].find(b=>b.role==='engineer')!.sessionID;
      await c.handle(engineer,'tool.execute',{tool:'workspace.write',callID:'d-input-write',args:{path:'work/d-input',content:'x'}});
      const a=await c.handle(engineer,'tool.execute',{tool:'artifact.publish',callID:'d-input-publish',args:{source:'file',path:'work/d-input'}}) as {ref:string};
      const p=await c.handle(engineer,'tool.execute',{tool:'package.publish',callID:'d-package-publish',args:{candidate:{ref:a.ref,start:0,end:1},files:[],extraction:'all',premises:[]}}) as {version:string};
      version=p.version;
    }
    if (['recon','engineer','domain-solver','verifier'].includes(role)) await c.handle('root','tool.execute',{tool:'challenge.assign',args:{role,challenge:'X',...(version?{version}:{})}});
    await c.handle('root','tool.before',{tool:'task',callID:`dispatch-${id}`,args:{subagent_type:role,background:role==='engineer'||role==='verifier'}});
    if(role==='engineer'||role==='verifier')await c.handle('root','tool.after',{tool:'task',callID:`dispatch-${id}`,metadata:{sessionId:id},output:'running'});
    await c.handle(id,'chat.message',{agent:role});
  }
  await bind('a'); await bind('b'); return { c, bind, abort, dir };
}
async function exec(c: ControlService, id: string, tool: string, args: object, callID = `call-${Math.random()}`) {
  await c.handle(id,'tool.before',{tool:`ctf_${tool.replaceAll('.','_')}`,args,callID});
  return c.handle(id,'tool.execute',{tool,args,callID});
}
it('Coordinator product plugin stops only owned child, idempotently through real RPC', async () => {
  const { c, abort } = await fixture(); const rpc = await startControlRpc((id,op,input,signal)=>c.handle(id,op,input,signal)); clean.push(rpc.close);
  const hooks = createCtfAgentHooks({ controlUrl: rpc.url, controlToken: rpc.token, tools: ['task.stop'] });
  async function stop() { const args={task_id:'a'}; await hooks['tool.execute.before']!({sessionID:'root',tool:'ctf_task_stop',callID:`stop-${Math.random()}`},{args}); return hooks.tool!.ctf_task_stop!.execute(args as never,{sessionID:'root',abort:new AbortController().signal} as never); }
  const results=await Promise.all([stop(),stop()]); expect(results.map(r=>JSON.parse((r as {output:string}).output).state)).toEqual(['stopped','stopped']);
  expect(abort.mock.calls.filter(([p])=>(p as {sessionID:string}).sessionID==='a')).toHaveLength(1);
  expect(c.bindings.get('a')?.state).toBe('revoked'); expect(c.bindings.get('b')?.state).toBe('active');
  await expect(c.handle('a','model.call',{agent:'recon'})).rejects.toThrow('session revoked');
});
it('rejects every other role in before and execute, forged/other parent/run/expired handles', async () => {
  const { c, bind, abort } = await fixture();
  for (const role of ['intake','recon','reference','strategy','domain-solver','engineer','verifier','recovery-critic']) { const id=`role-${role}`; await bind(id,role); for(const op of ['tool.before','tool.execute']) await expect(c.handle(id,op,{tool:op==='tool.before'?'ctf_task_stop':'task.stop',args:{task_id:'a'}})).rejects.toThrow('tool not permitted'); }
  for (const task_id of ['root','no-such-child',null,9]) await expect(exec(c,'root','task.stop',{task_id})).rejects.toThrow('task handle');
  c.bindings.get('a')!.parentID='foreign'; await expect(exec(c,'root','task.stop',{task_id:'a'})).rejects.toThrow('task handle'); c.bindings.get('a')!.parentID='root';
  c.bindings.get('a')!.expiresAt=Date.now()-1; await expect(exec(c,'root','task.stop',{task_id:'a'})).rejects.toThrow('task expired');
  const other=await fixture(); await other.bind('foreign-run'); await expect(exec(c,'root','task.stop',{task_id:'foreign-run'})).rejects.toThrow('task handle'); expect(abort).not.toHaveBeenCalled();
});
it('execute rechecks ownership and expiry after before approval', async () => {
 const {c}=await fixture(); await c.handle('root','tool.before',{tool:'ctf_task_stop',args:{task_id:'a'}}); c.bindings.get('a')!.expiresAt=Date.now()-1;
 await expect(c.handle('root','tool.execute',{tool:'task.stop',args:{task_id:'a'}})).rejects.toThrow('task expired');
});
it('cancels blocked HTTP and delivered process group, retains output, sibling continues', async () => {
 let entered!:()=>void; const ready=new Promise<void>(r=>entered=r); const target=createServer((_q,r)=>{r.writeHead(200);r.write('held');entered();}); await new Promise<void>(r=>target.listen(0,'127.0.0.1',r)); clean.push(()=>new Promise<void>(r=>{target.close(()=>r());target.closeAllConnections();}));
 const url=`http://127.0.0.1:${(target.address() as {port:number}).port}`; const {c,dir}=await fixture(url);
 const argv=[process.execPath,'-e',"const ch=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('fs').writeFileSync('grandchild.pid',String(ch.pid));console.log('retained');setInterval(()=>{},1000)"];
 await exec(c,'a','job.run',{argv,wait_ms:0},'delivered'); const peer=await exec(c,'b','job.run',{argv,wait_ms:0},'peer') as {job:string};
 const pid=async(id:string)=>Number(await readFile(join(dir,'X/work',id,'grandchild.pid'),'utf8')); await vi.waitFor(async()=>{expect(await pid('a')).toBeGreaterThan(0);expect(await pid('b')).toBeGreaterThan(0);}); const a=await pid('a'),b=await pid('b');
 const http=exec(c,'a','http.request',{url,timeout_ms:30000},'http').catch(e=>String(e));await ready;
 expect(await exec(c,'root','task.stop',{task_id:'a'})).toMatchObject({state:'stopped',resources:'settled',sessionAbort:'confirmed'});expect(await http).toContain('cancelled'); expect(()=>process.kill(a,0)).toThrow();expect(()=>process.kill(b,0)).not.toThrow();
 expect(await exec(c,'b','job.read',{job:peer.job,stream:'stdout'})).toMatchObject({state:'running'}); expect(c.resourceSnapshot().find(r=>r.callID==='delivered')).toMatchObject({state:'settled',result:'cancelled'});
 const outputs=await import('node:fs/promises').then(fs=>fs.readdir(join(dir,'state/jobs/a'))); expect(outputs.length).toBe(1);
});
it('completed jobs remain exited when stopped; abort failure and unknown reap never claim stopped', async()=>{
 const {c,abort}=await fixture();await exec(c,'a','job.run',{argv:[process.execPath,'-e','console.log("done")'],wait_ms:1000},'done');
 abort.mockRejectedValueOnce(new Error('fixture abort unavailable'));
 expect(await exec(c,'root','task.stop',{task_id:'a'})).toMatchObject({state:'unknown',resources:'settled',sessionAbort:'unknown'});expect(c.resourceSnapshot().find(r=>r.callID==='done')).toMatchObject({state:'settled',result:'exited'});
 const realKill=process.kill.bind(process);await exec(c,'b','job.run',{argv:['sleep','30'],wait_ms:0},'unknown');const spy=vi.spyOn(process,'kill').mockImplementation((pid,signal)=>pid<0&&signal===0?true:realKill(pid,signal));
 try {expect(await exec(c,'root','task.stop',{task_id:'b'})).toMatchObject({state:'unknown',resources:'unknown'});expect(c.resourceSnapshot().find(r=>r.callID==='unknown')).toMatchObject({state:'unknown',result:'cleanup_unknown'});} finally{spy.mockRestore();}
},10000);
it('stop waits outside global queue, rechecks parent expiry and retains unknown abort without retry', async()=>{
 const {c,abort}=await fixture();let release!:(value:{data:boolean})=>void; abort.mockImplementationOnce(()=>new Promise(r=>release=r));
 const first=exec(c,'root','task.stop',{task_id:'a'});await vi.waitFor(()=>expect(c.bindings.get('a')?.state).toBe('revoked'));
 expect(await c.handle('b','model.call',{agent:'recon'})).toMatchObject({role:'recon'});
 release({data:true});expect(await first).toMatchObject({state:'stopped'});
 await c.handle('root','tool.before',{tool:'ctf_task_stop',args:{task_id:'b'}});c.bindings.get('root')!.expiresAt=Date.now()-1;
 await expect(c.handle('root','tool.execute',{tool:'task.stop',args:{task_id:'b'}})).rejects.toThrow('binding lapsed');expect(c.bindings.get('b')?.state).toBe('active');
});
it('actual completion and stop race settles resource exactly once and repeated stop does not abort twice',async()=>{
 const {c,dir,abort}=await fixture(); const argv=[process.execPath,'-e',"console.log('ready');const fs=require('fs');const t=setInterval(()=>{if(fs.existsSync('finish')){clearInterval(t);process.exit(0)}},5)"];
 await exec(c,'a','job.run',{argv,wait_ms:0},'race');
 const rows=c.resourceSnapshot();const job=rows.find(r=>r.callID==='race')!.job!;
 await vi.waitFor(async()=>expect(await exec(c,'a','job.read',{job,stream:'stdout'})).toMatchObject({data:Buffer.from('ready\n').toString('base64')}));
 const {writeFile}=await import('node:fs/promises');await Promise.all([writeFile(join(dir,'X/work/a/finish'),'done'),exec(c,'root','task.stop',{task_id:'a'})]);
 expect(c.resourceSnapshot().find(r=>r.callID==='race')?.state).toBe('settled');expect(c.audit.filter(r=>r.op==='tool.settled'&&(r.detail as {callID:string})?.callID==='race')).toHaveLength(1);
 await exec(c,'root','task.stop',{task_id:'a'});expect(abort.mock.calls.filter(([p])=>(p as {sessionID:string}).sessionID==='a')).toHaveLength(1);
});
it('tool visibility grants stop exclusively to Coordinator',async()=>{
 const config=JSON.parse(await readFile('product/opencode/opencode.json','utf8'));for(const [role,entry] of Object.entries(config.agent) as Array<[string,{permission?:Record<string,string>}]>) if(entry.permission)expect(entry.permission.ctf_task_stop==='allow').toBe(role==='coordinator');
});
it('an unreturned SDK abort is bounded and cached as unknown, with no blind retry',async()=>{
 const {c,abort}=await fixture();abort.mockImplementationOnce(()=>new Promise(()=>{}));vi.useFakeTimers();
 try{const stopped=exec(c,'root','task.stop',{task_id:'a'});await vi.advanceTimersByTimeAsync(4001);expect(await stopped).toMatchObject({state:'unknown',sessionAbort:'unknown'});expect(await exec(c,'root','task.stop',{task_id:'a'})).toMatchObject({state:'unknown',alreadyStopped:true});expect(abort.mock.calls.filter(([p])=>(p as {sessionID:string}).sessionID==='a')).toHaveLength(1);}finally{vi.useRealTimers();}
});
