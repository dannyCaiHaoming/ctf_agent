import {CompletionRequests,strictUtf8} from '../../apps/launcher/src/completion-tools.js';
// Candidate-package contract: C integration with real files/jobs; SDK identity only is a deterministic fixture.
import {afterAll,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ControlService} from '../../apps/launcher/src/control-service.js';
const services:ControlService[]=[];
async function evidence(name:string,items:Record<string,Buffer|object>){
 const root=process.env.D_COMPLETION_EVIDENCE_DIR;if(!root)return;const dir=join(root,name);await mkdir(dir,{recursive:true});
 for(const [file,value] of Object.entries(items))await writeFile(join(dir,file),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));
}

afterAll(async()=>{await Promise.all(services.map(s=>s.stopAll('test end')));});
async function fixture(judge?:any){
 const root=await mkdtemp(join(tmpdir(),'d-package-'));const materialsDir=join(root,'X/materials');await mkdir(materialsDir,{recursive:true});await writeFile(join(materialsDir,'input.bin'),Buffer.from([0,255,13,10]));
 const client={session:{get:async({sessionID}:any)=>({data:{id:sessionID,parentID:'root',agent:sessionID==='other'?'engineer':sessionID}}),children:async()=>({data:[]}),messages:async()=>({data:[]}),abort:async()=>({data:true})}};
 const s=new ControlService({...({completionJudges:judge?{X:judge}:undefined} as any),runId:'D-package',client:client as never,budget:{maxModelCalls:100,maxObservableTokens:100000},expiresAt:Date.now()+60000,workdir:join(root,'opencode'),skillRoot:join(root,'skills'),challenges:[{id:'X',title:null,target:null,reachability:null,materials:[{name:'input.bin',sha256:createHash('sha256').update(Buffer.from([0,255,13,10])).digest('hex'),bytes:4}],materialsDir},{id:'Y',title:null,target:null,reachability:null,materials:[],materialsDir:join(root,'Y/materials')}]});services.push(s);s.bindRoot('root');let n=0;
 const exec=(sid:string,tool:string,args:object={})=>s.handle(sid,'tool.execute',{tool,args,callID:'p'+(++n)}) as Promise<any>;
 async function bind(sid:string,role:string,challenge='X',version?:string){await exec('root','challenge.assign',{role,challenge,...(version?{version}:{})});const callID='t'+(++n);await s.handle('root','tool.before',{tool:'task',callID,args:{subagent_type:role,background:true}});await s.handle('root','tool.after',{tool:'task',callID,metadata:{sessionId:sid},output:'running'});await s.handle(sid,'chat.message',{agent:role});}
 await bind('domain-solver','domain-solver');await bind('engineer','engineer');
 const publish=async(sid:string,path:string,bytes:Buffer)=>{await exec(sid,'workspace.write',{path,content:bytes.toString('base64'),encoding:'base64'});return exec(sid,'artifact.publish',{source:'file',path});};
 const source=await publish('domain-solver','work/mixed.bin',Buffer.concat([Buffer.from('log\r\n旗{é}'),Buffer.from([0,255,13,10])]));
 const script=await publish('engineer','work/solve.cjs',Buffer.from("process.stdout.write('candidate')"));
 const args={candidate:{ref:source.ref,start:5,end:14},files:[{kind:'artifact',ref:script.ref,path:'solve.cjs',purpose:'script'},{kind:'material',name:'input.bin',path:'data/input.bin',purpose:'input'},{kind:'artifact',ref:source.ref,path:'evidence/raw.bin',purpose:'evidence'}],argv:[process.execPath,'solve.cjs'],extraction:'Select bytes [5,14); no normalization',premises:['External state unknown']};
 const packages=()=>s.publicationSnapshot().filter(p=>p.source.kind as string==='package');
 return {root,s,exec,bind,publish,source,script,args,packages,read:async(version:string,component='candidate',path?:string)=>exec('engineer','package.read',{version,component,...(path?{path}:{})})};
}

