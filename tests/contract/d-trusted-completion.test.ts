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
 const s=new ControlService({...({completionJudges:judge?{X:{limits:{attempts:{kind:'unlimited'}},...judge}}:undefined} as any),runId:'D-package',client:client as never,budget:{maxModelCalls:100,maxObservableTokens:100000},expiresAt:Date.now()+60000,workdir:join(root,'opencode'),skillRoot:join(root,'skills'),challenges:[{id:'X',title:null,target:null,reachability:null,materials:[{name:'input.bin',sha256:createHash('sha256').update(Buffer.from([0,255,13,10])).digest('hex'),bytes:4}],materialsDir},{id:'Y',title:null,target:null,reachability:null,materials:[],materialsDir:join(root,'Y/materials')}]});services.push(s);s.bindRoot('root');let n=0;
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
const judgeFor=(received:Buffer[],status='accepted',completed=true)=>({limits:{attempts:{kind:'unlimited' as const}},id:'public-nonsecret-probe',timeoutMs:1000,submit:async(i:any)=>{received.push(Buffer.from(i.bytes));return {intent:i.intent,challenge:i.challenge,status,completed,...(status==='rejected'?{rejection:'wrong_answer'}:{})};}});
describe('D5 admission, outcome and failure boundaries',()=>{
 it('rejects roles, extra authority/candidate, wrong binding and usable rejected before dispatch',async()=>{
  const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const a=aRequest(f,r);
  for(const sid of ['engineer','verifier','domain-solver'])await expect(f.exec(sid,'completion.request',a)).rejects.toThrow();
  for(const arg of [{...a,candidate:'x'},{...a,authoritative:true},{...a,challenge:'Y'},{...a,version:'missing'},{...a,result:'missing'}])await expect(f.exec('root','completion.request',arg)).rejects.toThrow();
  for(const judgment of ['rejected']){const g=await ready(undefined,false,judgeFor(seen));const q=await g.exec('verifier','verification.report',report(g.j.job,judgment));if(judgment==='rejected')expect((await g.readResult(q)).currentAvailability.usable).toBe(true);await expect(g.exec('root','completion.request',aRequest(g,q))).rejects.toThrow('verifier rejected');}
  expect(seen).toHaveLength(0);
 });
 it('rechecks necessary changes and version race without using another version',async()=>{
  const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const next=await f.exec('engineer','package.publish',f.args);await expect(f.exec('root','completion.request',{...aRequest(f,r),version:next.version})).rejects.toThrow();await writeFile(join(f.root,'X/work/verifier',f.prep.directory,'data/input.bin'),'changed');const c=await f.exec('root','completion.request',aRequest(f,r));expect(c.solved).toBe(true);const page=await f.exec('root','verification.read',aRequest(f,r));expect(page.effectiveJudgment).toBe('inconclusive');expect(page.completionAdmission.layer).toBe('unable');expect(seen).toHaveLength(1);
 });
 it('maps only correlated explicit accepted whole completion; no judge candidate_only',async()=>{
  for(const [status,completed] of [['accepted',true],['accepted',false],['rejected',false],['duplicate',true],['invalid_state',false]]){const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen,String(status),Boolean(completed)));const r=await f.exec('verifier','verification.report',report(f.j.job));const v=await f.exec('root','completion.request',aRequest(f,r));expect(v.solved).toBe(status==='accepted'&&completed===true);expect(v.businessOutcome).toBe(status);expect(v.sent).toBe(true);expect(v.rawReply.intent).toBe(v.intent);const again=await f.exec('root','completion.request',aRequest(f,r));if(status==='accepted'||status==='rejected'){expect(again.intent).toBe(v.intent);expect(seen).toHaveLength(1);}else{expect(again.intent).not.toBe(v.intent);expect(again.solved).toBe(false);expect(seen).toHaveLength(2);}}
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
  const c=new CompletionRequests(await mkdtemp(join(tmpdir(),'d5-timeout-')));const r=await c.request('r',{challenge:'X',version:'v',result:'q'},{limits:{attempts:{kind:'unlimited'}},id:'timeout',timeoutMs:10,submit:async()=>new Promise(()=>{})},async()=>Buffer.from('x'),()=>{});expect(r.state).toBe('unknown');expect(r.sent).toBe(true);
 });
 it('pre-send storage failure, stop and expired admission make zero judge effects',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-storage-')),file=join(dir,'file');await writeFile(file,'x');let calls=0;const judge={id:'probe',timeoutMs:10,submit:async()=>{calls++;return {};}};const c=new CompletionRequests(file);await expect(async()=>c.request('r',{challenge:'X',version:'v',result:'q'},judge,async()=>Buffer.from('x'),()=>{})).rejects.toThrow();
  const f=await ready(undefined,false,judge);const r=await f.exec('verifier','verification.report',report(f.j.job));await f.s.stopAll('test stop');await expect(f.exec('root','completion.request',aRequest(f,r))).rejects.toThrow();expect(calls).toBe(0);
 });
});

