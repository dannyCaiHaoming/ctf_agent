// No-model runtime probe. Instrumentation changes IO timing/transport, never C authorization/state.
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
const label=process.argv[2];assert(label&&/^[\w-]+$/.test(label),'fresh batch required');
const base=resolve('docs/gates/d-h7-rpc-stop-20261024',...(label.startsWith('integration-')?['integration',label]:[label]));await fs.mkdir(base);
const scenarios=process.argv[3]?[process.argv[3]]:['control','R1','R2','R3'];
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const files=['apps/launcher/src/artifact-tools.ts','apps/launcher/src/control-service.ts','apps/launcher/src/control-rpc.ts','apps/launcher/src/launch.ts','apps/opencode-plugin/src/index.ts','tests/manual/d-h7-rpc-stop.ts','package-lock.json',...['coordinator','recon','domain-solver','engineer','verifier'].map(role=>`product/opencode/agents/${role}.md`),'docs/superpowers/specs/2026-10-24-design-v1-d-candidate-verification-minimal.md'];
await fs.writeFile(join(base,'source-hashes.json'),JSON.stringify(await Promise.all(files.map(async path=>({path,sha256:hash(await fs.readFile(path))}))),null,2));
for(const scenario of scenarios){
 assert(['control','R1','R2','R3'].includes(scenario));const out=join(base,scenario);await fs.mkdir(out);
 // Launch requires a non-git run root; retain this path and copy all run evidence back to this worktree.
 const root=await fs.mkdtemp(join(tmpdir(),'d-h7-'));const provider:any[]=[],events:any[]=[],wire:any[]=[],observations:any[]=[];
 let releaseReady!:()=>void,releaseIO!:()=>void;const ready=new Promise<void>(r=>releaseReady=r),io=new Promise<void>(r=>releaseIO=r);
 let barrier=false,stopped=false,seq=0,phase=0,result:any,failure:string|undefined;
 const steps=new Map<string,number>();const bytes=Buffer.from('H7-real-job-bytes\n');
 const mark=(event:string,detail:unknown={})=>{const row={index:observations.length,at:Date.now(),event,detail};observations.push(row);return row;};
 const originalCreate=http.createServer,originalRename=fs.rename,originalRecord=(ControlService.prototype as any).record;
 (ControlService.prototype as any).record=function(...args:any[]){const r=originalRecord.apply(this,args);if(args[1]==='artifact.published')mark('C.commit',args);if(args[1]==='revoke'){mark('C.revoke',args);if(scenario==='R2'){releaseIO();mark('barrier.release.after.revoke');}}if(args[1]==='task.stop.result'){stopped=true;mark('C.stop.result',args);if(scenario==='R3'){releaseIO();mark('response.release.after.stop');}}return r;};
 fs.rename=async function(a:any,b:any){if(scenario==='R2'&&String(a).endsWith('.tmp')&&String(b).includes('/published/')){barrier=true;mark('rename.barrier',{from:a,to:b});releaseReady();await io;mark('rename.resume');}return originalRename(a,b);};
 (http as any).createServer=function(...args:any[]){const listener=args.at(-1);if(typeof listener!=='function')return (originalCreate as any)(...args);args[args.length-1]=(q:any,r:any)=>{
  if(q.url==='/control'){
   const chunks:Buffer[]=[];q.on('data',(c:Buffer)=>chunks.push(Buffer.from(c)));const end=r.end;
   r.end=function(...endArgs:any[]){let body:any;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{}const publish=body?.operation==='tool.execute'&&body?.input?.tool==='artifact.publish';
    if(publish){const response=String(endArgs[0]??'');wire.push({at:Date.now(),request:body,status:r.statusCode,response});mark('rpc.reply.ready',{sessionID:body.sessionID,callID:body.input.callID,status:r.statusCode,response});
     if(scenario==='R1'){mark('socket.destroy.after.commit',{sessionID:body.sessionID,callID:body.input.callID});r.destroy();return r;}
     if(scenario==='R3'){barrier=true;mark('response.barrier',{sessionID:body.sessionID,callID:body.input.callID});releaseReady();void io.then(()=>{mark('response.late.attempt',{destroyed:r.destroyed,writableFinished:r.writableFinished});end.apply(r,endArgs);});return r;}
    }
    return end.apply(r,endArgs);
   };
   q.on('aborted',()=>mark('rpc.request.aborted'));r.on('close',()=>{if(Buffer.concat(chunks).toString().includes('artifact.publish'))mark('rpc.response.close',{finished:r.writableFinished,destroyed:r.destroyed});});
  }listener(q,r);
 };return (originalCreate as any)(...args);};syncBuiltinESMExports();
 const stub=originalCreate((q,r)=>{void(async()=>{
  const chunks:Buffer[]=[];for await(const c of q)chunks.push(Buffer.from(c));assert(q.url?.endsWith('/chat/completions'));
  const body=JSON.parse(Buffer.concat(chunks).toString());const first=JSON.stringify(body.messages.find((m:any)=>m.role==='user')?.content??'');
  const who=/H7_ROLE_(intake|domain-solver|engineer|recon)/.exec(first)?.[1]??'coordinator';const step=steps.get(who)??0;steps.set(who,step+1);
  const results=body.messages.filter((m:any)=>m.role==='tool').map((m:any)=>String(m.content));const decoded=results.flatMap((s:string)=>{try{return [JSON.parse(s)];}catch{return [];}});const all=body.messages.map((m:any)=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  const calls:any[]=[];const call=(name:string,args:object={})=>calls.push({name,args});let content='WAIT_FOR_NATIVE_TASK';
  const task=(role:string,extra='')=>call('task',{subagent_type:role,description:`H7 ${role}`,prompt:`H7_ROLE_${role} ${extra}`,...(role==='intake'?{}:{background:true})});
  if(who==='coordinator'){
   if(phase===0){task('intake');phase++;}
   else if(phase===1){assert(all.includes('INTAKE_READY'));call('ctf_challenge_assign',{role:'domain-solver',challenge:'X'});phase++;}
   else if(phase===2){task('domain-solver');phase++;}
   else if(phase===3&&['R2','R3'].includes(scenario)){call('ctf_challenge_assign',{role:'recon',challenge:'X'});phase++;}
   else if(phase===4&&['R2','R3'].includes(scenario)){task('recon');phase++;}
   else if(phase===5&&['R2','R3'].includes(scenario)&&all.includes('SIBLING_BARRIER_READY')){
    const initial=results.find((s:string)=>s.includes('Background task started')&&s.includes('<task id='));const m=initial&&/<task id="(ses_[\w]+)"/.exec(initial);assert(m,'native source task id');call('ctf_task_stop',{task_id:m[1]});phase++;
   }else if(['control','R1'].includes(scenario)&&phase===3&&all.includes('SOURCE_RESULT:')){
    if(scenario==='control'){call('ctf_challenge_assign',{role:'engineer',challenge:'X'});phase++;}else{assert(all.includes('SOURCE_RESULT:UNKNOWN'));content='HANDOFF_UNKNOWN no ref delivered; pause affected handoff';phase=9;}
   }else if(scenario==='control'&&phase===4){const m=/SOURCE_RESULT:(\{[^\n]+\})/.exec(all);assert(m);task('engineer','HANDOFF:'+m[1]);phase++;}
   else if(scenario==='control'&&phase===5&&all.includes('ENGINEER_READ_OK')){content='CONTROL_WIRING_COMPLETE';phase=9;}
   else if(['R2','R3'].includes(scenario)&&phase===6){assert(results.some((s:string)=>s.includes('"state":"stopped"')),'actual stop reply');content='STOP_CONFIRMED no late handoff authorized';phase=9;}
   else if(phase===9)content='END';
  }else if(who==='intake'){if(step===0)call('ctf_challenge_list');else content='INTAKE_READY';}
  else if(who==='domain-solver'){
   if(step===0)call('ctf_job_run',{argv:[process.execPath,'-e',"process.stdout.write('H7-real-job-bytes\\n')"],timeout_ms:5000});
   else if(step===1){const j=decoded.findLast((v:any)=>v.job);assert(j?.job);call('ctf_artifact_publish',{source:'job',job:j.job,stream:'stdout'});}
   else if(scenario==='control'){const p=decoded.findLast((v:any)=>v.ref);assert(p?.snapshotFixed);content='SOURCE_RESULT:'+JSON.stringify(p);}
   else{assert(!decoded.some((v:any)=>v.ref));content='SOURCE_RESULT:UNKNOWN';}
  }else if(who==='recon'){await ready;content='SIBLING_BARRIER_READY';mark('sibling.native.completion.ready');}
  else{const m=/HANDOFF:(\{[^\n]+\})/.exec(first.replaceAll('\\"','"'));assert(m);const p=JSON.parse(m[1]!);if(step===0)call('ctf_artifact_read',{ref:p.ref});else{const page=decoded.findLast((v:any)=>v.data);assert(page);assert.deepEqual(Buffer.from(page.data,'base64'),bytes);content='ENGINEER_READ_OK';}}
  provider.push({at:Date.now(),seq:++seq,who,step,phase,request:body,calls,content});const b={id:`chatcmpl-${seq}`,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'scripted'};
  const delta=calls.length?{role:'assistant',tool_calls:calls.map((c,i)=>({index:i,id:`call_${seq}_${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{role:'assistant',content};r.writeHead(200,{'content-type':'text/event-stream'});for(const v of [{...b,choices:[{index:0,delta,finish_reason:null}]},{...b,choices:[{index:0,delta:{},finish_reason:calls.length?'tool_calls':'stop'}]},{...b,choices:[],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}])r.write(`data: ${JSON.stringify(v)}\n\n`);r.end('data: [DONE]\n\n');
 })().catch(e=>{failure=String(e);r.writeHead(500).end('{}');});});await new Promise<void>(r=>stub.listen(0,'127.0.0.1',r));
 process.env.H7_STUB_KEY='local-nonsecret';process.env.HTTP_PROXY=process.env.HTTPS_PROXY=process.env.ALL_PROXY='http://127.0.0.1:9';process.env.NO_PROXY='127.0.0.1,localhost';
 const config={model:'stub/scripted',enabled_providers:['stub'],provider:{stub:{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${(stub.address() as any).port}/v1`,apiKey:'{env:H7_STUB_KEY}'},models:{scripted:{limit:{context:65536,output:2048}}}}}};assert.deepEqual(config.enabled_providers,['stub']);assert.equal(new URL(config.provider.stub.options.baseURL).hostname,'127.0.0.1');
 await fs.writeFile(join(out,'provider-config.json'),JSON.stringify({...config,proxy:{HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY,ALL_PROXY:process.env.ALL_PROXY,NO_PROXY:process.env.NO_PROXY}},null,2));await fs.writeFile(join(root,'opencode.json'),JSON.stringify(config));
 await fs.writeFile(join(out,'versions.json'),JSON.stringify({node:process.version,opencode:execFileSync('/Users/caihaoming/.opencode/bin/opencode',['--version'],{encoding:'utf8'}).trim(),sdk:JSON.parse(await fs.readFile('node_modules/@opencode-ai/sdk/package.json','utf8')).version,plugin:JSON.parse(await fs.readFile('node_modules/@opencode-ai/plugin/package.json','utf8')).version},null,2));
 await fs.writeFile(join(root,'challenges.json'),JSON.stringify({challenges:[{id:'X',statement:'H7 public nonsecret fixture; no oracle'}]}));await fs.writeFile(join(root,'profile.json'),JSON.stringify({profileId:'h7-local',challenges:'challenges.json',opencode:{configPath:'opencode.json',binaryPath:'/Users/caihaoming/.opencode/bin/opencode'},reference:{enabled:false},budget:{wallClockMs:25000,maxSteps:40,maxObservableTokens:100000,maxToolJobs:3},os:{platform:'macos'}}));
 const abort=new AbortController();
 try{
  result=await launch({profile:join(root,'profile.json'),runsRoot:join(root,'runs'),runId:scenario,onStarted:async({client})=>{const s=await client.event.subscribe({},{signal:abort.signal,throwOnError:true});void(async()=>{try{for await(const e of s.stream)events.push({at:Date.now(),...e});}catch{}})();}});
  assert.equal(failure,undefined);assert.equal(result.status,'completed');assert.equal(phase,9);
  const ev=join(result.runDir,'evidence');const load=async(n:string)=>JSON.parse(await fs.readFile(join(ev,n),'utf8'));const pubs=await load('publications.json'),resources=await load('tool-resources.json'),executions=await load('task-executions.json'),audit=await load('control-audit.json');
  assert.equal(pubs.length,scenario==='R2'?0:1);assert.equal(provider.flatMap(p=>p.calls).filter(c=>c.name==='ctf_job_run').length,1);assert.equal(provider.flatMap(p=>p.calls).filter(c=>c.name==='ctf_artifact_publish').length,1);assert(resources.every((r:any)=>r.state==='settled'));assert.equal(resources.filter((r:any)=>r.tool==='job.run').length,1);
  for(const p of pubs){assert.deepEqual(await fs.readFile(join(result.runDir,'workspace/X',p.path)),bytes);assert.equal(p.sha256,hash(bytes));assert.equal(p.source.execution,executions.find((e:any)=>e.role==='domain-solver').ref);}
  if(scenario==='R1'){assert(observations.some(o=>o.event==='socket.destroy.after.commit'));assert(provider.some(p=>p.who==='domain-solver'&&JSON.stringify(p.request.messages).includes('denied: control unavailable')));assert(!provider.some(p=>p.who==='engineer'));}
  if(['R2','R3'].includes(scenario)){assert(barrier&&stopped);assert(audit.some((a:any)=>a.op==='task.cancel'));assert.equal(executions.find((e:any)=>e.role==='domain-solver').state,'cancelled');assert.equal(executions.find((e:any)=>e.role==='domain-solver').delivery,'stop_reply');assert(!provider.some(p=>p.who==='domain-solver'&&p.step>1));assert(!provider.some(p=>p.who==='engineer'));}
  const order=(...names:string[])=>{const indices=names.map(n=>observations.findIndex(o=>o.event===n));assert(indices.every((n,i)=>n>=0&&(i===0||n>indices[i-1]!)),JSON.stringify({names,indices}));};
  const sourceExecution=executions.find((e:any)=>e.role==='domain-solver');
  const publishResource=resources.find((r:any)=>r.tool==='artifact.publish');assert.equal(publishResource.execution,sourceExecution.ref);assert.equal(publishResource.sessionID,sourceExecution.childID);
  const messages=await load('messages-'+sourceExecution.childID+'.json');const parts=messages.flatMap((m:any)=>m.parts??[]);const publishPart=parts.find((p:any)=>p.type==='tool'&&p.tool==='ctf_artifact_publish');assert(publishPart);assert.equal(publishPart.callID,publishResource.callID);
  const jobResource=resources.find((r:any)=>r.tool==='job.run');assert.deepEqual(await fs.readFile(join(result.runDir,'state/jobs',jobResource.sessionID,jobResource.job,'stdout.bin')),bytes);
  if(scenario==='control'){order('C.commit','rpc.reply.ready','rpc.response.close');assert.equal(publishPart.state.status,'completed');}
  if(scenario==='R1'){order('C.commit','rpc.reply.ready','socket.destroy.after.commit','rpc.response.close');assert.equal(publishPart.state.status,'error');assert.equal(publishPart.state.error,'denied: control unavailable');}
  if(scenario==='R2'){order('rename.barrier','C.revoke','barrier.release.after.revoke','rename.resume','C.stop.result');assert(!observations.some(o=>o.event==='C.commit'));assert.deepEqual(await fs.readdir(join(result.runDir,'workspace/X/published')),[]);assert.equal(publishResource.result,'cancelled');}
  if(scenario==='R3'){order('C.commit','response.barrier','C.revoke','rpc.response.close','C.stop.result','response.release.after.stop','response.late.attempt');assert.equal(publishPart.state.status,'error');assert.equal(publishPart.state.error,'Tool execution aborted');assert.equal(publishResource.result,'completed');}
  await fs.writeFile(join(out,'summary.json'),JSON.stringify({scenario,verdict:'passed',result,publicationCount:pubs.length,sourceJobs:1,publishCalls:1,sourceExecution,publishResource,publishToolState:publishPart.state,realModelCalls:0,usage:'scripted zero only; real usage unavailable',solved:false},null,2));
 }catch(e){failure=failure??String(e);process.exitCode=1;}finally{
  releaseReady();releaseIO();abort.abort();(http as any).createServer=originalCreate;fs.rename=originalRename;(ControlService.prototype as any).record=originalRecord;syncBuiltinESMExports();
  if(result?.runDir)for(const dir of ['evidence','workspace','state'])await fs.cp(join(result.runDir,dir),join(out,dir),{recursive:true});
  for(const [n,v]of Object.entries({provider,events,wire,observations,result:{result,failure,scenario,root,realModelCalls:0}}))await fs.writeFile(join(out,n+'.json'),JSON.stringify(v,null,2));await new Promise<void>(r=>{stub.close(()=>r());stub.closeAllConnections();});
 }console.log(JSON.stringify({scenario,result,failure,out}));
}
