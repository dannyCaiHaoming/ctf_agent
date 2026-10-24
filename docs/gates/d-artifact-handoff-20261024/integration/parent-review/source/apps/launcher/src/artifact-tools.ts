// D interface-one fixed publication and read. Host identity and an in-run registry authorize all public references.
// These checks detect specified races; they do not isolate an attacker with the same OS uid.
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { splitWorkspacePath, WorkspaceRefused, type WorkspaceRoots } from './workspace-tools.js';

const deny = (): never => { throw new WorkspaceRefused('artifact source'); };
const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const unchanged = (a: import('node:fs').Stats, b: import('node:fs').Stats) =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
export type SnapshotIO = Pick<typeof fs, 'lstat' | 'open'>;

/** Bounded read with descriptor and full ancestry identity checks. O_NOFOLLOW protects only the final open. */
export async function snapshotFile(root: string, segments: string[], io: SnapshotIO = fs): Promise<Buffer> {
  const paths = [root]; for (const s of segments) paths.push(join(paths.at(-1)!, s));
  const before = [];
  for (const [i,p] of paths.entries()) {
    const s=await io.lstat(p); if(s.isSymbolicLink() || (i<paths.length-1 ? !s.isDirectory() : !s.isFile())) deny();
    before.push(s);
  }
  const handle=await io.open(paths.at(-1)!,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const start=await handle.stat(); if(!unchanged(start,before.at(-1)!) || start.size>1048576) deny();
    const chunks: Buffer[]=[]; let offset=0;
    while(offset<start.size) { const chunk=Buffer.alloc(Math.min(65536,start.size-offset)); const {bytesRead}=await handle.read(chunk,0,chunk.length,offset); if(!bytesRead) deny(); chunks.push(chunk.subarray(0,bytesRead)); offset+=bytesRead; }
    if(!unchanged(start,await handle.stat())) deny();
    for(const [i,p] of paths.entries()) if(!unchanged(before[i]!,await io.lstat(p))) deny();
    return Buffer.concat(chunks);
  } finally { await handle.close(); }
}
export interface ArtifactSource {kind:'file'|'job'|'http'; run:string; challenge:string; sessionID:string; execution:string|null; selectedExecution?:string; resource?:string; path?:string; stream?:string; callID?:string}
export interface Publication {ref:string;path:string;sha256:string;size:number;source:ArtifactSource;start:number;end:number;originalBytes:number;originalComplete:boolean|null;rangeComplete:true;snapshotFixed:true}
export class ArtifactPublisher {
  private readonly records=new Map<string,{record:Publication;dir:string}>();
  constructor(private readonly io: Pick<typeof fs,'writeFile'|'rename'|'mkdir'|'rm'> = fs) {}
  snapshot() { return [...this.records.values()].map(({record})=>structuredClone(record)); }
  async publish(dir:string,source:ArtifactSource,bytes:Buffer,originalComplete:boolean|null,args:Record<string,unknown>,active:()=>void) {
    const start=args.start ?? 0,end=args.end ?? bytes.length;
    if(typeof start!=='number'||typeof end!=='number'||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>bytes.length) deny();
    const rangeStart=Number(start),rangeEnd=Number(end);
    const fixed=Buffer.from(bytes.subarray(rangeStart,rangeEnd)); const ref=randomUUID();
    const record:Publication={ref,path:`published/${ref}.bin`,sha256:digest(fixed),size:fixed.length,source:structuredClone(source),start:rangeStart,end:rangeEnd,originalBytes:bytes.length,originalComplete,rangeComplete:true,snapshotFixed:true};
    const path=join(dir,`${ref}.bin`),temp=join(dir,`.${ref}.tmp`);
    active();
    try {
      await this.io.mkdir(dir,{recursive:true}); await this.io.writeFile(temp,fixed,{flag:'wx'}); active();
      await this.io.rename(temp,path); active();
      this.records.set(ref,{record,dir}); // Publication linearizes here. No await before returning the usable ref.
      return this.public(record);
    } catch(error) { await this.io.rm(temp,{force:true}).catch(()=>{}); await this.io.rm(path,{force:true}).catch(()=>{}); throw error; }
  }
  private public(r:Publication) { const {source:_s,...publicRecord}=r; return publicRecord; }
  async bytes(run:string,challenge:string,ref:unknown) {
    const found=typeof ref==='string'?this.records.get(ref):undefined;
    if(!found||found.record.source.run!==run||found.record.source.challenge!==challenge) deny();
    const {record,dir}=found!; const bytes=await snapshotFile(dir,[`${record.ref}.bin`]);
    if(bytes.length!==record.size||digest(bytes)!==record.sha256) deny();
    return {bytes,record:this.public(record)};
  }
  async read(run:string,challenge:string,args:Record<string,unknown>) {
    const {bytes,record}=await this.bytes(run,challenge,args.ref);
    const cursor=args.cursor ?? '0';
    if(typeof cursor!=='string'||!/^\d{1,15}$/.test(cursor)||Number(cursor)>bytes.length) deny();
    const offset=Number(cursor),end=Math.min(offset+32768,bytes.length);
    return {...record,encoding:'base64',data:bytes.subarray(offset,end).toString('base64'),offset,nextCursor:end<bytes.length?String(end):null,done:end===bytes.length};
  }
}
export async function snapshotWork(roots:WorkspaceRoots,path:unknown) {
  const segments=splitWorkspacePath(path); if(segments[0]!=='work'||segments.length<2) deny();
  return snapshotFile(roots.workDir,segments.slice(1));
}
