// D fourth interface prototype. Semantic assertions belong to the independent Verifier.
// This registry checks mechanical facts; it is scoped to one C run, not restart recovery.
import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {WorkspaceRefused} from './workspace-tools.js';
const text=z.string().min(1).max(8192).refine(s=>!s.includes('\0'));
const range={start:z.number().int().safe().nonnegative().optional(),end:z.number().int().safe().nonnegative().optional()};
const selection={...range,necessary:z.boolean(),context:text};
export const reportSchema=z.object({
 judgment:z.enum(['verified','rejected','inconclusive']),mode:z.enum(['recompute','evidence_audit','replay']),rationale:text,sourceFlow:text,
 premises:z.array(z.object({statement:text,status:z.enum(['assumed','unknown'])}).strict()).max(32),issues:z.array(text).max(32),
 requirements:z.object({continuousIntegrity:z.boolean(),declaredDependenciesOnly:z.boolean()}).strict(),
 evidence:z.array(z.discriminatedUnion('kind',[
  z.object({kind:z.literal('job'),job:text,stream:z.enum(['stdout','stderr']),...selection}).strict(),
  z.object({kind:z.literal('artifact'),ref:text,...selection}).strict()
 ])).max(16),comparison:z.object({evidence:z.number().int().nonnegative(),start:z.number().int().safe().nonnegative(),end:z.number().int().safe().nonnegative()}).strict().optional()
}).strict();
export const resultReadSchema=z.object({challenge:text,version:text,result:text}).strict();
export type Selection=z.infer<typeof reportSchema>['evidence'][number];
export interface Evidence {kind:string;source:unknown;size:number;sha256:string;encoding:'base64';data:string;start:number;end:number;originalComplete:boolean|null;rangeComplete:true;necessary:boolean;context:string;association?:Record<string,unknown>;terminal?:{state:string;exitCode:number|null};preparation?:string}
interface Context {run:string;challenge:string;version:string;sessionID:string;execution:string}
interface Stored extends Context {result:string;original:z.infer<typeof reportSchema>;effectiveJudgment:string;evidence:Evidence[];hostChecks:{blockers:string[];candidateEqual:boolean|null;semanticAssessment:'verifier_assertion_not_host_proven'};createdAt:number}
const deny=(why:string):never=>{throw new WorkspaceRefused('verification '+why);};
export const sha256=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
export function fixEvidence(s:Selection,bytes:Buffer,metadata:Omit<Evidence,'size'|'sha256'|'data'|'encoding'|'start'|'end'|'rangeComplete'|'necessary'|'context'>):Evidence{
 const start=s.start??0,end=s.end??bytes.length;if(start>end||end>bytes.length)deny('range');const selected=Buffer.from(bytes.subarray(start,end));
 return {...metadata,start,end,size:selected.length,sha256:sha256(selected),encoding:'base64',data:selected.toString('base64'),rangeComplete:true,necessary:s.necessary,context:s.context};
}
export class VerificationResults {
 private records=new Map<string,Stored>();
 private executions=new Map<string,string>();
 snapshot(){return structuredClone([...this.records.values()]);}
 async register(ctx:Context,args:Record<string,unknown>,resolve:(s:Selection)=>Promise<Evidence>,candidate:()=>Promise<Buffer>,active:()=>void){
  const parsed=reportSchema.safeParse(args);if(!parsed.success)deny('arguments');const original=parsed.data!;
  const key=ctx.run+'/'+ctx.execution;
  const prior=this.executions.get(key);
  if(prior){const r=this.records.get(prior)!;active();if(JSON.stringify(r.original)!==JSON.stringify(original))deny('conflicting report');return {result:r.result,duplicate:true,effectiveJudgment:r.effectiveJudgment};}
  const expected=await candidate();active();const evidence:Evidence[]=[];
  for(const s of original.evidence){evidence.push(await resolve(s));active();}
  const blockers:string[]=[];
  if(original.mode==='replay')blockers.push('replay unavailable');
  if(!evidence.some(e=>e.necessary))blockers.push('no necessary evidence');
  if(original.premises.some(p=>p.status==='unknown'))blockers.push('required premise unknown');
  if(original.issues.length)blockers.push('unresolved verifier issues');
  let candidateEqual:boolean|null=null;
  for(const e of evidence.filter(e=>e.necessary)){
   if(e.originalComplete!==true)blockers.push('necessary source incomplete or unknown');
   if(e.association?.after==='changed_or_unreadable')blockers.push('prepared inputs changed_or_unreadable');
   if(e.terminal&&(e.terminal.state!=='exited'||e.terminal.exitCode!==0))blockers.push('necessary job unsuccessful');
   if(original.requirements.continuousIntegrity&&e.association?.continuousIntegrity!=='proven')blockers.push('continuous integrity unknown');
   if(original.requirements.declaredDependenciesOnly&&e.association?.undeclaredDependencies!=='proven_absent')blockers.push('undeclared dependencies unknown');
  }
  if(original.mode==='recompute'){
   if(!evidence.some(e=>e.necessary&&e.kind==='job'&&e.association))blockers.push('recompute requires own version-bound job');
   const c=original.comparison,e=c&&evidence[c.evidence];
   if(!c||!e||!e.necessary||e.kind!=='job'||!e.association)blockers.push('missing candidate comparison');
   else{const b=Buffer.from(e.data,'base64');if(c.end<c.start||c.end>b.length)deny('comparison range');candidateEqual=b.subarray(c.start,c.end).equals(expected);if(original.judgment==='verified'&&!candidateEqual)blockers.push('candidate bytes differ');}
  }
  // No promotion from equality. A dishonest semantic assertion remains a semantic gap.
  const effectiveJudgment=blockers.length?'inconclusive':original.judgment;
  const row:Stored={...ctx,result:randomUUID(),original,effectiveJudgment,evidence,hostChecks:{blockers:[...new Set(blockers)],candidateEqual,semanticAssessment:'verifier_assertion_not_host_proven'},createdAt:Date.now()};
  active(); // Atomic synchronous compare-and-set: no awaited IO between final check and commit.
  const raced=this.executions.get(key);if(raced){const r=this.records.get(raced)!;if(JSON.stringify(r.original)!==JSON.stringify(original))deny('conflicting report');return {result:r.result,duplicate:true,effectiveJudgment:r.effectiveJudgment};}
  this.records.set(row.result,row);this.executions.set(key,row.result);
  return {result:row.result,duplicate:false,effectiveJudgment};
 }
 async read(run:string,args:Record<string,unknown>,check:(r:Stored)=>Promise<string[]>,active:()=>void){
  const a=resultReadSchema.safeParse(args);if(!a.success)deny('read arguments');const v=a.data!,found=this.records.get(v.result);
  if(!found||found.run!==run||found.challenge!==v.challenge||found.version!==v.version)deny('specified result');const r=found!;
  const invalid=await check(structuredClone(r));active();
  return {...structuredClone(r),currentAvailability:{usable:r.effectiveJudgment!=='inconclusive'&&invalid.length===0,reasons:[...r.hostChecks.blockers,...invalid],conditionalOn:r.original.premises,semanticAssessment:'verifier_assertion_not_host_proven'}};
 }
}
