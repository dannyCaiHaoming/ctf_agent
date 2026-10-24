import {createServer} from 'node:net';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareRun} from '/Users/caihaoming/.codex/worktrees/local-readiness-validation/pentest-agent/apps/launcher/src/run-prep.ts';
const root='/var/folders/tn/x1hbkfy17sx0w1lb8kjzzr340000gn/T/ctf-readiness-validation-5wp4ld7h/readiness';
const server=createServer(s=>s.on('error',()=>{}));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const port=(server.address() as any).port;const rows=[];
try {for(const [name,extra,target] of [['port-only',{},true],['required-missing',{readiness:{required:true}},true],['instance-change-no-contract',{},true],['valid-binding-unrecognized',{readiness:{required:true,evidence:'synthetic-binding.json'}},true],['not-applicable-current',{},false]] as const){
 const dir=join(root,name);await mkdir(join(dir,'workspace'),{recursive:true});await mkdir(join(dir,'evidence'),{recursive:true});
 await writeFile(join(dir,'challenges.json'),JSON.stringify({challenges:[{id:'offline-probe',statement:'synthetic offline input',...(target?{target:{protocol:'tcp',host:'127.0.0.1',port}}:{}),...extra}]}));
 try {let r=await prepareRun({challengesPath:join(dir,'challenges.json'),workspace:join(dir,'workspace'),evidence:join(dir,'evidence'),secrets:[]});rows.push({name,accepted:true,reachable:r[0].reachability?.reachable??null});}catch(e){rows.push({name,accepted:false,error:(e as Error).message});}
}}finally{await new Promise<void>(r=>server.close(()=>r()));}
console.log(JSON.stringify(rows,null,2));await writeFile(join(root,'offline-results.json'),JSON.stringify(rows,null,2));
