// Candidate-package contract: C integration with real files/jobs; SDK identity only is a deterministic fixture.
import {afterAll,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ArtifactPublisher} from '../../apps/launcher/src/artifact-tools.js';
import {CandidatePackages} from '../../apps/launcher/src/candidate-package-tools.js';
import {ControlService} from '../../apps/launcher/src/control-service.js';
const services:ControlService[]=[];
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
describe('D interface two minimal package',()=>{
 // Missing dispatch or text normalization loses CRLF/UTF-8/binary candidate bytes.
 it('P1 publishes exact selected bytes and whole manifest binding',async()=>{
  const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);expect(p.version).toBeTypeOf('string');expect(p.snapshotFixed).toBe(true);
  const bytes=Buffer.from((await f.read(p.version)).data,'base64');expect(bytes).toEqual(Buffer.from([0xe6,0x97,0x97,0x7b,0xc3,0xa9,0x7d,0,255]));
  const m=JSON.parse(Buffer.from((await f.read(p.version,'manifest')).data,'base64').toString());expect(m.candidate.start).toBe(5);expect(m.candidate.end).toBe(14);expect(m.candidate.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));expect(m.argvStatus).toBe('proposed');expect(m.files[0].publication.source.sessionID).toBe('engineer');expect(m.candidate.publication.originalComplete).toBeNull();
  expect(Buffer.from((await f.read(p.version,'file','data/input.bin')).data,'base64')).toEqual(Buffer.from([0,255,13,10]));expect(f.packages()).toHaveLength(1);expect(JSON.stringify(p)).not.toContain(f.root);
 });
 it.each([{start:0,end:5,want:[108,111,103,13,10]},{start:6,end:7,want:[0x97]}])('P1 treats CRLF and a split UTF-8 byte as exact bytes $start:$end',async({start,end,want})=>{
  const f=await fixture();const p=await f.exec('engineer','package.publish',{...f.args,candidate:{ref:f.source.ref,start,end}});expect(Buffer.from((await f.read(p.version)).data,'base64')).toEqual(Buffer.from(want));
 });
 it('P1 rejects empty, reversed, fractional, missing and out-of-bounds ranges without partial package',async()=>{
  const f=await fixture();for(const candidate of [{ref:f.source.ref,start:0,end:0},{ref:f.source.ref,start:3,end:2},{ref:f.source.ref,start:0.5,end:3},{ref:f.source.ref,start:-1,end:2},{ref:f.source.ref,start:0,end:999},{ref:f.source.ref,start:0},{ref:f.source.ref,start:0,end:2,sha256:'forged'}])await expect(f.exec('engineer','package.publish',{...f.args,candidate})).rejects.toThrow('denied');expect(f.packages()).toHaveLength(0);
 });
 it('P2 refuses forged, wrong run/challenge/role refs and material tampering',async()=>{
  const f=await fixture();await expect(f.exec('domain-solver','package.publish',f.args)).rejects.toThrow('denied');await expect(f.s.handle('domain-solver','tool.before',{tool:'ctf_package_publish',args:f.args,callID:'role'})).rejects.toThrow('denied');
  await expect(f.exec('engineer','package.publish',{...f.args,candidate:{ref:'forged',start:0,end:1}})).rejects.toThrow('denied');
  await f.bind('other','engineer','Y');await expect(f.exec('other','package.publish',f.args)).rejects.toThrow('denied');const g=await fixture();await expect(g.exec('engineer','package.publish',f.args)).rejects.toThrow('denied');
  await writeFile(join(f.root,'X/materials/input.bin'),'tampered');await expect(f.exec('engineer','package.publish',f.args)).rejects.toThrow('denied');expect(f.packages()).toHaveLength(0);
 });
 it('P2 rejects ambiguous paths and forged metadata',async()=>{
  const f=await fixture();for(const path of ['../escape','/abs','a/../b','a\\b','./a','a//b','a/',''])await expect(f.exec('engineer','package.publish',{...f.args,files:[{kind:'artifact',ref:f.script.ref,path,purpose:'script'}]})).rejects.toThrow('denied');
  for(const path of ['SOLVE.CJS','solve.cjs/child'])await expect(f.exec('engineer','package.publish',{...f.args,files:[f.args.files[0],{kind:'artifact',ref:f.source.ref,path,purpose:'input'}]})).rejects.toThrow('denied');
  await expect(f.exec('engineer','package.publish',{...f.args,run:'forged'})).rejects.toThrow('denied');await expect(f.exec('engineer','package.publish',{...f.args,files:[{kind:'material',name:'../../private',path:'x',purpose:'input'}]})).rejects.toThrow('denied');expect(f.packages()).toHaveLength(0);
 });
 it('P2 retains truncated and unknown provenance without upgrading it',async()=>{
  const f=await fixture();const j=await f.exec('engineer','job.run',{argv:[process.execPath,'-e',"process.stdout.write('x'.repeat(1048577))"],timeout_ms:5000});const a=await f.exec('engineer','artifact.publish',{source:'job',job:j.job,stream:'stdout',end:2});
  const p=await f.exec('engineer','package.publish',{...f.args,candidate:{ref:a.ref,start:0,end:1}});const m=JSON.parse(Buffer.from((await f.read(p.version,'manifest')).data,'base64').toString());expect(m.candidate.publication.originalComplete).toBe(false);expect(m.candidate.publication.source.kind).toBe('job');expect(m.candidate.publication.source.http).toBeUndefined();expect(m.candidate.publication.snapshotFixed).toBe(true);expect(m.candidate.publication.rangeComplete).toBe(true);
  await writeFile(join(f.root,'X/work/engineer/unknown'),'unknown');const u=await f.exec('engineer','artifact.publish',{source:'file',path:'work/unknown'});const q=await f.exec('engineer','package.publish',{candidate:{ref:u.ref,start:0,end:1},files:[],extraction:'one byte',premises:[]});const n=JSON.parse(Buffer.from((await f.read(q.version,'manifest')).data,'base64').toString());expect(n.candidate.publication.source.execution).toBeNull();expect(n.argv).toEqual([]);
 });
 // Older host HTTP publications legitimately lack facts; package assembly must not invent them.
 it('P2 preserves legacy HTTP sources without filling facts from equal-content file sources',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'d-legacy-http-'));
  const artifacts=new ArtifactPublisher(),packages=new CandidatePackages(artifacts);
  const legacy={kind:'http' as const,run:'legacy',challenge:'X',sessionID:'solver',execution:'old',resource:'old-resource',callID:'old-call'};
  const original=await artifacts.publish(dir,legacy,Buffer.from('fixed'),true,{},()=>{});
  const copy=await artifacts.publish(dir,{...legacy,kind:'file',sessionID:'engineer',execution:null},Buffer.from('fixed'),null,{},()=>{});
  const p=await packages.publish({dir,source:{kind:'package',run:'legacy',challenge:'X',sessionID:'engineer',execution:'new'},challenge:{id:'X',title:null,target:null,reachability:null,materials:[],materialsDir:dir}}, {candidate:{ref:original.ref,start:0,end:5},files:[{kind:'artifact',ref:copy.ref,path:'copy',purpose:'evidence'}],extraction:'all bytes',premises:[]},()=>{});
  const page=await packages.read('legacy','X',{version:p.version,component:'manifest'});
  const m=JSON.parse(Buffer.from(page.data,'base64').toString());
  expect(m.candidate.publication.source).toEqual(legacy);
  expect(m.candidate.publication.source.http).toBeUndefined();
  expect(m.files[0].publication.source.kind).toBe('file');expect(m.files[0].publication.source.http).toBeUndefined();
  expect(m.files[0].publication.sha256).toBe(original.sha256);expect(m.files[0].publication.originalComplete).toBeNull();
 });
 it('P3 old versions survive unrelated/work/material changes and concurrent new versions',async()=>{
  const f=await fixture();const old=await f.exec('engineer','package.publish',f.args);const original=await f.read(old.version);await f.exec('engineer','workspace.write',{path:'work/tmp',content:'irrelevant'});await f.exec('engineer','workspace.write',{path:'work/solve.cjs',content:'changed unpublished'});await writeFile(join(f.root,'X/materials/input.bin'),'changed after fixed');
  expect((await f.read(old.version)).data).toBe(original.data);expect(Buffer.from((await f.read(old.version,'file','solve.cjs')).data,'base64').toString()).toBe("process.stdout.write('candidate')");expect(Buffer.from((await f.read(old.version,'file','data/input.bin')).data,'base64')).toEqual(Buffer.from([0,255,13,10]));
  const revised=await f.publish('engineer','work/revised',Buffer.from('NEW'));const [newer,readOld]=await Promise.all([f.exec('engineer','package.publish',{candidate:{ref:revised.ref,start:0,end:3},files:[{kind:'artifact',ref:revised.ref,path:'new.cjs',purpose:'script'}],extraction:'all bytes',premises:[]}),f.read(old.version)]);expect(newer.version).not.toBe(old.version);expect(readOld.data).toBe(original.data);expect(Buffer.from((await f.read(newer.version)).data,'base64').toString()).toBe('NEW');
  const newScript=await f.publish('engineer','work/solve.cjs',Buffer.from('NEW_SCRIPT'));const scriptRevision=await f.exec('engineer','package.publish',{...f.args,files:[{kind:'artifact',ref:newScript.ref,path:'solve.cjs',purpose:'script'}]});expect(scriptRevision.version).not.toBe(old.version);expect((await f.read(scriptRevision.version)).data).toBe(original.data);expect(Buffer.from((await f.read(scriptRevision.version,'file','solve.cjs')).data,'base64').toString()).toBe('NEW_SCRIPT');
  await expect(f.read('latest')).rejects.toThrow('denied');await expect(f.read(f.source.ref)).rejects.toThrow('denied');
 });
 it('P3 rejects corruption of manifest, candidate and required script at explicit old version',async()=>{
  for(const target of ['manifest','candidate','script']){const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);const ref=target==='manifest'?p.version:target==='candidate'?f.source.ref:f.script.ref;await writeFile(join(f.root,'X/published',ref+'.bin'),'bad');await expect(f.read(p.version)).rejects.toThrow('denied');}
 });
 it('P4 a failed dependency publishes no whole or half package',async()=>{
  const f=await fixture();const before=await readdir(join(f.root,'X/published'));await expect(f.exec('engineer','package.publish',{...f.args,files:[...f.args.files,{kind:'artifact',ref:'missing-last',path:'last',purpose:'input'}]})).rejects.toThrow('denied');expect(await readdir(join(f.root,'X/published'))).toEqual(before);expect(f.packages()).toHaveLength(0);expect(f.s.resourceSnapshot().at(-1)?.result).not.toBe('completed');
 });
 // A page offset bug or text decoding would lose bytes across the 32 KiB boundary.
 it('P1 reconstructs multi-page manifest, candidate and file with exact bytes and hashes',async()=>{
  const f=await fixture();const bytes=Buffer.alloc(100003);for(let i=0;i<bytes.length;i++)bytes[i]=i%256;
  const a=await f.publish('engineer','work/large.bin',bytes);
  const p=await f.exec('engineer','package.publish',{candidate:{ref:a.ref,start:0,end:bytes.length},files:[{kind:'artifact',ref:a.ref,path:'large.bin',purpose:'input'}],extraction:'all bytes',premises:[]});
  async function pages(component:string,path?:string){let cursor: string|undefined;const chunks:Buffer[]=[];let total=0;let last:any;
   do{const r=await f.exec('engineer','package.read',{version:p.version,component,...(path?{path}:{}),...(cursor?{cursor}:{})});const chunk=Buffer.from(r.data,'base64');expect(r.offset).toBe(total);expect(chunk.length).toBeLessThanOrEqual(32768);expect(r.manifestSha256).toBe(p.manifestSha256);chunks.push(chunk);total+=chunk.length;expect(r.done).toBe(r.nextCursor===null);if(r.nextCursor!==null)expect(Number(r.nextCursor)).toBe(total);cursor=r.nextCursor??undefined;last=r;}while(cursor!==undefined);
   expect(chunks.length).toBeGreaterThan(1);const all=Buffer.concat(chunks);expect(all.length).toBe(last.size);expect(createHash('sha256').update(all).digest('hex')).toBe(last.sha256);return all;}
  expect(await pages('candidate')).toEqual(bytes);expect(await pages('file','large.bin')).toEqual(bytes);
  const manifestBytes=await pages('manifest');expect(manifestBytes.length).toBe(p.manifestSize);expect(createHash('sha256').update(manifestBytes).digest('hex')).toBe(p.manifestSha256);const m=JSON.parse(manifestBytes.toString());expect(Buffer.from(m.candidate.data,'base64')).toEqual(bytes);
 });
 // Envelope base64 overhead must count, and neither rejected input may create a half package.
 it('P2 rejects over-1-MiB serialized envelope and file 33 without new publication',async()=>{
  const f=await fixture();const a=await f.publish('engineer','work/oversize.bin',Buffer.alloc(800000,255));const before=await readdir(join(f.root,'X/published'));
  await expect(f.exec('engineer','package.publish',{candidate:{ref:a.ref,start:0,end:800000},files:[],extraction:'all',premises:[]})).rejects.toThrow('denied');
  await expect(f.exec('engineer','package.publish',{...f.args,files:Array.from({length:33},(_,i)=>({kind:'artifact',ref:f.script.ref,path:`file-${i}`,purpose:'script'}))})).rejects.toThrow('denied');
  expect(await readdir(join(f.root,'X/published'))).toEqual(before);expect(f.packages()).toHaveLength(0);
 });
 it('P2 refuses NFC aliases and parent-child paths in either order',async()=>{
  const f=await fixture();for(const paths of [['café','cafe\u0301'],['a','a/b'],['a/b','a']]){
   await expect(f.exec('engineer','package.publish',{...f.args,files:paths.map(path=>({kind:'artifact',ref:f.script.ref,path,purpose:'script'}))})).rejects.toThrow('denied');
  }expect(f.packages()).toHaveLength(0);
 });
 // The C admission boundary must match the role whitelist even for direct managed calls.
 it('P2 limits publication to Engineer and allows only bound Verifier reads',async()=>{
  const f=await fixture();const p=await f.exec('engineer','package.publish',f.args);
  await f.bind('recon','recon');await f.bind('verifier','verifier','X',p.version);
  for(const role of ['domain-solver','recon','verifier'])for(const [tool,args] of [['publish',f.args],['read',{version:p.version,component:'manifest'}]] as const){
   if(role==='verifier'&&tool==='read'){expect(await f.exec(role,'package.read',args)).toHaveProperty('data');continue;}
   await expect(f.exec(role,`package.${tool}`,args)).rejects.toThrow('denied');
   await expect(f.s.handle(role,'tool.before',{tool:`ctf_package_${tool}`,args,callID:`role-${role}-${tool}`})).rejects.toThrow('denied');
  }expect(f.packages()).toHaveLength(1);
 });

});
