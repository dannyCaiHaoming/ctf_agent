// The host owns judge authority, submission limits and persisted attempt history.
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {readdirSync,readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {WorkspaceRefused} from './workspace-tools.js';
export const completionSchema=z.object({challenge:z.string().min(1).max(8192),version:z.string().min(1).max(8192),result:z.string().min(1).max(8192)}).strict();
const limitsSchema=z.object({
 attempts:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('unlimited')}).strict(),
  z.object({kind:z.literal('limited'),max:z.number().int().safe().nonnegative(),usedBeforeRun:z.number().int().safe().nonnegative().optional()}).strict(),
  z.object({kind:z.literal('unknown')}).strict()
 ]),notBefore:z.number().finite().nonnegative().optional(),cooldownMs:z.number().finite().nonnegative().optional(),blockedReason:z.string().min(1).max(8192).optional()
}).strict();
/** limited.max is the total allowance for this trusted challenge/judge scope.
 * usedBeforeRun is the fixed consumption OUTSIDE this completion directory, not a refreshed
 * per-run total. Restored directory records are deducted separately; retain the baseline on resume.
 */
export type SubmissionLimits=z.infer<typeof limitsSchema>;
export interface CompletionJudge {
 id:string;scope?:string;timeoutMs:number;limits?:SubmissionLimits;
 submit(input:{intent:string;challenge:string;bytes:Buffer;signal:AbortSignal}):Promise<unknown>;
}
const recordSchema=z.object({intent:z.string().uuid(),run:z.string().min(1),challenge:z.string().min(1),version:z.string().min(1),result:z.string().min(1),judge:z.string().min(1).nullable(),judgeScope:z.string().min(1).optional(),candidateSha256:z.string().regex(/^[a-f0-9]{64}$/),candidateSize:z.number().int().safe().positive(),state:z.enum(['intent','sent','confirmed','unknown','not_sent','candidate_only']),sent:z.boolean(),solved:z.boolean(),createdAt:z.number().finite(),updatedAt:z.number().finite(),sentAt:z.number().finite().optional(),attemptReserved:z.boolean().optional(),rawReply:z.unknown().optional(),businessOutcome:z.string().optional(),rejection:z.enum(['wrong_answer','non_answer']).optional(),reason:z.string().optional()}).strict();
export type CompletionRecord=z.infer<typeof recordSchema>;
const reply=z.object({intent:z.string(),challenge:z.string(),status:z.enum(['accepted','rejected','duplicate','invalid_state','closed']),completed:z.boolean(),rejection:z.enum(['wrong_answer','non_answer']).optional()}).strict().refine(r=>r.rejection===undefined||r.status==='rejected');
const deny=(reason:string):never=>{throw new WorkspaceRefused('completion '+reason);};
// Explicit scope is the stable judge/task identity; adapter labels and run IDs are provenance.
const scopeOf=(judge:CompletionJudge)=>judge.scope??judge.id;
const recordScope=(r:CompletionRecord)=>{
 if(r.judgeScope===undefined)return r.judge;
 // Existing records encode [adapterId, trustedScopeOrAdapterId]. Do not rewrite old receipts.
 const value:unknown=JSON.parse(r.judgeScope);
 if(!Array.isArray(value)||value.length!==2||value[0]!==r.judge||typeof value[1]!=='string'||!value[1])throw new Error('invalid judge scope');
 return value[1] as string;
};
const challengeKey=(challenge:string,judge:CompletionJudge|undefined)=>JSON.stringify([challenge,judge?scopeOf(judge):null]);
const unresolved=(r:CompletionRecord)=>['intent','sent','unknown'].includes(r.state);
export class CompletionRequests {
 private records:CompletionRecord[]=[];
 private busy=new Map<string,Promise<CompletionRecord>>();
 private recoveryError?:string;
 constructor(private readonly directory:string){
  // Load before admitting any request. Legacy intent/sent is unresolved even when sent=false.
  let files:string[];
  try{files=readdirSync(directory);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;this.recoveryError='completion history unreadable; no resend';return;}
  try{
   for(const file of files){
    if(!file.endsWith('.json'))continue;
    const path=join(directory,file);if(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw new Error('invalid record file');
    const r=recordSchema.parse(JSON.parse(readFileSync(path,'utf8')));
    if(file!==r.intent+'.json')throw new Error('record identity mismatch');
    recordScope(r);
    if(r.state==='confirmed'){
     const p=reply.safeParse(r.rawReply);
     if(!p.success||p.data.intent!==r.intent||p.data.challenge!==r.challenge||p.data.status!==r.businessOutcome||r.rejection!==p.data.rejection||r.solved!==(p.data.status==='accepted'&&p.data.completed))throw new Error('invalid confirmed record');
    }else if(r.solved)throw new Error('unconfirmed solved record');
    if(r.state==='not_sent'&&r.sent)throw new Error('contradictory unsent record');
    this.records.push(r);
   }
  }catch{this.recoveryError='completion history unreadable; no resend';}
 }
 snapshot(){return structuredClone(this.records);}
 private scopeIssue(challenge:string,judge:CompletionJudge|undefined){
  if(!judge||judge.scope!==undefined)return;
  const prior=this.records.filter(r=>r.challenge===challenge&&r.judge!==null);
  if(prior.length&&!prior.some(r=>r.judge===judge.id&&recordScope(r)===judge.id))return 'explicit stable judge scope required; adapter label does not establish task identity';
 }
 private history(challenge:string,judge:CompletionJudge|undefined){return this.records.filter(r=>r.challenge===challenge&&(!judge||recordScope(r)===scopeOf(judge)));}
 status(_run:string,challenge:string,judge:CompletionJudge|undefined,excludeIntent?:string){
  const reasons:string[]=[];let remaining:number|null=null,nextAllowedAt:number|null=null;
  const records=this.history(challenge,judge).filter(r=>r.intent!==excludeIntent);
  if(this.recoveryError)reasons.push(this.recoveryError);
  const scopeIssue=this.scopeIssue(challenge,judge);if(scopeIssue)reasons.push(scopeIssue);
  if(records.some(unresolved))reasons.push('unknown same challenge; no resend');
  if(this.busy.has(challengeKey(challenge,judge))&&excludeIntent===undefined)reasons.push('pending same challenge');
  if(!judge)reasons.push('no judge; candidate_only');
  else{
   const parsed=limitsSchema.safeParse(judge.limits);
   if(!parsed.success||parsed.data.attempts.kind==='unknown')reasons.push('submission limits unknown');
   else{
    const rules=parsed.data,history=records.filter(r=>recordScope(r)===scopeOf(judge));
    const consumed=history.filter(r=>r.state!=='not_sent'&&r.state!=='candidate_only').length;
    if(rules.attempts.kind==='limited'){
     remaining=Math.max(0,rules.attempts.max-(rules.attempts.usedBeforeRun??0)-consumed);
     if(remaining===0)reasons.push('attempt limit exhausted');
    }
    const last=history.filter(r=>r.state!=='not_sent'&&r.state!=='candidate_only').reduce((n,r)=>Math.max(n,r.sentAt??r.createdAt),0);
    nextAllowedAt=Math.max(rules.notBefore??0,last&&rules.cooldownMs?last+rules.cooldownMs:0)||null;
    if(nextAllowedAt!==null&&Date.now()<nextAllowedAt)reasons.push('submission cooldown');
    if(rules.blockedReason)reasons.push(rules.blockedReason);
   }
  }
  return {challenge,judgeAvailable:!!judge,allowed:reasons.length===0,reasons,remaining,nextAllowedAt,limits:judge?.limits??{attempts:{kind:'unknown'}}};
 }
 private async save(r:CompletionRecord){r.updatedAt=Date.now();await mkdir(this.directory,{recursive:true});const p=join(this.directory,r.intent+'.json'),tmp=p+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(r,null,2),{flag:'wx'});await rename(tmp,p);}
 request(run:string,input:Record<string,unknown>,judge:CompletionJudge|undefined,eligible:()=>Promise<Buffer>,active:()=>void,signal?:AbortSignal):Promise<CompletionRecord>{
  const parsed=completionSchema.safeParse(input);if(!parsed.success)deny('arguments');const a=parsed.data!;const key=challengeKey(a.challenge,judge);
  if(this.busy.has(key))return Promise.reject(new WorkspaceRefused('completion pending same challenge'));
  if(this.recoveryError)deny(this.recoveryError);
  const scopeIssue=this.scopeIssue(a.challenge,judge);if(scopeIssue)deny(scopeIssue);
  if(this.history(a.challenge,judge).some(unresolved))deny('unknown same challenge; no resend');
  const work=(async()=>{
   const bytes=Buffer.from(await eligible());active();
   const digest=createHash('sha256').update(bytes).digest('hex');if(!bytes.length)deny('empty candidate');
   const history=this.history(a.challenge,judge).filter(r=>r.candidateSha256===digest&&r.candidateSize===bytes.length&&(judge||r.judge===null));
   // Only correlated trusted wrong_answer and accepted replies blacklist bytes across package versions.
   const prior=history.find(r=>r.state==='confirmed'&&(r.businessOutcome==='accepted'||r.rejection==='wrong_answer'))??history.find(r=>r.run===run&&r.version===a.version&&r.result===a.result&&r.state==='candidate_only');
   if(prior)return structuredClone(prior);
   // This request owns the challenge lock; ignore that lock for its own admission.
   const admit=(intent?:string)=>{const state=this.status(run,a.challenge,judge,intent??'new');if(judge&&!state.allowed)deny(state.reasons.join('; '));};
   admit();
   const r:CompletionRecord={intent:randomUUID(),run,...a,judge:judge?.id??null,...(judge?{judgeScope:JSON.stringify([judge.id,scopeOf(judge)]),attemptReserved:true}:{}),candidateSha256:digest,candidateSize:bytes.length,state:judge?'intent':'candidate_only',sent:false,solved:false,createdAt:Date.now(),updatedAt:Date.now()};
   this.records.push(r);
   try{await this.save(r);}catch(e){r.state='not_sent';r.attemptReserved=false;throw e;}
   if(!judge)return structuredClone(r);
   const ctl=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   const abort=()=>ctl.abort(signal?.reason??'caller stopped');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   try{
    active();ctl.signal.throwIfAborted();r.state='sent';await this.save(r);
    const current=await eligible();if(!bytes.equals(current))deny('fixed bytes changed before send');active();ctl.signal.throwIfAborted();admit(r.intent);
    // No await between final candidate/budget/rule checks and calling host-bound transport.
    r.sent=true;r.sentAt=Date.now();
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{ctl.abort('judge timeout');reject(new Error('judge timeout'));},Math.max(1,Math.min(judge.timeoutMs,20000)));});
    const interrupted=new Promise<never>((_,reject)=>ctl.signal.addEventListener('abort',()=>reject(new Error('submission interrupted')),{once:true}));
    const raw=await Promise.race([judge.submit({intent:r.intent,challenge:a.challenge,bytes:Buffer.from(bytes),signal:ctl.signal}),timeout,interrupted]);
    r.rawReply=raw;const p=reply.safeParse(raw);
    if(!p.success||p.data.intent!==r.intent||p.data.challenge!==r.challenge){r.state='unknown';r.reason='invalid or unrelated judge reply';}
    else{r.state='confirmed';r.businessOutcome=p.data.status;r.rejection=p.data.rejection;r.solved=p.data.status==='accepted'&&p.data.completed===true;}
   }catch(e){r.state=r.sent?'unknown':'not_sent';r.attemptReserved=r.sent;r.reason=String(e);}
   finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);}
   try{await this.save(r);}catch(e){r.state=r.sent?'unknown':'not_sent';r.solved=false;r.reason='result persistence failed: '+String(e);throw e;}
   return structuredClone(r);
  })();
  this.busy.set(key,work);void work.finally(()=>{if(this.busy.get(key)===work)this.busy.delete(key);}).catch(()=>{});return work;
 }
}
/** Adapter for legacy string-only oracles. Reject rather than replace/trim/normalize. */
export function strictUtf8(bytes:Buffer){const s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(!Buffer.from(s,'utf8').equals(bytes))deny('non-roundtrippable UTF-8');return s;}
