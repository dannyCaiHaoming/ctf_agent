// Oracle-first completion admission (no Verifier result). Synthetic data only; the local HTTP server is a test double.
import {afterAll,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {ControlService} from '../../apps/launcher/src/control-service.js';
const services:ControlService[]=[];const servers:ReturnType<typeof createServer>[]=[];
afterAll(async()=>{await Promise.all(services.map(s=>s.stopAll('test end')));await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));});
const FLAG='flag{synthetic}',FLAG2='flag{synthetic-2}';
async function fixture(judge?:any){
 const root=await mkdtemp(join(tmpdir(),'vc-'));const materialsDir=join(root,'X/materials');await mkdir(materialsDir,{recursive:true});
 const server=createServer((q,r)=>{r.writeHead(200,{'content-type':'text/plain'});r.end('page '+(q.url==='/two'?FLAG2:FLAG)+' end');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));servers.push(server);const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const client={session:{get:async({sessionID}:any)=>({data:{id:sessionID,parentID:'root',agent:sessionID}}),children:async()=>({data:[]}),messages:async()=>({data:[]}),abort:async()=>({data:true})}};
 const s=new ControlService({...({completionJudges:judge?{X:judge}:undefined} as any),runId:'vc',client:client as never,budget:{maxModelCalls:100,maxObservableTokens:100000},expiresAt:Date.now()+60000,workdir:join(root,'opencode'),skillRoot:join(root,'skills'),challenges:[{id:'X',title:null,target:{protocol:'http',url:origin},reachability:null,materials:[],materialsDir}]} as any);
 services.push(s);s.bindRoot('root');let n=0;
 const exec=(sid:string,tool:string,args:object={})=>s.handle(sid,'tool.execute',{tool,args,callID:'p'+(++n)}) as Promise<any>;
 async function bind(sid:string,role:string){await exec('root','challenge.assign',{role,challenge:'X'});const callID='t'+(++n);await s.handle('root','tool.before',{tool:'task',callID,args:{subagent_type:role,background:true}});await s.handle('root','tool.after',{tool:'task',callID,metadata:{sessionId:sid},output:'running'});await s.handle(sid,'chat.message',{agent:role});}
 await bind('domain-solver','domain-solver');await bind('engineer','engineer');
 const publishFile=async(sid:string,path:string,text:string)=>{await exec(sid,'workspace.write',{path,content:text});return exec(sid,'artifact.publish',{source:'file',path});};
 let k=0;
 // Candidate fixed from a file publication (as Engineers do); provenance is decided by host captures, not by the file.
 const candidate=async(text:string)=>{const c=await publishFile('engineer','work/cand'+(++k)+'.bin',text);const sc=await publishFile('engineer','work/s'+k+'.cjs',"process.stdout.write('x')");
  const p=await exec('engineer','package.publish',{candidate:{ref:c.ref,start:0,end:Buffer.byteLength(text)},files:[{kind:'artifact',ref:sc.ref,path:'solve.cjs',purpose:'script'}],argv:[process.execPath,'solve.cjs'],extraction:'whole file',premises:['synthetic']});return p.version as string;};
 const http=async(path='/')=>exec('domain-solver','http.request',{url:origin+path});
 const ask=(version:string,extra:object={})=>exec('root','completion.request',{challenge:'X',version,...extra});
 return {root,s,exec,candidate,http,ask,origin};
}
const okJudge=(seen:Buffer[]=[],reply:any={status:'accepted',completed:true})=>({id:'probe.example.test',timeoutMs:1000,limits:{attempts:{kind:'unlimited' as const}},submit:async(i:any)=>{seen.push(Buffer.from(i.bytes));return {intent:i.intent,challenge:i.challenge,...reply};}});
describe('oracle-first completion admission',()=>{
 it('admits a candidate found in a host HTTP capture without a result; audit has resource, not bytes',async()=>{
  const seen:Buffer[]=[];const f=await fixture(okJudge(seen));const h=await f.http();const v=await f.candidate(FLAG);
  const r=await f.ask(v);expect(r.state).toBe('confirmed');expect(r.solved).toBe(true);expect(r.admission).toBe('oracle_first');expect(r.result).toBeUndefined();expect(r.captureResources).toEqual([h.resource]);expect(seen).toEqual([Buffer.from(FLAG)]);
  const disk=JSON.parse(await readFile(join(f.root,'state/completion',r.intent+'.json'),'utf8'));expect(disk.admission).toBe('oracle_first');expect(JSON.stringify(disk.captureResources)).not.toContain('flag{');
 });
 const refuse=async(f:any,version:string,why:string)=>{await expect(f.ask(version)).rejects.toThrow(/^(?:.*)verification required: .*/);await expect(f.ask(version)).rejects.toThrow(why);};
 it('refuses without a judge',async()=>{const f=await fixture();await f.http();await refuse(f,await f.candidate(FLAG),'no judge');});
 it('refuses limited attempts',async()=>{const seen:Buffer[]=[];const f=await fixture({...okJudge(seen),limits:{attempts:{kind:'limited',max:5}}});await f.http();await refuse(f,await f.candidate(FLAG),'not unlimited');expect(seen).toHaveLength(0);});
 it('refuses unknown limits',async()=>{const f=await fixture({...okJudge(),limits:{attempts:{kind:'unknown'}}});await f.http();await refuse(f,await f.candidate(FLAG),'not unlimited');});
 it('refuses missing limits',async()=>{const f=await fixture({...okJudge(),limits:undefined});await f.http();await refuse(f,await f.candidate(FLAG),'not unlimited');});
 it('refuses cooldown, notBefore and blockedReason',async()=>{for(const extra of [{cooldownMs:1000},{notBefore:1},{blockedReason:'closed'}]){const f=await fixture({...okJudge(),limits:{attempts:{kind:'unlimited'},...extra}});await f.http();await refuse(f,await f.candidate(FLAG),'cooldown or block');}});
 it('refuses after a confirmed wrong_answer, including for a new candidate',async()=>{
  const seen:Buffer[]=[];const f=await fixture(okJudge(seen,{status:'rejected',completed:false,rejection:'wrong_answer'}));await f.http();await f.http('/two');
  const first=await f.ask(await f.candidate(FLAG));expect(first.rejection).toBe('wrong_answer');expect(first.admission).toBe('oracle_first');
  await refuse(f,await f.candidate(FLAG2),'prior wrong_answer');expect(seen).toHaveLength(1);
 });
 it('refuses when the candidate only exists in a workspace file',async()=>{const f=await fixture(okJudge());await f.http('/two');await refuse(f,await f.candidate(FLAG),'not found in any host http capture');});
 it('refuses when the candidate only exists in job output',async()=>{const f=await fixture(okJudge());await f.http('/two');const j=await f.exec('domain-solver','job.run',{argv:[process.execPath,'-e',`process.stdout.write('${FLAG}')`],timeout_ms:5000});expect(j.job).toBeTruthy();await refuse(f,await f.candidate(FLAG),'not found in any host http capture');});
 it('refuses when there is no capture at all',async()=>{const f=await fixture(okJudge());await refuse(f,await f.candidate(FLAG),'not found in any host http capture');});
 it('lists every failing condition in one reason',async()=>{const f=await fixture({...okJudge(),limits:{attempts:{kind:'limited',max:1}}});await expect(f.ask(await f.candidate(FLAG))).rejects.toThrow(/verification required: .*not unlimited.*not found in any host http capture/);});
 it('refused oracle-first never reaches the judge and leaves no record',async()=>{const seen:Buffer[]=[];const f=await fixture(okJudge(seen));await expect(f.ask(await f.candidate(FLAG))).rejects.toThrow('verification required');expect(seen).toHaveLength(0);expect(f.s.completionSnapshot()).toHaveLength(0);});
 it('a request with result still takes the verification path (unknown result refused, no oracle-first fallback)',async()=>{
  const seen:Buffer[]=[];const f=await fixture(okJudge(seen));await f.http();const v=await f.candidate(FLAG);
  await expect(f.ask(v,{result:'missing'})).rejects.toThrow();expect(seen).toHaveLength(0);
 });
 it('unknown pause and pending still apply on the oracle-first path',async()=>{
  let release!:()=>void;const hold=new Promise<void>(r=>release=r);let calls=0;
  const f=await fixture({...okJudge(),submit:async()=>{calls++;await hold;throw new Error('lost');}});await f.http();await f.http('/two');const a=await f.candidate(FLAG),b=await f.candidate(FLAG2);
  const one=f.ask(a);await new Promise(r=>setTimeout(r,20));await expect(f.ask(b)).rejects.toThrow('pending same challenge');release();expect((await one).state).toBe('unknown');
  await expect(f.ask(b)).rejects.toThrow('unknown same challenge');expect(calls).toBe(1);
 });
 it('dedups an already accepted candidate on the oracle-first path',async()=>{const seen:Buffer[]=[];const f=await fixture(okJudge(seen));await f.http();const v=await f.candidate(FLAG);const r1=await f.ask(v);const r2=await f.ask(v);expect(r2.intent).toBe(r1.intent);expect(seen).toHaveLength(1);});
});