it('proof change after intent becomes explicitly unable while fixed candidate can be sent',async()=>{
 const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const c=(f.s as any).completions,save=c.save.bind(c);let once=true;
 c.save=async(row:any)=>{await save(row);if(once&&row.state==='intent'){once=false;await writeFile(join(f.root,'X/work/verifier',f.prep.directory,'data/input.bin'),'changed during intent save');}};
 const v=await f.exec('root','completion.request',aRequest(f,r));expect(v.state).toBe('confirmed');expect(v.solved).toBe(true);expect(seen).toHaveLength(1);const page=await f.exec('root','verification.read',aRequest(f,r));expect(page.effectiveJudgment).toBe('inconclusive');expect(page.completionAdmission.layer).toBe('unable');
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

const reviewOnly=(mode='unable',judgment='inconclusive')=>({mode,judgment,rationale:'Existing theory cannot establish the instance state; stop without collecting new evidence',sourceFlow:'Review the fixed extraction and existing explanation only',premises:[{statement:'Instance state unknown',status:'unknown'}],issues:['Existing materials insufficient'],requirements:{continuousIntegrity:true,declaredDependenciesOnly:true},evidence:[]});
describe('D three-level controlled attempts',()=>{
 it.each([{mode:'llm',judgment:'verified',gaps:false},{mode:'llm',judgment:'verified',gaps:true},{mode:'unable',judgment:'inconclusive',gaps:true}])('sends $mode review without job (gaps=$gaps) and preserves the report after solved',async({mode,judgment,gaps})=>{
  const seen:Buffer[]=[];const f=await fixture(judgeFor(seen));const p=await f.exec('engineer','package.publish',f.args);await f.bind('verifier','verifier','X',p.version);
  const original=gaps?reviewOnly(mode,judgment):{mode,judgment,rationale:'Existing theory independently supports this fixed extraction',sourceFlow:'Review existing explanation only',evidence:[]},r=await f.exec('verifier','verification.report',original);const a={challenge:'X',version:p.version,result:r.result};
  const page=await f.exec('root','verification.read',a);expect(page.effectiveJudgment).toBe(gaps?'inconclusive':judgment);expect(page.currentAvailability.usable).toBe(!gaps);expect(page.completionAdmission).toMatchObject({allowed:true,layer:gaps?'unable':mode});expect(page.summary.rationale).toBe(original.rationale);
  const c=await f.exec('root','completion.request',a);expect(c.solved).toBe(true);expect(seen).toEqual([Buffer.from([230,151,151,123,195,169,125,0,255])]);
  const stored=f.s.verificationResultSnapshot()[0]!;expect(stored.original).toEqual(original);expect(stored.hostChecks.candidateEqual).toBeNull();expect(stored.effectiveJudgment).toBe(gaps?'inconclusive':judgment);
 });
 it.each(['script','candidate-source','manifest'])('separates proof damage from %s integrity at read and dispatch',async(kind)=>{
  const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));
  const ref=kind==='script'?f.script.ref:kind==='candidate-source'?f.source.ref:f.p.version;
  await writeFile(join(f.root,'X/published',ref+'.bin'),'corrupt');
  if(kind==='script'){expect(Buffer.from((await f.read(f.p.version)).data,'base64')).toEqual(Buffer.from([230,151,151,123,195,169,125,0,255]));const page=await f.exec('root','verification.read',aRequest(f,r));expect(page.effectiveJudgment).toBe('inconclusive');expect(page.currentAvailability.usable).toBe(false);expect(page.completionAdmission).toMatchObject({allowed:true,layer:'unable'});expect((await f.exec('root','completion.request',aRequest(f,r))).solved).toBe(true);}
  else{await expect(f.read(f.p.version)).rejects.toThrow();await expect(f.exec('root','completion.request',aRequest(f,r))).rejects.toThrow();}
  expect(seen).toHaveLength(kind==='script'?1:0);
 });
 it.each(['candidate-source','manifest'])('rechecks %s after awaited intent save and never sends changed candidate',async(kind)=>{
  const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const c=(f.s as any).completions,save=c.save.bind(c);let once=true;
  c.save=async(row:any)=>{await save(row);if(once&&row.state==='intent'){once=false;await writeFile(join(f.root,'X/published',(kind==='manifest'?f.p.version:f.source.ref)+'.bin'),'changed during await');}};
  const v=await f.exec('root','completion.request',aRequest(f,r));expect(v.state).toBe('not_sent');expect(v.sent).toBe(false);expect(seen).toHaveLength(0);
 });
 it('still refuses original rejected with unknown premises instead of falling through third layer',async()=>{
  const seen:Buffer[]=[];const f=await fixture(judgeFor(seen));const p=await f.exec('engineer','package.publish',f.args);await f.bind('verifier','verifier','X',p.version);const r=await f.exec('verifier','verification.report',reviewOnly('llm','rejected'));const a={challenge:'X',version:p.version,result:r.result};const page=await f.exec('root','verification.read',a);expect(page.effectiveJudgment).toBe('rejected');expect(page.completionAdmission.allowed).toBe(false);await expect(f.exec('root','completion.request',a)).rejects.toThrow('verifier rejected');expect(seen).toHaveLength(0);
 });
 it('restores wrong-answer fingerprints across versions without merging challenge or judge scopes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-recover-')),seen:Buffer[]=[];const judge=judgeFor(seen,'rejected',false),a={challenge:'X',version:'v1',result:'r1'};
  const first=await new CompletionRequests(dir).request('run',a,judge,async()=>Buffer.from('bad\n'),()=>{});expect(first.businessOutcome).toBe('rejected');
  const c=new CompletionRequests(dir);const again=await c.request('run',{...a,version:'v2',result:'r2'},judge,async()=>Buffer.from('bad\n'),()=>{});expect(again.intent).toBe(first.intent);expect(seen).toHaveLength(1);
  await c.request('run',{...a,version:'v3',result:'r3'},judge,async()=>Buffer.from('bad'),()=>{});
  await c.request('run',{...a,challenge:'Y'},judge,async()=>Buffer.from('bad\n'),()=>{});
  await c.request('run',a,{...judge,id:'another-scope',scope:'another-scope'},async()=>Buffer.from('bad\n'),()=>{});expect(seen).toHaveLength(4);
 });
 it.each(['timeout','mismatch','intent','sent','corrupt'])('restores %s conservatively and blocks a different candidate',async(kind)=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-unresolved-'));const seen:Buffer[]=[];let c=new CompletionRequests(dir);const a={challenge:'X',version:'v',result:'q'};
  const judge={...judgeFor(seen),timeoutMs:5,submit:async(i:any)=>{seen.push(i.bytes);return kind==='timeout'?new Promise(()=>{}):{intent:'unrelated',challenge:i.challenge,status:'accepted',completed:true};}};
  if(kind==='corrupt')await writeFile(join(dir,'broken.json'),'{');
  else{const r=await c.request('run',a,judge,async()=>Buffer.from('a'),()=>{});expect(r.state).toBe('unknown');if(kind==='intent'||kind==='sent'){r.state=kind;r.sent=false;await writeFile(join(dir,r.intent+'.json'),JSON.stringify(r));}}
  c=new CompletionRequests(dir);await expect(async()=>c.request('run',{...a,version:'next'},judge,async()=>Buffer.from('b'),()=>{})).rejects.toThrow();expect(seen).toHaveLength(kind==='corrupt'?0:1);
 });
 it.each(['invalid_state','closed','unclassified','non_answer'])('does not blacklist %s as wrong_answer',async(kind)=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-non-answer-')),seen:Buffer[]=[];const a={challenge:'X',version:'v',result:'q'};
  const judge={...judgeFor(seen),submit:async(i:any)=>{seen.push(i.bytes);return {intent:i.intent,challenge:i.challenge,status:['invalid_state','closed'].includes(kind)?kind:'rejected',completed:false,...(kind==='non_answer'?{rejection:'non_answer'}:{})};}};
  await new CompletionRequests(dir).request('run',a,judge,async()=>Buffer.from('same'),()=>{});
  await new CompletionRequests(dir).request('run',{...a,version:'v2',result:'q2'},judge,async()=>Buffer.from('same'),()=>{});expect(seen).toHaveLength(2);
 });
 it('persists last opportunity across rebuild and rejects concurrent reuse of it',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-limits-')),seen:Buffer[]=[];const c=new CompletionRequests(dir),a={challenge:'X',version:'v',result:'q'},judge={...judgeFor(seen,'rejected',false),limits:{attempts:{kind:'limited' as const,max:1}}};
  const both=await Promise.allSettled([c.request('run',a,judge,async()=>Buffer.from('a'),()=>{}),c.request('run',{...a,result:'q2'},judge,async()=>Buffer.from('b'),()=>{})]);expect(both.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(seen).toHaveLength(1);
  await expect(new CompletionRequests(dir).request('run',{...a,version:'new'},judge,async()=>Buffer.from('c'),()=>{})).rejects.toThrow('attempt limit');expect(seen).toHaveLength(1);
 });
 it.each(['unknown','cooldown','closed'])('blocks host %s limits and exposes them through existing tools',async(kind)=>{
  const seen:Buffer[]=[];const limits=kind==='unknown'?{attempts:{kind:'unknown'}}:kind==='cooldown'?{attempts:{kind:'unlimited'},notBefore:Date.now()+60000}:{attempts:{kind:'unlimited'},blockedReason:'challenge closed'};
  const f=await ready(undefined,false,{...judgeFor(seen),limits});const r=await f.exec('verifier','verification.report',report(f.j.job));await expect(f.exec('root','completion.request',aRequest(f,r))).rejects.toThrow();expect(seen).toHaveLength(0);
  const progress=await f.exec('root','progress.read');expect(progress.completion.challenges.find((c:any)=>c.challenge==='X').allowed).toBe(false);
 });
 it('checks exhausted model budget even without another model.call',async()=>{
  const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));(f.s as any).options.budget.maxModelCalls=0;await expect(f.exec('root','completion.request',aRequest(f,r))).rejects.toThrow();expect(seen).toHaveLength(0);
 });
});

