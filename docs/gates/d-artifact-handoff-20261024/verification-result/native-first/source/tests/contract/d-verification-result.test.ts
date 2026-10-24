// Candidate-package contract: C integration with real files/jobs; SDK identity only is a deterministic fixture.
import {afterAll,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ControlService} from '../../apps/launcher/src/control-service.js';
const services:ControlService[]=[];
async function evidence(name:string,items:Record<string,Buffer|object>){
 const root=process.env.D_RESULT_EVIDENCE_DIR;if(!root)return;const dir=join(root,name);await mkdir(dir,{recursive:true});
 for(const [file,value] of Object.entries(items))await writeFile(join(dir,file),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));
}

afterAll(async()=>{await Promise.all(services.map(s=>s.stopAll('test end')));});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'d-package-'));const materialsDir=join(root,'X/materials');await mkdir(materialsDir,{recursive:true});await writeFile(join(materialsDir,'input.bin'),Buffer.from([0,255,13,10]));
 const client={session:{get:async({sessionID}:any)=>({data:{id:sessionID,parentID:'root',agent:sessionID==='other'?'engineer':sessionID}}),children:async()=>({data:[]}),messages:async()=>({data:[]}),abort:async()=>({data:true})}};
 const s=new ControlService({runId:'D-package',client:client as never,budget:{maxModelCalls:100,maxObservableTokens:100000},expiresAt:Date.now()+60000,workdir:join(root,'opencode'),skillRoot:join(root,'skills'),challenges:[{id:'X',title:null,target:null,reachability:null,materials:[{name:'input.bin',sha256:createHash('sha256').update(Buffer.from([0,255,13,10])).digest('hex'),bytes:4}],materialsDir},{id:'Y',title:null,target:null,reachability:null,materials:[],materialsDir:join(root,'Y/materials')}]});services.push(s);s.bindRoot('root');let n=0;
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
async function ready(script="process.stdout.write(Buffer.from([0xe6,0x97,0x97,0x7b,0xc3,0xa9,0x7d,0,255]))"){
 const f=await fixture();const a=await f.publish('engineer','work/check.cjs',Buffer.from(script));const p=await f.exec('engineer','package.publish',{...f.args,files:[...f.args.files,{kind:'artifact',ref:a.ref,path:'check.cjs',purpose:'script'}]});await f.bind('verifier','verifier','X',p.version);const prep=await f.exec('verifier','package.prepare');const j=await f.exec('verifier','job.run',{preparation:prep.preparation,argv:[process.execPath,'check.cjs'],timeout_ms:5000});
 return {...f,p,prep,j,readResult:(r:any,version=p.version)=>f.exec('root','verification.read',{challenge:'X',version,result:r.result})};
}
describe('D fourth interface',()=>{
 it('Q1 registers host-bound original report and Coordinator reads exact result with raw bytes',async()=>{
  const f=await ready();const r=await f.exec('verifier','verification.report',report(f.j.job));expect(r.result).toBeTruthy();const read=await f.readResult(r);expect(read.original.judgment).toBe('verified');expect(read.effectiveJudgment).toBe('verified');expect(read.currentAvailability.usable).toBe(true);expect(read.hostChecks.semanticAssessment).toBe('verifier_assertion_not_host_proven');expect(read.evidence[0].association.continuousIntegrity).toBe('unknown');expect(Buffer.from(read.evidence[0].data,'base64')).toEqual(Buffer.from([0xe6,0x97,0x97,0x7b,0xc3,0xa9,0x7d,0,255]));expect(read.execution).toBe(f.s.executionSnapshot().find(e=>e.role==='verifier')!.ref);
  await evidence('valid',{'report.json':read,'audit.json':f.s.audit,'stdout.bin':Buffer.from(read.evidence[0].data,'base64')});
 });
 it('Q1 rejects role, forged identity/receipt/job, foreign evidence and wrong specified version/challenge',async()=>{
  const f=await ready();for(const sid of ['root','engineer','domain-solver'])await expect(f.exec(sid,'verification.report',report(f.j.job))).rejects.toThrow();
  for(const arg of [{...report(f.j.job),version:f.p.version},{...report(f.j.job),receipt:{}},report('forged'),{...report(f.j.job),evidence:[{kind:'artifact',ref:'foreign',necessary:true,context:'foreign'}]}])await expect(f.exec('verifier','verification.report',arg)).rejects.toThrow();
  const other=await f.exec('engineer','job.run',{argv:[process.execPath,'-e',"process.stdout.write('other')"],timeout_ms:5000});await expect(f.exec('verifier','verification.report',report(other.job))).rejects.toThrow();
  const r=await f.exec('verifier','verification.report',report(f.j.job));await expect(f.readResult(r,f.source.ref)).rejects.toThrow();await expect(f.exec('root','verification.read',{challenge:'Y',version:f.p.version,result:r.result})).rejects.toThrow();await expect(f.exec('verifier','verification.read',{challenge:'X',version:f.p.version,result:r.result})).rejects.toThrow();
 });
 it('Q2 preserves rejected and missing-evidence proposals without equality-based promotion',async()=>{
  const f=await ready("process.stdout.write('WRONG')");const a={...report(f.j.job,'rejected'),comparison:{evidence:0,start:0,end:5},rationale:'Inspected local fixture calculation contradicts candidate'};const r=await f.exec('verifier','verification.report',a);const v=await f.readResult(r);expect(v.effectiveJudgment).toBe('rejected');expect(v.hostChecks.candidateEqual).toBe(false);
  const g=await ready();const q=await g.exec('verifier','verification.report',{...report(g.j.job),evidence:[],comparison:undefined});const w=await g.readResult(q);expect(w.original.judgment).toBe('verified');expect(w.effectiveJudgment).toBe('inconclusive');expect(w.currentAvailability.usable).toBe(false);
  const h=await ready();const z=await h.exec('verifier','verification.report',report(h.j.job,'inconclusive'));expect((await h.readResult(z)).effectiveJudgment).toBe('inconclusive');await evidence('judgments',{'rejected.json':v,'missing.json':w});
 });
 it('Q2 records echo/wrong-input equal-output/audit-string semantic counterexamples rather than claiming a classifier',async()=>{
  const cases=[['echo',"process.stdout.write(require('node:fs').readFileSync('../candidate.bin'))"],['wrong-input',"require('node:fs').readFileSync('data/input.bin');process.stdout.write(Buffer.from([0xe6,0x97,0x97,0x7b,0xc3,0xa9,0x7d,0,255]))"],['audit-string',"process.stdout.write('candidate present in irrelevant log')"]];
  for(const [name,script] of cases){const f=await ready(script);let a:any=report(f.j.job,'inconclusive');a.issues=['Semantic sufficiency not established: '+name];if(name==='audit-string'){a.mode='evidence_audit';delete a.comparison;}const r=await f.exec('verifier','verification.report',a);const v=await f.readResult(r);expect(v.effectiveJudgment).toBe('inconclusive');await evidence(name!,{'script.cjs':Buffer.from(script!),'report.json':v});}
  // Deliberately dishonest semantic assertion passes mechanical checks: this is the boundary, not a semantic PASS.
  const f=await ready("process.stdout.write(require('node:fs').readFileSync('../candidate.bin'))");const r=await f.exec('verifier','verification.report',report(f.j.job));const v=await f.readResult(r);expect(v.hostChecks.candidateEqual).toBe(true);expect(v.hostChecks.semanticAssessment).toBe('verifier_assertion_not_host_proven');await evidence('dishonest-echo-boundary',{'report.json':v});
 });
 it('Q3 keeps V3 change-restore unknown and blocks declared continuity requirement',async()=>{
  const script="const f=require('node:fs');const b=f.readFileSync('data/input.bin');f.writeFileSync('data/input.bin','CHANGED');process.stdout.write(f.readFileSync('data/input.bin'));f.writeFileSync('data/input.bin',b);";
  const f=await ready(script);const a={...report(f.j.job),requirements:{continuousIntegrity:true,declaredDependenciesOnly:true},comparison:{evidence:0,start:0,end:7}};const r=await f.exec('verifier','verification.report',a);const v=await f.readResult(r);expect(v.evidence[0].association.after).toBe('matched');expect(v.evidence[0].association.continuousIntegrity).toBe('unknown');expect(v.effectiveJudgment).toBe('inconclusive');await evidence('mid-job-restore',{'script.cjs':Buffer.from(script),'report.json':v,'stdout.bin':Buffer.from(v.evidence[0].data,'base64')});
 });
 it('Q3 retains known mutation, unknown premises, replay and necessary truncation as blockers',async()=>{
  for(const kind of ['mutation','premise','replay','truncate']){const f=await ready(kind==='mutation'?"require('node:fs').writeFileSync('data/input.bin','CHANGED');process.stdout.write('candidate')":kind==='truncate'?"process.stdout.write('x'.repeat(1048577))":undefined);const a:any=report(f.j.job);if(kind==='premise')a.premises=[{statement:'Required instance state unknown',status:'unknown'}];if(kind==='replay')a.mode='replay';const r=await f.exec('verifier','verification.report',a);const v=await f.readResult(r);expect(v.effectiveJudgment).toBe('inconclusive');expect(v.hostChecks.blockers.length).toBeGreaterThan(0);await evidence(kind,{'report.json':v});}
 });
 it('Q3 nonessential truncated stderr preserves context, does not auto-deny stdout conclusion',async()=>{
  const f=await ready("process.stderr.write('x'.repeat(1048577));process.stdout.write(Buffer.from([0xe6,0x97,0x97,0x7b,0xc3,0xa9,0x7d,0,255]))");const a=report(f.j.job);a.evidence.push({kind:'job',job:f.j.job,stream:'stderr',necessary:false,context:'Unrelated padding diagnostic; conclusion uses complete stdout only'});const r=await f.exec('verifier','verification.report',a);const v=await f.readResult(r);expect(v.evidence[1].originalComplete).toBe(false);expect(v.effectiveJudgment).toBe('verified');await evidence('irrelevant-truncation',{'report.json':v});
 });
 it('Q3 revision stays separate; relevant input mutation invalidates read while unrelated work does not',async()=>{
  const f=await ready();const r=await f.exec('verifier','verification.report',report(f.j.job));const q=await f.exec('engineer','package.publish',f.args);expect(q.version).not.toBe(f.p.version);expect((await f.readResult(r)).currentAvailability.usable).toBe(true);await expect(f.readResult(r,q.version)).rejects.toThrow();await f.exec('verifier','workspace.write',{path:'work/unrelated',content:'edit'});expect((await f.readResult(r)).currentAvailability.usable).toBe(true);await writeFile(join(f.root,'X/work/verifier',f.prep.directory,'data/input.bin'),'changed');const v=await f.readResult(r);expect(v.original.judgment).toBe('verified');expect(v.currentAvailability.usable).toBe(false);await evidence('invalidation',{'report.json':v});
 });
 it('Q4 exact duplicates retain ref; conflicts refuse without overwrite; stop/budget refuse new registration',async()=>{
  const f=await ready();const a=report(f.j.job);const r=await f.exec('verifier','verification.report',a);expect((await f.exec('verifier','verification.report',a)).result).toBe(r.result);await expect(f.exec('verifier','verification.report',{...a,rationale:'conflict'})).rejects.toThrow();expect((await f.readResult(r)).original.rationale).toBe(a.rationale);
  const g=await ready();await g.exec('root','task.stop',{task_id:'verifier'});await expect(g.exec('verifier','verification.report',report(g.j.job))).rejects.toThrow();
  const h=await ready();(h.s as any).options.budget.maxModelCalls=0;await expect(h.s.handle('verifier','model.call',{agent:'verifier'})).rejects.toThrow();await expect(h.exec('verifier','verification.report',report(h.j.job))).rejects.toThrow();
 });
});
