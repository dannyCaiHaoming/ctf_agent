// The fixture resumes an already owned child through public SDK solely to create an in-flight wait.
// Revocation is always initiated by Coordinator's real product tool, never by host revoke/stopAll.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { OpencodeClient } from '@opencode-ai/sdk/v2';
import { launch } from '../../apps/launcher/src/launch.js';
const label=process.argv[2]??'first';
const evidence=resolve('docs/gates/g-solver-verification-20261023/decision-coordinator-stop/runtime',label);await mkdir(evidence,{recursive:true});
async function until(fn:()=>Promise<boolean>,ms=8000){const end=Date.now()+ms;while(!await fn()){if(Date.now()>end)throw new Error('fixture wait deadline');await new Promise(r=>setTimeout(r,20));}}
for(const scenario of ['foreground','http','job-wait'] as const){
 if(process.argv[3]&&process.argv[3]!==scenario)continue;
 const out=join(evidence,scenario);await mkdir(out,{recursive:true});const root=await mkdtemp(join(tmpdir(),'gdec-coordinator-stop-'));
 const events:Array<Record<string,unknown>>=[];const requests:Array<Record<string,unknown>>=[];let client:OpencodeClient;let rootID='';let a='',b='';let lastBJob='';let rootStep=0,aStep=0,bStep=0,seq=0;let httpEntered=false;let stopAt=0;let aPID=0,bPID=0,waitingPID=0;
 const target=createServer((_q,r)=>{events.push({at:Date.now(),event:'http.entered'});httpEntered=true;r.writeHead(200);r.write('held');r.once('close',()=>events.push({at:Date.now(),event:'http.closed'}));});await new Promise<void>(r=>target.listen(0,'127.0.0.1',r));const targetURL=`http://127.0.0.1:${(target.address() as {port:number}).port}`;
 const work=(id:string)=>join(root,'runs/product/workspace/X/work',id);
 const pid=async(id:string,name='grandchild.pid')=>Number(await readFile(join(work(id),name),'utf8'));
 const script=(name:string)=>`const ch=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});require('fs').writeFileSync('${name}',String(ch.pid));console.log('retained-${name}');setInterval(()=>{},1000)`;
 const stub=createServer((req,res)=>{void(async()=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));if(req.method!=='POST'||!req.url?.endsWith('/chat/completions')){res.writeHead(404).end('{}');return;}
  const body=JSON.parse(Buffer.concat(chunks).toString());const first=JSON.stringify(body.messages.find((m:{role:string})=>m.role==='user')?.content??'');const role=first.includes('STOP_A')?'a':first.includes('STOP_B')?'b':'root';const step=role==='a'?aStep++:role==='b'?bStep++:rootStep++;const results=body.messages.filter((m:{role:string})=>m.role==='tool').map((m:{content:unknown})=>String(m.content));
  const nativeID=(text:string)=>/ses_[a-zA-Z0-9]+/.exec(text)?.[0]??'';
  if(role==='root'&&step===2)a=nativeID(results.at(-1)??'');if(role==='root'&&step===4)b=nativeID(results.at(-1)??'');if(role==='b'){for(const r of results){const m=/"job":"([a-f0-9-]{36})"/.exec(r);if(m)lastBJob=m[1]!;}}
  const calls:Array<{name:string;args:object}>=[];
  if(role==='root'){
   if(step===0)calls.push({name:'ctf_challenge_assign',args:{role:'recon',challenge:'X'}});
   if(step===1)calls.push({name:'task',args:{description:'stop owned child',subagent_type:'recon',prompt:'STOP_A prepare a delivered job'}});
   if(step===2)calls.push({name:'ctf_challenge_assign',args:{role:'engineer',challenge:'X'}});
   if(step===3)calls.push({name:'task',args:{description:'independent peer',subagent_type:'engineer',prompt:'STOP_B keep own work running'}});
   if(step===4){
    assert(a&&b,'native task handles missing');await until(async()=>{try{aPID=await pid(a);bPID=await pid(b);return aPID>0&&bPID>0}catch{return false}});
    if(scenario !== 'foreground') {
    events.push({at:Date.now(),event:'fixture.sdk.resume.owned.child',sessionID:a});
    await client.session.promptAsync({sessionID:a,agent:'recon',parts:[{type:'text',text:'FIXTURE_WAIT begin in-flight operation'}]},{throwOnError:true});
    if(scenario==='http')await until(async()=>httpEntered);else await until(async()=>{try{waitingPID=await pid(a,'waiting.pid');return waitingPID>0}catch{return false}});
    } else {
      assert(httpEntered);const closed=events.find(e=>e.event==='http.closed');assert(closed);
      events.push({at:Date.now(),event:'native.foreground.parent.can.only.continue.after.child.wait',httpClosedAt:closed.at});
      const nativeAbort=(await client.session.abort({sessionID:a},{throwOnError:true})).data;
      assert.equal(nativeAbort,true);assert.doesNotThrow(()=>process.kill(aPID,0));
      events.push({at:Date.now(),event:'native.sdk.abort.returned.but.delivered.job.alive',nativeAbort,aPID});
    }
    stopAt=Date.now();events.push({at:stopAt,event:'coordinator.emits.stop',sessionID:a});
    calls.push({name:'ctf_task_stop',args:{task_id:a}},{name:'task',args:{description:'peer continues',subagent_type:'engineer',task_id:b,prompt:'STOP_B verify still running'}});
   }
   if(step===5){assert.throws(()=>process.kill(aPID,0));if(waitingPID)assert.throws(()=>process.kill(waitingPID,0));assert.doesNotThrow(()=>process.kill(bPID,0));events.push({at:Date.now(),event:'reap.checked.before.global.cleanup',aPID,bPID,waitingPID});calls.push({name:'ctf_task_stop',args:{task_id:a}});}
  }else if(role==='a'){
   if(step===0)calls.push({name:'ctf_job_run',args:{argv:[process.execPath,'-e',script('grandchild.pid')],wait_ms:20,timeout_ms:60000}});
   if(step===1&&scenario==='foreground')calls.push({name:'ctf_http_request',args:{url:targetURL,timeout_ms:1200}});
   if(step===2&&scenario!=='foreground')calls.push(scenario==='http'?{name:'ctf_http_request',args:{url:targetURL,timeout_ms:30000}}:{name:'ctf_job_run',args:{argv:[process.execPath,'-e',script('waiting.pid')],wait_ms:30000,timeout_ms:60000}});
  }else{
   if(step===0)calls.push({name:'ctf_job_run',args:{argv:[process.execPath,'-e',script('grandchild.pid')],wait_ms:20,timeout_ms:60000}});
   if(step===2)calls.push({name:'ctf_job_read',args:{job:lastBJob,stream:'stdout'}});
  }
  requests.push({at:Date.now(),seq:++seq,role,step,calls,results,tools:body.tools?.map((t:{function:{name:string;parameters:unknown}})=>t.function)});
  const base={id:`chatcmpl-${seq}`,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'scripted'};res.writeHead(200,{'content-type':'text/event-stream'});
  const delta=calls.length?{role:'assistant',tool_calls:calls.map((c,i)=>({index:i,id:`call_${seq}_${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{role:'assistant',content:'script complete'};
  for(const chunk of [{...base,choices:[{index:0,delta,finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:calls.length?'tool_calls':'stop'}]},{...base,choices:[],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}])res.write(`data: ${JSON.stringify(chunk)}\n\n`);res.end('data: [DONE]\n\n');
 })().catch(e=>{events.push({at:Date.now(),event:'stub.failure',error:String(e)});res.writeHead(500).end('{}');});});await new Promise<void>(r=>stub.listen(0,'127.0.0.1',r));
 process.env.GDEC_STOP_STUB_KEY='local-fixture-only';process.env.HTTP_PROXY=process.env.HTTPS_PROXY=process.env.ALL_PROXY='http://127.0.0.1:9';process.env.NO_PROXY='127.0.0.1,localhost';
 await writeFile(join(root,'opencode.json'),JSON.stringify({model:'stub/scripted',enabled_providers:['stub'],provider:{stub:{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${(stub.address() as {port:number}).port}/v1`,apiKey:'{env:GDEC_STOP_STUB_KEY}'},models:{scripted:{limit:{context:65536,output:4096}}}}}}));
 await writeFile(join(root,'challenges.json'),JSON.stringify({challenges:[{id:'X',statement:'Coordinator stop fixture',target:{protocol:'http',url:targetURL}}]}));
 await writeFile(join(root,'profile.json'),JSON.stringify({profileId:'gdec-coordinator-stop',opencode:{configPath:'opencode.json',binaryPath:'/Users/caihaoming/.opencode/bin/opencode'},challenges:'challenges.json',reference:{enabled:false},budget:{wallClockMs:45000,maxSteps:30,maxToolJobs:2,maxObservableTokens:100000},os:{platform:'macos'}}));
 let result:Awaited<ReturnType<typeof launch>>|undefined;let failure:string|undefined;
 try{
  result=await launch({profile:join(root,'profile.json'),runsRoot:join(root,'runs'),runId:'product',onStarted:async c=>{client=c.client;rootID=c.rootId;}});assert.equal(result.status,'completed');
  const audit=JSON.parse(await readFile(join(result.runDir!,'evidence/control-audit.json'),'utf8'));const resources=JSON.parse(await readFile(join(result.runDir!,'evidence/tool-resources.json'),'utf8'));
  const revoke=audit.filter((r:{sessionID:string;op:string})=>r.sessionID===a&&r.op==='revoke');assert.equal(revoke.length,1);
  const toolCalls=audit.filter((r:{sessionID:string;op:string;allow:boolean;detail?:{tool:string}})=>r.sessionID===rootID&&r.op==='tool.execute'&&r.allow&&r.detail?.tool==='task.stop');assert.equal(toolCalls.length,2);
  const revAt=revoke[0].at;assert(!audit.some((r:{sessionID:string;op:string;allow:boolean;at:number})=>r.sessionID===a&&r.op==='model.call'&&r.allow&&r.at>revAt));
  assert(audit.some((r:{sessionID:string;op:string;allow:boolean;at:number})=>r.sessionID===b&&r.op==='model.call'&&r.allow&&r.at>=stopAt));
  assert(events.some(e=>e.event==='reap.checked.before.global.cleanup'));const peerRead=requests.find(r=>r.role==='b'&&r.step===3)?.results as string[];assert(peerRead.at(-1)?.includes('running'));
  const stops=requests.filter(r=>r.role==='root'&&(r.step===5||r.step===6)).map(r=>(r.results as string[]).findLast(t=>t.includes('sessionAbort')));assert(stops.every(t=>t?.includes('"state":"stopped"')));
  assert(resources.filter((r:{sessionID:string;tool:string})=>r.sessionID===a&&['http.request','job.run'].includes(r.tool)).every((r:{state:string;result:string})=>r.state==='settled'&&(r.result==='cancelled'||(scenario==='foreground'&&r.result==='timeout'))));
  if(scenario==='foreground'){const close=Number(events.find(e=>e.event==='http.closed')!.at);const next=requests.find(r=>r.role==='root'&&r.step===2)!;assert(Number(next.at)>=close);assert(!requests.some(r=>r.role==='root'&&Number(r.at)<close&&(r.calls as Array<{name:string}>).some(c=>c.name==='ctf_task_stop')));}
  assert(!requests.filter(r=>r.role!=='root').some(r=>(r.tools as Array<{name:string}>).some(t=>t.name==='ctf_task_stop')));
  const outputDir=join(result.runDir!,'state/jobs',a);const jobs=await readdir(outputDir);for(const job of jobs){const stdout=await readFile(join(outputDir,job,'stdout.bin'));assert(stdout.toString().includes('retained-'));await writeFile(join(out,`${job}-stdout.txt`),stdout);}
 }catch(e){failure=String(e);process.exitCode=1;}
 finally{
  if(result?.runDir){for(const name of await readdir(join(result.runDir,'evidence')))if(/^(control-audit|tool-resources|bindings|admissions|sessions|messages-|assets|inventory|challenges)/.test(name))await writeFile(join(out,name),await readFile(join(result.runDir,'evidence',name)));await writeFile(join(out,'run.json'),await readFile(join(result.runDir,'state/run.json')));}
  await writeFile(join(out,'provider.json'),JSON.stringify(requests,null,2));await writeFile(join(out,'events.json'),JSON.stringify(events,null,2));await writeFile(join(out,'result.json'),JSON.stringify({result,failure,scenario,root,fixture:scenario==='foreground'?'native foreground task without SDK resume; stop only after HTTP timeout': 'public SDK resume establishes in-flight owned child only; Coordinator initiates task.stop through real plugin',usage:'stub reports zero; no real model',sourceVersion:'OpenCode 1.19.3 SDK/plugin 1.19.0'},null,2));
  await new Promise<void>(r=>{stub.close(()=>r());stub.closeAllConnections();});await new Promise<void>(r=>{target.close(()=>r());target.closeAllConnections();});
 }
 console.log(JSON.stringify({scenario,result,failure,evidence:out}));
}
