// Deterministic no-model public runtime probe, not an agent capability evaluation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,readdir,writeFile,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {launch} from '../../apps/launcher/src/launch.js';
const label=process.argv[2];assert(label && /^[\w-]+$/.test(label),'requires fresh batch label');
const out=resolve('docs/gates/d-artifact-handoff-20261024',...(label.startsWith('integration-')?['integration',label]:[label]));await mkdir(out); // Never overwrite any prior batch.
const sourceFiles=['AGENTS.md','package-lock.json',...['coordinator','recon','domain-solver','engineer','verifier'].map(role=>`product/opencode/agents/${role}.md`),'apps/launcher/src/artifact-tools.ts','apps/launcher/src/control-service.ts','apps/launcher/src/http-tools.ts','apps/launcher/src/job-tools.ts','apps/launcher/src/workspace-tools.ts','apps/launcher/src/launch.ts','apps/opencode-plugin/src/index.ts','product/opencode/opencode.json','tests/contract/d-artifact-handoff.test.ts','tests/contract/opencode-config.test.ts','tests/manual/d-artifact-handoff.ts','docs/superpowers/specs/2026-10-24-design-v1-d-candidate-verification-minimal.md'];
await writeFile(join(out,'source-hashes.json'),JSON.stringify(await Promise.all(sourceFiles.map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')}))),null,2));
const root=await mkdtemp(join(tmpdir(),'d-runtime-'));
const provider:any[]=[],events:any[]=[],targetRequests:string[]=[];const steps=new Map<string,number>();
let phase=0,seq=0,failure:string|undefined,result:Awaited<ReturnType<typeof launch>>|undefined;
const abort=new AbortController();const binary=Buffer.from([0,1,2,255]),script="process.stdout.write('real-job-output\\n')";
const target=createServer((q,r)=>{targetRequests.push(q.url!);r.writeHead(200,{'content-type':'text/plain'});r.end('real-http-body');});
await new Promise<void>(r=>target.listen(0,'127.0.0.1',r));const targetURL=`http://127.0.0.1:${(target.address() as any).port}`;
const stub=createServer((q,r)=>{void(async()=>{
 assert(q.url?.endsWith('/chat/completions'));const chunks:Buffer[]=[];for await(const c of q)chunks.push(Buffer.from(c));
 const body=JSON.parse(Buffer.concat(chunks).toString());const first=JSON.stringify(body.messages.find((m:any)=>m.role==='user')?.content??'');
 const who=/D_ROLE_(intake|domain-solver|engineer)/.exec(first)?.[1]??'coordinator';const step=steps.get(who)??0;steps.set(who,step+1);
 const toolResults=body.messages.filter((m:any)=>m.role==='tool').map((m:any)=>String(m.content));
 const decoded=toolResults.flatMap((s:string)=>{try{return [JSON.parse(s)];}catch{return [];}});
 const all=body.messages.map((m:any)=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
 const calls:{name:string;args:object}[]=[];const call=(name:string,args:object={})=>calls.push({name,args});let content='';
 const task=(role:string,extra='')=>call('task',{subagent_type:role,description:`D ${role}`,prompt:`D_ROLE_${role} ${extra}`,...(role==='intake'?{}:{background:true})});
 const publications=decoded.filter((v:any)=>v.ref&&v.snapshotFixed);
 if(who==='coordinator'){
  switch(phase){
   case 0:task('intake');phase++;break;
   case 1:assert(all.includes('INTAKE_READY'));call('ctf_challenge_assign',{role:'domain-solver',challenge:'X'});phase++;break;
   case 2:task('domain-solver');phase++;break;
   case 3:if(all.includes('SOLVER_HANDOFF:')){call('ctf_challenge_assign',{role:'engineer',challenge:'X'});phase++;}break;
   case 4:{
    // References come exclusively from the native child completion message in this parent's request.
    const m=/SOLVER_HANDOFF:(\[[^\]\n]+\])/.exec(all);assert(m,'native task must deliver references');const refs=JSON.parse(m[1]!);
    assert.equal(refs.length,4);assert(refs.every((v:any)=>typeof v.ref==='string'&&v.path.startsWith('published/')));
    task('engineer','HANDOFF:'+JSON.stringify(refs));phase++;break;
   }
   case 5:if(all.includes('ENGINEER_READ_OK')){content='D_INTERFACE_ONE_WIRING_COMPLETE; no candidate, verification or solved claim';phase++;}break;
   default:content='D_INTERFACE_ONE_WIRING_COMPLETE';
  }content||='WAIT_FOR_NATIVE_TASK';
 }else if(who==='intake'){
  assert(!body.tools.some((t:any)=>t.function.name==='ctf_artifact_publish'));
  if(step===0)call('ctf_challenge_list');else if(step===1)call('ctf_challenge_read',{id:'X',path:'input.txt'});else content='INTAKE_READY X fixed public materials; no oracle';
 }else if(who==='domain-solver'){
  assert(body.tools.some((t:any)=>t.function.name==='ctf_artifact_publish'));
  switch(step){
   case 0:call('ctf_workspace_write',{path:'work/source.bin',content:binary.toString('base64'),encoding:'base64'});break;
   case 1:call('ctf_workspace_write',{path:'work/solve.cjs',content:script});break;
   case 2:call('ctf_artifact_publish',{source:'file',path:'work/source.bin'});break;
   case 3:call('ctf_artifact_publish',{source:'file',path:'work/solve.cjs'});break;
   case 4:call('ctf_job_run',{argv:[process.execPath,'solve.cjs'],timeout_ms:5000});break;
   case 5:{const j=decoded.findLast((v:any)=>v.job);assert(j?.job);call('ctf_artifact_publish',{source:'job',job:j.job,stream:'stdout'});break;}
   case 6:call('ctf_http_request',{url:targetURL,timeout_ms:3000});break;
   case 7:{const h=decoded.findLast((v:any)=>v.resource);assert(h?.resource);call('ctf_artifact_publish',{source:'http',resource:h.resource});break;}
   default:assert.equal(publications.length,4);content='SOLVER_HANDOFF:'+JSON.stringify(publications.map((p:any)=>({ref:p.ref,path:p.path,sha256:p.sha256,size:p.size})));break;
  }
 }else{
  // No SDK prompt injection: only this new session's first task prompt supplies opaque public refs.
  assert(!first.includes(script),'private source script was not passed as task content');
  const m=/HANDOFF:(\[[^\]\n]+\])/.exec(first.replaceAll('\\"','"'));assert(m,'Engineer receives native task refs');const refs=JSON.parse(m[1]!);
  if(step===0)call('ctf_workspace_read',{path:'work/../domain-solver/source.bin'});
  else if(step<=4)call('ctf_artifact_read',{ref:refs[step-1].ref});
  else if(step===5)call('ctf_workspace_read',{path:refs[1].path});
  else{
   const pages=decoded.filter((v:any)=>v.encoding==='base64'&&v.ref);assert.equal(pages.length,4);
   const expected=[binary,Buffer.from(script),Buffer.from('real-job-output\n'),Buffer.from('real-http-body')];
   pages.forEach((p:any,i:number)=>{const bytes=Buffer.from(p.data,'base64');assert.deepEqual(bytes,expected[i]);assert.equal(createHash('sha256').update(bytes).digest('hex'),refs[i].sha256);});
   assert(toolResults.some((s:string)=>s.includes('denied: workspace path')));content='ENGINEER_READ_OK exact file/script/job/HTTP bytes from native handoff refs; sibling work refused';
  }
 }
 provider.push({at:Date.now(),seq:++seq,who,step,phase,request:body,calls,content});
 const base={id:`chatcmpl-${seq}`,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'scripted'};
 const delta=calls.length?{role:'assistant',tool_calls:calls.map((c,i)=>({index:i,id:`call_${seq}_${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{role:'assistant',content};
 r.writeHead(200,{'content-type':'text/event-stream'});
 for(const v of [{...base,choices:[{index:0,delta,finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:calls.length?'tool_calls':'stop'}]},{...base,choices:[],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}])r.write(`data: ${JSON.stringify(v)}\n\n`);
 r.end('data: [DONE]\n\n');
})().catch(e=>{failure=String(e);r.writeHead(500).end('{}');});});
await new Promise<void>(r=>stub.listen(0,'127.0.0.1',r));
process.env.D_STUB_KEY='nonsecret-local-only';process.env.HTTP_PROXY=process.env.HTTPS_PROXY=process.env.ALL_PROXY='http://127.0.0.1:9';process.env.NO_PROXY='127.0.0.1,localhost';
await writeFile(join(root,'input.txt'),'nonsecret frozen E material');
const config={model:'stub/scripted',enabled_providers:['stub'],provider:{stub:{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${(stub.address() as any).port}/v1`,apiKey:'{env:D_STUB_KEY}'},models:{scripted:{limit:{context:65536,output:2048}}}}}};
assert.deepEqual(config.enabled_providers,['stub']);assert.equal(new URL(config.provider.stub.options.baseURL).hostname,'127.0.0.1');
await writeFile(join(out,'provider-config.json'),JSON.stringify({...config,proxy:{HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY,ALL_PROXY:process.env.ALL_PROXY,NO_PROXY:process.env.NO_PROXY}},null,2));
await writeFile(join(out,'versions.json'),JSON.stringify({node:process.version,opencode:execFileSync('/Users/caihaoming/.opencode/bin/opencode',['--version'],{encoding:'utf8'}).trim(),sdk:JSON.parse(await readFile('node_modules/@opencode-ai/sdk/package.json','utf8')).version,plugin:JSON.parse(await readFile('node_modules/@opencode-ai/plugin/package.json','utf8')).version},null,2));
await writeFile(join(root,'opencode.json'),JSON.stringify(config));
await writeFile(join(root,'challenges.json'),JSON.stringify({challenges:[{id:'X',statement:'D public artifact fixture; no oracle',materials:['input.txt'],target:{protocol:'http',url:targetURL}}]}));
await writeFile(join(root,'profile.json'),JSON.stringify({profileId:'d-local',challenges:'challenges.json',opencode:{configPath:'opencode.json',binaryPath:'/Users/caihaoming/.opencode/bin/opencode'},reference:{enabled:false},budget:{wallClockMs:60000,maxSteps:60,maxObservableTokens:100000,maxToolJobs:3},os:{platform:'macos'}}));
try{
 result=await launch({profile:join(root,'profile.json'),runsRoot:join(root,'runs'),runId:'d-handoff',onStarted:async({client})=>{
  const stream=await client.event.subscribe({},{signal:abort.signal,throwOnError:true});void(async()=>{try{for await(const e of stream.stream)events.push({at:Date.now(),...e});}catch{/* closed */}})();
 }});
 assert.equal(failure,undefined);assert.equal(result.status,'completed');assert.equal(phase,6);
 const ev=join(result.runDir!,'evidence');const load=async(name:string)=>JSON.parse(await readFile(join(ev,name),'utf8'));
 const bindings=await load('bindings.json'),executions=await load('task-executions.json'),records=await load('publications.json'),resources=await load('tool-resources.json'),audit=await load('control-audit.json');
 const solver=bindings.find((b:any)=>b.role==='domain-solver'),engineer=bindings.find((b:any)=>b.role==='engineer');assert.notEqual(solver.sessionID,engineer.sessionID);assert.equal(records.length,4);
 const sx=executions.find((e:any)=>e.role==='domain-solver');assert(records.every((p:any)=>p.source.execution===sx.ref&&p.source.sessionID===solver.sessionID&&p.source.challenge==='X'));
 assert.equal(provider.length,audit.filter((r:any)=>r.op==='model.call'&&r.allow).length);assert(resources.every((r:any)=>r.state==='settled'));assert.equal(targetRequests.length,1); // E reachability checks the socket; only G issues HTTP.
 const nativeHostPathRequests=provider.filter(p=>JSON.stringify(p.request).includes('Working directory: /') && JSON.stringify(p.request).includes(root)).length;
 const publicToolReplies=provider.flatMap(p=>p.request.messages.filter((m:any)=>m.role==='tool').map((m:any)=>String(m.content)));
 assert(publicToolReplies.every(s=>!s.includes(root)), 'managed handoff outputs expose no private runtime path');
 const summary={nativeHostPathRequests,status:result.status,phase,requests:provider.length,publications:records.length,solver:solver.sessionID,engineer:engineer.sessionID,sourceExecution:sx.ref,targetRequests,H1:'artifact wiring passed; broad no-private-host-path criterion failed: native system environment exposes cwd',H2:'passed in same runtime',realModelCalls:0,usage:'stub reported zero; not real provider usage',solved:false,scope:'D interface one only',osIsolation:false};
 await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}catch(e){failure=failure??String(e);process.exitCode=1;console.error(e);}
finally{
 abort.abort();
 if(result?.runDir){await cp(join(result.runDir,'evidence'),join(out,'evidence'),{recursive:true});await cp(join(result.runDir,'workspace'),join(out,'workspace'),{recursive:true});await cp(join(result.runDir,'state'),join(out,'state'),{recursive:true});}
 await writeFile(join(out,'provider.json'),JSON.stringify(provider,null,2));await writeFile(join(out,'events.json'),JSON.stringify(events,null,2));await writeFile(join(out,'result.json'),JSON.stringify({result,failure,root,realModelCalls:0,targetRequests},null,2));
 await new Promise<void>(r=>{stub.close(()=>r());stub.closeAllConnections();});await new Promise<void>(r=>{target.close(()=>r());target.closeAllConnections();});
}
