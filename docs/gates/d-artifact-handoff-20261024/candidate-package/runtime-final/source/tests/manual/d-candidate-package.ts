// Native no-model probe. Only loopback scripted provider; real E / OpenCode task / plugin / C / work / jobs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {ControlService} from '../../apps/launcher/src/control-service.js';
import {launch} from '../../apps/launcher/src/launch.js';
const label=process.argv[2];assert(label&&/^[\w-]+$/.test(label),'fresh label required');
const base=resolve('docs/gates/d-artifact-handoff-20261024/candidate-package',label);await fs.mkdir(base);
const scenarios=process.argv[3]?[process.argv[3]]:['control','R1','R2','R3'];
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const sourceFiles=['AGENTS.md','package.json','package-lock.json','apps/launcher/src/artifact-tools.ts','apps/launcher/src/candidate-package-tools.ts','apps/launcher/src/control-service.ts','apps/launcher/src/control-rpc.ts','apps/launcher/src/run-prep.ts','apps/launcher/src/launch.ts','apps/launcher/src/workspace-tools.ts','apps/launcher/src/job-tools.ts','apps/opencode-plugin/src/index.ts','product/opencode/opencode.json','tests/manual/d-candidate-package.ts','tests/contract/d-candidate-package.test.ts',...['coordinator','intake','domain-solver','engineer','recon'].map(r=>`product/opencode/agents/${r}.md`)];
await fs.mkdir(join(base,'source'));for(const path of sourceFiles){const destination=join(base,'source',path);await fs.mkdir(resolve(destination,'..'),{recursive:true});await fs.copyFile(path,destination);}
await fs.writeFile(join(base,'source-hashes.json'),JSON.stringify(await Promise.all(sourceFiles.map(async path=>({path,sha256:hash(await fs.readFile(path))}))),null,2));
const expected=Buffer.from([0xe6,0x97,0x97,0x7b,0xc3,0xa9,0x7d,0,255]);
const raw=Buffer.concat([Buffer.from('log\r\n'),expected,Buffer.from('\r\nTAIL')]);
const eMaterial='E_NONSECRET\r\n';
const solverScript=`process.stdout.write(Buffer.from('${raw.toString('base64')}','base64'))`;
const extractionScript="const f=require('node:fs'); const p=require('node:path'); if(f.readFileSync(p.join(process.env.CTF_MATERIALS,'input.txt'),'utf8')!=='E_NONSECRET\\r\\n')throw new Error('wrong E material'); const b=f.readFileSync('raw.bin').subarray(5,14); f.writeFileSync('candidate.bin',b); process.stdout.write(b);";
for(const scenario of scenarios){
 assert(['control','R1','R2','R3'].includes(scenario));const out=join(base,scenario);await fs.mkdir(out);
 const root=await fs.mkdtemp(join(tmpdir(),'d-package-runtime-'));const provider:any[]=[],events:any[]=[],wire:any[]=[],observations:any[]=[];
 let releaseReady!:()=>void,releaseIO!:()=>void;const ready=new Promise<void>(r=>releaseReady=r),io=new Promise<void>(r=>releaseIO=r);
 let barrier=false,stopped=false,packagePending=false,seq=0,phase=0,result:any,failure:string|undefined;const steps=new Map<string,number>();
 const mark=(event:string,detail:unknown={})=>{const row={index:observations.length,at:Date.now(),event,detail};observations.push(row);return row;};
 const originalCreate=http.createServer,originalRename=fs.rename,originalRecord=(ControlService.prototype as any).record;
 (ControlService.prototype as any).record=function(...args:any[]){const r=originalRecord.apply(this,args);if(args[1]==='package.published')mark('C.commit',args);if(args[1]==='revoke'){mark('C.revoke',args);if(scenario==='R2'&&barrier){releaseIO();mark('barrier.release.after.revoke');}}if(args[1]==='task.stop.result'){stopped=true;mark('C.stop.result',args);if(scenario==='R3'){releaseIO();mark('response.release.after.stop');}}return r;};
 fs.rename=async function(a:any,b:any){if(scenario==='R2'&&packagePending&&String(a).endsWith('.tmp')&&String(b).includes('/published/')){barrier=true;mark('rename.barrier',{from:a,to:b});releaseReady();await io;mark('rename.resume');}return originalRename(a,b);};
 (http as any).createServer=function(...args:any[]){const listener=args.at(-1);if(typeof listener!=='function')return (originalCreate as any)(...args);args[args.length-1]=(q:any,r:any)=>{
  if(q.url==='/control'){
   const chunks:Buffer[]=[];q.on('data',(c:Buffer)=>chunks.push(Buffer.from(c)));const end=r.end;
   r.end=function(...endArgs:any[]){let body:any;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{}const publish=body?.operation==='tool.execute'&&body?.input?.tool==='package.publish';
    if(publish){const response=String(endArgs[0]??'');wire.push({at:Date.now(),request:body,status:r.statusCode,response});mark('rpc.reply.ready',{sessionID:body.sessionID,callID:body.input.callID,status:r.statusCode,response});
     if(scenario==='R1'){mark('socket.destroy.after.commit');r.destroy();return r;}
     if(scenario==='R3'){barrier=true;mark('response.barrier');releaseReady();void io.then(()=>{mark('response.late.attempt',{destroyed:r.destroyed,writableFinished:r.writableFinished});end.apply(r,endArgs);});return r;}
    }return end.apply(r,endArgs);
   };q.on('aborted',()=>mark('rpc.request.aborted'));r.on('close',()=>{if(Buffer.concat(chunks).toString().includes('package.publish'))mark('rpc.response.close',{finished:r.writableFinished,destroyed:r.destroyed});});
  }listener(q,r);
 };return (originalCreate as any)(...args);};syncBuiltinESMExports();
 const failedRequests:any[]=[];
 const stub=originalCreate((q,r)=>{let request:any;void(async()=>{
  const chunks:Buffer[]=[];for await(const c of q)chunks.push(Buffer.from(c));assert(q.url?.endsWith('/chat/completions'));
  const body=JSON.parse(Buffer.concat(chunks).toString());request=body;const first=String(body.messages.find((m:any)=>m.role==='user')?.content??'');
  const who=/PK_ROLE_(intake|domain-solver|engineer|recon)/.exec(first)?.[1]??'coordinator';const step=steps.get(who)??0;steps.set(who,step+1);
  const results=body.messages.filter((m:any)=>m.role==='tool').map((m:any)=>String(m.content));const decoded=results.flatMap((s:string)=>{try{return [JSON.parse(s)];}catch{return [];}});const all=body.messages.map((m:any)=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  const calls:any[]=[];const call=(name:string,args:object={})=>calls.push({name,args});let content='WAIT_FOR_NATIVE_TASK';
  const task=(role:string,extra='')=>call('task',{subagent_type:role,description:`package ${role}`,prompt:`PK_ROLE_${role} ${extra}`,...(role==='intake'?{}:{background:true})});
  const publications=decoded.filter((v:any)=>v.ref&&v.snapshotFixed&&!Object.hasOwn(v,'data'));
  if(who==='coordinator'){
   if(phase===0){task('intake');phase++;}
   else if(phase===1){assert(all.includes('INTAKE_READY'));call('ctf_challenge_assign',{role:'domain-solver',challenge:'X'});phase++;}
   else if(phase===2){task('domain-solver');phase++;}
   else if(phase===3&&all.includes('SOLVER_HANDOFF:')){call('ctf_challenge_assign',{role:'engineer',challenge:'X'});phase++;}
   else if(phase===4){const m=/SOLVER_HANDOFF:(\[[^\]\n]+\])/.exec(all);assert(m);assert.equal(JSON.parse(m[1]!).length,2);task('engineer','HANDOFF:'+m[1]);phase++;}
   else if(phase===5&&['R2','R3'].includes(scenario)){call('ctf_challenge_assign',{role:'recon',challenge:'X'});phase++;}
   else if(phase===6){task('recon');phase++;}
   else if(phase===7&&all.includes('SIBLING_BARRIER_READY')){const initial=results.filter((s:string)=>s.includes('Background task started')&&s.includes('<task id='));assert.equal(initial.length,3);const m=/<task id="(ses_[\w]+)"/.exec(initial[1]!);assert(m);mark('parent.native.stop.handle',{taskID:m[1]});call('ctf_task_stop',{task_id:m[1]});phase++;}
   else if(phase===8){assert(results.some((s:string)=>s.includes('"state":"stopped"')));content='STOP_CONFIRMED affected package handoff paused';phase=9;}
   else if(phase===5&&['control','R1'].includes(scenario)&&all.includes('ENGINEER_RESULT:')){if(scenario==='control')assert(/ENGINEER_RESULT:\{"version":/.test(all));else assert(all.includes('ENGINEER_RESULT:UNKNOWN'));content='PACKAGE_BATCH_END no verified/solved claim';phase=9;}
   else if(phase===9)content='END';
  }else if(who==='intake'){
   if(step===0)call('ctf_challenge_list');else if(step===1)call('ctf_challenge_read',{id:'X',path:'input.txt'});else{assert(decoded.some((v:any)=>v.text===eMaterial));content='INTAKE_READY fixed E input.txt';}
  }else if(who==='domain-solver'){
   if(step===0)call('ctf_workspace_write',{path:'work/solve.cjs',content:solverScript});
   else if(step===1)call('ctf_job_run',{argv:[process.execPath,'solve.cjs'],timeout_ms:5000});
   else if(step===2){const j=decoded.findLast((v:any)=>v.job);assert.equal(j.exitCode,0);call('ctf_artifact_publish',{source:'job',job:j.job,stream:'stdout'});}
   else if(step===3)call('ctf_artifact_publish',{source:'file',path:'work/solve.cjs'});
   else{assert.equal(publications.length,2);content='SOLVER_HANDOFF:'+JSON.stringify(publications.map((p:any)=>({ref:p.ref,path:p.path,sha256:p.sha256,size:p.size})));}
  }else if(who==='recon'){await ready;mark('sibling.native.completion.ready');content='SIBLING_BARRIER_READY';}
  else{
   assert(body.tools.some((t:any)=>t.function.name==='ctf_package_publish'));const m=/HANDOFF:(\[[^\]\n]+\])/.exec(first);assert(m,'actual native Engineer task must supply refs');const refs=JSON.parse(m[1]!);
   const pages=decoded.filter((v:any)=>v.encoding==='base64'&&v.ref);const get=(i:number)=>{const p=pages[i];assert(p);return Buffer.from(p.data,'base64');};
   if(step===0)call('ctf_artifact_read',{ref:refs[0].ref});
   else if(step===1)call('ctf_artifact_read',{ref:refs[1].ref});
   else if(step===2)call('ctf_workspace_read',{path:'materials/input.txt'});
   else if(step===3){assert.deepEqual(get(0),raw);assert(decoded.some((v:any)=>v.text===eMaterial));call('ctf_workspace_write',{path:'work/raw.bin',content:get(0).toString('base64'),encoding:'base64'});}
   else if(step===4){assert.equal(get(1).toString(),solverScript);call('ctf_workspace_write',{path:'work/source.cjs',content:get(1).toString('base64'),encoding:'base64'});}
   else if(step===5)call('ctf_workspace_write',{path:'work/extract.cjs',content:extractionScript});
   else if(step===6)call('ctf_job_run',{argv:[process.execPath,'extract.cjs'],timeout_ms:5000});
   else if(step===7){assert.equal(decoded.findLast((v:any)=>v.job)?.exitCode,0);call('ctf_artifact_publish',{source:'file',path:'work/extract.cjs'});}
   else if(step===8)call('ctf_artifact_publish',{source:'file',path:'work/source.cjs'});
   else if(step===9){const j=decoded.findLast((v:any)=>v.job);call('ctf_artifact_publish',{source:'job',job:j.job,stream:'stdout'});}
   else if(step===10){assert.equal(publications.length,3);packagePending=true;mark('provider.package.call');call('ctf_package_publish',{candidate:{ref:publications[2].ref,start:0,end:9},files:[{kind:'artifact',ref:publications[0].ref,path:'extract.cjs',purpose:'script'},{kind:'artifact',ref:publications[1].ref,path:'source.cjs',purpose:'script'},{kind:'artifact',ref:refs[0].ref,path:'raw.bin',purpose:'input'},{kind:'material',name:'input.txt',path:'data/input.txt',purpose:'input'},{kind:'artifact',ref:refs[1].ref,path:'evidence/solver.cjs',purpose:'evidence'}],argv:[process.execPath,'extract.cjs'],extraction:'Engineer local extract.cjs reads raw.bin [5,14) after checking fixed E input; stdout is candidate bytes without normalization',premises:['CTF_MATERIALS must expose fixed input.txt; raw.bin relative to proposed working directory','External state unknown; binary candidate fixture; no verifier/oracle']});}
   else if(scenario==='R1'){assert(!decoded.some((v:any)=>v.version));assert(results.some((v:string)=>v.includes('denied: control unavailable')));content='ENGINEER_RESULT:UNKNOWN pause affected handoff; no blind resend';}
   else{
    const p=decoded.find((v:any)=>v.version&&v.candidateSha256);assert(p?.version);
    if(step===11)call('ctf_package_read',{version:p.version,component:'manifest'});
    else if(step===12)call('ctf_package_read',{version:p.version,component:'candidate'});
    else if(step===13)call('ctf_package_read',{version:p.version,component:'file',path:'data/input.txt'});
    else{const reads=decoded.filter((v:any)=>v.version&&v.data);assert.equal(reads.length,3);const manifest=JSON.parse(Buffer.from(reads[0].data,'base64').toString());assert.equal(manifest.candidate.publication.ref,publications[2].ref);assert.deepEqual(Buffer.from(reads[1].data,'base64'),expected);assert.equal(Buffer.from(reads[2].data,'base64').toString(),eMaterial);assert.equal(manifest.argvStatus,'proposed');content='ENGINEER_RESULT:'+JSON.stringify({version:p.version,sha256:reads[1].sha256});}
   }
  }
  provider.push({at:Date.now(),seq:++seq,who,step,phase,request:body,calls,content});const b={id:`chatcmpl-${seq}`,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'scripted'};
  const delta=calls.length?{role:'assistant',tool_calls:calls.map((c,i)=>({index:i,id:`call_${seq}_${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{role:'assistant',content};r.writeHead(200,{'content-type':'text/event-stream'});for(const v of [{...b,choices:[{index:0,delta,finish_reason:null}]},{...b,choices:[{index:0,delta:{},finish_reason:calls.length?'tool_calls':'stop'}]},{...b,choices:[],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}])r.write(`data: ${JSON.stringify(v)}\n\n`);r.end('data: [DONE]\n\n');
 })().catch(e=>{failure??=String(e);failedRequests.push({at:Date.now(),error:String(e),request});mark('provider.failure',String(e));r.writeHead(500).end('{}');});});await new Promise<void>(r=>stub.listen(0,'127.0.0.1',r));
 process.env.PK_STUB_KEY='local-nonsecret';process.env.HTTP_PROXY=process.env.HTTPS_PROXY=process.env.ALL_PROXY='http://127.0.0.1:9';process.env.NO_PROXY='127.0.0.1,localhost';
 const config={model:'stub/scripted',enabled_providers:['stub'],provider:{stub:{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${(stub.address() as any).port}/v1`,apiKey:'{env:PK_STUB_KEY}'},models:{scripted:{limit:{context:65536,output:2048}}}}}};assert.deepEqual(config.enabled_providers,['stub']);assert.equal(new URL(config.provider.stub.options.baseURL).hostname,'127.0.0.1');
 await fs.writeFile(join(out,'provider-config.json'),JSON.stringify({...config,proxy:{HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY,ALL_PROXY:process.env.ALL_PROXY,NO_PROXY:process.env.NO_PROXY}},null,2));await fs.writeFile(join(root,'opencode.json'),JSON.stringify(config));
 await fs.writeFile(join(out,'versions.json'),JSON.stringify({node:process.version,opencode:execFileSync('/Users/caihaoming/.opencode/bin/opencode',['--version'],{encoding:'utf8'}).trim(),sdk:JSON.parse(await fs.readFile('node_modules/@opencode-ai/sdk/package.json','utf8')).version,plugin:JSON.parse(await fs.readFile('node_modules/@opencode-ai/plugin/package.json','utf8')).version},null,2));
 await fs.writeFile(join(root,'input.txt'),eMaterial);await fs.writeFile(join(root,'challenges.json'),JSON.stringify({challenges:[{id:'X',statement:'D package public nonsecret fixture; no oracle',materials:['input.txt']}]}));await fs.writeFile(join(root,'profile.json'),JSON.stringify({profileId:'package-local',challenges:'challenges.json',opencode:{configPath:'opencode.json',binaryPath:'/Users/caihaoming/.opencode/bin/opencode'},reference:{enabled:false},budget:{wallClockMs:60000,maxSteps:80,maxObservableTokens:100000,maxToolJobs:3},os:{platform:'macos'}}));
 const abort=new AbortController();
 try{
  result=await launch({profile:join(root,'profile.json'),runsRoot:join(root,'runs'),runId:scenario,onStarted:async({client})=>{const s=await client.event.subscribe({},{signal:abort.signal,throwOnError:true});void(async()=>{try{for await(const e of s.stream)events.push({at:Date.now(),...e});}catch{}})();}});
  assert.equal(failure,undefined);assert.equal(result.status,'completed');assert.equal(phase,9);
  const ev=join(result.runDir,'evidence');const load=async(n:string)=>JSON.parse(await fs.readFile(join(ev,n),'utf8'));const pubs=await load('publications.json'),resources=await load('tool-resources.json'),executions=await load('task-executions.json'),audit=await load('control-audit.json');
  const packages=pubs.filter((p:any)=>p.source.kind==='package');assert.equal(packages.length,scenario==='R2'?0:1);const sourceExecution=executions.find((e:any)=>e.role==='domain-solver'),engineerExecution=executions.find((e:any)=>e.role==='engineer');assert.notEqual(sourceExecution.childID,engineerExecution.childID);
  const calls=provider.flatMap(p=>p.calls);assert.equal(calls.filter(c=>c.name==='ctf_job_run').length,2);assert.equal(calls.filter(c=>c.name==='ctf_artifact_publish').length,5);assert.equal(calls.filter(c=>c.name==='ctf_package_publish').length,1);assert(resources.every((r:any)=>r.state==='settled'));
  const packageResource=resources.find((r:any)=>r.tool==='package.publish');assert.equal(packageResource.execution,engineerExecution.ref);assert.equal(packageResource.sessionID,engineerExecution.childID);
  const messages=await load('messages-'+engineerExecution.childID+'.json');const part=messages.flatMap((m:any)=>m.parts??[]).find((p:any)=>p.type==='tool'&&p.tool==='ctf_package_publish');assert(part);assert.equal(part.callID,packageResource.callID);
  for(const p of packages){const bytes=await fs.readFile(join(result.runDir,'workspace/X',p.path));assert.equal(hash(bytes),p.sha256);const manifest=JSON.parse(bytes.toString());assert.deepEqual(Buffer.from(manifest.candidate.data,'base64'),expected);assert.equal(manifest.candidate.publication.source.execution,engineerExecution.ref);assert.equal(manifest.candidate.publication.source.kind,'job');assert.equal(manifest.candidate.publication.originalComplete,true);assert.equal(manifest.files.find((f:any)=>f.path==='raw.bin').publication.source.execution,sourceExecution.ref);assert.equal(manifest.argvStatus,'proposed');await fs.writeFile(join(out,'fixed-manifest.json'),bytes);await fs.writeFile(join(out,'candidate.bin'),Buffer.from(manifest.candidate.data,'base64'));}
  const solverJob=resources.find((r:any)=>r.tool==='job.run'&&r.sessionID===sourceExecution.childID),engineerJob=resources.find((r:any)=>r.tool==='job.run'&&r.sessionID===engineerExecution.childID);assert.deepEqual(await fs.readFile(join(result.runDir,'state/jobs',solverJob.sessionID,solverJob.job,'stdout.bin')),raw);assert.deepEqual(await fs.readFile(join(result.runDir,'state/jobs',engineerJob.sessionID,engineerJob.job,'stdout.bin')),expected);
  const order=(...names:string[])=>{const indices=names.map(n=>observations.findIndex(o=>o.event===n));assert(indices.every((n,i)=>n>=0&&(i===0||n>indices[i-1]!)),JSON.stringify({names,indices}));};
  if(scenario==='control'){order('C.commit','rpc.reply.ready','rpc.response.close');assert.equal(part.state.status,'completed');assert.equal(calls.filter(c=>c.name==='ctf_package_read').length,3);assert(executions.find((e:any)=>e.role==='engineer').delivered);}
  if(scenario==='R1'){order('C.commit','rpc.reply.ready','socket.destroy.after.commit','rpc.response.close');assert.equal(part.state.status,'error');assert.equal(part.state.error,'denied: control unavailable');assert.equal(calls.filter(c=>c.name==='ctf_package_read').length,0);assert(provider.some(p=>p.who==='engineer'&&p.content.includes('UNKNOWN')));}
  if(['R2','R3'].includes(scenario)){assert(barrier&&stopped);assert(audit.some((a:any)=>a.op==='task.cancel'));assert.equal(engineerExecution.state,'cancelled');assert.equal(engineerExecution.delivery,'stop_reply');assert.equal(calls.filter(c=>c.name==='ctf_task_stop').length,1);assert(!provider.some(p=>p.who==='engineer'&&p.step>10));const nativeStop=observations.find(o=>o.event==='parent.native.stop.handle');assert.equal(nativeStop.detail.taskID,engineerExecution.childID);}
  if(scenario==='R2'){order('rename.barrier','C.revoke','barrier.release.after.revoke','rename.resume','C.stop.result');assert(!observations.some(o=>o.event==='C.commit'));assert.equal((await fs.readdir(join(result.runDir,'workspace/X/published'))).length,5);assert.equal(packageResource.result,'cancelled');}
  if(scenario==='R3'){order('C.commit','response.barrier','C.revoke','rpc.response.close','C.stop.result','response.release.after.stop','response.late.attempt');assert.equal(part.state.status,'error');assert.equal(part.state.error,'Tool execution aborted');assert.equal(packageResource.result,'completed');}
  await fs.writeFile(join(out,'summary.json'),JSON.stringify({scenario,verdict:'passed',result,packageCount:packages.length,sourceJobs:2,artifactCalls:5,packageCalls:1,sourceExecution,engineerExecution,packageResource,packageToolState:part.state,realModelCalls:0,realUsage:'unavailable',scriptedUsage:'zero only',solved:false,scope:'disposable D interface-two prototype only'},null,2));
 }catch(e){failure=failure??String(e);process.exitCode=1;console.error(e);}finally{
  releaseReady();releaseIO();abort.abort();(http as any).createServer=originalCreate;fs.rename=originalRename;(ControlService.prototype as any).record=originalRecord;syncBuiltinESMExports();
  if(result?.runDir)for(const dir of ['evidence','workspace','state'])await fs.cp(join(result.runDir,dir),join(out,dir),{recursive:true});
  for(const [n,v]of Object.entries({provider,failedRequests,events,wire,observations,result:{result,failure,scenario,root,realModelCalls:0}}))await fs.writeFile(join(out,n+'.json'),JSON.stringify(v,null,2));await fs.writeFile(join(out,'expected-raw.bin'),raw);await fs.writeFile(join(out,'expected-candidate.bin'),expected);await new Promise<void>(r=>{stub.close(()=>r());stub.closeAllConnections();});
 }console.log(JSON.stringify({scenario,result,failure,out}));
}
