// Native same-batch A -> learning -> process restart -> B -> learning. All generation is a loopback script.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {launch} from '../../apps/launcher/src/launch.js';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
const root=await mkdtemp(join(tmpdir(),'experience-loop-')),trace:any[]=[];
let run='A',phase=0,seq=0,failure:string|undefined,lessonID='',episodeID='',evidenceRef='';
const steps=new Map<string,number>();
const str=(v:any)=>typeof v==='string'?v:JSON.stringify(v);
const stub=createServer((q,r)=>{void(async()=>{
  assert(q.url?.endsWith('/chat/completions'));
  const chunks:Buffer[]=[];for await(const c of q)chunks.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(chunks).toString());
  const users=body.messages.filter((m:any)=>m.role==='user').map((m:any)=>str(m.content)),first=users[0]??'',last=users.at(-1)??'';
  const stage=last.includes('CTF_MEMORY_EPISODE')?'episode':last.includes('CTF_MEMORY_LESSON')?'lesson':null;
  const who=stage??(/EXP_ROLE_(recon|domain-solver|engineer|verifier)/.exec(first)?.[1]??'coordinator');
  const step=steps.get(run+who)??0;steps.set(run+who,step+1);
  const raw=body.messages.filter((m:any)=>m.role==='tool').map((m:any)=>str(m.content));
  const results=raw.flatMap((s:string)=>{try{return [JSON.parse(s)];}catch{return [];}}),all=body.messages.map((m:any)=>str(m.content)).join('\n');
  const calls:{name:string;args:any}[]=[];let content='';
  const call=(name:string,args:any={})=>calls.push({name,args});
  const task=(role:string,prompt='')=>call('task',{subagent_type:role,description:`experience ${role}`,prompt:`EXP_ROLE_${role} ${prompt}`,background:role==='verifier'});
  if(stage==='episode') {
    const data=JSON.parse(last.slice(last.lastIndexOf('\n')+1));assert(data.sources.some((s:any)=>s.ref.startsWith('execution:')));assert(data.sources.some((s:any)=>str(s.content).includes('SQL_FAILED')));
    const source=data.sources.find((s:any)=>s.role==='domain-solver');assert(source);
    content=JSON.stringify({summary:`${run} template process`,tech_tags:['template'],steps:[{stage:'solve',action:run==='A'?'arithmetic then exploit':'compare arithmetic with reflection',observation:run==='A'?'evaluation 42':'numeric route works; literal reflection is inapplicable',reason:'direct comparison',source_refs:[source.ref]}],failed_paths:['SQL_FAILED'],unresolved:[],experience_refs:run==='B'?[`lesson:${lessonID}@1`]:[]});
  }else if(stage==='lesson')content=JSON.stringify({lessons:run==='A'?[{title:'template arithmetic procedure',tags:['template'],when:'arithmetic result evaluated',steps:['compare baseline and arithmetic'],checks:['42 from expression'],avoid:['SQL_FAILED'],limits:['literal reflection is inapplicable']}]:[]});
  else if(who==='coordinator') {
    const version=/ENGINEER_VERSION=([\w-]+)/.exec(all)?.[1],verification=/VERIFIER_RESULT=([\w-]+)/.exec(all)?.[1];
    switch(phase++) {
      case 0:call('ctf_challenge_assign',{role:'recon',challenge:'X'});break;
      case 1:task('recon');break;
      case 2:assert(all.includes('RECON_DONE'));evidenceRef=/EXPORT_REF=([\w-]+)/.exec(all)?.[1]??'';assert(evidenceRef);call('ctf_challenge_assign',{role:'domain-solver',challenge:'X'});break;
      case 3:task('domain-solver',`REF=${evidenceRef}`);break;
      case 4:assert(all.includes('SOLVER_DONE'));call('ctf_challenge_assign',{role:'engineer',challenge:'X'});break;
      case 5:task('engineer');break;
      case 6:assert(version);call('ctf_challenge_assign',{role:'verifier',challenge:'X',version});break;
      case 7:task('verifier');break;
      case 8:if(!verification){phase--;content='WAIT_FOR_NATIVE_VERIFIER';break;}assert(version&&verification);call('ctf_completion_request',{challenge:'X',version,result:verification});break;
      default:assert(results.some((v:any)=>v.solved===true));content='ATTEMPT_COMPLETE';
    }
  }else if(who==='recon') {
    if(run==='A') {
      if(step===0){call('ctf_workspace_write',{path:'work/baseline.txt',content:'SQL_FAILED: no SQL evidence'});call('ctf_workspace_write',{path:'work/template.txt',content:'arithmetic evaluated to 42'});}
      else if(step===1)call('ctf_job_run',{argv:[process.execPath,'-e',"console.log('SQL_FAILED; template arithmetic 42')"],timeout_ms:5000});
      else if(step===2)call('ctf_http_request',{url:'http://127.0.0.1:1/not-authorized'});
      else if(step===3)call('ctf_job_run',{argv:[process.execPath,'-e','setTimeout(()=>{},2000)'],timeout_ms:20});
      else if(step===4)call('ctf_recon_note',{observation:'SQL_FAILED; arithmetic 42',assessment:'template route needs solving',next_action:'handoff',next_reason:'baseline answered'});
      else if(step===5)call('ctf_recon_read',{});
      else {const v=results.findLast((v:any)=>v.export);assert(v?.export.ref);content=`RECON_DONE EXPORT_REF=${v.export.ref} SQL_FAILED; template route supported locally`;} 
    }else {
      if(step===0)call('ctf_experience_search',{query:'template'});
      else if(step===1){const found=results.findLast((v:any)=>v.results)?.results[0];assert(found?.id===lessonID);call('ctf_experience_read',{kind:'lesson',id:lessonID,version:1});}
      else if(step===2){const v=results.findLast((v:any)=>v.kind==='lesson'&&v.data);assert(v);const l=JSON.parse(Buffer.from(v.data,'base64').toString());assert(l.limits.includes('literal reflection is inapplicable'));episodeID=l.source_episode_refs[0].id;call('ctf_experience_read',{kind:'episode',id:episodeID,version:1});}
      else if(step===3){const v=results.findLast((v:any)=>v.kind==='episode'&&v.data);assert(v);const e=JSON.parse(Buffer.from(v.data,'base64').toString());assert(e.outcome==='solved');assert(e.content.failed_paths.includes('SQL_FAILED'));call('ctf_job_run',{argv:[process.execPath,'-e',"console.log(JSON.stringify({evaluated:6*7,literal:'{{6*7}}'}))"],timeout_ms:5000});}
      else if(step===4){assert(results.some((v:any)=>v.job&&v.exitCode===0));call('ctf_recon_note',{observation:'SQL_FAILED prior route. Current arithmetic=42; literal reflection remains literal',assessment:'adopt arithmetic comparison; do not exploit literal reflection',evidence_refs:[`lesson:${lessonID}@1`],next_reason:'checked conditions against current fixture'});}
      else if(step===5)call('ctf_recon_read',{});
      else {const v=results.findLast((v:any)=>v.export);assert(v);content=`RECON_DONE EXPORT_REF=${v.export.ref} SQL_FAILED; used lesson:${lessonID}@1; reflected string is inapplicable`;}
    }
  }else if(who==='domain-solver') {
    if(step===0)call('ctf_artifact_read',{ref:/REF=([\w-]+)/.exec(first)![1]});
    else if(run==='B'&&step===1)call('ctf_experience_search',{query:'template'});
    else if(run==='B'&&step===2)call('ctf_experience_read',{kind:'lesson',id:lessonID});
    else if(run==='B'&&step===3)call('ctf_job_run',{argv:[process.execPath,'-e',"console.log(JSON.stringify({evaluated:6*7,literal:'{{6*7}}'}))"],timeout_ms:5000});
    else {assert(results.some((v:any)=>v.ref===evidenceRef&&v.data));if(run==='B'){assert(results.some((v:any)=>v.kind==='lesson'));assert(results.some((v:any)=>v.job&&v.exitCode===0));}content=`SOLVER_DONE SQL_FAILED. arithmetic evaluated=42; parameters expression=6*7; literal reflection control did not evaluate. ${run==='B'?`used lesson:${lessonID}@1; literal route abandoned`:''}`;}
  }else if(who==='engineer') {
    if(step===0)call('ctf_workspace_write',{path:'work/candidate.txt',content:'fixture-answer'});
    else if(step===1)call('ctf_artifact_publish',{source:'file',path:'work/candidate.txt'});
    else if(step===2){const v=results.findLast((v:any)=>v.ref);call('ctf_package_publish',{candidate:{ref:v.ref,start:0,end:14},files:[],extraction:'local fixture bytes',premises:[]});}
    else {const v=results.findLast((v:any)=>v.version);assert(v);content=`ENGINEER_VERSION=${v.version} actual local extraction fixed; SQL_FAILED branch preserved`;}
  }else if(who==='verifier') {
    if(step===0)call('ctf_verification_report',{judgment:'inconclusive',mode:'unable',rationale:'scripted local fixture; no independent semantic proof',sourceFlow:'local fixed candidate'});
    else {const v=results.findLast((v:any)=>v.result);assert(v);content=`VERIFIER_RESULT=${v.result}`;}
  }
  trace.push({run,who,step,phase,calls,results,content,max_tokens:body.max_tokens??body.max_completion_tokens});
  const base={id:`chatcmpl-${++seq}`,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'scripted'};
  const delta=calls.length?{role:'assistant',tool_calls:calls.map((c,i)=>({index:i,id:`call_${seq}_${i}`,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{role:'assistant',content};
  r.writeHead(200,{'content-type':'text/event-stream'});
  for(const v of [{...base,choices:[{index:0,delta,finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:calls.length?'tool_calls':'stop'}]},{...base,choices:[],usage:{prompt_tokens:50,completion_tokens:20,total_tokens:70}}])r.write(`data: ${JSON.stringify(v)}\n\n`);r.end('data: [DONE]\n\n');
})().catch(error=>{failure??=String(error);void writeFile(join(root,'stub-failure.json'),JSON.stringify({error:String(error),trace:trace.map(t=>[t.run,t.who,t.step])}));r.writeHead(400).end('{}');});});
await new Promise<void>(done=>stub.listen(0,'127.0.0.1',done));
process.env.EXPERIENCE_STUB_KEY='local-only';process.env.HTTP_PROXY=process.env.HTTPS_PROXY=process.env.ALL_PROXY='http://127.0.0.1:9';process.env.NO_PROXY='127.0.0.1,localhost';
await writeFile(join(root,'opencode.json'),JSON.stringify({model:'stub/scripted',enabled_providers:['stub'],provider:{stub:{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${(stub.address() as any).port}/v1`,apiKey:'{env:EXPERIENCE_STUB_KEY}'},models:{scripted:{limit:{context:65536,output:4096}}}}}}));
await writeFile(join(root,'challenges.json'),JSON.stringify({challenges:[{id:'X',statement:'Local template fixture, no external target'}]}));
await writeFile(join(root,'profile.json'),JSON.stringify({profileId:'experience-local',opencode:{configPath:'opencode.json',binaryPath:process.env.OPENCODE_BINARY??'/Users/caihaoming/.opencode/bin/opencode'},challenges:'challenges.json',reference:{enabled:false},budget:{wallClockMs:60000,maxSteps:70,maxObservableTokens:100000,maxToolJobs:3},learning:{maxObservableTokens:100000,wallClockMs:45000},os:{platform:'macos'}}));
const results:any[]=[];
try {
  for(const current of ['A','B']) {
    run=current;phase=0;
    const result=await launch({profile:join(root,'profile.json'),runsRoot:join(root,'runs'),runId:run,completionJudges:{X:{id:'local-fixture',scope:`fixture-${run}`,timeoutMs:1000,limits:{attempts:{kind:'limited',max:1}},submit:async i=>({intent:i.intent,challenge:i.challenge,status:'accepted',completed:true})}}});
    results.push(result);assert.equal(failure,undefined);assert.equal(result.status,'completed');
    const learning=JSON.parse(await readFile(join(result.runDir!,'evidence/learning.json'),'utf8'));assert.equal(learning.status,'completed',JSON.stringify(learning));assert.equal(learning.requests,2);
    const db=new ExperienceStore(join(root,'runs/experience.sqlite'));
    const rows=db.allRecords(run,'X');assert(rows.length>0);assert(rows.filter((r:any)=>r.kind==='tool').every((r:any)=>r.message_id&&r.turn_no));
    if(run==='A') {
      const writes=rows.filter((r:any)=>r.tool==='workspace.write');assert(writes.length>=2);assert.equal((writes[0] as any).turn_no,(writes[1] as any).turn_no);
      assert(rows.some((r:any)=>r.tool==='job.run'&&r.status==='exited'));assert(rows.some((r:any)=>r.tool==='job.run'&&r.status==='timed_out'));assert(rows.some((r:any)=>r.tool==='http.request'&&r.status==='error'));
      const found=db.search({query:'template'}).results[0];assert(found);lessonID=found.id!;
    }else {const episodes=db.search({query:'template',kind:'episode'}).results;const b=episodes.find(e=>(db.getEpisode(e.id!)!).run_id==='B');assert(b);const record=db.getEpisode(b.id!)!;assert(record.content!.experience_refs.includes(`lesson:${lessonID}@1`));assert(record.content!.steps[0]!.observation.includes('inapplicable'));}
    db.close();
  }
  assert(trace.some(t=>t.run==='B'&&t.who==='recon'&&t.calls.some((c:any)=>c.name==='ctf_experience_read')));
  assert(trace.some(t=>t.run==='B'&&t.who==='domain-solver'&&t.calls.some((c:any)=>c.name==='ctf_experience_read')));
  console.log(JSON.stringify({status:'passed',root,results,lessonID,episodeID,requests:trace.length,realModelCalls:0,runtime:{platform:process.platform,arch:process.arch,node:process.version},proof:'native OpenCode wiring with deterministic localhost generation; no semantic model or production image certification'},null,2));
}catch(error){process.exitCode=1;console.error(error,{root,failure,trace:trace.map(t=>`${t.run}:${t.who}:${t.step}:${t.calls.map((c:any)=>c.name)}`)});}
finally{await writeFile(join(root,'trace.json'),JSON.stringify(trace,null,2));await writeFile(join(root,'source-hashes.json'),JSON.stringify(await Promise.all(['apps/launcher/src/control-service.ts','apps/launcher/src/experience-store.ts','apps/launcher/src/episode-learning.ts','apps/launcher/src/launch.ts','apps/opencode-plugin/src/index.ts','tests/manual/experience-loop.ts'].map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')}))),null,2));await new Promise<void>(done=>{stub.close(()=>done());stub.closeAllConnections();});}