describe('D final admission and restoration edges',()=>{
 it('rechecks candidate source after the final awaited evidence diagnostic',async()=>{
  const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const service=f.s as any,check=service.checkVerification.bind(service);let checks=0;
  service.checkVerification=async(...args:any[])=>{const result=await check(...args);if(++checks===4)await writeFile(join(f.root,'X/published',f.source.ref+'.bin'),'changed after last evidence check');return result;};
  const c=await f.exec('root','completion.request',aRequest(f,r));expect(c.state).toBe('not_sent');expect(seen).toHaveLength(0);
 });
 it.each(['budget','tokens','deadline','rules','stop'])('rechecks %s after persisted intent and releases a provably unsent reservation',async(kind)=>{
  const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const service=f.s as any,c=service.completions,save=c.save.bind(c);let once=true;
  c.save=async(row:any)=>{await save(row);if(once&&row.state==='intent'){once=false;if(kind==='budget')service.options.budget.maxModelCalls=0;if(kind==='tokens')service.options.budget.maxObservableTokens=0;if(kind==='deadline')service.options.expiresAt=0;if(kind==='rules')service.options.completionJudges.X.limits={attempts:{kind:'unknown'}};if(kind==='stop')await f.s.stopAll('stop during intent');}};
  const v=await f.exec('root','completion.request',aRequest(f,r));expect(v.state).toBe('not_sent');expect(v.attemptReserved).toBe(false);expect(seen).toHaveLength(0);
 });
 it('accepted partial bytes deduplicate after reconstruction across version/result',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-accepted-')),seen:Buffer[]=[];const a={challenge:'X',version:'v',result:'q'},judge=judgeFor(seen,'accepted',false);
  const first=await new CompletionRequests(dir).request('run',a,judge,async()=>Buffer.from('partial'),()=>{});expect(first.solved).toBe(false);
  const next=await new CompletionRequests(dir).request('run',{...a,version:'v2',result:'q2'},judge,async()=>Buffer.from('partial'),()=>{});expect(next.intent).toBe(first.intent);expect(seen).toHaveLength(1);
 });
 it('unknown keeps the last reserved chance after reconstruction',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-unknown-limit-')),c=new CompletionRequests(dir),a={challenge:'X',version:'v',result:'q'};
  const judge={...judgeFor([]),limits:{attempts:{kind:'limited' as const,max:1}},timeoutMs:5,submit:async()=>new Promise(()=>{})};
  const r=await c.request('run',a,judge,async()=>Buffer.from('a'),()=>{});expect(r.state).toBe('unknown');const status=new CompletionRequests(dir).status('run','X',judge);expect(status.remaining).toBe(0);expect(status.reasons).toContain('unknown same challenge; no resend');
 });
 it.each(['missing','used-before','cooldown-after','penalty'])('honors %s host rules without resetting counters',async(kind)=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-trusted-rules-')),seen:Buffer[]=[];const c=new CompletionRequests(dir),a={challenge:'X',version:'v',result:'q'};
  const limits=kind==='missing'?undefined:kind==='used-before'?{attempts:{kind:'limited' as const,max:2,usedBeforeRun:2}}:kind==='penalty'?{attempts:{kind:'unlimited' as const},blockedReason:'penalty policy forbids attempt'}:{attempts:{kind:'unlimited' as const},cooldownMs:60000};
  const judge={...judgeFor(seen,'rejected',false),limits};
  if(kind==='cooldown-after')await c.request('run',a,judge,async()=>Buffer.from('a'),()=>{});
  await expect(new CompletionRequests(dir).request('run',{...a,version:'v2'},judge,async()=>Buffer.from('b'),()=>{})).rejects.toThrow();expect(seen).toHaveLength(kind==='cooldown-after'?1:0);
 });
 it('no judge still records third layer candidate_only without clearing its issues',async()=>{
  const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);await f.bind('verifier','verifier','X',p.version);const r=await f.exec('verifier','verification.report',reviewOnly());const c=await f.exec('root','completion.request',{challenge:'X',version:p.version,result:r.result});expect(c.state).toBe('candidate_only');expect(c.solved).toBe(false);expect(f.s.verificationResultSnapshot()[0]!.original.issues).toEqual(['Existing materials insufficient']);
 });
});

