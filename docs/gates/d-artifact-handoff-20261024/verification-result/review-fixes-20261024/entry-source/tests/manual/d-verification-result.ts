// Native no-model probe. Only loopback scripted provider; real E / OpenCode task / plugin / C / work / jobs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {createCtfAgentHooks} from '../../apps/opencode-plugin/src/index.js';
import {VerificationResults} from '../../apps/launcher/src/verification-results.js';
import {ControlService,MANAGED_TOOLS} from '../../apps/launcher/src/control-service.js';
import {launch} from '../../apps/launcher/src/launch.js';
const label=process.argv[2];assert(label&&/^[\w-]+$/.test(label),'fresh label required');
const base=resolve('docs/gates/d-artifact-handoff-20261024/verification-result',label);await fs.mkdir(base);
const scenarios=process.argv[3]?[process.argv[3]]:['control','rejected','missing','lost','stop','late','budget'];
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const sourceFiles=['AGENTS.md','package.json','package-lock.json','apps/launcher/src/artifact-tools.ts','apps/launcher/src/candidate-package-tools.ts','apps/launcher/src/control-service.ts','apps/launcher/src/control-rpc.ts','apps/launcher/src/run-prep.ts','apps/launcher/src/launch.ts','apps/launcher/src/workspace-tools.ts','apps/launcher/src/job-tools.ts','apps/launcher/src/http-tools.ts','apps/opencode-plugin/src/index.ts','product/opencode/opencode.json','tests/manual/d-verification-result.ts','apps/launcher/src/verification-results.ts','tests/contract/d-verification-result.test.ts','tests/contract/d-verifier-handoff.test.ts','tests/contract/opencode-config.test.ts','tests/contract/control-service.test.ts','tests/contract/g-coordinator-stop.test.ts','tests/contract/g-team-integration.test.ts','tests/contract/d-candidate-package.test.ts',...['coordinator','intake','domain-solver','engineer','recon','verifier'].map(r=>`product/opencode/agents/${r}.md`)];
await fs.mkdir(join(base,'source'));for(const path of sourceFiles){const destination=join(base,'source',path);await fs.mkdir(resolve(destination,'..'),{recursive:true});await fs.copyFile(path,destination);}
await fs.writeFile(join(base,'source-hashes.json'),JSON.stringify(await Promise.all(sourceFiles.map(async path=>({path,sha256:hash(await fs.readFile(path))}))),null,2));
const roleBodies=Object.fromEntries(await Promise.all(['coordinator','intake','domain-solver','engineer','recon','verifier'].map(async role=>[role,(await fs.readFile(`product/opencode/agents/${role}.md`,'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'').trim()])));
const productConfig=JSON.parse(await fs.readFile('product/opencode/opencode.json','utf8'));
const expectedTools=createCtfAgentHooks({controlUrl:'http://127.0.0.1:9/control',controlToken:'nonsecret-context-check-token-00000',tools:MANAGED_TOOLS}).tool!;
const expected=Buffer.from([0xe6,0x97,0x97,0x7b,0xc3,0xa9,0x7d,0,255]);
const raw=Buffer.concat([Buffer.from('log\r\n'),expected,Buffer.from('\r\nTAIL')]);
const eMaterial='E_NONSECRET\r\n';
const solverScript=`process.stdout.write(Buffer.from('${raw.toString('base64')}','base64'))`;
const extractionScript="const f=require('node:fs'); const p=require('node:path'); if(f.readFileSync(p.join('data','input.txt'),'utf8')!=='E_NONSECRET\\r\\n')throw new Error('wrong E material'); const b=f.readFileSync('raw.bin').subarray(5,14); f.writeFileSync('candidate.bin',b); process.stdout.write(b);";
for(const scenario of scenarios){
 assert(['control','rejected','missing','lost','stop','late','budget'].includes(scenario));const candidateExpected=scenario==='rejected'?Buffer.from('INCORRECT'):expected;const out=join(base,scenario);await fs.mkdir(out);
 const root=await fs.mkdtemp(join(tmpdir(),'d-package-runtime-'));const provider:any[]=[],events:any[]=[],wire:any[]=[],observations:any[]=[],loadedContext:any[]=[];
 let releaseReady!:()=>void,releaseIO!:()=>void;const ready=new Promise<void>(r=>releaseReady=r),io=new Promise<void>(r=>releaseIO=r);
 let barrier=false,stopped=false,packagePending=false,seq=0,phase=0,result:any,failure:string|undefined;const steps=new Map<string,number>();
 const mark=(event:string,detail:unknown={})=>{const row={index:observations.length,at:Date.now(),event,detail};observations.push(row);return row;};
 const originalCreate=http.createServer,originalRename=fs.rename,originalRecord=(ControlService.prototype as any).record,originalRegister=VerificationResults.prototype.register;
 (ControlService.prototype as any).record=function(...args:any[]){const r=originalRecord.apply(this,args);if(args[1]==='verification.registered')mark('C.registered',args);if(args[1]==='verification.job.terminal')mark('C.job.terminal',args);if(args[1]==='revoke'){mark('C.revoke',args);if(scenario==='stop'&&barrier){releaseIO();mark('barrier.release.after.revoke');}}if(args[1]==='task.stop.result'){stopped=true;mark('C.stop.result',args);if(scenario==='late'){releaseIO();mark('response.release.after.stop');}}return r;};
 VerificationResults.prototype.register=async function(...args:Parameters<VerificationResults['register']>){
   if(scenario==='stop'){barrier=true;mark('register.before.barrier');releaseReady();await io;mark('register.before.resume');}
   return originalRegister.apply(this,args);
 };
 (http as any).createServer=function(...args:any[]){const listener=args.at(-1);if(typeof listener!=='function')return (originalCreate as any)(...args);args[args.length-1]=(q:any,r:any)=>{
  if(q.url==='/control'){
   const chunks:Buffer[]=[];q.on('data',(c:Buffer)=>chunks.push(Buffer.from(c)));const end=r.end;
   r.end=function(...endArgs:any[]){let body:any;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{}const prepare=body?.operation==='tool.execute'&&body?.input?.tool==='verification.report';
    if(prepare){const response=String(endArgs[0]??'');wire.push({at:Date.now(),request:body,status:r.statusCode,response});mark('rpc.reply.ready',{sessionID:body.sessionID,callID:body.input.callID,status:r.statusCode,response});
     if(scenario==='lost'){mark('socket.destroy.after.register');r.destroy();return r;}
     if(scenario==='late'){barrier=true;mark('response.barrier');releaseReady();void io.then(()=>{mark('response.late.attempt',{destroyed:r.destroyed,writableFinished:r.writableFinished});end.apply(r,endArgs);});return r;}
    }return end.apply(r,endArgs);
   };r.on('close',()=>{if(Buffer.concat(chunks).toString().includes('verification.report'))mark('rpc.response.close',{finished:r.writableFinished,destroyed:r.destroyed});});
  }listener(q,r);
 };return (originalCreate as any)(...args);};syncBuiltinESMExports();
 const failedRequests:any[]=[];
 const stub=originalCreate((q,r)=>{let request:any;void(async()=>{
  const chunks:Buffer[]=[];for await(const c of q)chunks.push(Buffer.from(c));assert(q.url?.endsWith('/chat/completions'));
  const body=JSON.parse(Buffer.concat(chunks).toString());request=body;const first=String(body.messages.find((m:any)=>m.role==='user')?.content??'');
  const who=/PK_ROLE_(intake|domain-solver|engineer|recon|verifier)/.exec(first)?.[1]??'coordinator';
  if(!loadedContext.some(c=>c.role===who)){
   const system=body.messages.filter((m:any)=>m.role==='system').map((m:any)=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
   const tools=body.tools.filter((t:any)=>t.function.name.startsWith('ctf_')).map((t:any)=>({name:t.function.name,description:t.function.description}));
   loadedContext.push({role:who,system,expectedRoleBody:roleBodies[who],roleBodySha256:hash(Buffer.from(roleBodies[who]!)),tools});
   assert(system.includes(roleBodies[who]!),`actual runtime must load final ${who} body`);
   assert.deepEqual(tools.map((t:any)=>t.name).sort(),Object.entries(productConfig.agent[who].permission).filter(([name,permission])=>name.startsWith('ctf_')&&permission==='allow').map(([name])=>name).sort());
   for(const t of tools)assert.equal(t.description,expectedTools[t.name]!.description,`final description ${t.name}`);
  }
  const step=steps.get(who)??0;steps.set(who,step+1);
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
   else if(phase===5&&all.includes('ENGINEER_RESULT:')){const m=/ENGINEER_RESULT:(\{[^\n]+\})/.exec(all);assert(m);const version=JSON.parse(m[1]!).version;call('ctf_challenge_assign',{role:'verifier',challenge:'X',version});phase++;}
   else if(phase===6){const m=/ENGINEER_RESULT:(\{[^\n]+\})/.exec(all);assert(m);task('verifier','VERSION:'+JSON.parse(m[1]!).version);phase++;}
   else if(phase===7&&['stop','late'].includes(scenario)){call('ctf_challenge_assign',{role:'recon',challenge:'X'});phase++;}
   else if(phase===8){task('recon');phase++;}
   else if(phase===9&&all.includes('SIBLING_BARRIER_READY')){const initial=results.filter((s:string)=>s.includes('Background task started')&&s.includes('<task id='));assert.equal(initial.length,4);const m=/<task id="(ses_[\w]+)"/.exec(initial[2]!);assert(m);mark('parent.native.stop.handle',{taskID:m[1]});call('ctf_task_stop',{task_id:m[1]});phase++;}
   else if(phase===10){assert(results.some((s:string)=>s.includes('"state":"stopped"')));content='STOP_CONFIRMED affected verification paused';phase=11;}
   else if(phase===7&&['control','rejected','missing','lost'].includes(scenario)&&all.includes('VERIFIER_RESULT:')){if(scenario==='lost'){assert(all.includes('VERIFIER_RESULT:UNKNOWN'));content='UNKNOWN paused no blind resend';phase=11;}else{const m=/VERIFIER_RESULT:(\{[^\n]+\})/.exec(all);assert(m);const v=JSON.parse(m[1]!);call('ctf_verification_read',{challenge:'X',version:v.version,result:v.result});phase=12;}}
   else if(phase===12){const v=decoded.find((v:any)=>v.original&&v.currentAvailability);assert(v);assert.equal(v.original.judgment,scenario==='rejected'?'rejected':'verified');assert.equal(v.effectiveJudgment,scenario==='missing'?'inconclusive':scenario==='rejected'?'rejected':'verified');assert.equal(v.currentAvailability.usable,scenario!=='missing');content='COORDINATOR_READ_RESULT mechanical contract only; semantic assertion scripted; not solved';phase=11;}
   else if(phase===11)content='END';
  }else if(who==='intake'){
   if(step===0)call('ctf_challenge_list');else if(step===1)call('ctf_challenge_read',{id:'X',path:'input.txt'});else{assert(decoded.some((v:any)=>v.text===eMaterial));content='INTAKE_READY fixed E input.txt';}
  }else if(who==='domain-solver'){
   if(step===0)call('ctf_workspace_write',{path:'work/solve.cjs',content:solverScript});
   else if(step===1)call('ctf_job_run',{argv:[process.execPath,'solve.cjs'],timeout_ms:5000});
   else if(step===2){const j=decoded.findLast((v:any)=>v.job);assert.equal(j.exitCode,0);call('ctf_artifact_publish',{source:'job',job:j.job,stream:'stdout'});}
   else if(step===3)call('ctf_artifact_publish',{source:'file',path:'work/solve.cjs'});
   else{assert.equal(publications.length,2);content='SOLVER_HANDOFF:'+JSON.stringify(publications.map((p:any)=>({ref:p.ref,path:p.path,sha256:p.sha256,size:p.size})));}
  }else if(who==='recon'){await ready;mark('sibling.native.completion.ready');content='SIBLING_BARRIER_READY';}
  else if(who==='engineer'){
   assert(body.tools.some((t:any)=>t.function.name==='ctf_package_publish'));const m=/HANDOFF:(\[[^\]\n]+\])/.exec(first);assert(m,'actual native Engineer task must supply refs');const refs=JSON.parse(m[1]!);
   const pages=decoded.filter((v:any)=>v.encoding==='base64'&&v.ref);const get=(i:number)=>{const p=pages[i];assert(p);return Buffer.from(p.data,'base64');};
   if(step===0)call('ctf_artifact_read',{ref:refs[0].ref});
   else if(step===1)call('ctf_artifact_read',{ref:refs[1].ref});
   else if(step===2)call('ctf_workspace_read',{path:'materials/input.txt'});
   else if(step===3){assert.deepEqual(get(0),raw);assert(decoded.some((v:any)=>v.text===eMaterial));call('ctf_workspace_write',{path:'work/raw.bin',content:get(0).toString('base64'),encoding:'base64'});call('ctf_workspace_write',{path:'work/data/input.txt',content:decoded.find((v:any)=>v.text===eMaterial).text});}
   else if(step===4){assert.equal(get(1).toString(),solverScript);call('ctf_workspace_write',{path:'work/source.cjs',content:get(1).toString('base64'),encoding:'base64'});}
   else if(step===5)call('ctf_workspace_write',{path:'work/extract.cjs',content:scenario==='rejected'?extractionScript.replace('process.stdout.write(b);',"process.stdout.write('INCORRECT');"):extractionScript});
   else if(step===6)call('ctf_job_run',{argv:[process.execPath,'extract.cjs'],timeout_ms:5000});
   else if(step===7){assert.equal(decoded.findLast((v:any)=>v.job)?.exitCode,0);call('ctf_artifact_publish',{source:'file',path:'work/extract.cjs'});}
   else if(step===8)call('ctf_artifact_publish',{source:'file',path:'work/source.cjs'});
   else if(step===9){const j=decoded.findLast((v:any)=>v.job);call('ctf_artifact_publish',{source:'job',job:j.job,stream:'stdout'});}
   else if(step===10){assert.equal(publications.length,3);packagePending=true;mark('provider.package.call');call('ctf_package_publish',{candidate:{ref:publications[2].ref,start:0,end:9},files:[{kind:'artifact',ref:publications[0].ref,path:'extract.cjs',purpose:'script'},{kind:'artifact',ref:publications[1].ref,path:'source.cjs',purpose:'script'},{kind:'artifact',ref:refs[0].ref,path:'raw.bin',purpose:'input'},{kind:'material',name:'input.txt',path:'data/input.txt',purpose:'input'},{kind:'artifact',ref:refs[1].ref,path:'evidence/solver.cjs',purpose:'evidence'}],argv:[process.execPath,'extract.cjs'],extraction:'Engineer local extract.cjs reads raw.bin [5,14) after checking fixed E input; stdout is candidate bytes without normalization',premises:['CTF_MATERIALS must expose fixed input.txt; raw.bin relative to proposed working directory','External state unknown; binary candidate fixture; no verifier/oracle']});}
   else{
    const p=decoded.find((v:any)=>v.version&&v.candidateSha256);assert(p?.version);
    if(step===11)call('ctf_package_read',{version:p.version,component:'manifest'});
    else if(step===12)call('ctf_package_read',{version:p.version,component:'candidate'});
    else if(step===13)call('ctf_package_read',{version:p.version,component:'file',path:'data/input.txt'});
    else{const reads=decoded.filter((v:any)=>v.version&&v.data);assert.equal(reads.length,3);const manifest=JSON.parse(Buffer.from(reads[0].data,'base64').toString());assert.equal(manifest.candidate.publication.ref,publications[2].ref);assert.deepEqual(Buffer.from(reads[1].data,'base64'),candidateExpected);assert.equal(Buffer.from(reads[2].data,'base64').toString(),eMaterial);assert.equal(manifest.argvStatus,'proposed');content='ENGINEER_RESULT:'+JSON.stringify({version:p.version,sha256:reads[1].sha256});}
   }
  }
  else if(who==='verifier'){
    assert(body.tools.some((t:any)=>t.function.name==='ctf_package_prepare'));
    assert(!body.tools.some((t:any)=>['ctf_package_publish','ctf_artifact_publish','ctf_http_request'].includes(t.function.name)));
    const version=/VERSION:([^\s]+)/.exec(first)?.[1];assert(version);
    const prep=decoded.find((v:any)=>v.ready===true);
    const manifestPage=decoded.find((v:any)=>v.component==='manifest');
    if(step===0)call('ctf_package_read',{version,component:'manifest'});
    else if(step===1)call('ctf_package_read',{version,component:'candidate'});
    else if(step===2)call('ctf_package_read',{version,component:'file',path:'raw.bin'});
    else if(step===3){assert(manifestPage);call('ctf_package_prepare');}
        else if(step===4){assert(prep);const m=JSON.parse(Buffer.from(manifestPage.data,'base64').toString());assert.equal(m.argvStatus,'proposed');call('ctf_job_run',{preparation:prep.preparation,argv:scenario==='rejected'?[process.execPath,'-e',extractionScript]:m.argv,timeout_ms:15000});}
    else if(step===5){const j=decoded.findLast((v:any)=>v.job);assert(j);assert.equal(j.exitCode,0);assert.equal(j.inputAssociation.version,version);assert.equal(j.inputAssociation.continuousIntegrity,'unknown');call('ctf_job_read',{job:j.job,stream:'stdout'});}
    else if(step===6){const out=decoded.findLast((v:any)=>v.stream==='stdout');assert.deepEqual(Buffer.from(out.data,'base64'),expected);const j=decoded.findLast((v:any)=>v.job);
      call('ctf_verification_report',{judgment:scenario==='rejected'?'rejected':'verified',mode:'recompute',rationale:scenario==='rejected'?'Scripted fixture counterexample: expected candidate differs from inspected stdout':'Scripted fixture source/dataflow checked under explicit trusted local assumption',sourceFlow:'Fixed E material check, raw.bin [5,14) and extract.cjs stdout; no semantic model claim',premises:[{statement:'Trusted stable local fixture execution; semantic choice predefined by stub',status:'assumed'}],issues:[],requirements:{continuousIntegrity:false,declaredDependenciesOnly:false},evidence:scenario==='missing'?[]:[{kind:'job',job:j.job,stream:'stdout',necessary:true,context:'Whole stdout of prepared local fixture calculation'}],...(scenario==='missing'?{}:{comparison:{evidence:0,start:0,end:9}})});
    }else{if(scenario==='lost'){assert(results.some((s:string)=>s.includes('denied: control unavailable')));content='VERIFIER_RESULT:UNKNOWN pause no blind resend';}else{const v=decoded.find((v:any)=>v.result&&v.effectiveJudgment);assert(v);content='VERIFIER_RESULT:'+JSON.stringify({result:v.result,version});}}
  }
  provider.push({at:Date.now(),seq:++seq,who,step,phase,request:body,calls,content});const b={id:`chatcmpl-${seq}`,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'scripted'};
  const delta=calls.length?{role:'assistant',tool_calls:calls.map((c,i)=>({index:i,id:`call_${seq}_${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{role:'assistant',content};r.writeHead(200,{'content-type':'text/event-stream'});for(const v of [{...b,choices:[{index:0,delta,finish_reason:null}]},{...b,choices:[{index:0,delta:{},finish_reason:calls.length?'tool_calls':'stop'}]},{...b,choices:[],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}])r.write(`data: ${JSON.stringify(v)}\n\n`);r.end('data: [DONE]\n\n');
 })().catch(e=>{failure??=String(e);failedRequests.push({at:Date.now(),error:String(e),request});mark('provider.failure',String(e));r.writeHead(500).end('{}');});});await new Promise<void>(r=>stub.listen(0,'127.0.0.1',r));
 process.env.PK_STUB_KEY='local-nonsecret';process.env.HTTP_PROXY=process.env.HTTPS_PROXY=process.env.ALL_PROXY='http://127.0.0.1:9';process.env.NO_PROXY='127.0.0.1,localhost';
 const config={model:'stub/scripted',enabled_providers:['stub'],provider:{stub:{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${(stub.address() as any).port}/v1`,apiKey:'{env:PK_STUB_KEY}'},models:{scripted:{limit:{context:65536,output:2048}}}}}};assert.deepEqual(config.enabled_providers,['stub']);assert.equal(new URL(config.provider.stub.options.baseURL).hostname,'127.0.0.1');
 await fs.writeFile(join(out,'provider-config.json'),JSON.stringify({...config,proxy:{HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY,ALL_PROXY:process.env.ALL_PROXY,NO_PROXY:process.env.NO_PROXY}},null,2));await fs.writeFile(join(root,'opencode.json'),JSON.stringify(config));
 await fs.writeFile(join(out,'versions.json'),JSON.stringify({node:process.version,opencode:execFileSync('/Users/caihaoming/.opencode/bin/opencode',['--version'],{encoding:'utf8'}).trim(),sdk:JSON.parse(await fs.readFile('node_modules/@opencode-ai/sdk/package.json','utf8')).version,plugin:JSON.parse(await fs.readFile('node_modules/@opencode-ai/plugin/package.json','utf8')).version},null,2));
 await fs.writeFile(join(root,'input.txt'),eMaterial);await fs.writeFile(join(root,'challenges.json'),JSON.stringify({challenges:[{id:'X',statement:'D package public nonsecret fixture; no oracle',materials:['input.txt']}]}));await fs.writeFile(join(root,'profile.json'),JSON.stringify({profileId:'package-local',challenges:'challenges.json',opencode:{configPath:'opencode.json',binaryPath:'/Users/caihaoming/.opencode/bin/opencode'},reference:{enabled:false},budget:{wallClockMs:60000,maxSteps:scenario==='budget'?39:90,maxObservableTokens:100000,maxToolJobs:3},os:{platform:'macos'}}));
 const abort=new AbortController();
 try{
  result=await launch({profile:join(root,'profile.json'),runsRoot:join(root,'runs'),runId:scenario,onStarted:async({client})=>{const s=await client.event.subscribe({},{signal:abort.signal,throwOnError:true});void(async()=>{try{for await(const e of s.stream)events.push({at:Date.now(),...e});}catch{}})();}});
  assert.equal(failure,undefined);assert.equal(result.status,scenario==='budget'?'budget_exceeded':'completed');assert.equal(phase,scenario==='budget'?7:11);
  for(const role of ['coordinator','domain-solver','engineer','verifier'])assert(loadedContext.some(c=>c.role===role),`loaded ${role} context`);
  const ev=join(result.runDir,'evidence');const load=async(n:string)=>JSON.parse(await fs.readFile(join(ev,n),'utf8'));const pubs=await load('publications.json'),resources=await load('tool-resources.json'),executions=await load('task-executions.json'),audit=await load('control-audit.json');
  const packages=pubs.filter((p:any)=>p.source.kind==='package');assert.equal(packages.length,1);const sourceExecution=executions.find((e:any)=>e.role==='domain-solver'),engineerExecution=executions.find((e:any)=>e.role==='engineer'),verifierExecution=executions.find((e:any)=>e.role==='verifier');
  assert.equal(new Set([sourceExecution.childID,engineerExecution.childID,verifierExecution.childID]).size,3);assert.equal(verifierExecution.version,packages[0].ref);
  const calls=provider.flatMap(p=>p.calls);assert.equal(calls.filter(c=>c.name==='ctf_artifact_publish').length,5);assert.equal(calls.filter(c=>c.name==='ctf_package_publish').length,1);assert.equal(calls.filter(c=>c.name==='ctf_package_prepare').length,1);assert(resources.every((r:any)=>r.state==='settled'));
  const prepareResource=resources.find((r:any)=>r.tool==='package.prepare');assert.equal(prepareResource.execution,verifierExecution.ref);assert.equal(prepareResource.sessionID,verifierExecution.childID);
  const messages=await load('messages-'+verifierExecution.childID+'.json');const part=messages.flatMap((m:any)=>m.parts??[]).find((p:any)=>p.type==='tool'&&p.tool==='ctf_package_prepare');assert(part);assert.equal(part.callID,prepareResource.callID);
  const fixed=packages[0];const bytes=await fs.readFile(join(result.runDir,'workspace/X',fixed.path));assert.equal(hash(bytes),fixed.sha256);const manifest=JSON.parse(bytes.toString());assert.deepEqual(Buffer.from(manifest.candidate.data,'base64'),candidateExpected);assert.equal(manifest.files.find((f:any)=>f.path==='raw.bin').publication.source.execution,sourceExecution.ref);
  await fs.writeFile(join(out,'fixed-manifest.json'),bytes);await fs.writeFile(join(out,'candidate.bin'),Buffer.from(manifest.candidate.data,'base64'));
  const prepared=audit.find((a:any)=>a.op==='package.prepared');assert(prepared);
  const j=resources.find((r:any)=>r.tool==='job.run'&&r.sessionID===verifierExecution.childID);assert(j);
  const records=await load('verification-results.json');const reportResource=resources.find((r:any)=>r.tool==='verification.report');
  const reportMessages=messages.flatMap((m:any)=>m.parts??[]).filter((p:any)=>p.type==='tool'&&p.tool==='ctf_verification_report');
  const order=(...names:string[])=>{const indices=names.map(n=>observations.findIndex(o=>o.event===n));assert(indices.every((n,i)=>n>=0&&(i===0||n>indices[i-1]!)),JSON.stringify({names,indices}));};
  if(['control','rejected','missing'].includes(scenario)){
    order('C.job.terminal','C.registered','rpc.reply.ready');assert.equal(records.length,1);assert.equal(reportMessages[0].state.status,'completed');assert(verifierExecution.delivered);assert.equal(records[0].version,fixed.ref);assert.equal(records[0].execution,verifierExecution.ref);assert.equal(calls.filter(c=>c.name==='ctf_verification_read').length,1);assert.equal(calls.filter(c=>c.name==='ctf_verification_report').length,1);
    assert.equal(records[0].effectiveJudgment,scenario==='missing'?'inconclusive':scenario==='rejected'?'rejected':'verified');if(scenario!=='missing')assert.equal(records[0].hostChecks.candidateEqual,scenario!=='rejected');
  }
  if(scenario==='budget'){assert.equal(records.length,0);assert(!reportResource);assert(audit.some((a:any)=>a.op==='model.call'&&!a.allow&&a.reason==='budget denied'));assert.equal(provider.filter(p=>p.who==='verifier').length,6);}
  if(scenario==='lost'){order('C.registered','rpc.reply.ready','socket.destroy.after.register','rpc.response.close');assert.equal(records.length,1);assert.equal(reportMessages[0].state.status,'error');assert.equal(reportMessages[0].state.error,'denied: control unavailable');assert.equal(calls.filter(c=>c.name==='ctf_verification_report').length,1);assert.equal(calls.filter(c=>c.name==='ctf_verification_read').length,0);assert(provider.some(p=>p.who==='verifier'&&p.content.includes('UNKNOWN')));}
  if(['stop','late'].includes(scenario)){
    assert(barrier&&stopped);assert.equal(verifierExecution.state,'cancelled');assert.equal(verifierExecution.delivery,'stop_reply');assert.equal(calls.filter(c=>c.name==='ctf_task_stop').length,1);assert.equal(observations.find(o=>o.event==='parent.native.stop.handle').detail.taskID,verifierExecution.childID);
    assert.equal(calls.filter(c=>c.name==='ctf_verification_report').length,1);
  }
  if(scenario==='stop'){order('register.before.barrier','C.revoke','barrier.release.after.revoke','register.before.resume','C.stop.result');assert.equal(records.length,0);assert.equal(reportResource.result,'cancelled');}
  if(scenario==='late'){order('C.registered','response.barrier','C.revoke','rpc.response.close','C.stop.result','response.release.after.stop','response.late.attempt');assert.equal(records.length,1);assert.equal(reportMessages[0].state.status,'error');assert.equal(reportMessages[0].state.error,'Tool execution aborted');assert.equal(reportResource.result,'completed');assert(!provider.some(p=>p.who==='verifier'&&p.step>6));}
  await fs.writeFile(join(out,'summary.json'),JSON.stringify({scenario,verdict:'passed',result,sourceExecution,engineerExecution,verifierExecution,reportResource,reportToolState:reportMessages[0]?.state,records:records.length,realModelCalls:0,realUsage:'unavailable',scriptedUsage:'zero only',solved:false,scope:'D fourth interface isolated prototype; semantic assertions predefined; no model/solved claim'},null,2));
 }catch(e){failure=failure??String(e);process.exitCode=1;console.error(e);}finally{
  releaseReady();releaseIO();abort.abort();(http as any).createServer=originalCreate;fs.rename=originalRename;VerificationResults.prototype.register=originalRegister;(ControlService.prototype as any).record=originalRecord;syncBuiltinESMExports();
  if(result?.runDir)for(const dir of ['evidence','workspace','state'])await fs.cp(join(result.runDir,dir),join(out,dir),{recursive:true});
  for(const [n,v]of Object.entries({provider,failedRequests,events,wire,observations,loadedContext,result:{result,failure,scenario,root,realModelCalls:0}}))await fs.writeFile(join(out,n+'.json'),JSON.stringify(v,null,2));await fs.writeFile(join(out,'expected-raw.bin'),raw);await fs.writeFile(join(out,'expected-candidate.bin'),expected);await new Promise<void>(r=>{stub.close(()=>r());stub.closeAllConnections();});
 }console.log(JSON.stringify({scenario,result,failure,out}));
}