const report=(job:string,judgment='verified')=>({judgment,mode:'recompute',rationale:'Local fixture recomputation under explicit trusted local execution premise',sourceFlow:'Inspect script and fixed input; compare stdout exact bytes to candidate',premises:[{statement:'Trusted stable local execution, no untrusted concurrent writers',status:'assumed'}],issues:[],requirements:{continuousIntegrity:false,declaredDependenciesOnly:false},evidence:[{kind:'job',job,stream:'stdout',necessary:true,context:'Whole local stdout answers fixture; stderr irrelevant'}],comparison:{evidence:0,start:0,end:9}});
async function ready(script="const b=require('node:fs').readFileSync('data/input.bin');process.stdout.write(Buffer.concat([Buffer.from('旗{é}'),b.subarray(0,2)]))",wrongCandidate=false,judge?:any){
 const f=await fixture(judge);const a=await f.publish('engineer','work/check.cjs',Buffer.from(script));const wrong=wrongCandidate?await f.publish('engineer','work/wrong.bin',Buffer.from('INCORRECT')):undefined;const p=await f.exec('engineer','package.publish',{...f.args,...(wrong?{candidate:{ref:wrong.ref,start:0,end:9}}:{}),files:[...f.args.files,{kind:'artifact',ref:a.ref,path:'check.cjs',purpose:'script'}]});await f.bind('verifier','verifier','X',p.version);const prep=await f.exec('verifier','package.prepare');const j=await f.exec('verifier','job.run',{preparation:prep.preparation,argv:[process.execPath,'check.cjs'],timeout_ms:5000});
 return {...f,p,prep,j,readResult:async(r:any,version=p.version)=>{
  const chunks:Buffer[]=[];let cursor:string|undefined,page:any;let size:number|undefined,digest:string|undefined;
  do{page=await f.exec('root','verification.read',{challenge:'X',version,result:r.result,...(cursor?{cursor}:{})});expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(262144);expect(page.report.offset).toBe(chunks.reduce((n,b)=>n+b.length,0));if(size!==undefined){expect(page.report.size).toBe(size);expect(page.report.sha256).toBe(digest);}size=page.report.size;digest=page.report.sha256;chunks.push(Buffer.from(page.report.data,'base64'));cursor=page.report.nextCursor??undefined;}while(cursor);
  const bytes=Buffer.concat(chunks);expect(page.report.done).toBe(true);expect(bytes.length).toBe(size);expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);return {...JSON.parse(bytes.toString()),currentAvailability:page.currentAvailability};
 }};
}
describe('D fifth interface',()=>{
 it('only verified current fixed bytes reach trusted judge and saved result',async()=>{
  const received:Buffer[]=[];const judge={id:'nonsecret-probe',timeoutMs:1000,submit:async(i:any)=>{received.push(Buffer.from(i.bytes));return {intent:i.intent,challenge:i.challenge,status:'accepted',completed:true};}};
  const f=await ready(undefined,false,judge);const r=await f.exec('verifier','verification.report',report(f.j.job));const args={challenge:'X',version:f.p.version,result:r.result};
  const v=await f.exec('root','completion.request',args);expect(v.state).toBe('confirmed');expect(v.solved).toBe(true);expect(received).toEqual([Buffer.from([0xe6,0x97,0x97,0x7b,0xc3,0xa9,0x7d,0,255])]);
  const disk=JSON.parse(await readFile(join(f.root,'state/completion',v.intent+'.json'),'utf8'));expect(disk.solved).toBe(true);
 });
});

