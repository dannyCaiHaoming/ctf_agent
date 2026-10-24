// Candidate-package contract: C integration with real files/jobs; SDK identity only is a deterministic fixture.
import {afterAll,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ControlService} from '../../apps/launcher/src/control-service.js';
const services:ControlService[]=[];
async function evidence(name:string,items:Record<string,Buffer|object>){
 const root=process.env.D_VERIFIER_EVIDENCE_DIR;if(!root)return;const dir=join(root,name);await mkdir(dir,{recursive:true});
 for(const [file,value] of Object.entries(items))await writeFile(join(dir,file),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));
}

afterAll(async()=>{await Promise.all(services.map(s=>s.stopAll('test end')));});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'d-package-'));const materialsDir=join(root,'X/materials');await mkdir(materialsDir,{recursive:true});await writeFile(join(materialsDir,'input.bin'),Buffer.from([0,255,13,10]));
 const client={session:{get:async({sessionID}:any)=>({data:{id:sessionID,parentID:'root',agent:sessionID==='other'?'engineer':sessionID}}),children:async()=>({data:[]}),messages:async()=>({data:[]}),abort:async()=>({data:true})}};
 const s=new ControlService({runId:'D-package',client:client as never,budget:{maxModelCalls:100,maxObservableTokens:100000},expiresAt:Date.now()+60000,workdir:join(root,'opencode'),skillRoot:join(root,'skills'),challenges:[{id:'X',title:null,target:null,reachability:null,materials:[{name:'input.bin',sha256:createHash('sha256').update(Buffer.from([0,255,13,10])).digest('hex'),bytes:4}],materialsDir},{id:'Y',title:null,target:null,reachability:null,materials:[],materialsDir:join(root,'Y/materials')}]});services.push(s);s.bindRoot('root');let n=0;
 const exec=(sid:string,tool:string,args:object={})=>s.handle(sid,'tool.execute',{tool,args,callID:'p'+(++n)}) as Promise<any>;
 async function bind(sid:string,role:string,challenge='X',version?:string){await exec('root','challenge.assign',{role,challenge,...(version?{version}:{})});const callID='t'+(++n);await s.handle('root','tool.before',{tool:'task',callID,args:{subagent_type:role,background:true}});await s.handle('root','tool.after',{tool:'task',callID,metadata:{sessionId:sid},output:'running'});await s.handle(sid,'chat.message',{agent:role});}
 await bind('domain-solver','domain-solver');await bind('engineer','engineer');
 const publish=async(sid:string,path:string,bytes:Buffer)=>{await exec(sid,'workspace.write',{path,content:bytes.toString('base64'),encoding:'base64'});return exec(sid,'artifact.publish',{source:'file',path});};
 const source=await publish('domain-solver','work/mixed.bin',Buffer.concat([Buffer.from('log\r\n旗{é}'),Buffer.from([0,255,13,10])]));
 const script=await publish('engineer','work/solve.cjs',Buffer.from("process.stdout.write('candidate')"));
 const args={candidate:{ref:source.ref,start:5,end:14},files:[{kind:'artifact',ref:script.ref,path:'solve.cjs',purpose:'script'},{kind:'material',name:'input.bin',path:'data/input.bin',purpose:'input'},{kind:'artifact',ref:source.ref,path:'evidence/raw.bin',purpose:'evidence'}],argv:[process.execPath,'solve.cjs'],extraction:'Select bytes [5,14); no normalization',premises:['External state unknown']};
 const packages=()=>s.publicationSnapshot().filter(p=>p.source.kind as string==='package');
 return {root,s,exec,bind,publish,source,script,args,packages,read:async(version:string,component='candidate',path?:string)=>exec('engineer','package.read',{version,component,...(path?{path}:{})})};
}
describe('D third interface',()=>{
 it('V1/V2 binds a real execution before first read and prepares exact bytes',async()=>{
  const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);
  await f.bind('verifier','verifier','X',p.version);
  const page=await f.exec('verifier','package.read',{version:p.version,component:'candidate'});
  expect(Buffer.from(page.data,'base64')).toEqual(Buffer.from([0xe6,0x97,0x97,0x7b,0xc3,0xa9,0x7d,0,255]));
  const ready=await f.exec('verifier','package.prepare',{});expect(ready.ready).toBe(true);
  expect(await readFile(join(f.root,'X/work/verifier',ready.directory,'data/input.bin'))).toEqual(Buffer.from([0,255,13,10]));
  expect(await readFile(join(f.root,'X/work/verifier',ready.directory,'solve.cjs'),'utf8')).toBe("process.stdout.write('candidate')");
  const j=await f.exec('verifier','job.run',{preparation:ready.preparation,argv:[process.execPath,'solve.cjs'],timeout_ms:5000});
  expect(j.exitCode).toBe(0);expect(j.inputAssociation.version).toBe(p.version);expect(j.inputAssociation.continuousIntegrity).toBe('unknown');
  expect(Buffer.from((await f.exec('verifier','job.read',{job:j.job,stream:'stdout'})).data,'base64').toString()).toBe('candidate');
 });
 it('V1 rejects missing/wrong-role/foreign version and never inherits on resume',async()=>{
  const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);
  for(const args of [{role:'verifier',challenge:'X'},{role:'engineer',challenge:'X',version:p.version},{role:'verifier',challenge:'Y',version:p.version},{role:'verifier',challenge:'X',version:'foreign'}])await expect(f.exec('root','challenge.assign',args)).rejects.toThrow();
  await f.bind('verifier','verifier','X',p.version);
  await expect(f.exec('verifier','package.read',{version:f.source.ref,component:'candidate'})).rejects.toThrow('verification version');
  for(const tool of ['package.publish','artifact.publish','http.request'])await expect(f.exec('verifier',tool,{})).rejects.toThrow('denied');
  const e=f.s.executionSnapshot().find(e=>e.role==='verifier')!;
  await f.s.handle('root','chat.message',{agent:'coordinator',messageID:'done',parts:[{type:'text',synthetic:true,text:`<task id="verifier" state="completed">\n<summary>Background task completed: [ctf:${e.ref}]</summary>`}]});
  await expect(f.exec('verifier','package.prepare')).rejects.toThrow('verification version');
  await expect(f.s.handle('root','tool.before',{tool:'task',callID:'resume-missing',args:{subagent_type:'verifier',task_id:'verifier',background:true}})).rejects.toThrow('verification version');
  await f.exec('root','challenge.assign',{role:'verifier',challenge:'X',version:p.version});
  await expect(f.s.handle('root','tool.before',{tool:'task',callID:'foreign-task',args:{subagent_type:'verifier',task_id:'not-owned',background:true}})).rejects.toThrow('denied');
  await f.s.handle('root','tool.before',{tool:'task',callID:'resume-explicit',args:{subagent_type:'verifier',task_id:'verifier',background:true}});
  expect(f.s.executionSnapshot().filter(e=>e.role==='verifier')).toHaveLength(2);
  expect((await f.exec('verifier','package.prepare')).version).toBe(p.version);
 });
 it('V1 refuses late native child before admission and keeps the actual child/version',async()=>{
  const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);
  await f.exec('root','challenge.assign',{role:'verifier',challenge:'X',version:p.version});
  await f.s.handle('root','tool.before',{tool:'task',callID:'native-v',args:{subagent_type:'verifier',background:true}});
  await f.s.handle('root','tool.after',{tool:'task',callID:'native-v',metadata:{sessionId:'verifier'},output:'running'});
  const client=(f.s as any).options.client;const original=client.session.get;client.session.get=async({sessionID}:any)=>({data:{id:sessionID,parentID:'root',agent:'verifier'}});
  await expect(f.s.handle('late','model.call',{agent:'verifier'})).rejects.toThrow('denied');
  client.session.get=original;
  await f.s.handle('verifier','model.call',{agent:'verifier'});
  expect((await f.exec('verifier','package.prepare')).version).toBe(p.version);
 });
 it('V2 handles multiple pages, immutable material/artifact dependencies and new private directories',async()=>{
  const f=await fixture();const bytes=Buffer.concat([Buffer.from([0,255,13,10]),Buffer.from('旗é'.repeat(15000))]);
  const a=await f.publish('engineer','work/large.bin',bytes);
  const p=await f.exec('engineer','package.publish',{...f.args,files:[...f.args.files,{kind:'artifact',ref:a.ref,path:'data/large.bin',purpose:'input'}]});
  await f.bind('verifier','verifier','X',p.version);
  let cursor:string|undefined;const chunks:Buffer[]=[];do{const r=await f.exec('verifier','package.read',{version:p.version,component:'file',path:'data/large.bin',...(cursor?{cursor}:{})});chunks.push(Buffer.from(r.data,'base64'));cursor=r.nextCursor??undefined;}while(cursor);
  expect(Buffer.concat(chunks)).toEqual(bytes);expect(chunks.length).toBeGreaterThan(1);await evidence('multipage',{'original.bin':bytes,'received.bin':Buffer.concat(chunks),'pages.json':{sizes:chunks.map(b=>b.length)}});
  const one=await f.exec('verifier','package.prepare');const two=await f.exec('verifier','package.prepare');expect(one.directory).not.toBe(two.directory);
  expect(await readFile(join(f.root,'X/work/verifier',one.directory,'data/large.bin'))).toEqual(bytes);
  await writeFile(join(f.root,'X/published',a.ref+'.bin'),'corrupt');
  const before=await readdir(join(f.root,'X/work/verifier'));await expect(f.exec('verifier','package.prepare')).rejects.toThrow('denied');
  expect(await readdir(join(f.root,'X/work/verifier'))).toEqual(before);
 });
 it('V3 rejects forged receipts, preparation ownership, modified files and symlink replacement',async()=>{
  const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);await f.bind('verifier','verifier','X',p.version);const ready=await f.exec('verifier','package.prepare');
  const command={argv:[process.execPath,'solve.cjs'],timeout_ms:5000,preparation:ready.preparation};
  await expect(f.exec('verifier','job.run',{...command,receipt:{version:p.version}})).rejects.toThrow('denied');
  await expect(f.exec('verifier','job.run',{...command,preparation:'forged'})).rejects.toThrow('denied');
  const file=join(f.root,'X/work/verifier',ready.directory,'solve.cjs');await writeFile(file,"process.stdout.write('forged')");await expect(f.exec('verifier','job.run',command)).rejects.toThrow('denied');
  await rm(file);await symlink(join(f.root,'X/work/engineer/solve.cjs'),file);await expect(f.exec('verifier','job.run',command)).rejects.toThrow('denied');
  const e=f.s.executionSnapshot().find(e=>e.role==='verifier')!;await f.s.handle('root','chat.message',{agent:'coordinator',messageID:'done',parts:[{type:'text',synthetic:true,text:`<task id="verifier" state="completed">\n<summary>Background task completed: [ctf:${e.ref}]</summary>`}]});
  await f.exec('root','challenge.assign',{role:'verifier',challenge:'X',version:p.version});await f.s.handle('root','tool.before',{tool:'task',callID:'new-execution',args:{subagent_type:'verifier',task_id:'verifier',background:true}});
  await expect(f.exec('verifier','job.run',command)).rejects.toThrow('preparation');
 });
 it('V3 proves a real mid-job change-and-restore remains unknown despite matching endpoint hashes',async()=>{
  const f=await fixture();const script=Buffer.from("const f=require('node:fs');const old=f.readFileSync('data/input.bin');f.writeFileSync('data/input.bin','CHANGED');process.stdout.write(f.readFileSync('data/input.bin'));f.writeFileSync('data/input.bin',old);process.stdout.write(f.readFileSync('../unlisted','utf8'));");
  const a=await f.publish('engineer','work/change.cjs',script);const p=await f.exec('engineer','package.publish',{...f.args,files:[...f.args.files,{kind:'artifact',ref:a.ref,path:'change.cjs',purpose:'script'}]});await f.bind('verifier','verifier','X',p.version);const r=await f.exec('verifier','package.prepare');
  await writeFile(join(f.root,'X/work/verifier',r.directory,'../unlisted'),'UNDECLARED');
  const j=await f.exec('verifier','job.run',{preparation:r.preparation,argv:[process.execPath,'change.cjs'],timeout_ms:5000});
  expect(j.inputAssociation.before).toBe('matched');expect(j.inputAssociation.after).toBe('matched');expect(j.inputAssociation.continuousIntegrity).toBe('unknown');expect(j.inputAssociation.undeclaredDependencies).toBe('unknown');
  const output=Buffer.from((await f.exec('verifier','job.read',{job:j.job,stream:'stdout'})).data,'base64');expect(output.toString()).toBe('CHANGEDUNDECLARED');
  await evidence('mid-job-restore',{'script.cjs':script,'stdout.bin':output,'receipt.json':j,'audit.json':f.s.audit,'executions.json':f.s.executionSnapshot(),'restored-input.bin':await readFile(join(f.root,'X/work/verifier',r.directory,'data/input.bin'))});
 });
 it('V3 records permanent job mutation as changed, with raw real output retained',async()=>{
  const f=await fixture();const a=await f.publish('engineer','work/change.cjs',Buffer.from("require('node:fs').writeFileSync('data/input.bin','changed');process.stdout.write('done')"));const p=await f.exec('engineer','package.publish',{...f.args,files:[...f.args.files,{kind:'artifact',ref:a.ref,path:'change.cjs',purpose:'script'}]});await f.bind('verifier','verifier','X',p.version);const r=await f.exec('verifier','package.prepare');
  const j=await f.exec('verifier','job.run',{preparation:r.preparation,argv:[process.execPath,'change.cjs'],timeout_ms:5000});expect(j.inputAssociation.after).toBe('changed_or_unreadable');expect(j.inputAssociation.continuousIntegrity).toBe('unknown');
  await expect(f.exec('verifier','job.run',{preparation:r.preparation,argv:[process.execPath,'change.cjs']})).rejects.toThrow('denied');
 });
 it('V4 budget denial revokes prepared input and refuses new operations',async()=>{
  const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);await f.bind('verifier','verifier','X',p.version);const r=await f.exec('verifier','package.prepare');
  (f.s as any).options.budget.maxModelCalls=0;await expect(f.s.handle('verifier','model.call',{agent:'verifier'})).rejects.toThrow('budget');
  await expect(f.exec('verifier','job.run',{preparation:r.preparation,argv:[process.execPath,'solve.cjs']})).rejects.toThrow('denied');
 });

 it('V3 rejects replacement of prepared candidate/manifest and an input parent directory',async()=>{
  for(const target of ['candidate','manifest','directory']){
   const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);await f.bind('verifier','verifier','X',p.version);const r=await f.exec('verifier','package.prepare');const work=join(f.root,'X/work/verifier');
   if(target==='candidate')await writeFile(join(work,r.candidatePath),'forged');
   if(target==='manifest')await writeFile(join(work,r.manifestPath),'forged');
   if(target==='directory'){await rename(join(work,r.directory,'data'),join(work,r.directory,'moved'));await symlink(join(work,r.directory,'moved'),join(work,r.directory,'data'));}
   await expect(f.exec('verifier','job.run',{preparation:r.preparation,argv:[process.execPath,'solve.cjs']})).rejects.toThrow('denied');
  }
 });

});
