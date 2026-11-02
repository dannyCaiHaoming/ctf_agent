// Transport-only public OpenCode probe. No semantic model or product implementation.
import assert from 'node:assert/strict';
import {createServer,type ServerResponse} from 'node:http';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {startManagedOpenCode} from '../../packages/opencode-bridge/src/server.js';

type Candidate='native_text_part'|'synthetic_text_part'|'tool_output_only'|'synthetic_appended_message'|'append_only_combo';
const allCandidates:Candidate[]=['native_text_part','synthetic_text_part','tool_output_only','synthetic_appended_message','append_only_combo'];
const requested=process.env.PROBE_CANDIDATES?.split(',').map(value=>value.trim()).filter(Boolean) as Candidate[]|undefined;
const candidates:Candidate[]=requested?.length?requested:allCandidates;
assert(candidates.every(candidate=>allCandidates.includes(candidate)),'unknown PROBE_CANDIDATES value');
const root=await mkdtemp(join(tmpdir(),'recon-context-placement-'));
const statePath=join(root,'state.json'),eventsPath=join(root,'events.jsonl');
const state:Record<string,any>={},requests:any[]=[],checks:any[]=[],candidateReports:Record<string,any>={};
const trace:Array<{at:number;stage:string;detail?:unknown}>=[];const mark=(stage:string,detail?:unknown)=>trace.push({at:Date.now(),stage,detail});
const wait=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));
async function within<T>(label:string,value:Promise<T>,ms=5000):Promise<T>{let timer:NodeJS.Timeout|undefined;try{return await Promise.race([value,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('probe timeout: '+label)),ms);})]);}finally{if(timer)clearTimeout(timer);}}
const save=()=>writeFile(statePath,JSON.stringify(state));
await save();
const plugin=join(root,'probe.ts');
await writeFile(plugin,`
import {readFile,writeFile,appendFile} from 'node:fs/promises';
import {tool} from ${JSON.stringify(resolve('node_modules/@opencode-ai/plugin/dist/tool.js'))};
const statePath=${JSON.stringify(statePath)},eventsPath=${JSON.stringify(eventsPath)};
const lastVisible=new Map();
const event=(value)=>appendFile(eventsPath,JSON.stringify(value)+'\\n');
const partId=()=> 'prt_'+crypto.randomUUID().replaceAll('-','');
const messageId=()=> 'msg_'+crypto.randomUUID().replaceAll('-','');
async function projection(sessionID){
 const all=JSON.parse(await readFile(statePath,'utf8')),value=all[sessionID];
 if(!value||value.fail){await event({hook:'projection.error',sessionID,reason:'unavailable'});throw new Error('probe projection unavailable');}
 return {...value,marker:'[PROJECTION '+value.label+' v'+value.version+' candidate='+value.candidate+'] facts=local; lesson=local@1'};
}
function textPart(input,value,messageID,synthetic){
 const part={id:partId(),sessionID:input.sessionID,messageID,type:'text',text:value.marker};
 if(synthetic)part.synthetic=true;
 return part;
}
function appendSyntheticMessage(out,user,value){
 const id=messageId();
 out.messages.push({info:{...user.info,id,time:{created:Date.now()}},parts:[{
   id:partId(),sessionID:user.info.sessionID,messageID:id,type:'text',synthetic:true,text:value.marker
 }]});
}
export default {id:'context-placement-probe',server:async()=>({
 tool:{probe_update:tool({description:'Update local probe state',args:{},async execute(_,ctx){const all=JSON.parse(await readFile(statePath,'utf8'));all[ctx.sessionID].version++;await writeFile(statePath,JSON.stringify(all));return 'local state updated';}})},
 async event({event:value}){
   if(value.type==='session.compacted'){
     const sessionID=value.properties?.sessionID??value.data?.sessionID;
     if(sessionID)lastVisible.delete(sessionID);
     await event({hook:'session.compacted',sessionID});
   }
 },
 async 'chat.message'(input,output){
   const value=await projection(input.sessionID);
   if(!['native_text_part','synthetic_text_part','append_only_combo'].includes(value.candidate))return;
   if(value.candidate==='append_only_combo'&&lastVisible.get(input.sessionID)===value.version){
     await event({hook:'chat.message.skip_same_version',sessionID:input.sessionID,version:value.version});
     return;
   }
   output.parts.push(textPart(input,value,output.message.id,value.candidate!=='native_text_part'));
   lastVisible.set(input.sessionID,value.version);
   await event({hook:'chat.message.append',candidate:value.candidate,sessionID:input.sessionID,version:value.version});
 },
 async 'tool.execute.after'(input,output){
   const value=await projection(input.sessionID);
   if(!['tool_output_only','append_only_combo'].includes(value.candidate))return;
   if(value.candidate==='append_only_combo'&&lastVisible.get(input.sessionID)===value.version){
     await event({hook:'tool.after.skip_same_version',sessionID:input.sessionID,version:value.version});
     return;
   }
   output.output+='\\n'+value.marker;
   lastVisible.set(input.sessionID,value.version);
   await event({hook:'tool.after.append',candidate:value.candidate,sessionID:input.sessionID,version:value.version,callID:input.callID});
 },
 async 'experimental.chat.messages.transform'(_,out){
   const sessions=[...new Set(out.messages.map((message)=>message.info.sessionID))];
   if(sessions.length!==1)throw new Error('probe binding ambiguous');
   const value=await projection(sessions[0]);
   await event({hook:'transform',candidate:value.candidate,sessionID:sessions[0],version:value.version,messages:out.messages.length});
   if(value.candidate!=='synthetic_appended_message')return;
   const user=out.messages.filter((message)=>message.info.role==='user').at(-1);
   if(!user)throw new Error('no user message');
   appendSyntheticMessage(out,user,value);
 },
 async 'experimental.session.compacting'(input,output){
   const value=await projection(input.sessionID);
   const marker='[COMPACTION PROJECTION '+value.label+' v'+value.version+' candidate='+value.candidate+'] '+value.marker;
   output.context.push(marker);
   await event({hook:'compacting.append',candidate:value.candidate,sessionID:input.sessionID,version:value.version});
 }
})};
`);
let seq=0,holdLabel:string|undefined,heldResponse:ServerResponse|undefined,heldResolve:()=>void=()=>{};
const held=new Promise<void>(resolveHeld=>{heldResolve=resolveHeld;});
const role=(message:any)=>message?.role??'unknown';
const content=(message:any)=>{
 if(typeof message?.content==='string')return message.content;
 if(Array.isArray(message?.content))return message.content.map((item:any)=>typeof item==='string'?item:String(item?.text??'')).join('\n');
 return '';
};
const markerPattern=/\[PROJECTION ([AB]) v(\d+) candidate=([a-z_]+)\]/g;
const compactPattern=/\[COMPACTION PROJECTION ([AB]) v(\d+) candidate=([a-z_]+)\]/g;
const probePattern=/PROBE:([a-z_]+):([AB])/g;
function lastMatch(pattern:RegExp,text:string){const matches=[...text.matchAll(pattern)];return matches.at(-1);}
function normalize(body:any){
 const seenCalls:number[]=[];
 return body.messages.map((message:any,index:number)=>{
   const calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
   if(role(message)==='assistant')for(const call of calls)seenCalls.push(call.id);
   const result=role(message)==='tool'?message.tool_call_id:undefined;
   return {index,role:role(message),content:content(message),toolCalls:calls.map((call:any)=>({id:call.id,name:call?.function?.name,arguments:call?.function?.arguments})),toolCallID:result};
 });
}
function pairing(messages:any[]){
 const calls=new Map<string,number>(),results=new Map<string,number>();
 for(const message of messages){
   for(const call of message.toolCalls)calls.set(call.id,message.index);
   if(message.toolCallID)results.set(message.toolCallID,message.index);
 }
 return {
   callIDs:[...calls.keys()],resultIDs:[...results.keys()],
   complete:[...calls].every(([id,index])=>results.has(id)&&results.get(id)!>index)&&[...results].every(([id,index])=>calls.has(id)&&calls.get(id)!<index),
   callsWithoutResults:[...calls.keys()].filter(id=>!results.has(id)),
   resultsWithoutCalls:[...results.keys()].filter(id=>!calls.has(id))
 };
}
function isPrefix(previous:any[],next:any[]){
 return previous.every((message,index)=>JSON.stringify(message)===JSON.stringify(next[index]));
}
function requestSummary(request:any){
 return {index:request.index,candidate:request.candidate,label:request.label,phase:request.phase,compact:request.compact,messagesBytes:request.messagesBytes,messagesSha256:request.messagesSha256,markers:request.markers,compactMarkers:request.compactMarkers,pairing:request.pairing,stablePrefixFromPrevious:request.stablePrefixFromPrevious};
}
function markerCount(request:any,label:string,version:number,candidate:Candidate){
 return request.markers.filter((marker:any)=>marker.label===label&&marker.version===version&&marker.candidate===candidate).length;
}
function compactCount(request:any,label:string,version:number,candidate:Candidate){
 return request.compactMarkers.filter((marker:any)=>marker.label===label&&marker.version===version&&marker.candidate===candidate).length;
}
function addCheck(candidate:Candidate,name:string,passed:boolean,detail:any={}){
 checks.push({candidate,name,status:passed?'passed':'failed',detail});
 return passed;
}
const stub=createServer((request,response)=>{void(async()=>{
 if(!request.url?.endsWith('/chat/completions')){response.writeHead(404).end();return;}
 const chunks=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
 const body=JSON.parse(Buffer.concat(chunks).toString());
 const serialized=JSON.stringify(body.messages);
 const candidateMatch=lastMatch(probePattern,serialized);
 const projectionMatch=lastMatch(markerPattern,serialized);
 const compactMatch=lastMatch(compactPattern,serialized);
 const markerCandidate=projectionMatch?.[3]??compactMatch?.[3];
 const candidate=(candidateMatch?.[1]??markerCandidate??'unknown') as Candidate;
 const label=candidateMatch?.[2]??projectionMatch?.[1]??compactMatch?.[1]??'?';
 const messages=normalize(body);
 const toolPairing=pairing(messages);
 const compact=Boolean(compactMatch);
 const markers=[...serialized.matchAll(markerPattern)].map(match=>({label:match[1],version:Number(match[2]),candidate:match[3] as Candidate}));
 const compactMarkers=[...serialized.matchAll(compactPattern)].map(match=>({label:match[1],version:Number(match[2]),candidate:match[3] as Candidate}));
 const previous=[...requests].reverse().find(item=>item.candidate===candidate&&item.label===label&&!item.compact&&!item.cancelled);
 const requestRecord:any={index:requests.length,candidate,label,phase:'unknown',compact,messages,markers,compactMarkers,pairing:toolPairing,messagesBytes:Buffer.byteLength(JSON.stringify(messages)),messagesSha256:createHash('sha256').update(JSON.stringify(messages)).digest('hex'),stablePrefixFromPrevious:previous?isPrefix(previous.messages,messages):null};
 requests.push(requestRecord);
 await writeFile(eventsPath,await readFile(eventsPath,'utf8').catch(()=>''));
 if(compactMatch){void compactMatch;}
 if(holdLabel===label&&!compact){
   holdLabel=undefined;requestRecord.cancelled=true;heldResponse=response;heldResolve();return;
 }
 const userIndex=messages.map((message:any)=>message.role).lastIndexOf('user');
 const afterLastUser=messages.slice(userIndex+1);
 const wantsTool=messages[userIndex]?.content.includes('USE_TOOL')&&!afterLastUser.some((message:any)=>message.role==='tool');
 const base={id:'chatcmpl-'+(++seq),object:'chat.completion.chunk',created:1,model:'scripted'};
 const delta=compact?{role:'assistant',content:'Local compact summary.'}:wantsTool?{role:'assistant',tool_calls:[{index:0,id:'call_'+seq,type:'function',function:{name:'probe_update',arguments:'{}'}}]}:{role:'assistant',content:'LOCAL_DONE'};
 response.writeHead(200,{'content-type':'text/event-stream'});
 for(const value of [{...base,choices:[{index:0,delta,finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:wantsTool?'tool_calls':'stop'}]},{...base,choices:[],usage:{prompt_tokens:20,completion_tokens:5,total_tokens:25}}])response.write('data: '+JSON.stringify(value)+'\n\n');
 response.end('data: [DONE]\n\n');
})().catch(error=>response.writeHead(500).end(String(error)));});
await new Promise<void>(resolveListen=>stub.listen(0,'127.0.0.1',resolveListen));
process.env.HTTP_PROXY=process.env.HTTPS_PROXY=process.env.ALL_PROXY='http://127.0.0.1:9';
process.env.NO_PROXY='127.0.0.1,localhost';
const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),240000);
let engine:Awaited<ReturnType<typeof startManagedOpenCode>>|undefined,error:string|undefined;
try{
 engine=await startManagedOpenCode({
   directory:join(root,'runtime'),binaryPath:'/Users/caihaoming/.opencode/bin/opencode',signal:abort.signal,environment:{},
   config:{
     model:'stub/scripted',small_model:'stub/scripted',enabled_providers:['stub'],plugin:[plugin],
     agent:{
       'probe-a':{mode:'all',prompt:'PROBE_AGENT_A local placement interface only',tools:{'*':false,probe_update:true}},
       'probe-b':{mode:'all',prompt:'PROBE_AGENT_B local placement interface only',tools:{'*':false,probe_update:true}}
     },
     provider:{stub:{npm:'@ai-sdk/openai-compatible',options:{baseURL:'http://127.0.0.1:'+(stub.address() as any).port+'/v1',apiKey:'local-only'},models:{scripted:{limit:{context:65536,output:4096}}}}}
   }
 });
 const client=engine.client;
 for(const candidate of candidates){
   const sessionA=(await client.session.create({title:candidate+' A'},{throwOnError:true})).data!;
   const sessionB=(await client.session.create({title:candidate+' B'},{throwOnError:true})).data!;
   state[sessionA.id]={candidate,label:'A',version:1,fail:false};state[sessionB.id]={candidate,label:'B',version:1,fail:false};await save();
   const prompt=async(session:any,label:'A'|'B',phase:string,text:string)=>{
     const from=requests.length;
     const result=await client.session.prompt({sessionID:session.id,agent:label==='A'?'probe-a':'probe-b',parts:[{type:'text',text:'PROBE:'+candidate+':'+label+' phase='+phase+'\n'+text}]},{throwOnError:true});
     for(const request of requests.slice(from))request.phase=phase;
     return {result,requests:requests.slice(from)};
   };
   const stage:any={};
   const initial=await prompt(sessionA,'A','initial_tool','USE_TOOL');
   stage.initial=initial.requests.map(requestSummary);
   const initialRequest=initial.requests[0],continuation=initial.requests[1];
   const initialVisible=Boolean(initialRequest&&markerCount(initialRequest,'A',1,candidate)>0);
   const continuationCurrent=Boolean(continuation&&markerCount(continuation,'A',2,candidate)>0);
   const initialStable=Boolean(continuation&&continuation.stablePrefixFromPrevious===true);
   const initialPairs=Boolean(!continuation||continuation.pairing.complete);
   addCheck(candidate,'first model request exposes current state',initialVisible,{request:initialRequest?.index});
   addCheck(candidate,'native tool continuation exposes changed current state',continuationCurrent,{request:continuation?.index});
   addCheck(candidate,'initial user prefix remains byte-stable through tool continuation',initialStable,{request:initialRequest?.index,next:continuation?.index});
   addCheck(candidate,'tool call and result remain paired',initialPairs,{pairing:continuation?.pairing});

   const same=await prompt(sessionA,'A','same_version','Resume with the same state');
   stage.same=requests.slice(same.requests[0]?.index??0).slice(0,same.requests.length).map(requestSummary);
   const sameRequest=same.requests[0];
   const sameCurrentCount=sameRequest?markerCount(sameRequest,'A',2,candidate):0;
   addCheck(candidate,'same-version request contains current state once',sameCurrentCount===1,{count:sameCurrentCount,request:sameRequest?.index});
   addCheck(candidate,'same-version request preserves previous provider prefix',sameRequest?.stablePrefixFromPrevious===true,{request:sameRequest?.index});

   state[sessionA.id].version=3;await save();
   const changed=await prompt(sessionA,'A','changed_new_user','State changed externally');
   stage.changed=changed.requests.map(requestSummary);
   const changedRequest=changed.requests[0];
   const changedVisible=Boolean(changedRequest&&markerCount(changedRequest,'A',3,candidate)===1);
   addCheck(candidate,'new user message exposes changed current state once',changedVisible,{request:changedRequest?.index,count:changedRequest?markerCount(changedRequest,'A',3,candidate):0});
   addCheck(candidate,'new user message preserves previous provider prefix',changedRequest?.stablePrefixFromPrevious===true,{request:changedRequest?.index});

   state[sessionA.id].version=4;state[sessionB.id].version=1;await save();
   const fromParallel=requests.length;
   await Promise.all([prompt(sessionA,'A','parallel','Parallel A'),prompt(sessionB,'B','parallel','Parallel B')]);
   for(const request of requests.slice(fromParallel))request.phase='parallel';
   const parallel=requests.slice(fromParallel);stage.parallel=parallel.map(requestSummary);
   const parallelA=parallel.filter(request=>request.label==='A'),parallelB=parallel.filter(request=>request.label==='B');
   addCheck(candidate,'concurrent sessions remain isolated',parallelA.length===1&&parallelB.length===1&&parallelA.every(request=>request.markers.every((marker:any)=>marker.label==='A'))&&parallelB.every(request=>request.markers.every((marker:any)=>marker.label==='B')),{requests:parallel.map(requestSummary)});

   const fromCompact=requests.length;
   await client.session.summarize({sessionID:sessionA.id,providerID:'stub',modelID:'scripted',auto:false},{throwOnError:true});
   for(let index=0;index<100;index++){const statuses=(await client.session.status({},{throwOnError:true})).data;if(!statuses?.[sessionA.id]||statuses[sessionA.id]?.type==='idle')break;await new Promise(resolveWait=>setTimeout(resolveWait,50));}
   const compactRequests=requests.slice(fromCompact);for(const request of compactRequests)request.phase='explicit_compaction';
   stage.compaction=compactRequests.map(requestSummary);
   const compactRequest=compactRequests.find(request=>request.compact);
   addCheck(candidate,'compaction prompt receives current state',Boolean(compactRequest&&compactCount(compactRequest,'A',4,candidate)>0),{request:compactRequest?.index});
   const postCompact=await prompt(sessionA,'A','post_compaction','Resume after compaction');
   stage.postCompaction=postCompact.requests.map(requestSummary);
   const postCompactRequest=postCompact.requests[0];
   addCheck(candidate,'post-compaction request exposes current state',Boolean(postCompactRequest&&markerCount(postCompactRequest,'A',4,candidate)===1),{request:postCompactRequest?.index});

   state[sessionB.id].version=2;await save();
   mark('cancel.prepare',{candidate,sessionID:sessionB.id});
   holdLabel='B';const fromCancel=requests.length;const pending=prompt(sessionB,'B','cancel','Cancel in flight').catch(error=>String(error));
   await within('cancel request reaches local stub',held,20000);mark('cancel.request-held',{candidate,requestCount:requests.length});
   const aborting=client.session.abort({sessionID:sessionB.id},{throwOnError:true}).then(()=>undefined).catch(error=>{mark('cancel.abort-error',{candidate,error:String(error)});});
   await wait(100);mark('cancel.close-held-response',{candidate});heldResponse?.destroy();heldResponse=undefined;
   await within('session abort request',aborting,5000);mark('cancel.abort-returned',{candidate});
   await within('cancelled prompt settles',Promise.allSettled([pending]),5000);mark('cancel.prompt-settled',{candidate});
   let idle=false;for(let index=0;index<100;index++){const statuses=(await within('session status after cancel',client.session.status({},{throwOnError:true}),2000)).data;if(!statuses?.[sessionB.id]||statuses[sessionB.id]?.type==='idle'){idle=true;break;}await wait(50);}
   mark('cancel.idle',{candidate,idle});
   if(!idle)throw new Error('probe cancellation did not reach idle: '+candidate);
   for(const request of requests.slice(fromCancel))request.phase='cancel';
   const afterCancel=await prompt(sessionB,'B','after_cancel','Resume after cancel');
   stage.cancel=requests.slice(fromCancel).map(requestSummary);
   const afterCancelRequest=afterCancel.requests[0];
   addCheck(candidate,'post-cancellation request exposes current state',Boolean(afterCancelRequest&&markerCount(afterCancelRequest,'B',2,candidate)===1),{request:afterCancelRequest?.index});

   state[sessionB.id].version=3;state[sessionB.id].fail=true;await save();
   const fromFailure=requests.length;let failureReply:unknown;
   try{failureReply=await prompt(sessionB,'B','projection_failure','Must not reach endpoint');}catch(failure){failureReply=String(failure);}
   for(const request of requests.slice(fromFailure))request.phase='projection_failure';
   const endpointDelta=requests.length-fromFailure;
   addCheck(candidate,'projection failure prevents every outbound model request',endpointDelta===0,{endpointDelta,sdkReply:failureReply});

   stage.failClosed={endpointDelta,sdkReply:failureReply};
   const required=['first model request exposes current state','native tool continuation exposes changed current state','initial user prefix remains byte-stable through tool continuation','tool call and result remain paired','same-version request contains current state once','same-version request preserves previous provider prefix','new user message exposes changed current state once','new user message preserves previous provider prefix','concurrent sessions remain isolated','compaction prompt receives current state','post-compaction request exposes current state','post-cancellation request exposes current state','projection failure prevents every outbound model request'];
   const candidateChecks=checks.filter(check=>check.candidate===candidate);
   candidateReports[candidate]={status:candidateChecks.every(check=>check.status==='passed')?'passed':'failed',checks:candidateChecks,stages:stage,sessionIDs:{A:sessionA.id,B:sessionB.id}};
 }
 const expected:Record<Candidate,Partial<Record<string,boolean>>>={native_text_part:{'native tool continuation exposes changed current state':false},synthetic_text_part:{'native tool continuation exposes changed current state':false,'post-cancellation request exposes current state':false},tool_output_only:{'first model request exposes current state':false,'new user message exposes changed current state once':false,'post-compaction request exposes current state':false,'post-cancellation request exposes current state':false},synthetic_appended_message:{'native tool continuation exposes changed current state':false,'initial user prefix remains byte-stable through tool continuation':false,'same-version request contains current state once':false,'same-version request preserves previous provider prefix':false,'new user message preserves previous provider prefix':false},append_only_combo:{}};
 for(const candidate of candidates)for(const [name,value] of Object.entries(expected[candidate])){
   const check=checks.find(item=>item.candidate===candidate&&item.name===name);
   assert(check,'missing expected check '+candidate+' '+name);
   assert.equal(check.status,value?'passed':'failed','unexpected result: '+candidate+' / '+name);
 }
 if(candidates.includes('append_only_combo'))assert.equal(candidateReports.append_only_combo.status,'passed','append-only combo must pass every criterion');
}catch(caught){error=String(caught);process.exitCode=1;}
finally{
 clearTimeout(timer);await engine?.close();stub.closeAllConnections();await new Promise<void>(resolveClose=>stub.close(()=>resolveClose()));
 const directory=resolve('docs/gates/recon-context-interface-20261031');await mkdir(directory,{recursive:true});
   const report={status:error?'failed':'passed',error,root,version:engine?.version,realModelCalls:0,proof:'scripted localhost responses; public native transport only; no model, semantic, provider-cache or cost proof',candidates:candidateReports,automaticCompaction:{status:'not-observed',reason:'The probe uses explicit native compaction and the public compacting hook. Triggering overflow would also require a product-sized conversation; automatic continuation remains a separate interface condition.'},requestCount:requests.length,requests,trace,hookEvents:await readFile(eventsPath,'utf8').catch(()=>''),probeSha256:createHash('sha256').update(await readFile(import.meta.filename)).digest('hex')};
 await writeFile(join(directory,'placement-validation.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({status:report.status,error,version:report.version,realModelCalls:0,candidates:Object.fromEntries(candidates.map(candidate=>[candidate,{status:candidateReports[candidate]?.status,failed:candidateReports[candidate]?.checks.filter((check:any)=>check.status==='failed').map((check:any)=>check.name)??[]}])),requestCount:requests.length,evidence:join(directory,'placement-validation.json')},null,2));
}
