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
import {CompletionRequests} from '../../apps/launcher/src/completion-tools.js';
import {VerificationResults} from '../../apps/launcher/src/verification-results.js';
import {ControlService,MANAGED_TOOLS} from '../../apps/launcher/src/control-service.js';
import {launch} from '../../apps/launcher/src/launch.js';
const label=process.argv[2];assert(label&&/^[\w-]+$/.test(label),'fresh label required');
const outputRoot=resolve('runs/d-trusted-completion');await fs.mkdir(outputRoot,{recursive:true});
const base=join(outputRoot,label);await fs.mkdir(base);
const scenarios=process.argv[3]?[process.argv[3]]:['control','rejected','noj','missing','judge-lost','rpc-lost','stop','late','before-stop','budget'];
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const sourceFiles=['AGENTS.md','package.json','package-lock.json','apps/launcher/src/artifact-tools.ts','apps/launcher/src/candidate-package-tools.ts','apps/launcher/src/control-service.ts','apps/launcher/src/control-rpc.ts','apps/launcher/src/run-prep.ts','apps/launcher/src/launch.ts','apps/launcher/src/workspace-tools.ts','apps/launcher/src/job-tools.ts','apps/launcher/src/http-tools.ts','apps/opencode-plugin/src/index.ts','product/opencode/opencode.json','tests/manual/d-trusted-completion.ts','apps/launcher/src/completion-tools.ts','apps/launcher/src/verification-results.ts','tests/contract/d-verification-result.test.ts','tests/contract/d-verifier-handoff.test.ts','tests/contract/opencode-config.test.ts','tests/contract/control-service.test.ts','tests/contract/g-coordinator-stop.test.ts','tests/contract/g-team-integration.test.ts','tests/contract/d-candidate-package.test.ts',...['coordinator','intake','domain-solver','engineer','recon','verifier'].map(r=>`product/opencode/agents/${r}.md`)];
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
 assert(['control','rejected','noj','missing','judge-lost','rpc-lost','stop','late','before-stop','budget'].includes(scenario));const candidateExpected=scenario==='rejected'?Buffer.from('INCORRECT'):expected;const out=join(base,scenario);await fs.mkdir(out);
 const root=await fs.mkdtemp(join(tmpdir(),'d-package-runtime-'));const provider:any[]=[],events:any[]=[],wire:any[]=[],observations:any[]=[],loadedContext:any[]=[],readbackPages:any[]=[];let reportReadback:any;const judgeReceived:any[]=[];let completionReadback:any;
 let releaseReady!:()=>void,releaseIO!:()=>void;const ready=new Promise<void>(r=>releaseReady=r),io=new Promise<void>(r=>releaseIO=r);
 let barrier=false,stopped=false,packagePending=false,seq=0,phase=0,result:any,failure:string|undefined;const steps=new Map<string,number>();
 const mark=(event:string,detail:unknown={})=>{const row={index:observations.length,at:Date.now(),event,detail};observations.push(row);return row;};
 const originalCreate=http.createServer,originalRename=fs.rename,originalRecord=(ControlService.prototype as any).record,originalRegister=VerificationResults.prototype.register,originalSave=(CompletionRequests.prototype as any).save;
 (ControlService.prototype as any).record=function(...args:any[]){const r=originalRecord.apply(this,args);if(args[1]==='verification.registered')mark('C.registered',args);if(args[1]==='completion.saved')mark('C.completion.saved',args);if(args[1]==='verification.job.terminal')mark('C.job.terminal',args);if(args[1]==='stop_marked'){mark('C.stop_marked',args);if(scenario==='before-stop'&&barrier){releaseIO();mark('barrier.release.after.revoke');}}return r;};
 (CompletionRequests.prototype as any).save=async function(row:any){await originalSave.call(this,row);mark('completion.persist',{state:row.state,sent:row.sent,intent:row.intent});if(scenario==='before-stop'&&row.state==='intent'&&!barrier){barrier=true;mark('intent.before.dispatch.barrier');await io;mark('intent.before.dispatch.resume');}};
 (http as any).createServer=function(...args:any[]){const listener=args.at(-1);if(typeof listener!=='function')return (originalCreate as any)(...args);args[args.length-1]=(q:any,r:any)=>{
  if(q.url==='/control'){
   const chunks:Buffer[]=[];q.on('data',(c:Buffer)=>chunks.push(Buffer.from(c)));const end=r.end;
   r.end=function(...endArgs:any[]){let body:any;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{}const target=body?.operation==='tool.execute'&&body?.input?.tool==='completion.request';
    if(target){const response=String(endArgs[0]??'');wire.push({at:Date.now(),request:body,status:r.statusCode,response});mark('rpc.reply.ready',{sessionID:body.sessionID,callID:body.input.callID,status:r.statusCode,response});
     if(scenario==='rpc-lost'){mark('socket.destroy.after.save');r.destroy();return r;}
     if(scenario==='late'){barrier=true;mark('response.barrier');void io.then(()=>{mark('response.late.attempt',{destroyed:r.destroyed,writableFinished:r.writableFinished});end.apply(r,endArgs);});return r;}
    }return end.apply(r,endArgs);
   };r.on('close',()=>{if(Buffer.concat(chunks).toString().includes('completion.request')){mark('rpc.response.close',{finished:r.writableFinished,destroyed:r.destroyed});if(scenario==='late'){releaseIO();mark('response.release.after.close');}}});
  }listener(q,r);
 };return (originalCreate as any)(...args);};syncBuiltinESMExports();
 const judgeServer=originalCreate((q,r)=>{void(async()=>{const chunks:Buffer[]=[];for await(const c of q)chunks.push(Buffer.from(c));const bytes=Buffer.concat(chunks);const intent=String(q.headers['x-intent']),challenge=String(q.headers['x-challenge']);judgeReceived.push({intent,challenge,data:bytes.toString('base64'),sha256:hash(bytes),size:bytes.length,at:Date.now()});mark('judge.received',{intent,size:bytes.length});assert.deepEqual(bytes,candidateExpected);
  await fs.writeFile(join(out,'judge-received-'+judgeReceived.length+'.bin'),bytes);
  if(scenario==='judge-lost'){mark('judge.socket.destroy.after.receive');r.destroy();return;}
  if(scenario==='stop'){mark('judge.response.hold.until.native.deadline');q.socket.on('close',()=>mark('judge.socket.close'));return;}
  const raw={intent,challenge,status:scenario==='rejected'?'rejected':'accepted',completed:scenario!=='rejected'};await fs.writeFile(join(out,'judge-raw-reply.json'),JSON.stringify(raw,null,2));r.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(raw));
 })().catch(e=>{failure??=String(e);r.destroy();});});await new Promise<void>(r=>judgeServer.listen(0,'127.0.0.1',r));
 const judge={id:'nonsecret-loopback-judge',timeoutMs:20000,submit:async(i:any)=>{mark('judge.transport.send',{intent:i.intent});const response=await fetch(`http://127.0.0.1:${(judgeServer.address() as any).port}/judge`,{method:'POST',headers:{'x-intent':i.intent,'x-challenge':i.challenge},body:i.bytes,signal:i.signal});return response.json();}};
 const failedRequests:any[]=[];
 const stub=originalCreate((q,r)=>{let request:any;void(async()=>{
  const chunks:Buffer[]=[];for await(const c of q)chunks.push(Buffer.from(c));assert(q.url?.endsWith('/chat/completions'));
  const body=JSON.parse(Buffer.concat(chunks).toString());request=body;const first=String(body.messages.find((m:any)=>m.role==='user')?.content??'');
  const who=/PK_ROLE_(intake|domain-solver|engineer|recon|verifier)/.exec(first)?.[1]??'coordinator';
  if(!loadedContext.some(c=>c.role===who)){
   const system=body.messages.filter((m:any)=>m.role==='system').map((m:any)=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
   const tools=body.tools.filter((t:any)=>t.function.name.startsWith('ctf_')).map((t:any)=>({name:t.function.name,description:t.function.description,parameters:t.function.parameters}));
   loadedContext.push({role:who,system,expectedRoleBody:roleBodies[who],roleBodySha256:hash(Buffer.from(roleBodies[who]!)),tools});
   assert(system.includes(roleBodies[who]!),`actual runtime must load final ${who} body`);
   assert.deepEqual(tools.map((t:any)=>t.name).sort(),Object.entries(productConfig.agent[who].permission).filter(([name,permission])=>name.startsWith('ctf_')&&permission==='allow').map(([name])=>name).sort());
   if(who==='coordinator')assert(Object.hasOwn(tools.find((t:any)=>t.name==='ctf_verification_read')!.parameters.properties,'cursor'));
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
   else if(phase===7&&all.includes('VERIFIER_RESULT:')){const m=/VERIFIER_RESULT:(\{[^\n]+\})/.exec(all);assert(m);const v=JSON.parse(m[1]!);call('ctf_verification_read',{challenge:'X',version:v.version,result:v.result});phase=12;}
   else if(phase===12){const pages=decoded.filter((v:any)=>v.report?.encoding==='base64'&&v.currentAvailability);assert(pages.length);const last=pages.at(-1);const bytes=Buffer.concat(pages.map((v:any,i:number)=>{assert(Buffer.byteLength(JSON.stringify(v))<262144);assert.equal(v.report.sha256,pages[0].report.sha256);assert.equal(v.report.size,pages[0].report.size);assert.equal(v.report.offset,pages.slice(0,i).reduce((n:number,p:any)=>n+Buffer.from(p.report.data,'base64').length,0));return Buffer.from(v.report.data,'base64');}));
    readbackPages.push(last);
    if(last.report.nextCursor!==null){assert.equal(last.report.done,false);call('ctf_verification_read',{challenge:last.challenge,version:last.version,result:last.result,cursor:last.report.nextCursor});}
    else{assert.equal(last.report.done,true);assert.equal(bytes.length,last.report.size);assert.equal(hash(bytes),last.report.sha256);const v=JSON.parse(bytes.toString());assert.equal(v.original.judgment,'verified');assert.equal(v.effectiveJudgment,scenario==='missing'?'inconclusive':'verified');assert.equal(last.currentAvailability.usable,scenario!=='missing');if(scenario==='large'){assert(bytes.length>1048576);assert.equal(Buffer.from(v.evidence[1].data,'base64').length,1048576);assert.equal(v.evidence[1].necessary,false);assert.equal(v.evidence[1].originalComplete,false);assert(Buffer.from(v.evidence[1].data,'base64').equals(Buffer.alloc(1048576,120)));assert(pages.length>1);}await fs.writeFile(join(out,'coordinator-report.bin'),bytes);await fs.writeFile(join(out,'coordinator-read-pages.json'),JSON.stringify(pages,null,2));reportReadback={pages:pages.length,size:bytes.length,sha256:hash(bytes),largestReply:Math.max(...pages.map((p:any)=>Buffer.byteLength(JSON.stringify(p)))),complete:true};call('ctf_completion_request',{challenge:last.challenge,version:last.version,result:last.result});phase=13;}
   }
   else if(phase===13){
    const c=decoded.findLast((v:any)=>v.intent&&v.candidateSha256);completionReadback=c??{delivery:'unknown',errors:results.filter((s:string)=>s.includes('denied:'))};
    if(scenario==='missing'){assert(results.some((s:string)=>s.includes('current verified')));content='RESULT_UNUSABLE zero dispatch; return evidence gap to team';}
    else if(scenario==='rpc-lost'){assert(results.some((s:string)=>s.includes('denied: control unavailable')));content='UNKNOWN delivery; pause same challenge; no resend';}
    else{assert(c);assert.equal(c.state,scenario==='judge-lost'?'unknown':scenario==='noj'?'candidate_only':'confirmed');assert.equal(c.solved,!['rejected','noj','judge-lost'].includes(scenario));content=scenario==='rejected'?'JUDGE_REJECTED return to existing team for correction':scenario==='judge-lost'?'UNKNOWN judge result; pause no resend':'COMPLETION_OBSERVED';}
    if(scenario==='rejected'){assert.equal(c.businessOutcome,'rejected');call('ctf_challenge_assign',{role:'engineer',challenge:'X'});phase=14;}else phase=11;
   }
   else if(phase===14){task('engineer','COMPLETION_FEEDBACK:'+JSON.stringify({intent:completionReadback.intent,challenge:'X',businessOutcome:completionReadback.businessOutcome,solved:completionReadback.solved}));phase=15;}
   else if(phase===15&&all.includes('ENGINEER_REJECTION_RECEIVED:')){assert(all.includes('ENGINEER_REJECTION_RECEIVED:'+completionReadback.intent));content='REJECTION_RETURN_DELIVERED native Engineer receipt confirmed; correction not attempted';phase=11;}
   else if(phase===11)content='END';
  }else if(who==='engineer'&&first.includes('COMPLETION_FEEDBACK:')){const m=/COMPLETION_FEEDBACK:(\{[^\n]+\})/.exec(first);assert(m);const feedback=JSON.parse(m[1]!);assert.equal(feedback.businessOutcome,'rejected');assert.equal(feedback.solved,false);assert.equal(feedback.intent,completionReadback.intent);mark('engineer.rejection.received',feedback);content='ENGINEER_REJECTION_RECEIVED:'+feedback.intent;
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
        else if(step===4){assert(prep);const m=JSON.parse(Buffer.from(manifestPage.data,'base64').toString());assert.equal(m.argvStatus,'proposed');call('ctf_job_run',{preparation:prep.preparation,argv:scenario==='rejected'?[process.execPath,'-e',"process.stdout.write(require('node:fs').readFileSync('../candidate.bin'))"]:scenario==='large'?[process.execPath,'-e',extractionScript+"process.stderr.write('x'.repeat(1048577));"]:m.argv,timeout_ms:15000});}
    else if(step===5){const j=decoded.findLast((v:any)=>v.job);assert(j);assert.equal(j.exitCode,0);assert.equal(j.inputAssociation.version,version);assert.equal(j.inputAssociation.continuousIntegrity,'unknown');call('ctf_job_read',{job:j.job,stream:'stdout'});}
    else if(step===6){const out=decoded.findLast((v:any)=>v.stream==='stdout');assert.deepEqual(Buffer.from(out.data,'base64'),candidateExpected);const j=decoded.findLast((v:any)=>v.job);
      call('ctf_verification_report',{judgment:'verified',mode:'recompute',rationale:scenario==='rejected'?'Scripted fixture counterexample: expected candidate differs from inspected stdout':'Scripted fixture source/dataflow checked under explicit trusted local assumption',sourceFlow:'Fixed E material check, raw.bin [5,14) and extract.cjs stdout; no semantic model claim',premises:[{statement:'Trusted stable local fixture execution; semantic choice predefined by stub',status:'assumed'}],issues:[],requirements:{continuousIntegrity:false,declaredDependenciesOnly:false},evidence:scenario==='missing'?[]:[{kind:'job',job:j.job,stream:'stdout',necessary:true,context:'Whole stdout of prepared local fixture calculation'},...(scenario==='large'?[{kind:'job',job:j.job,stream:'stderr',necessary:false,context:'Independent diagnostic padding; candidate depends only on complete stdout'}]:[])],...(scenario==='missing'?{}:{comparison:{evidence:0,start:0,end:9}})});
    }else{if(scenario==='lost'){assert(results.some((s:string)=>s.includes('denied: control unavailable')));content='VERIFIER_RESULT:UNKNOWN pause no blind resend';}else{const v=decoded.find((v:any)=>v.result&&v.effectiveJudgment);assert(v);content='VERIFIER_RESULT:'+JSON.stringify({result:v.result,version});}}
  }
  provider.push({at:Date.now(),seq:++seq,who,step,phase,request:body,calls,content});const b={id:`chatcmpl-${seq}`,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'scripted'};
  const delta=calls.length?{role:'assistant',tool_calls:calls.map((c,i)=>({index:i,id:`call_${seq}_${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{role:'assistant',content};r.writeHead(200,{'content-type':'text/event-stream'});for(const v of [{...b,choices:[{index:0,delta,finish_reason:null}]},{...b,choices:[{index:0,delta:{},finish_reason:calls.length?'tool_calls':'stop'}]},{...b,choices:[],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}])r.write(`data: ${JSON.stringify(v)}\n\n`);r.end('data: [DONE]\n\n');
 })().catch(e=>{failure??=String(e);failedRequests.push({at:Date.now(),error:String(e),request});mark('provider.failure',String(e));r.writeHead(500).end('{}');});});await new Promise<void>(r=>stub.listen(0,'127.0.0.1',r));
 process.env.PK_STUB_KEY='local-nonsecret';process.env.HTTP_PROXY=process.env.HTTPS_PROXY=process.env.ALL_PROXY='http://127.0.0.1:9';process.env.NO_PROXY='127.0.0.1,localhost';
 const config={model:'stub/scripted',enabled_providers:['stub'],provider:{stub:{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${(stub.address() as any).port}/v1`,apiKey:'{env:PK_STUB_KEY}'},models:{scripted:{limit:{context:65536,output:2048}}}}}};assert.deepEqual(config.enabled_providers,['stub']);assert.equal(new URL(config.provider.stub.options.baseURL).hostname,'127.0.0.1');
 await fs.writeFile(join(out,'provider-config.json'),JSON.stringify({...config,proxy:{HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY,ALL_PROXY:process.env.ALL_PROXY,NO_PROXY:process.env.NO_PROXY}},null,2));await fs.writeFile(join(root,'opencode.json'),JSON.stringify(config));
 await fs.writeFile(join(out,'versions.json'),JSON.stringify({node:process.version,opencode:execFileSync('/Users/caihaoming/.opencode/bin/opencode',['--version'],{encoding:'utf8'}).trim(),sdk:JSON.parse(await fs.readFile('node_modules/@opencode-ai/sdk/package.json','utf8')).version,plugin:JSON.parse(await fs.readFile('node_modules/@opencode-ai/plugin/package.json','utf8')).version},null,2));
 await fs.writeFile(join(root,'input.txt'),eMaterial);await fs.writeFile(join(root,'challenges.json'),JSON.stringify({challenges:[{id:'X',statement:'D package public nonsecret fixture; no oracle',materials:['input.txt']}]}));await fs.writeFile(join(root,'profile.json'),JSON.stringify({profileId:'package-local',challenges:'challenges.json',opencode:{configPath:'opencode.json',binaryPath:'/Users/caihaoming/.opencode/bin/opencode'},reference:{enabled:false},budget:{wallClockMs:['stop','late','before-stop'].includes(scenario)?15000:60000,maxSteps:scenario==='budget'?42:90,maxObservableTokens:100000,maxToolJobs:3},os:{platform:'macos'}}));
 const abort=new AbortController();
 try{
  result=await launch({completionJudges:scenario==='noj'?undefined:{X:judge},profile:join(root,'profile.json'),runsRoot:join(root,'runs'),runId:scenario,onStarted:async({client})=>{const s=await client.event.subscribe({},{signal:abort.signal,throwOnError:true});void(async()=>{try{for await(const e of s.stream)events.push({at:Date.now(),...e});}catch{}})();}});
  assert.equal(failure,undefined);const stopping=['stop','late','before-stop'].includes(scenario);assert.equal(result.status,scenario==='budget'?'budget_exceeded':stopping?'deadline_exceeded':'completed');
  if(!stopping&&scenario!=='budget')assert.equal(phase,11);
  for(const role of ['coordinator','domain-solver','engineer','verifier'])assert(loadedContext.some(c=>c.role===role),`loaded ${role} context`);
  const ev=join(result.runDir,'evidence');const load=async(n:string)=>JSON.parse(await fs.readFile(join(ev,n),'utf8'));const pubs=await load('publications.json'),resources=await load('tool-resources.json'),executions=await load('task-executions.json'),audit=await load('control-audit.json');
  const packages=pubs.filter((p:any)=>p.source.kind==='package');assert.equal(packages.length,1);const sourceExecution=executions.find((e:any)=>e.role==='domain-solver'),engineerExecution=executions.find((e:any)=>e.role==='engineer'),verifierExecution=executions.find((e:any)=>e.role==='verifier');assert.equal(new Set([sourceExecution.childID,engineerExecution.childID,verifierExecution.childID]).size,3);assert.equal(verifierExecution.version,packages[0].ref);assert(resources.every((r:any)=>r.state==='settled'));
  const fixed=packages[0];const bytes=await fs.readFile(join(result.runDir,'workspace/X',fixed.path));assert.equal(hash(bytes),fixed.sha256);const manifest=JSON.parse(bytes.toString());assert.deepEqual(Buffer.from(manifest.candidate.data,'base64'),candidateExpected);assert.equal(manifest.files.find((f:any)=>f.path==='raw.bin').publication.source.execution,sourceExecution.ref);await fs.writeFile(join(out,'fixed-manifest.json'),bytes);await fs.writeFile(join(out,'candidate.bin'),Buffer.from(manifest.candidate.data,'base64'));
  const records=await load('verification-results.json'),completions=await load('completion-results.json');const calls=provider.flatMap(p=>p.calls);const bindings=await load('bindings.json');const rootID=bindings.find((b:any)=>b.role==='coordinator').sessionID;const rootMessages=await load('messages-'+rootID+'.json');const toolStates=rootMessages.flatMap((m:any)=>m.parts??[]).filter((p:any)=>p.type==='tool'&&p.tool==='ctf_completion_request').map((p:any)=>p.state);
  assert.equal(calls.filter(c=>c.name==='ctf_artifact_publish').length,5);assert.equal(calls.filter(c=>c.name==='ctf_package_publish').length,1);assert.equal(calls.filter(c=>c.name==='ctf_package_prepare').length,1);assert.equal(records.length,1);
  if(scenario==='budget'){assert.equal(completions.length,0);assert.equal(judgeReceived.length,0);assert(audit.some((a:any)=>a.op==='model.call'&&!a.allow&&a.reason==='budget denied'));}
  else if(scenario==='missing'){assert.equal(records[0].effectiveJudgment,'inconclusive');assert.equal(completions.length,0);assert.equal(judgeReceived.length,0);}
  else {assert.equal(records[0].effectiveJudgment,'verified');assert.equal(completions.length,1);const c=completions[0];assert.equal(c.version,fixed.ref);assert.equal(c.result,records[0].result);assert.equal(c.candidateSha256,hash(candidateExpected));
    assert.equal(judgeReceived.length,['noj','before-stop'].includes(scenario)?0:1);assert.equal(c.state,scenario==='noj'?'candidate_only':scenario==='before-stop'?'not_sent':['judge-lost','stop'].includes(scenario)?'unknown':'confirmed');assert.equal(c.solved,['control','rpc-lost','late'].includes(scenario));
    const saved=JSON.parse(await fs.readFile(join(result.runDir,'state/completion',c.intent+'.json'),'utf8'));assert.deepEqual(saved,c);
    if(scenario==='rpc-lost'){assert.equal(toolStates[0].status,'error');assert.equal(toolStates[0].error,'denied: control unavailable');assert(observations.some(o=>o.event==='socket.destroy.after.save'));assert.equal(completionReadback.delivery,'unknown');}
    if(scenario==='late'){assert.equal(toolStates[0].status,'error');assert.equal(toolStates[0].error,'Tool execution aborted');assert(observations.some(o=>o.event==='C.stop_marked'));assert(observations.some(o=>o.event==='response.late.attempt'&&o.detail.destroyed));}
    if(scenario==='stop'){assert.equal(toolStates[0].status,'error');assert.equal(toolStates[0].error,'Tool execution aborted');}
    if(scenario==='before-stop'){if(toolStates[0].status==='completed'){const delivered=JSON.parse(toolStates[0].output);assert.equal(delivered.state,'not_sent');assert.equal(delivered.sent,false);assert.equal(delivered.solved,false);}else{assert.equal(toolStates[0].status,'error');assert.equal(toolStates[0].error,'Tool execution aborted');}}
    if(scenario==='before-stop'){assert(barrier);assert(observations.findIndex(o=>o.event==='C.stop_marked')<observations.findIndex(o=>o.event==='intent.before.dispatch.resume'));}
  }
  if(scenario==='rejected'){assert(observations.some(o=>o.event==='engineer.rejection.received'));const engineers=executions.filter((e:any)=>e.role==='engineer');assert.equal(engineers.length,2);assert.notEqual(engineers[0].childID,engineers[1].childID);assert.equal(engineers[1].state,'completed');assert.equal(engineers[1].delivered,true);}
  await fs.writeFile(join(out,'summary.json'),JSON.stringify({scenario,verdict:'passed',result,sourceExecution,engineerExecution,verifierExecution,reportReadback,completionReadback,completionToolStates:toolStates,completions,judgeReceived:judgeReceived.length,realModelCalls:0,realUsage:'unavailable',scriptedUsage:'zero only',productSolvedClaim:false,scope:'D5 interface only; nonsecret judge; semantic choices scripted; no real model/deployment claim'},null,2));
 }catch(e){failure=failure??String(e);process.exitCode=1;console.error(e);}finally{
  releaseReady();releaseIO();abort.abort();(http as any).createServer=originalCreate;fs.rename=originalRename;VerificationResults.prototype.register=originalRegister;(CompletionRequests.prototype as any).save=originalSave;(ControlService.prototype as any).record=originalRecord;syncBuiltinESMExports();
  if(result?.runDir)for(const dir of ['evidence','workspace','state'])await fs.cp(join(result.runDir,dir),join(out,dir),{recursive:true});
  for(const [n,v]of Object.entries({provider,failedRequests,events,wire,observations,loadedContext,judgeReceived,result:{result,failure,scenario,root,realModelCalls:0}}))await fs.writeFile(join(out,n+'.json'),JSON.stringify(v,null,2));await fs.writeFile(join(out,'expected-raw.bin'),raw);await fs.writeFile(join(out,'expected-candidate.bin'),expected);await new Promise<void>(r=>{stub.close(()=>r());stub.closeAllConnections();});await new Promise<void>(r=>{judgeServer.close(()=>r());judgeServer.closeAllConnections();});
 }console.log(JSON.stringify({scenario,result,failure,out}));
}
