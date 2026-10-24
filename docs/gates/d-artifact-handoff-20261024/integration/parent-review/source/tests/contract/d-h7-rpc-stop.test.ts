// Real plugin HTTP boundary + C; SDK is a component fixture, not native runtime evidence.
import {describe,it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ControlService} from '../../apps/launcher/src/control-service.js';
import {startControlRpc} from '../../apps/launcher/src/control-rpc.js';
import {createCtfAgentHooks,managedToolId} from '../../apps/opencode-plugin/src/index.js';

function barrier(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
async function fixture(mode:'drop'|'before'|'after'){
 const root=await mkdtemp(join(tmpdir(),'d-h7-contract-'));const materialsDir=join(root,'X/materials');await mkdir(materialsDir,{recursive:true});
 const service=new ControlService({runId:'h7',client:{session:{get:async({sessionID}:any)=>({data:{id:sessionID,parentID:'root',agent:'domain-solver'}}),children:async()=>({data:[]}),messages:async()=>({data:[]}),abort:async()=>({data:true})}} as never,budget:{maxModelCalls:50,maxObservableTokens:100000},expiresAt:Date.now()+20000,workdir:join(root,'opencode'),skillRoot:join(root,'skills'),challenges:[{id:'X',title:null,target:null,reachability:null,materials:[],materialsDir}]});
 service.bindRoot('root');await service.handle('root','tool.execute',{tool:'challenge.assign',args:{role:'domain-solver',challenge:'X'},callID:'assign'});await service.handle('root','tool.before',{tool:'task',callID:'task',args:{subagent_type:'domain-solver',background:true}});await service.handle('root','tool.after',{tool:'task',callID:'task',metadata:{sessionId:'solver'},output:'running'});await service.handle('solver','chat.message',{agent:'domain-solver'});
 const entered=barrier(),resume=barrier();let publishRequests=0;let publicationReply:any;
 const rpc=await startControlRpc((sid,op,input,signal)=>service.handle(sid,op,input,signal));
 const proxy=createServer((q,r)=>{void(async()=>{const chunks:Buffer[]=[];for await(const c of q)chunks.push(Buffer.from(c));const raw=Buffer.concat(chunks);const body=JSON.parse(raw.toString());const publish=body.operation==='tool.execute'&&body.input.tool==='artifact.publish';if(publish){publishRequests++;if(mode==='before'){entered.release();await resume.promise;}}
  const response=await fetch(rpc.url,{method:'POST',headers:{authorization:`Bearer ${rpc.token}`,'content-type':'application/json'},body:raw});const payload=await response.text();
  if(publish&&mode!=='before'){publicationReply=JSON.parse(payload);entered.release();if(mode==='after')await resume.promise;if(mode==='drop'){r.destroy();return;}}
  r.writeHead(response.status,{'content-type':'application/json'}).end(payload);
 })().catch(()=>{r.destroy();});});await new Promise<void>(r=>proxy.listen(0,'127.0.0.1',r));
 const hooks=createCtfAgentHooks({controlUrl:`http://127.0.0.1:${(proxy.address() as any).port}/control`,controlToken:rpc.token,tools:['workspace.write','artifact.publish','task.stop']});let seq=0;
 async function call(sid:string,name:string,args:any){const id=managedToolId(name);await hooks['tool.execute.before']!({sessionID:sid,tool:id,callID:`c${++seq}`} as never,{args});return hooks.tool![id]!.execute(args,{sessionID:sid,abort:new AbortController().signal} as never);}
 await call('solver','workspace.write',{path:'work/a',content:'fixed-h7-bytes'});
 return {root,service,entered,resume,call,get publishRequests(){return publishRequests;},get publicationReply(){return publicationReply;},close:async()=>{resume.release();await service.stopAll('test end');await new Promise<void>(r=>{proxy.close(()=>r());proxy.closeAllConnections();});await rpc.close();}};
}

describe('H7 real HTTP failure boundary (component regression)',()=>{
 it('R1 committed bytes survive actual socket loss; plugin reports failure and never retries',async()=>{
  const f=await fixture('drop');try{await expect(f.call('solver','artifact.publish',{source:'file',path:'work/a'})).rejects.toThrow('denied: control unavailable');expect(f.publishRequests).toBe(1);const pubs=f.service.publicationSnapshot();expect(pubs).toHaveLength(1);expect(f.publicationReply.result.ref).toBe(pubs[0]!.ref);expect(await readFile(join(f.root,'X',pubs[0]!.path),'utf8')).toBe('fixed-h7-bytes');expect(f.service.resourceSnapshot().every(r=>r.state==='settled')).toBe(true);}finally{await f.close();}
 });
 it('R2 task.stop before request dispatch denies pending publish and yields no usable reference',async()=>{
  const f=await fixture('before');try{const pending=f.call('solver','artifact.publish',{source:'file',path:'work/a'});const rejected=expect(pending).rejects.toThrow('denied: session revoked');await f.entered.promise;const stopped=await f.call('root','task.stop',{task_id:'solver'}) as any;expect(JSON.parse(stopped.output).state).toBe('stopped');f.resume.release();await rejected;expect(f.service.publicationSnapshot()).toHaveLength(0);expect(f.publishRequests).toBe(1);expect(f.service.executionSnapshot()[0]!.delivery).toBe('stop_reply');}finally{await f.close();}
 });
 it('R3 committed reply delayed past task.stop retains fact; execution cannot deliver it',async()=>{
  const f=await fixture('after');try{const pending=f.call('solver','artifact.publish',{source:'file',path:'work/a'});await f.entered.promise;expect(f.service.publicationSnapshot()).toHaveLength(1);const stopped=await f.call('root','task.stop',{task_id:'solver'}) as any;expect(JSON.parse(stopped.output).state).toBe('stopped');f.resume.release();const late=await pending as any;expect(JSON.parse(late.output).ref).toBe(f.service.publicationSnapshot()[0]!.ref);expect(f.service.executionSnapshot()[0]).toMatchObject({state:'cancelled',delivery:'stop_reply',delivered:true});await expect(f.service.handle('solver','tool.before',{tool:'ctf_artifact_publish',callID:'late',args:{}})).rejects.toThrow('session revoked');expect(f.publishRequests).toBe(1);}finally{await f.close();}
 });
});