const aRequest=(f:any,r:any)=>({challenge:'X',version:f.p.version,result:r.result});
const judgeFor=(received:Buffer[],status='accepted',completed=true)=>({id:'public-nonsecret-probe',timeoutMs:1000,submit:async(i:any)=>{received.push(Buffer.from(i.bytes));return {intent:i.intent,challenge:i.challenge,status,completed};}});
describe('D5 admission, outcome and failure boundaries',()=>{
 it('rejects roles, extra authority/candidate, wrong binding and usable rejected before dispatch',async()=>{
  const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const a=aRequest(f,r);
  for(const sid of ['engineer','verifier','domain-solver'])await expect(f.exec(sid,'completion.request',a)).rejects.toThrow();
  for(const arg of [{...a,candidate:'x'},{...a,authoritative:true},{...a,challenge:'Y'},{...a,version:'missing'},{...a,result:'missing'}])await expect(f.exec('root','completion.request',arg)).rejects.toThrow();
  for(const judgment of ['rejected','inconclusive']){const g=await ready(undefined,false,judgeFor(seen));const q=await g.exec('verifier','verification.report',report(g.j.job,judgment));if(judgment==='rejected')expect((await g.readResult(q)).currentAvailability.usable).toBe(true);await expect(g.exec('root','completion.request',aRequest(g,q))).rejects.toThrow('current verified');}
  const missing=await ready(undefined,false,judgeFor(seen));const q=await missing.exec('verifier','verification.report',{...report(missing.j.job),evidence:[],comparison:undefined});await expect(missing.exec('root','completion.request',aRequest(missing,q))).rejects.toThrow();expect(seen).toHaveLength(0);
 });
 it('rechecks necessary changes and version race without using another version',async()=>{
  const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const next=await f.exec('engineer','package.publish',f.args);await expect(f.exec('root','completion.request',{...aRequest(f,r),version:next.version})).rejects.toThrow();await writeFile(join(f.root,'X/work/verifier',f.prep.directory,'data/input.bin'),'changed');await expect(f.exec('root','completion.request',aRequest(f,r))).rejects.toThrow();expect(seen).toHaveLength(0);
 });
 it('maps only correlated explicit accepted whole completion; no judge candidate_only',async()=>{
  for(const [status,completed] of [['accepted',true],['accepted',false],['rejected',false],['duplicate',true],['invalid_state',false]]){const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen,String(status),Boolean(completed)));const r=await f.exec('verifier','verification.report',report(f.j.job));const v=await f.exec('root','completion.request',aRequest(f,r));expect(v.solved).toBe(status==='accepted'&&completed===true);expect(v.businessOutcome).toBe(status);expect(v.sent).toBe(true);expect(v.rawReply.intent).toBe(v.intent);expect((await f.exec('root','completion.request',aRequest(f,r))).intent).toBe(v.intent);expect(seen).toHaveLength(1);}
  const f=await ready();const r=await f.exec('verifier','verification.report',report(f.j.job));const v=await f.exec('root','completion.request',aRequest(f,r));expect(v.state).toBe('candidate_only');expect(v.sent).toBe(false);expect(v.solved).toBe(false);
 });
 it('dishonest complete echo stays mechanical verified but wrong candidate is rejected by trusted judge',async()=>{
  const seen:Buffer[]=[];const f=await ready("process.stdout.write(require('node:fs').readFileSync('../candidate.bin'))",true,judgeFor(seen,'rejected',false));const r=await f.exec('verifier','verification.report',report(f.j.job));const v=await f.readResult(r);expect(v.effectiveJudgment).toBe('verified');expect(v.currentAvailability.usable).toBe(true);const c=await f.exec('root','completion.request',aRequest(f,r));expect(c.solved).toBe(false);expect(c.businessOutcome).toBe('rejected');expect(seen).toEqual([Buffer.from('INCORRECT')]);
 });
 it('unknown locks whole challenge across new version/result while normal result reads still work',async()=>{
  let calls=0;const f=await ready(undefined,false,{id:'lost',timeoutMs:1000,submit:async()=>{calls++;throw new Error('transport lost after receive');}});const r=await f.exec('verifier','verification.report',report(f.j.job));const v=await f.exec('root','completion.request',aRequest(f,r));expect(v.state).toBe('unknown');expect(v.sent).toBe(true);const n=await f.exec('engineer','package.publish',f.args);await expect(f.exec('root','completion.request',{...aRequest(f,r),version:n.version,result:'new-result'})).rejects.toThrow('unknown same challenge');expect((await f.readResult(r)).currentAvailability.usable).toBe(true);expect(calls).toBe(1);
 });
 it('rejects invalid, forged authority and wrong-correlation replies as unknown',async()=>{
  for(const reply of [{status:'accepted',completed:true,authoritative:true},{intent:'other',challenge:'X',status:'accepted',completed:true},{intent:'x',challenge:'Y',status:'accepted',completed:true}]){const f=await ready(undefined,false,{id:'probe',timeoutMs:1000,submit:async()=>reply});const r=await f.exec('verifier','verification.report',report(f.j.job));const c=await f.exec('root','completion.request',aRequest(f,r));expect(c.state).toBe('unknown');expect(c.solved).toBe(false);expect(c.rawReply).toEqual(reply);}
 });
 it('parallel requests send at most once; intent exists on disk before judge receives bytes',async()=>{
  let calls=0,release!:()=>void;const hold=new Promise<void>(r=>release=r);let f:any;const judge={id:'hold',timeoutMs:1000,submit:async(i:any)=>{calls++;const disk=JSON.parse(await readFile(join(f.root,'state/completion',i.intent+'.json'),'utf8'));expect(disk.state).toBe('sent');expect(disk.candidateSha256).toBe(createHash('sha256').update(i.bytes).digest('hex'));await hold;return {intent:i.intent,challenge:i.challenge,status:'accepted',completed:true};}};f=await ready(undefined,false,judge);const r=await f.exec('verifier','verification.report',report(f.j.job));const one=f.exec('root','completion.request',aRequest(f,r));const two=f.exec('root','completion.request',aRequest(f,r));const both=Promise.allSettled([one,two]);setTimeout(()=>release(),50);const results=await both;expect(results.filter(v=>v.status==='fulfilled')).toHaveLength(1);expect(calls).toBe(1);
 });
 it('string oracle adapter strictly preserves LF, NFC/NFD, BOM and rejects invalid UTF-8',()=>{
  for(const s of ['flag\n','é','e\u0301','\uFEFFflag'])expect(Buffer.from(strictUtf8(Buffer.from(s)))).toEqual(Buffer.from(s));expect(strictUtf8(Buffer.from('é'))).not.toBe(strictUtf8(Buffer.from('e\u0301')));expect(()=>strictUtf8(Buffer.from([255]))).toThrow();
 });
 it('exact bytes preserve LF and NFC distinction at the judge and timeout is unknown',async()=>{
  for(const bytes of [Buffer.from('flag\n'),Buffer.from('é'),Buffer.from('e\u0301'),Buffer.from([255])]){const dir=await mkdtemp(join(tmpdir(),'d5-bytes-'));const c=new CompletionRequests(dir),seen:Buffer[]=[];const r=await c.request('r',{challenge:'X',version:'v',result:'q'},judgeFor(seen),async()=>bytes,()=>{});expect(r.solved).toBe(true);expect(seen).toEqual([bytes]);}
  const c=new CompletionRequests(await mkdtemp(join(tmpdir(),'d5-timeout-')));const r=await c.request('r',{challenge:'X',version:'v',result:'q'},{id:'timeout',timeoutMs:10,submit:async()=>new Promise(()=>{})},async()=>Buffer.from('x'),()=>{});expect(r.state).toBe('unknown');expect(r.sent).toBe(true);
 });
 it('pre-send storage failure, stop and expired admission make zero judge effects',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-storage-')),file=join(dir,'file');await writeFile(file,'x');let calls=0;const judge={id:'probe',timeoutMs:10,submit:async()=>{calls++;return {};}};const c=new CompletionRequests(file);await expect(c.request('r',{challenge:'X',version:'v',result:'q'},judge,async()=>Buffer.from('x'),()=>{})).rejects.toThrow();
  const f=await ready(undefined,false,judge);const r=await f.exec('verifier','verification.report',report(f.j.job));await f.s.stopAll('test stop');await expect(f.exec('root','completion.request',aRequest(f,r))).rejects.toThrow();expect(calls).toBe(0);
 });
});

