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
export const episodeContent = z.object({ summary: text, tech_tags: list,
  steps: z.array(z.object({ stage: z.enum(['recon','solve','engineering']), action: text, observation: text, reason: text, source_refs: list }).strict()).max(80),
  failed_paths: list, unresolved: list, experience_refs: list }).strict();
export const lessonContent = z.object({ title: text, tags: list, when: text, steps: list, checks: list, avoid: list, limits: list }).strict();
export type EpisodeContent = z.infer<typeof episodeContent>;
export type LessonContent = z.infer<typeof lessonContent>;
export interface ProcessScope { run: string; challenge: string; session: string; execution?: string; message?: string; call?: string }
export interface Episode { episode_id: string; version: number; run_id: string; challenge_id: string; outcome: 'solved'|'unsolved'|'unknown'; outcome_ref: unknown; end_reason: string;
  input: any; input_hash: string; content: EpisodeContent|null; episode_status: string; lesson_status: string; lesson_ids: string[]; model?: string; usage: any; error?: string; requests: any[]; created_at: number }
export class ExperienceStore {
  readonly db: SQLiteDatabase;
  constructor(readonly path: string, private secrets: readonly string[] = []) {
    mkdirSync(dirname(path), { recursive:true, mode:0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if(version > 1) { this.db.close(); throw new Error('experience schema newer than supported'); }
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS recon_turns (
        id INTEGER PRIMARY KEY, run_id TEXT NOT NULL, challenge_id TEXT NOT NULL, session_id TEXT NOT NULL,
        execution_ref TEXT, message_id TEXT, turn_no INTEGER, call_id TEXT, kind TEXT NOT NULL,
        tool TEXT, args_json TEXT, status TEXT, result_json TEXT, note_json TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, finished_at INTEGER,
        UNIQUE(run_id,session_id,call_id,kind));
      CREATE INDEX IF NOT EXISTS recon_scope ON recon_turns(run_id,challenge_id,id);
      CREATE TABLE IF NOT EXISTS episodes (episode_id TEXT NOT NULL, version INTEGER NOT NULL, run_id TEXT NOT NULL, challenge_id TEXT NOT NULL,
        input_hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(episode_id,version), UNIQUE(run_id,challenge_id,input_hash));
      CREATE TABLE IF NOT EXISTS lessons (lesson_id TEXT NOT NULL, version INTEGER NOT NULL, episode_id TEXT NOT NULL, episode_version INTEGER NOT NULL,
        body TEXT NOT NULL, PRIMARY KEY(lesson_id,version), FOREIGN KEY(episode_id,episode_version) REFERENCES episodes(episode_id,version));
      PRAGMA user_version=1; COMMIT;`);
  }
  close() { this.db.close(); }
  addRedactions(values:string[]) {this.secrets=[...this.secrets,...values.filter(Boolean)];}
  clean(value: unknown): any {
    const walk=(v:any,key=''):any=> {
      if(/^(?:authorization|cookie|set-cookie|password|secret|api[-_]?key|.*token|candidate|rawReply|reasoning|thinking)$/i.test(key)) return '<redacted>';
      if(typeof v==='string') {
        let s=v; for(const secret of this.secrets) if(secret)s=s.split(secret).join('<redacted>');
        s=s.replace(/(?:flag|ctf)\{[^}\r\n]*\}/gi,'<redacted-flag>')
          .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+/gi,'<redacted-auth>')
          .replace(/((?:cookie|password|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*)[^\s,;"']+/gi,'$1<redacted>');
        // Never persist encoded response bodies blindly. Tool callers decode explicitly below.
        return s.length>12000?s.slice(0,12000)+' [truncated]':s;
      }
      if(Array.isArray(v))return v.map(x=>walk(x));
      if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['reasoning_content'].includes(k)).map(([k,x])=>[k,walk(x,k)]));
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
    return walk(decoded(value));
  }
  private json(v:unknown) { return JSON.stringify(this.clean(v)); }
  private recordJson(v:unknown) {const raw=this.json(v);return Buffer.byteLength(raw)>8000?JSON.stringify({preview:raw.slice(0,1800),truncated:true,original_bytes:Buffer.byteLength(raw)}):raw;}
  transaction<T>(fn:()=>T):T { this.db.exec('BEGIN IMMEDIATE');try {const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;} }
  private turn(s:ProcessScope) {
    if(!s.message)return null;
    const previous=this.db.prepare('SELECT turn_no FROM recon_turns WHERE run_id=? AND session_id=? AND message_id=? AND turn_no IS NOT NULL LIMIT 1').get(s.run,s.session,s.message);
    return previous?Number(previous.turn_no):Number(this.db.prepare('SELECT COALESCE(MAX(turn_no),0)+1 AS n FROM recon_turns WHERE run_id=? AND session_id=?').get(s.run,s.session)!.n);
  }
  start(s:ProcessScope,tool:string,args:unknown) {
    return this.transaction(()=> {
      const now=Date.now();this.db.prepare(`INSERT OR IGNORE INTO recon_turns(run_id,challenge_id,session_id,execution_ref,message_id,turn_no,call_id,kind,tool,args_json,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'tool',?,?,'running',?,?)`).run(s.run,s.challenge,s.session,s.execution??null,s.message??null,this.turn(s),s.call??null,tool,this.recordJson(args),now,now);
      if(args&&typeof args==='object'&&Object.keys(args).length)this.db.prepare('UPDATE recon_turns SET args_json=? WHERE run_id=? AND session_id=? AND call_id=? AND kind=\'tool\'').run(this.recordJson(args),s.run,s.session,s.call??null);
      if(s.message)this.db.prepare('UPDATE recon_turns SET message_id=?,turn_no=? WHERE run_id=? AND session_id=? AND call_id=? AND message_id IS NULL').run(s.message,this.turn(s),s.run,s.session,s.call??null);
    });
  }
  finish(s:ProcessScope,status:string,result:unknown) {
    this.db.prepare('UPDATE recon_turns SET status=?,result_json=?,updated_at=?,finished_at=? WHERE run_id=? AND session_id=? AND call_id=? AND kind=\'tool\'').run(status,this.recordJson(result),Date.now(),status==='running'?null:Date.now(),s.run,s.session,s.call??null);
  }
  note(s:ProcessScope,input:unknown,validEvidence:(r:string)=>boolean) {
    const args=z.object({kind:z.enum(['decision','handoff']).default('decision'),related_ids:z.array(z.number().int().positive()).max(40).default([]),evidence_refs:z.array(z.string().min(1).max(160)).max(32).default([]),observation:text.optional(),assessment:text.optional(),next_action:text.optional(),next_reason:text.optional()}).strict().parse(input);
    for(const id of args.related_ids)if(!this.db.prepare('SELECT id FROM recon_turns WHERE id=? AND run_id=? AND challenge_id=?').get(id,s.run,s.challenge))throw new Error('unbound related record');
    if(args.evidence_refs.some(r=>!validEvidence(r)))throw new Error('unbound evidence');
    const now=Date.now(),turn=this.turn(s);
    this.db.prepare(`INSERT OR IGNORE INTO recon_turns(run_id,challenge_id,session_id,execution_ref,message_id,turn_no,call_id,kind,note_json,status,created_at,updated_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,'completed',?,?,?)`).run(s.run,s.challenge,s.session,s.execution??null,s.message??null,turn,s.call??null,args.kind,this.json(args),now,now,now);
    return this.db.prepare('SELECT id,turn_no FROM recon_turns WHERE run_id=? AND session_id=? AND call_id=? AND kind=?').get(s.run,s.session,s.call??null,args.kind);
  }
  records(run:string,challenge:string,args:unknown={}) {
    const a=z.object({after_id:z.number().int().nonnegative().optional(),ids:z.array(z.number().int().positive()).max(40).optional(),limit:z.number().int().min(1).max(40).default(20)}).strict().refine(a=>a.after_id===undefined||a.ids===undefined,'ids and after_id are exclusive').parse(args);
    const all=this.db.prepare('SELECT * FROM recon_turns WHERE run_id=? AND challenge_id=? AND id>? ORDER BY id').all(run,challenge,a.after_id??0).filter(r=>!a.ids||a.ids.includes(Number(r.id)));
    const rows:any[]=[];let size=0;for(const r of all) {const n=JSON.stringify(r).length;if(rows.length&&(size+n>24000||rows.length>=a.limit))break;rows.push(r);size+=n;}
    return {records:rows.map(r=>({...r,args_json:r.args_json?JSON.parse(r.args_json):null,result_json:r.result_json?JSON.parse(r.result_json):null,note_json:r.note_json?JSON.parse(r.note_json):null,association:r.message_id?'native_assistant':'unknown'})),next_cursor:rows.length<all.length?Number(rows.at(-1)?.id??a.after_id??0):null,in_flight_ids:all.filter(r=>r.status==='running').map(r=>r.id)};
  }
  allRecords(run:string,challenge:string) {return this.db.prepare('SELECT * FROM recon_turns WHERE run_id=? AND challenge_id=? ORDER BY id').all(run,challenge).map(r=>({...r,args_json:r.args_json?JSON.parse(String(r.args_json)):null,result_json:r.result_json?JSON.parse(String(r.result_json)):null,note_json:r.note_json?JSON.parse(String(r.note_json)):null}));}
  saveDraft(input:Omit<Episode,'episode_id'|'version'|'input_hash'|'content'|'episode_status'|'lesson_status'|'lesson_ids'|'usage'|'requests'|'created_at'>):Episode {
    const cleaned=this.clean(input.input);
    if(input.input.sources)cleaned.sources=input.input.sources.map((s:any)=>({...this.clean(s),ref:s.ref}));
    if(input.input.experience_refs)cleaned.experience_refs=[...input.input.experience_refs];
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
