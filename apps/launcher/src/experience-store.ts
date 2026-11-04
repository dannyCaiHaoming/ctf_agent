// Host-owned persistent process, episode and lesson storage. No model has SQL or disk access.
import { createRequire } from 'node:module';
import type { DatabaseSync as SQLiteDatabase } from 'node:sqlite';
// Vite 5 predates node:sqlite; require the Node builtin without its module resolver.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

const text = z.string().max(4000), list = z.array(text).max(32);
const claim = z.union([text, z.object({ text, source_refs: list }).strict()]);
export const episodeContent = z.object({ summary: text, tech_tags: list,
  steps: z.array(z.object({ stage: z.enum(['recon','solve','engineering']), action: text, observation: text, reason: text, source_refs: list }).strict()).max(80),
  // Old rows stored plain strings; new output binds each claim to provided sources.
  failed_paths: z.array(claim).max(32), unresolved: z.array(claim).max(32), experience_refs: list }).strict();
export const lessonContent = z.object({ title: text, tags: list, when: text, steps: list, checks: list, avoid: list, limits: list }).strict();
export type EpisodeContent = z.infer<typeof episodeContent>;
export type LessonContent = z.infer<typeof lessonContent>;
const sortedNames=(names:Iterable<string>)=>[...new Set(names)].sort();
const bodyNames=(body:unknown):string[]=> {
  if(body&&typeof body==='object')return Object.keys(body);
  if(typeof body!=='string'||!body)return [];
  try{const parsed=JSON.parse(body);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return Object.keys(parsed);}catch{/* not JSON: form body */}
  return [...new URLSearchParams(body).keys()];
};
/** Family key from saved, sanitized arguments only: tool plus target shape, never parameter values or task semantics. */
export function familyKey(row:any):string {
  const tool=typeof row?.tool==='string'&&row.tool?row.tool:String(row?.kind??'other'),args=row?.args_json&&typeof row.args_json==='object'?row.args_json:{};
  if(tool==='http.request'&&typeof args.url==='string') {
    let path=args.url,query:string[]=[];
    try{const u=new URL(args.url);path=u.pathname;query=[...u.searchParams.keys()];}catch{path=args.url.split(/[?#]/)[0]!;}
    const body=args.body_base64!==undefined?['<base64>']:bodyNames(args.body);
    return `${tool}:${String(args.method??'GET').toUpperCase()} ${path}?q=${sortedNames(query).join(',')}&b=${sortedNames(body).join(',')}`;
  }
  if(tool==='job.run'&&Array.isArray(args.argv)&&typeof args.argv[0]==='string')return `${tool}:${args.argv[0].split('/').at(-1)}`;
  if((tool.startsWith('workspace.')||tool.startsWith('artifact.'))&&typeof args.path==='string')return `${tool}:${args.path}`;
  return tool;
}

/** Mechanical source descriptor: family from saved sanitized arguments, outcome class from status/HTTP code, incompleteness from gaps and meta. */
export function describeSource(s:any,index:number) {
  const c=s.content&&typeof s.content==='object'&&!Array.isArray(s.content)?s.content:null,recon=!!c&&['tool','decision','handoff'].includes(c.kind);
  const ref=String(s.ref),http=c?.result_json&&typeof c.result_json==='object'&&typeof c.result_json.status==='number'?c.result_json.status:'-';
  return {
    actor:s.role?null:recon?String(c.role??'recon'):null,
    family:s.role?`execution:${s.role}`:ref.startsWith('artifact:')?'artifact':ref.startsWith('execution:')?'execution':recon?(c.kind==='tool'?familyKey(c):c.kind):'other',
    sequence:s.role||/^(?:artifact|execution):/.test(ref)?null:typeof c?.sequence==='number'?c.sequence:index+1,
    cls:recon&&c.kind==='tool'?`${c.status??'unknown'}/${http}`:(s.gaps??[]).length?'gap':'ok',
    incomplete:(s.gaps??[]).length>0||s.content===undefined||c?.result_meta?.complete===false||c?.args_meta?.complete===false||c?.status==='running',
  };
}
export interface ProcessScope { run: string; challenge: string; session: string; role?: string; execution?: string; message?: string; call?: string }
export interface PreparedPayload { raw: string; meta: { sha256: string; size: number; complete: boolean; transformation: 'redacted'|'none'; redactions?: string[]; original_size?: number; storage?: 'inline'|'artifact' } }
export interface StartOptions { complete?: boolean; prepared?: PreparedPayload }
export interface FinishOptions { priority?: number; complete?: boolean; prepared?: PreparedPayload }
export interface Episode { episode_id: string; version: number; run_id: string; challenge_id: string; outcome: 'solved'|'unsolved'|'unknown'; outcome_ref: unknown; end_reason: string;
  input: any; input_hash: string; model_input?: unknown; model_input_hash?: string; omitted_ranges?: any[]; content: EpisodeContent|null; episode_status: string; lesson_status: string; lesson_ids: string[]; model?: string; usage: any; error?: string; requests: any[]; created_at: number }
export class ExperienceStore {
  readonly db: SQLiteDatabase;
  constructor(readonly path: string, private secrets: readonly string[] = []) {
    mkdirSync(dirname(path), { recursive:true, mode:0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if(version > 3) { this.db.close(); throw new Error('experience schema newer than supported'); }
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS recon_turns (
        id INTEGER PRIMARY KEY, step_id TEXT, run_id TEXT NOT NULL, challenge_id TEXT NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'recon',
        execution_ref TEXT, message_id TEXT, turn_no INTEGER, call_id TEXT, sequence INTEGER, kind TEXT NOT NULL,
        tool TEXT, visible_intent TEXT, args_json TEXT, args_meta_json TEXT, args_shape_json TEXT,
        status TEXT, result_json TEXT, result_meta_json TEXT, result_sha256 TEXT, result_size INTEGER,
        original_complete INTEGER, visible_observation TEXT, terminal_priority INTEGER NOT NULL DEFAULT 0, note_json TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER,
        UNIQUE(run_id,session_id,call_id,kind));
      CREATE INDEX IF NOT EXISTS recon_scope ON recon_turns(run_id,challenge_id,sequence,id);
      CREATE TABLE IF NOT EXISTS episodes (episode_id TEXT NOT NULL, version INTEGER NOT NULL, run_id TEXT NOT NULL, challenge_id TEXT NOT NULL,
        input_hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(episode_id,version), UNIQUE(run_id,challenge_id,input_hash));
      CREATE TABLE IF NOT EXISTS lessons (lesson_id TEXT NOT NULL, version INTEGER NOT NULL, episode_id TEXT NOT NULL, episode_version INTEGER NOT NULL,
        body TEXT NOT NULL, PRIMARY KEY(lesson_id,version), FOREIGN KEY(episode_id,episode_version) REFERENCES episodes(episode_id,version));
      COMMIT;`);
    if(version < 2) this.migrateReconV2();
    if(version < 3) this.migrateRoleV3();
  }
  close() { this.db.close(); }
  private migrateReconV2() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const columns=new Set((this.db.prepare('PRAGMA table_info(recon_turns)').all() as Array<{name:string}>).map(r=>r.name));
      const additions:Array<[string,string]>=[['step_id','TEXT'],['sequence','INTEGER'],['visible_intent','TEXT'],['args_meta_json','TEXT'],['args_shape_json','TEXT'],['result_meta_json','TEXT'],['result_sha256','TEXT'],['result_size','INTEGER'],['original_complete','INTEGER'],['visible_observation','TEXT'],['terminal_priority','INTEGER NOT NULL DEFAULT 0']];
      for(const [name,type] of additions)if(!columns.has(name))this.db.exec(`ALTER TABLE recon_turns ADD COLUMN ${name} ${type}`);
      this.db.exec('DROP INDEX IF EXISTS recon_scope; CREATE INDEX recon_scope ON recon_turns(run_id,challenge_id,sequence,id);');
      const rows=this.db.prepare('SELECT id,run_id,challenge_id FROM recon_turns ORDER BY run_id,challenge_id,id').all() as Array<{id:number;run_id:string;challenge_id:string}>;
      const sequences=new Map<string,number>();
      for(const row of rows) {
        const key=row.run_id+'\0'+row.challenge_id;
        const sequence=(sequences.get(key)??0)+1;sequences.set(key,sequence);
        this.db.prepare('UPDATE recon_turns SET step_id=COALESCE(step_id,?),sequence=COALESCE(sequence,?),original_complete=COALESCE(original_complete,0) WHERE id=?').run(randomUUID(),sequence,row.id);
      }
      this.db.exec('PRAGMA user_version=2; COMMIT;');
    } catch(error) {
      this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }
  /** v3: rows written before role existed were all Recon's. */
  private migrateRoleV3() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const columns=new Set((this.db.prepare('PRAGMA table_info(recon_turns)').all() as Array<{name:string}>).map(r=>r.name));
      if(!columns.has('role'))this.db.exec("ALTER TABLE recon_turns ADD COLUMN role TEXT NOT NULL DEFAULT 'recon'");
      this.db.exec('PRAGMA user_version=3; COMMIT;');
    } catch(error) {
      this.db.exec('ROLLBACK');
      this.db.close();
      throw error;
    }
  }
  addRedactions(values:string[]) {this.secrets=[...this.secrets,...values.filter(Boolean)];}
  clean(value: unknown): any {return this.cleanTracked(value).value;}
  private cleanTracked(value: unknown): {value:any;redactions:string[]} {
    const redactions:string[]=[],seen=new Set<string>();
    const mark=(path:string)=>{if(!seen.has(path)){seen.add(path);redactions.push(path);}};
    const child=(path:string,key:string)=>path?`${path}.${key}`:key;
    const walk=(v:any,path=''):any=> {
      if(/^(?:authorization|cookie|set-cookie|password|secret|api[-_]?key|.*token|candidate|rawReply|reasoning|thinking)$/i.test(path.split('.').at(-1)??'')) {mark(path);return '<redacted>';}
      if(typeof v==='string') {
        let s=v; for(const secret of this.secrets) if(secret)s=s.split(secret).join('<redacted>');
        s=s.replace(/(?:flag|ctf)\{[^}\r\n]*\}/gi,'<redacted-flag>')
          .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi,'<redacted-auth>')
          .replace(/((?:cookie|password|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*)[^\s,;"']+/gi,'$1<redacted>');
        if(s!==v)mark(path||'$');
        return s;
      }
      if(Array.isArray(v))return v.map((x,i)=>walk(x,`${path}[${i}]`));
      if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).flatMap(([k,x])=>{
        if(k==='reasoning_content'){mark(child(path,k));return [];}
        return [[k,walk(x,child(path,k))]];
      }));
      return v;
    };
    const decoded=(v:any):any=> {
      if(Array.isArray(v))return v.map(decoded);
      if(v&&typeof v==='object') {
        const o:any={...v};
        if(o.encoding==='base64') {for(const k of ['data','content'])if(typeof o[k]==='string')o[k]=Buffer.from(o[k],'base64').toString('utf8');o.encoding='utf8';}
        return Object.fromEntries(Object.entries(o).map(([k,x])=>[k,decoded(x)]));
      }return v;
    };
    return {value:walk(decoded(value)),redactions};
  }
  private json(v:unknown) { return JSON.stringify(this.clean(v)); }
  preparePayload(v:unknown):PreparedPayload {
    const original=JSON.stringify(v)??'null',cleaned=this.cleanTracked(v),raw=JSON.stringify(cleaned.value)??'null';
    return {raw,meta:{sha256:createHash('sha256').update(raw).digest('hex'),size:Buffer.byteLength(raw),complete:true,transformation:cleaned.redactions.length?'redacted' as const:'none' as const,storage:'inline',...(cleaned.redactions.length?{redactions:cleaned.redactions,original_size:Buffer.byteLength(original)}:{})}};
  }
  transaction<T>(fn:()=>T):T { this.db.exec('BEGIN IMMEDIATE');try {const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;} }
  private turn(s:ProcessScope) {
    if(!s.message)return null;
    const previous=this.db.prepare('SELECT turn_no FROM recon_turns WHERE run_id=? AND session_id=? AND message_id=? AND turn_no IS NOT NULL LIMIT 1').get(s.run,s.session,s.message);
    return previous?Number(previous.turn_no):Number(this.db.prepare('SELECT COALESCE(MAX(turn_no),0)+1 AS n FROM recon_turns WHERE run_id=? AND session_id=?').get(s.run,s.session)!.n);
  }
  private sequence(s:ProcessScope) {return Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM recon_turns WHERE run_id=? AND challenge_id=?').get(s.run,s.challenge)!.n);}
  start(s:ProcessScope,tool:string,args:unknown,options:StartOptions={}) {
    return this.transaction(()=> {
      const now=Date.now(),payload=options.prepared??this.preparePayload(args),complete=options.complete??true;
      const inserted=this.db.prepare(`INSERT OR IGNORE INTO recon_turns(step_id,run_id,challenge_id,session_id,role,execution_ref,message_id,turn_no,call_id,sequence,kind,tool,args_json,args_meta_json,status,original_complete,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'tool',?,?,?,'running',?,?,?)`).run(randomUUID(),s.run,s.challenge,s.session,s.role??'recon',s.execution??null,s.message??null,this.turn(s),s.call??null,this.sequence(s),tool,payload.raw,JSON.stringify({...payload.meta,complete}),complete?1:0,now,now);
      // A placeholder row (event arrived before the call, or args were unavailable) is incomplete; real args may upgrade it once, never the reverse.
      if(!inserted.changes&&complete&&s.call) {
        const existing=this.db.prepare("SELECT args_meta_json,result_meta_json FROM recon_turns WHERE run_id=? AND session_id=? AND call_id=? AND kind='tool'").get(s.run,s.session,s.call) as {args_meta_json?:string;result_meta_json?:string}|undefined;
        const argsMeta=this.parsedJson(existing?.args_meta_json),resultMeta=this.parsedJson(existing?.result_meta_json);
        if(existing&&argsMeta&&argsMeta.complete===false)
          this.db.prepare("UPDATE recon_turns SET args_json=?,args_meta_json=?,original_complete=?,updated_at=? WHERE run_id=? AND session_id=? AND call_id=? AND kind='tool'")
            .run(payload.raw,JSON.stringify({...payload.meta,complete:true}),!resultMeta||resultMeta.complete===true?1:0,now,s.run,s.session,s.call);
      }
      if(s.message)this.db.prepare('UPDATE recon_turns SET message_id=?,turn_no=? WHERE run_id=? AND session_id=? AND call_id=? AND message_id IS NULL').run(s.message,this.turn(s),s.run,s.session,s.call??null);
    });
  }
  finish(s:ProcessScope,status:string,result:unknown,options:FinishOptions={}) {
    this.transaction(()=>{
      const existing=this.db.prepare("SELECT terminal_priority,args_meta_json FROM recon_turns WHERE run_id=? AND session_id=? AND call_id=? AND kind='tool'").get(s.run,s.session,s.call??null) as {terminal_priority?:number;args_meta_json?:string}|undefined;
      if(!existing)return;
      const priority=options.priority??20;
      if(priority<=(existing.terminal_priority??0))return;
      const payload=options.prepared??this.preparePayload(result),complete=options.complete??true,argsComplete=this.parsedJson(existing.args_meta_json)?.complete!==false;
      this.db.prepare(`UPDATE recon_turns SET status=?,result_json=?,result_meta_json=?,result_sha256=?,result_size=?,original_complete=?,terminal_priority=?,updated_at=?,finished_at=?
        WHERE run_id=? AND session_id=? AND call_id=? AND kind='tool'`).run(status,payload.raw,JSON.stringify({...payload.meta,complete}),payload.meta.sha256,payload.meta.size,complete&&argsComplete?1:0,priority,Date.now(),status==='running'?null:Date.now(),s.run,s.session,s.call??null);
    });
  }
  note(s:ProcessScope,input:unknown,validEvidence:(r:string)=>boolean) {
    const args=z.object({kind:z.enum(['decision','handoff']).default('decision'),related_ids:z.array(z.number().int().positive()).max(40).default([]),evidence_refs:z.array(z.string().min(1).max(160)).max(32).default([]),observation:text.optional(),assessment:text.optional(),next_action:text.optional(),next_reason:text.optional()}).strict().parse(input);
    for(const id of args.related_ids)if(!this.db.prepare('SELECT id FROM recon_turns WHERE id=? AND run_id=? AND challenge_id=?').get(id,s.run,s.challenge))throw new Error('unbound related record');
    if(args.evidence_refs.some(r=>!validEvidence(r)))throw new Error('unbound evidence');
    const now=Date.now(),turn=this.turn(s);
    this.db.prepare(`INSERT OR IGNORE INTO recon_turns(step_id,run_id,challenge_id,session_id,role,execution_ref,message_id,turn_no,call_id,sequence,kind,note_json,status,original_complete,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'completed',1,?,?,?)`).run(randomUUID(),s.run,s.challenge,s.session,s.role??'recon',s.execution??null,s.message??null,turn,s.call??null,this.sequence(s),args.kind,this.json(args),now,now,now);
    return this.db.prepare('SELECT id,step_id,sequence,turn_no FROM recon_turns WHERE run_id=? AND session_id=? AND call_id=? AND kind=?').get(s.run,s.session,s.call??null,args.kind);
  }
  records(run:string,challenge:string,args:unknown={}) {
    const cursor=z.string().regex(/^[1-9]\d{0,9}:[1-9]\d{0,9}$/).optional();
    const a=z.object({
      after_id:z.number().int().nonnegative().optional(),step_id:z.string().min(1).max(128).optional(),
      ids:z.array(z.number().int().positive()).max(40).optional(),kind:z.enum(['tool','decision','handoff']).optional(),
      cursor,start_sequence:z.number().int().nonnegative().optional(),end_sequence:z.number().int().positive().optional(),
      limit:z.number().int().min(1).max(40).default(20),
    }).strict()
      .refine(a=>!a.ids||[a.after_id,a.cursor,a.start_sequence,a.end_sequence,a.step_id].every(v=>v===undefined),'ids and other selectors are exclusive')
      .refine(a=>a.after_id===undefined||a.cursor===undefined,'ids and after_id are exclusive')
      .refine(a=>a.start_sequence===undefined||a.end_sequence===undefined||a.end_sequence>a.start_sequence,'end_sequence must follow start_sequence')
      .parse(args);
    const cursorParts=a.cursor?.split(':').map(Number),cursorSequence=cursorParts?.[0],cursorId=cursorParts?.[1];
    const selectedIds=a.ids?new Set(a.ids):undefined;
    const basis=(this.db.prepare('SELECT * FROM recon_turns WHERE run_id=? AND challenge_id=? ORDER BY sequence,id').all(run,challenge) as any[])
      .filter(r=>(!selectedIds||selectedIds.has(Number(r.id)))
        &&(!a.step_id||r.step_id===a.step_id)
        &&(!a.kind||r.kind===a.kind)
        &&(a.after_id===undefined||Number(r.id)>a.after_id)
        &&(a.start_sequence===undefined||Number(r.sequence)>=a.start_sequence)
        &&(a.end_sequence===undefined||Number(r.sequence)<a.end_sequence));
    const all=cursorSequence===undefined?basis:basis.filter(r=>Number(r.sequence)>cursorSequence||(Number(r.sequence)===cursorSequence&&Number(r.id)>cursorId!));
    const index=basis.map(r=>this.indexRow(r));
    const fingerprint=createHash('sha256').update(JSON.stringify(index)).digest('hex');
    const rows:any[]=[];let size=0;
    for(const r of all) {
      const n=Buffer.byteLength(JSON.stringify(r));
      if(rows.length&&(size+n>24000||rows.length>=a.limit))break;
      rows.push(r);size+=n;
    }
    const lastRow=rows.at(-1),lastPosition=lastRow?basis.indexOf(lastRow):-1,hasMore=lastPosition>=0&&lastPosition<basis.length-1;
    const next_cursor=hasMore?`${lastRow.sequence}:${lastRow.id}`:null;
    const consumed=lastPosition+1;
    return {
      records:rows.map(r=>this.row(r)),index,next_cursor,done:!hasMore,fingerprint,
      coverage:{total:basis.length,returned:rows.length,remaining:Math.max(0,basis.length-consumed),complete:!hasMore,next_cursor,included_ids:rows.map(r=>Number(r.id))},
      in_flight_ids:basis.filter(r=>r.status==='running').map(r=>r.id),
    };
  }
  private parsedJson(value:unknown) {if(typeof value!=='string'||!value)return null;try{return JSON.parse(value);}catch{return null;}}
  private publicationRef(value:unknown) {const parsed=this.parsedJson(value);return parsed&&typeof parsed==='object'&&typeof (parsed as {ref?:unknown}).ref==='string'?(parsed as {ref:string}).ref:null;}
  private indexRow(r:any) {
    const argsMeta=this.parsedJson(r.args_meta_json),resultMeta=this.parsedJson(r.result_meta_json);
    const fingerprint=typeof argsMeta?.sha256==='string'?argsMeta.sha256:createHash('sha256').update(String(r.args_json??r.note_json??r.tool??'')).digest('hex');
    return {
      id:Number(r.id),step_id:r.step_id,sequence:Number(r.sequence),cursor:`${r.sequence}:${r.id}`,role:r.role??'recon',
      turn_no:r.turn_no,message_id:r.message_id,session_id:r.session_id,execution_ref:r.execution_ref,
      kind:r.kind,tool:r.tool,status:r.status,fingerprint,
      args_ref:this.publicationRef(r.args_json),args_shape:this.parsedJson(r.args_shape_json),
      result_ref:this.publicationRef(r.result_json),result_sha256:r.result_sha256??null,result_size:r.result_size??null,
      result_complete:!!resultMeta&&resultMeta.complete===true,original_complete:r.original_complete===1,
    };
  }
  private row(r:any) {return {...r,args_json:r.args_json?JSON.parse(String(r.args_json)):null,args_meta:r.args_meta_json?JSON.parse(String(r.args_meta_json)):null,args_shape:r.args_shape_json?JSON.parse(String(r.args_shape_json)):null,result_json:r.result_json?JSON.parse(String(r.result_json)):null,result_meta:r.result_meta_json?JSON.parse(String(r.result_meta_json)):null,note_json:r.note_json?JSON.parse(String(r.note_json)):null,original_complete:r.original_complete===1,association:r.message_id?'native_assistant':'unknown'};}
  allRecords(run:string,challenge:string):any[] {return this.db.prepare('SELECT * FROM recon_turns WHERE run_id=? AND challenge_id=? ORDER BY sequence,id').all(run,challenge).map(r=>this.row(r));}
  saveDraft(input:Omit<Episode,'episode_id'|'version'|'input_hash'|'content'|'episode_status'|'lesson_status'|'lesson_ids'|'usage'|'requests'|'created_at'>):Episode {
    const cleaned=this.clean(input.input);
    if(input.input.sources)cleaned.sources=input.input.sources.map((s:any)=>({...this.clean(s),ref:s.ref}));
    if(input.input.experience_refs)cleaned.experience_refs=[...input.input.experience_refs];
    // Host-owned range over the complete persisted trajectory; the model can neither write nor narrow it.
    const trajectory=this.records(input.run_id,input.challenge_id),index=trajectory.index;
    cleaned.source_range={first_sequence:index[0]?.sequence??null,last_sequence:index.at(-1)?.sequence??null,total:index.length,fingerprint:trajectory.fingerprint,
      artifact_refs:[...new Set(((cleaned.source_manifest??cleaned.sources??[]) as any[]).map(s=>String(s.ref)).filter(r=>r.startsWith('artifact:')))],
      running:index.filter(r=>r.status==='running').length,unknown:index.filter(r=>r.status==null||r.status==='unknown').length};
    cleaned.result={outcome:input.outcome,end_reason:input.end_reason,completion:cleaned.completion??null,judge:input.outcome_ref,verifications:cleaned.verifications??[]};
    cleaned.skeleton=(cleaned.source_manifest??cleaned.sources??[]).map((s:any)=>({ref:s.ref,role:s.role??s.content?.role??(s.ref?.startsWith('recon:')?'recon':null),kind:s.content?.kind??null,status:s.content?.status??null,
      related_ids:s.content?.note_json?.related_ids??[],gaps:s.gaps??[],provided:!!cleaned.sources?.some((x:any)=>x.ref===s.ref)}));
    const fixed={...input,input:cleaned},hash=createHash('sha256').update(JSON.stringify(fixed)).digest('hex');
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT body FROM episodes WHERE run_id=? AND challenge_id=? AND input_hash=?').get(input.run_id,input.challenge_id,hash);if(old)return JSON.parse(String(old.body));
      const prior=this.db.prepare('SELECT episode_id,version FROM episodes WHERE run_id=? AND challenge_id=? ORDER BY version DESC LIMIT 1').get(input.run_id,input.challenge_id);
      const e:Episode={...fixed,episode_id:prior?String(prior.episode_id):randomUUID(),version:prior?Number(prior.version)+1:1,input_hash:hash,content:null,episode_status:'pending',lesson_status:'pending',lesson_ids:[],usage:{availability:'unavailable'},requests:[],created_at:Date.now()};
      this.db.prepare('INSERT INTO episodes VALUES(?,?,?,?,?,?)').run(e.episode_id,e.version,e.run_id,e.challenge_id,hash,JSON.stringify(e));return e;
    });
  }
  saveEpisode(e:Episode) {this.db.prepare('UPDATE episodes SET body=? WHERE episode_id=? AND version=?').run(JSON.stringify(e),e.episode_id,e.version);}
  getEpisode(id:string,version?:number):Episode|undefined {const r=version===undefined?this.db.prepare('SELECT body FROM episodes WHERE episode_id=? ORDER BY version DESC LIMIT 1').get(id):this.db.prepare('SELECT body FROM episodes WHERE episode_id=? AND version=?').get(id,version);return r?JSON.parse(String(r.body)):undefined;}
  completeLessons(e:Episode,contents:LessonContent[]) {
    return this.transaction(()=>{
      const current=this.getEpisode(e.episode_id,e.version);if(current?.lesson_status==='completed')return current;
      if(!current||current.episode_status!=='completed')throw new Error('episode not complete');
      const ids:string[]=[];
      for(const content of contents) {const id=randomUUID();ids.push(id);const body={...this.clean(lessonContent.parse(content)),lesson_id:id,version:1,source_episode_refs:[{id:e.episode_id,version:e.version}],created_at:Date.now()};
        this.db.prepare('INSERT INTO lessons VALUES(?,?,?,?,?)').run(id,1,e.episode_id,e.version,JSON.stringify(body));}
      const next={...e,lesson_status:'completed',lesson_ids:ids};this.saveEpisode(next);return next;
    });
  }
  private revisions(refs:{id:string;version:number}[]) {return refs.flatMap(r=>{const latest=this.getEpisode(r.id);return latest&&latest.version>r.version?[{source:r,latest:{id:r.id,version:latest.version,outcome:latest.outcome},message:'source episode revised'}]:[];});}
  hasRef(ref:string) {const m=/^(episode|lesson):([\w-]+)@(\d+)$/.exec(ref);if(!m)return false;return m[1]==='episode'?this.getEpisode(m[2]!,Number(m[3]))?.episode_status==='completed':!!this.db.prepare('SELECT lesson_id FROM lessons WHERE lesson_id=? AND version=?').get(m[2]!,Number(m[3]));}
  search(input:unknown) {
    const a=z.object({query:z.string().min(1).max(500),tags:list.optional(),kind:z.enum(['lesson','episode']).default('lesson'),limit:z.number().int().min(1).max(8).default(6)}).strict().parse(input);
    const rows=this.db.prepare(`SELECT body FROM ${a.kind==='lesson'?'lessons':'episodes'}`).all().map(r=>JSON.parse(String(r.body))).filter(b=>a.kind==='lesson'||b.episode_status==='completed');
    const words=[...a.query.toLowerCase().split(/\s+/),...(a.tags??[]).map(s=>s.toLowerCase())];
    const results=rows.map(b=>({b,score:words.reduce((n,w)=>n+(w&&JSON.stringify(b).toLowerCase().includes(w)?1:0),0)})).filter(x=>x.score>0).sort((x,y)=>y.score-x.score).slice(0,a.limit).map(({b})=>a.kind==='lesson'?{kind:'lesson',id:b.lesson_id,version:b.version,title:b.title,when:b.when,tags:b.tags,source_episode_refs:b.source_episode_refs,source_revisions:this.revisions(b.source_episode_refs)}:{kind:'episode',id:b.episode_id,version:b.version,summary:b.content.summary,outcome:b.outcome,source_revisions:this.revisions([{id:b.episode_id,version:b.version}])});
    return {results,reference_only:true};
  }
  lessonSummary(id:string,version:number) {
    const row=this.db.prepare('SELECT body FROM lessons WHERE lesson_id=? AND version=?').get(id,version);
    if(!row)throw new Error('experience version not found');
    const b=JSON.parse(String(row.body));
    const fields=['title','when','steps','checks','avoid','limits'] as const;
    const summary:any={id,version,kind:'lesson',source_episode_refs:b.source_episode_refs,source_revisions:this.revisions(b.source_episode_refs),reference_only:true,truncated_fields:[]};
    for(const key of fields){const raw=typeof b[key]==='string'?b[key]:JSON.stringify(b[key]);summary[key]=raw.slice(0,600);if(raw.length>600)summary.truncated_fields.push(key);}
    return summary;
  }
  read(input:unknown) {
    const a=z.object({kind:z.enum(['lesson','episode']),id:z.string().min(1).max(128),version:z.number().int().positive().optional(),cursor:z.string().regex(/^\d{1,10}$/).optional()}).strict().parse(input);
    if(a.cursor!==undefined&&a.version===undefined)throw new Error('continuation requires returned version');
    let b:any;if(a.kind==='episode') {b=this.getEpisode(a.id,a.version);if(b?.episode_status!=='completed')b=undefined;
      else {const {episode_status,lesson_status,lesson_ids,usage,error,requests,...history}=b;b=history;}
    }
    else {const r=a.version===undefined?this.db.prepare('SELECT body FROM lessons WHERE lesson_id=? ORDER BY version DESC LIMIT 1').get(a.id):this.db.prepare('SELECT body FROM lessons WHERE lesson_id=? AND version=?').get(a.id,a.version);b=r?JSON.parse(String(r.body)):undefined;}
    if(!b)throw new Error('experience version not found');
    const bytes=Buffer.from(JSON.stringify(b)),offset=Number(a.cursor??0);if(offset>bytes.length)throw new Error('invalid experience cursor');const end=Math.min(offset+16000,bytes.length);
    return {kind:a.kind,id:a.id,version:b.version,encoding:'base64',data:bytes.subarray(offset,end).toString('base64'),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),next_cursor:end<bytes.length?String(end):null,source_revisions:this.revisions(a.kind==='lesson'?b.source_episode_refs:[{id:b.episode_id,version:b.version}]),reference_only:true};
  }
}
