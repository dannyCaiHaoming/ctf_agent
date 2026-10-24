// D5 single-run prototype. Only the host can inject a judge; never take authority from tool input.
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {WorkspaceRefused} from './workspace-tools.js';
export const completionSchema=z.object({challenge:z.string().min(1).max(8192),version:z.string().min(1).max(8192),result:z.string().min(1).max(8192)}).strict();
export interface CompletionJudge {id:string;timeoutMs:number;submit(input:{intent:string;challenge:string;bytes:Buffer;signal:AbortSignal}):Promise<unknown>}
export interface CompletionRecord {intent:string;run:string;challenge:string;version:string;result:string;judge:string|null;candidateSha256:string;candidateSize:number;state:'intent'|'sent'|'confirmed'|'unknown'|'not_sent'|'candidate_only';sent:boolean;solved:boolean;createdAt:number;updatedAt:number;rawReply?:unknown;businessOutcome?:string;reason?:string}
const reply=z.object({intent:z.string(),challenge:z.string(),status:z.enum(['accepted','rejected','duplicate','invalid_state','closed']),completed:z.boolean()}).strict();
const deny=(reason:string):never=>{throw new WorkspaceRefused('completion '+reason);};
export class CompletionRequests {
 private records:CompletionRecord[]=[];
 private busy=new Map<string,Promise<CompletionRecord>>();
 constructor(private readonly directory:string){}
 snapshot(){return structuredClone(this.records);}
 private async save(r:CompletionRecord){r.updatedAt=Date.now();await mkdir(this.directory,{recursive:true});const p=join(this.directory,r.intent+'.json'),tmp=p+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(r,null,2),{flag:'wx'});await rename(tmp,p);}
 request(run:string,input:Record<string,unknown>,judge:CompletionJudge|undefined,eligible:()=>Promise<Buffer>,active:()=>void,signal?:AbortSignal):Promise<CompletionRecord>{
  const parsed=completionSchema.safeParse(input);if(!parsed.success)deny('arguments');const a=parsed.data!;const key=run+'/'+a.challenge;
  if(this.busy.has(key))return Promise.reject(new WorkspaceRefused('completion pending same challenge'));
  const unknown=this.records.find(r=>r.run===run&&r.challenge===a.challenge&&['sent','unknown'].includes(r.state));if(unknown)deny('unknown same challenge; no resend');
  const prior=this.records.find(r=>r.run===run&&r.challenge===a.challenge&&r.version===a.version&&r.result===a.result&&['confirmed','candidate_only'].includes(r.state));
  const work=(async()=>{
   const bytes=Buffer.from(await eligible());active();if(prior)return structuredClone(prior);
   const r:CompletionRecord={intent:randomUUID(),run,...a,judge:judge?.id??null,candidateSha256:createHash('sha256').update(bytes).digest('hex'),candidateSize:bytes.length,state:judge?'intent':'candidate_only',sent:false,solved:false,createdAt:Date.now(),updatedAt:Date.now()};
   this.records.push(r);await this.save(r);
   if(!judge)return structuredClone(r);
   const ctl=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   const abort=()=>ctl.abort(signal?.reason??'caller stopped');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   try{
    active();ctl.signal.throwIfAborted();r.state='sent';await this.save(r);const current=await eligible();if(!bytes.equals(current))deny('fixed bytes changed before send');active();ctl.signal.throwIfAborted();
    // Synchronous send boundary: no await between final admission and invoking the host-bound transport.
    r.sent=true;
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{ctl.abort('judge timeout');reject(new Error('judge timeout'));},Math.max(1,Math.min(judge.timeoutMs,20000)));});
    const interrupted=new Promise<never>((_,reject)=>ctl.signal.addEventListener('abort',()=>reject(new Error('submission interrupted')),{once:true}));
    const raw=await Promise.race([judge.submit({intent:r.intent,challenge:a.challenge,bytes:Buffer.from(bytes),signal:ctl.signal}),timeout,interrupted]);
    r.rawReply=raw;const p=reply.safeParse(raw);
    if(!p.success||p.data.intent!==r.intent||p.data.challenge!==r.challenge){r.state='unknown';r.reason='invalid or unrelated judge reply';}
    else{r.state='confirmed';r.businessOutcome=p.data.status;r.solved=p.data.status==='accepted'&&p.data.completed===true;}
   }catch(e){r.state=r.sent?'unknown':'not_sent';r.reason=String(e);}
   finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);}
   try{await this.save(r);}catch(e){r.state=r.sent?'unknown':'not_sent';r.solved=false;r.reason='result persistence failed: '+String(e);throw e;}
   return structuredClone(r);
  })();
  this.busy.set(key,work);void work.finally(()=>{if(this.busy.get(key)===work)this.busy.delete(key);}).catch(()=>{});return work;
 }
}
/** Adapter for legacy string-only oracles. Reject rather than replace/trim/normalize. */
export function strictUtf8(bytes:Buffer){const s=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(!Buffer.from(s,'utf8').equals(bytes))deny('non-roundtrippable UTF-8');return s;}
