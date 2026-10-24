// D interface two: immutable candidate and solution package. One existing ArtifactPublisher commit fixes the whole package.
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ArtifactPublisher,snapshotFile,type ArtifactSource,type Publication} from './artifact-tools.js';
import type {PreparedChallenge} from './run-prep.js';
import {WorkspaceRefused} from './workspace-tools.js';
const deny=():never=>{throw new WorkspaceRefused('candidate package');};
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const text=z.string().min(1).max(8192).refine(s=>!s.includes('\0'));
const entry={path:text,purpose:z.enum(['script','input','evidence'])};
const input=z.object({candidate:z.object({ref:text,start:z.number().int().safe().nonnegative(),end:z.number().int().safe().nonnegative()}).strict(),files:z.array(z.discriminatedUnion('kind',[
 z.object({kind:z.literal('artifact'),ref:text,...entry}).strict(),z.object({kind:z.literal('material'),name:text,...entry}).strict()
])).max(32),argv:z.array(text).max(32).default([]),extraction:text,premises:z.array(text).max(32)}).strict();
const readInput=z.object({version:text,component:z.enum(['manifest','candidate','file']),path:text.optional(),cursor:z.string().regex(/^\d{1,15}$/).optional()}).strict();
interface Context {source:ArtifactSource;dir:string;challenge:PreparedChallenge}
type FixedPublication=Publication;
type FileEntry={path:string;purpose:'script'|'input'|'evidence'}&({kind:'artifact';publication:FixedPublication}|{kind:'material';name:string;sha256:string;size:number;data:string;encoding:'base64'});
interface Manifest {schema:1;run:string;challenge:string;engineer:{sessionID:string;execution:string|null};candidate:{publication:FixedPublication;start:number;end:number;size:number;sha256:string;data:string;encoding:'base64'};files:FileEntry[];argv:string[];argvStatus:'proposed';extraction:string;premises:string[]}
function relative(path:string){
 if(path.length>512||path.includes('\\')||path.includes(':')||path.split('/').some(s=>!s||s==='.'||s==='..'||/[\x00-\x1f\x7f]/.test(s)))deny();
 return path.normalize('NFC').toLowerCase();
}
export class CandidatePackages {
 constructor(private readonly artifacts:ArtifactPublisher){}
 private async publication(run:string,challenge:string,ref:unknown){
  const fixed=await this.artifacts.bytes(run,challenge,ref);if(fixed.source.kind==='package')deny();
  return {bytes:fixed.bytes,record:{...fixed.record,source:fixed.source}};
 }
 async publish(ctx:Context,args:Record<string,unknown>,active:()=>void){
  const parsed=input.safeParse(args);if(!parsed.success)deny();const a=parsed.data!;
  const paths=a.files.map(f=>relative(f.path));for(let i=0;i<paths.length;i++)for(let j=0;j<i;j++)if(paths[i]===paths[j]||paths[i]!.startsWith(paths[j]+'/')||paths[j]!.startsWith(paths[i]+'/'))deny();
  const run=ctx.source.run,challenge=ctx.source.challenge;
  const fixed=await this.publication(run,challenge,a.candidate.ref);active();
  const {start,end}=a.candidate;if(end<=start||end>fixed.bytes.length)deny();const bytes=Buffer.from(fixed.bytes.subarray(start,end));
  const files:FileEntry[]=[];
  for(const f of a.files){
   if(f.kind==='artifact'){const p=await this.publication(run,challenge,f.ref);files.push({kind:f.kind,path:f.path,purpose:f.purpose,publication:p.record});}
   else{
    const material=ctx.challenge.materials.find(m=>m.name===f.name);if(!material)deny();
    const data=await snapshotFile(ctx.challenge.materialsDir,[material!.name]);if(data.length!==material!.bytes||hash(data)!==material!.sha256)deny();
    files.push({kind:'material',name:material!.name,path:f.path,purpose:f.purpose,size:data.length,sha256:hash(data),encoding:'base64',data:data.toString('base64')});
   }active();
  }
  const manifest:Manifest={schema:1,run,challenge,engineer:{sessionID:ctx.source.sessionID,execution:ctx.source.execution},candidate:{publication:fixed.record,start,end,size:bytes.length,sha256:hash(bytes),encoding:'base64',data:bytes.toString('base64')},files,argv:a.argv,argvStatus:'proposed',extraction:a.extraction,premises:a.premises};
  const serialized=Buffer.from(JSON.stringify(manifest));if(serialized.length>1048576)deny();active();
  const p=await this.artifacts.publish(ctx.dir,ctx.source,serialized,true,{},active);
  return {version:p.ref,manifestSha256:p.sha256,manifestSize:p.size,snapshotFixed:true,candidateSize:bytes.length,candidateSha256:hash(bytes)};
 }
 async prepare(run:string,challenge:string,version:string,work:string,active:()=>void){
  const all=async(component:string,path?:string)=>{
   let cursor:string|undefined;const chunks:Buffer[]=[];
   do{const p=await this.read(run,challenge,{version,component,...(path?{path}:{}),...(cursor?{cursor}:{})});chunks.push(Buffer.from(p.data,'base64'));cursor=p.nextCursor??undefined;active();}while(cursor);
   return Buffer.concat(chunks);
  };
  const manifest=await all('manifest');const m=JSON.parse(manifest.toString()) as Manifest;
  const id=randomUUID(),directory='verify-'+id+'/inputs',staging=join(work,'.prepare-'+id),final=join(work,'verify-'+id);
  const files:{path:string;sha256:string;size:number}[]=[];
  try{
   await mkdir(join(staging,'inputs'),{recursive:true});
   await writeFile(join(staging,'manifest.json'),manifest,{flag:'wx'});
   const candidate=await all('candidate');await writeFile(join(staging,'candidate.bin'),candidate,{flag:'wx'});
   for(const f of m.files){relative(f.path);const bytes=await all('file',f.path);active();const dest=join(staging,'inputs',f.path);await mkdir(join(dest,'..'),{recursive:true});await writeFile(dest,bytes,{flag:'wx'});files.push({path:f.path,sha256:hash(bytes),size:bytes.length});}
   active();await rename(staging,final);active();
   const p={ready:true,preparation:id,directory,manifestPath:'verify-'+id+'/manifest.json',candidatePath:'verify-'+id+'/candidate.bin',manifestSha256:hash(manifest),metadata:[{path:'verify-'+id+'/manifest.json',sha256:hash(manifest),size:manifest.length},{path:'verify-'+id+'/candidate.bin',sha256:hash(candidate),size:candidate.length}],files};
   await this.checkPrepared(work,p);active();return p;
  }catch(error){await rm(staging,{recursive:true,force:true});await rm(final,{recursive:true,force:true});throw error;}
 }
 async checkPrepared(work:string,p:{directory:string;metadata:{path:string;sha256:string;size:number}[];files:{path:string;sha256:string;size:number}[]}){
  for(const f of [...p.metadata,...p.files.map(f=>({...f,path:p.directory+'/'+f.path}))]){const bytes=await snapshotFile(work,f.path.split('/'));if(bytes.length!==f.size||hash(bytes)!==f.sha256)deny();}
 }
 async read(run:string,challenge:string,args:Record<string,unknown>){
  const parsed=readInput.safeParse(args);if(!parsed.success)deny();const a=parsed.data!;
  if((a.component==='file')!==!!a.path)deny();
  const fixed=await this.artifacts.bytes(run,challenge,a.version);if(fixed.source.kind!=='package')deny();
  const m=JSON.parse(fixed.bytes.toString('utf8')) as Manifest;
  if(m.schema!==1||m.run!==run||m.challenge!==challenge||m.engineer.sessionID!==fixed.source.sessionID||m.engineer.execution!==fixed.source.execution)deny();
  const original=await this.publication(run,challenge,m.candidate.publication.ref);
  const candidate=Buffer.from(m.candidate.data,'base64');
  if(original.record.sha256!==m.candidate.publication.sha256||!candidate.equals(original.bytes.subarray(m.candidate.start,m.candidate.end))||candidate.length!==m.candidate.size||hash(candidate)!==m.candidate.sha256)deny();
  let selected:Buffer|undefined=a.component==='manifest'?fixed.bytes:a.component==='candidate'?candidate:undefined;
  for(const f of m.files){
   let bytes:Buffer;
   if(f.kind==='artifact'){const p=await this.publication(run,challenge,f.publication.ref);if(p.record.sha256!==f.publication.sha256||p.record.size!==f.publication.size)deny();bytes=p.bytes;}
   else{bytes=Buffer.from(f.data,'base64');if(bytes.length!==f.size||hash(bytes)!==f.sha256)deny();}
   if(a.component==='file'&&a.path===f.path)selected=bytes;
  }
  if(!selected)deny();const bytes=selected!;const offset=Number(a.cursor??'0');if(!Number.isSafeInteger(offset)||offset>bytes.length)deny();const end=Math.min(offset+32768,bytes.length);
  return {version:a.version,manifestSha256:fixed.record.sha256,component:a.component,...(a.path?{path:a.path}:{}),size:bytes.length,sha256:hash(bytes),encoding:'base64',data:bytes.subarray(offset,end).toString('base64'),offset,nextCursor:end<bytes.length?String(end):null,done:end===bytes.length,snapshotFixed:true};
 }
}