it('an invalidated execution cannot retain usable verified status or submit',async()=>{
 const seen:Buffer[]=[];const f=await ready(undefined,false,judgeFor(seen));const r=await f.exec('verifier','verification.report',report(f.j.job));const execution=f.s.verificationResultSnapshot()[0]!.execution;(f.s as any).executions.get(execution).version='forged';
 const page=await f.exec('root','verification.read',aRequest(f,r));expect(page.currentAvailability.usable).toBe(false);expect(page.effectiveJudgment).toBe('inconclusive');expect(page.completionAdmission.allowed).toBe(false);await expect(f.exec('root','completion.request',aRequest(f,r))).rejects.toThrow('execution mismatch');expect(seen).toHaveLength(0);
});

// Independent review regressions: history ownership, pre-bind proof loss, and recoverable non-answer replies.
describe('D independent review fixes',()=>{
 it.each(['wrong_answer','accepted','quota','cooldown','unknown'])('preserves %s across run changes within the trusted challenge/judge scope',async(kind)=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-review-scope-')),seen:Buffer[]=[];const a={challenge:'X',version:'v',result:'q'};
  const judge={...judgeFor(seen),scope:'contest-instance/task-X',limits:kind==='quota'?{attempts:{kind:'limited' as const,max:1}}:{attempts:{kind:'unlimited' as const},...(kind==='cooldown'?{cooldownMs:60000}:{})},submit:async(i:any)=>{seen.push(Buffer.from(i.bytes));return {intent:kind==='unknown'?'unrelated':i.intent,challenge:i.challenge,status:kind==='accepted'?'accepted':kind==='wrong_answer'?'rejected':'invalid_state',completed:false,...(kind==='wrong_answer'?{rejection:'wrong_answer'}:{})};}};
  const first=await new CompletionRequests(dir).request('run-one',a,judge,async()=>Buffer.from('candidate\n'),()=>{});
  const restored=new CompletionRequests(dir),next={...a,version:'v2',result:'q2'},same=kind==='wrong_answer'||kind==='accepted';
  if(same){const r=await restored.request('run-two',next,judge,async()=>Buffer.from('candidate\n'),()=>{});expect(r.intent).toBe(first.intent);}
  else{const reason=kind==='quota'?'attempt limit':kind==='cooldown'?'cooldown':'unknown same challenge';await expect(async()=>restored.request('run-two',next,judge,async()=>Buffer.from('other'),()=>{})).rejects.toThrow(reason);}
  expect(seen).toHaveLength(1);
 });
 it('uses explicit host scope across adapter ids and isolates other challenges and judge scopes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-review-identity-')),seen:Buffer[]=[];const a={challenge:'X',version:'v',result:'q'},judge={...judgeFor(seen,'rejected',false),scope:'contest-instance/task-X'};
  const first=await new CompletionRequests(dir).request('one',a,judge,async()=>Buffer.from('bad'),()=>{});
  const restored=new CompletionRequests(dir);const again=await restored.request('two',{...a,version:'v2'},{...judge,id:'adapter-new-id'},async()=>Buffer.from('bad'),()=>{});expect(again.intent).toBe(first.intent);expect(seen).toHaveLength(1);
  await restored.request('two',{...a,challenge:'Y'},judge,async()=>Buffer.from('bad'),()=>{});
  await restored.request('two',a,{...judge,scope:'different-contest-instance/task-X'},async()=>Buffer.from('bad'),()=>{});expect(seen).toHaveLength(3);
 });
 it('keeps outside-directory consumption baseline without double-counting restored local attempts',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'d5-review-baseline-')),seen:Buffer[]=[];const a={challenge:'X',version:'v',result:'q'};
  const judge={...judgeFor(seen,'rejected',false),scope:'stable-task',limits:{attempts:{kind:'limited' as const,max:3,usedBeforeRun:1}}};
  await new CompletionRequests(dir).request('one',a,judge,async()=>Buffer.from('a'),()=>{});
  const restored=new CompletionRequests(dir);expect(restored.status('two','X',judge).remaining).toBe(1);
  await restored.request('two',a,judge,async()=>Buffer.from('b'),()=>{});expect(new CompletionRequests(dir).status('three','X',judge).remaining).toBe(0);expect(seen).toHaveLength(2);
 });
 it('allows third-layer binding after proof loss but keeps prepare strict',async()=>{
  const seen:Buffer[]=[];const f=await fixture(judgeFor(seen));const p=await f.exec('engineer','package.publish',f.args);
  await writeFile(join(f.root,'X/published',f.script.ref+'.bin'),'corrupted before assignment');
  await f.bind('verifier','verifier','X',p.version);await expect(f.exec('verifier','package.prepare')).rejects.toThrow();
  const r=await f.exec('verifier','verification.report',reviewOnly()),a={challenge:'X',version:p.version,result:r.result};const page=await f.exec('root','verification.read',a);
  expect(page.completionAdmission).toMatchObject({allowed:true,layer:'unable'});expect(page.currentAvailability.reasons).toContain('fixed package or dependency unavailable');
  expect((await f.exec('root','completion.request',a)).solved).toBe(true);expect(seen).toEqual([Buffer.from([230,151,151,123,195,169,125,0,255])]);
 });
 it.each(['candidate-source','manifest'])('still refuses binding a corrupt %s before any Verifier task or send',async(kind)=>{
  const seen:Buffer[]=[];const f=await fixture(judgeFor(seen));const p=await f.exec('engineer','package.publish',f.args);
  await writeFile(join(f.root,'X/published',(kind==='manifest'?p.version:f.source.ref)+'.bin'),'corrupt');
  await expect(f.exec('root','challenge.assign',{role:'verifier',challenge:'X',version:p.version})).rejects.toThrow();expect(f.s.executionSnapshot().filter(e=>e.role==='verifier')).toHaveLength(0);expect(seen).toHaveLength(0);
 });
 it.each(['invalid_state','closed','non_answer'])('re-admits the same report after %s when trusted conditions recover',async(kind)=>{
  let calls=0;const seen:Buffer[]=[];const f=await ready(undefined,false,{...judgeFor(seen),limits:{attempts:{kind:'limited',max:2}},submit:async(i:any)=>{seen.push(Buffer.from(i.bytes));return {intent:i.intent,challenge:i.challenge,status:calls++?'accepted':kind==='non_answer'?'rejected':kind,completed:calls===2,...(calls===1&&kind==='non_answer'?{rejection:'non_answer'}:{})};}});
  const r=await f.exec('verifier','verification.report',report(f.j.job)),a=aRequest(f,r);const first=await f.exec('root','completion.request',a);expect(first.solved).toBe(false);
  const judge=(f.s as any).options.completionJudges.X;judge.limits.blockedReason='temporarily unavailable';await expect(f.exec('root','completion.request',a)).rejects.toThrow('temporarily unavailable');expect(seen).toHaveLength(1);
  delete judge.limits.blockedReason;const second=await f.exec('root','completion.request',a);expect(second.intent).not.toBe(first.intent);expect(second.solved).toBe(true);expect(seen).toHaveLength(2);expect(seen[1]).toEqual(seen[0]);
  expect(f.s.verificationResultSnapshot()).toHaveLength(1);expect(f.s.completionSnapshot()).toHaveLength(2);
 });
});

it('refuses ambiguous adapter-id changes without stable scope and requires host clarification',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'d5-review-ambiguous-scope-')),seen:Buffer[]=[];const a={challenge:'X',version:'v',result:'q'},judge=judgeFor(seen,'rejected',false);
 const first=await new CompletionRequests(dir).request('one',a,judge,async()=>Buffer.from('bad'),()=>{});
 const restored=new CompletionRequests(dir),relabeled={...judge,id:'new-adapter-label'};
 expect(restored.status('two','X',relabeled).allowed).toBe(false);
 await expect(async()=>restored.request('two',a,relabeled,async()=>Buffer.from('bad'),()=>{})).rejects.toThrow('explicit stable judge scope required');expect(seen).toHaveLength(1);
 const clarified=await restored.request('two',a,{...relabeled,scope:judge.id},async()=>Buffer.from('bad'),()=>{});expect(clarified.intent).toBe(first.intent);expect(seen).toHaveLength(1);
 await restored.request('two',a,{...relabeled,scope:'confirmed-different-task-instance'},async()=>Buffer.from('bad'),()=>{});expect(seen).toHaveLength(2);
});
