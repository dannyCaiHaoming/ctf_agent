import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch } from './apps/launcher/src/launch.js';
const out='/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-readiness-validation-5wp4ld7h/root';
const ext = await new Promise<string>(r=>{ const s=connect({host:'1.1.1.1',port:443}); s.on('connect',()=>{s.destroy();r('CONNECTED')}); s.on('error',(e:any)=>r(e.code)); s.setTimeout(2000,()=>{s.destroy();r('TIMEOUT')}); });
assert.equal(ext,'EPERM','network must be denied by OS');
await writeFile(join(out,'isolation.json'),JSON.stringify({externalConnect:ext,environmentKeys:Object.keys(process.env).sort(),provider:'loopback deterministic stub only',auth:'fictional local-only env key',kernelPolicy:'isolation.sb'},null,2));
const all:any[]=[];
for(const [label,finish,text,limit,budget] of [ ['empty-length','length','',64,1000],['partial-length','length','PARTIAL REPORT',64,1000],['normal-stop','stop','UNSOLVED; no candidate found',64,1000],['budget-smaller','stop','UNSOLVED',2048,512] ] as const){
 const root=join(out,label); await mkdir(root,{recursive:true});
 const requests:any[]=[];
 const server=createServer((q,r)=>{void(async()=>{assert(q.url?.endsWith('/chat/completions')); const b:Buffer[]=[];for await(const c of q)b.push(Buffer.from(c));const body=JSON.parse(Buffer.concat(b).toString());requests.push({model:body.model,max_tokens:body.max_tokens,max_completion_tokens:body.max_completion_tokens,stream:body.stream}); const base={id:'local',object:'chat.completion.chunk',created:1,model:'scripted'};r.writeHead(200,{'content-type':'text/event-stream'});for(const v of [{...base,choices:[{index:0,delta:{role:'assistant',...(text?{content:text}:{})},finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:finish}]},{...base,choices:[],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}])r.write(`data: ${JSON.stringify(v)}\n\n`);r.end('data: [DONE]\n\n');})().catch(()=>r.writeHead(500).end('{}'))});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 process.env.OFFLINE_STUB_KEY='local-only';
 await writeFile(join(root,'opencode.json'),JSON.stringify({model:'stub/scripted',enabled_providers:['stub'],provider:{stub:{npm:'@ai-sdk/openai-compatible',options:{baseURL:`http://127.0.0.1:${(server.address() as any).port}/v1`,apiKey:'{env:OFFLINE_STUB_KEY}'},models:{scripted:{limit:{context:65536,output:limit}}}}}}));
 await writeFile(join(root,'challenges.json'),JSON.stringify({challenges:[{id:'offline',statement:'deterministic offline fixture; no target, no oracle'}]}));
 await writeFile(join(root,'profile.json'),JSON.stringify({profileId:'offline',challenges:'challenges.json',opencode:{configPath:'opencode.json',binaryPath:'/Users/caihaoming/.opencode/bin/opencode'},reference:{enabled:false},budget:{wallClockMs:15000,maxSteps:3,maxObservableTokens:budget,maxToolJobs:1},os:{platform:'macos'}}));
 try{const result=await launch({profile:join(root,'profile.json'),runsRoot:join(root,'runs'),runId:'run'});const run=JSON.parse(await readFile(join(result.runDir!,'state/run.json'),'utf8'));const evidence=join(result.runDir!,'evidence');const msgs=JSON.parse(await readFile(join(evidence,`messages-${run.rootSessionId}.json`),'utf8'));const admissions=JSON.parse(await readFile(join(evidence,'admissions.json'),'utf8'));all.push({label,limit,budget,result,version:run.opencodeVersion,requests,admissions,admitted:run.admittedModelCalls,stopReason:run.stopReason,assistant:msgs.filter((m:any)=>m.info.role==='assistant').map((m:any)=>({id:m.info.id,finish:m.info.finish,error:m.info.error??null,time:m.info.time,text:m.parts.filter((p:any)=>p.type==='text').map((p:any)=>p.text)})),trusted:await Promise.all(['publications.json','verification-results.json','completion-results.json'].map(async n=>({name:n,value:JSON.parse(await readFile(join(evidence,n),'utf8'))})))});}catch(e){all.push({label,error:String(e),requests});}
 finally{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections()});}
 await writeFile(join(out,'runtime-summary.json'),JSON.stringify(all,null,2));
}
console.log(JSON.stringify(all));