it('rechecks fixed necessary source after intent persistence before dispatch',async()=>{
 const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const c=(f.s as any).completions,save=c.save.bind(c);let once=true;
 c.save=async(row:any)=>{await save(row);if(once&&row.state==='intent'){once=false;await writeFile(join(f.root,'X/work/verifier',f.prep.directory,'data/input.bin'),'changed during intent save');}};
 const v=await f.exec('root','completion.request',aRequest(f,r));expect(v.state).toBe('not_sent');expect(v.sent).toBe(false);expect(seen).toHaveLength(0);
});

it('post-judge result persistence failure never returns solved and locks new versions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'d5-after-save-'));const c=new CompletionRequests(dir),seen:Buffer[]=[];const save=(c as any).save.bind(c);
 (c as any).save=async(row:any)=>{if(row.state==='confirmed')throw new Error('injected final result persistence failure');await save(row);};
 const input={challenge:'X',version:'v',result:'r'};await expect(c.request('run',input,judgeFor(seen),async()=>Buffer.from('public-candidate'),()=>{})).rejects.toThrow('persistence failure');
 const memory=c.snapshot()[0]!;expect(memory.state).toBe('unknown');expect(memory.sent).toBe(true);expect(memory.solved).toBe(false);expect((memory.rawReply as any).status).toBe('accepted');
 const disk=JSON.parse(await readFile(join(dir,memory.intent+'.json'),'utf8'));expect(disk.state).toBe('sent');expect(disk.sent).toBe(false);expect(disk.solved).toBe(false);
 expect(()=>c.request('run',{...input,version:'new-version',result:'new-result'},judgeFor(seen),async()=>Buffer.from('new'),()=>{})).toThrow('unknown same challenge');expect(seen).toHaveLength(1);
 await evidence('post-judge-persistence-failure',{'memory.json':memory,'disk.json':disk,'judge-received.bin':seen[0]!});
});
