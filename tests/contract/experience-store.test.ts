import {describe,it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
const fixture=()=>{const path=join(mkdtempSync(join(tmpdir(),'experience-')),'memory.sqlite');return {path,store:new ExperienceStore(path,['private-secret'])};};
const draft=(store:ExperienceStore,outcome:'solved'|'unknown'='solved')=>store.saveDraft({run_id:'A',challenge_id:'X',outcome,outcome_ref:'host:1',end_reason:'completed',input:{sources:[{ref:'recon:1',content:'SQL failed; template arithmetic observed'}]}});
const content={summary:'template route',tech_tags:['template'],steps:[{stage:'recon' as const,action:'arithmetic',observation:'42',reason:'identify evaluation',source_refs:['recon:1']}],failed_paths:['SQL failed'],unresolved:[],experience_refs:[]};
const lesson={title:'template probe',tags:['template'],when:'evaluated arithmetic',steps:['probe'],checks:['verify numeric result'],avoid:['SQL assumption'],limits:['not every reflection is evaluation']};
describe('persistent experience chain',()=>{
 it('associates native turns per session, deduplicates and refreshes terminal rows across reopen',()=>{
  const {path,store}=fixture(),s={run:'A',challenge:'X',session:'s1',message:'m1',call:'c1'};
  store.start(s,'job.run',{argv:['node','-e','42'],password:'private-secret'});store.start(s,'job.run',{});store.start({...s,call:'c2'},'http.request',{});store.start({...s,message:'m2',call:'c3'},'job.run',{});store.start({...s,session:'s2',call:'c4'},'job.run',{});
  expect(store.records('A','X').records.map(r=>r.turn_no)).toEqual([1,1,2,1]);
  const id=Number(store.records('A','X').records[0]!.id);store.finish(s,'exited',{stdout:'flag{private} private-secret'});store.close();
  const reopened=new ExperienceStore(path);const row=reopened.records('A','X',{ids:[id]}).records[0]!;expect(row.status).toBe('exited');expect(JSON.stringify(row)).not.toContain('flag{private}');expect(JSON.stringify(row)).not.toContain('private-secret');reopened.close();
 });
 it('atomically saves lessons, hides drafts, prevents duplicates and reports source revision',()=>{
  const {path,store}=fixture(),e=draft(store);expect(draft(store).episode_id).toBe(e.episode_id);expect(store.search({kind:'episode',query:'template'}).results).toEqual([]);
  e.content=content;e.episode_status='completed';store.saveEpisode(e);
  store.db.exec("CREATE TRIGGER inject_failure BEFORE INSERT ON lessons BEGIN SELECT RAISE(ABORT,'disk simulation'); END;");
  expect(()=>store.completeLessons(e,[lesson])).toThrow();expect(store.getEpisode(e.episode_id)!.lesson_status).toBe('pending');expect(store.search({query:'template'}).results).toHaveLength(0);
  store.db.exec('DROP TRIGGER inject_failure');const done=store.completeLessons(e,[lesson]);expect(store.completeLessons(e,[lesson]).lesson_ids).toEqual(done.lesson_ids);
  const next=draft(store,'unknown');expect(next.version).toBe(2);store.close();const reopened=new ExperienceStore(path);
  const found=reopened.search({query:'template'}).results[0]!;expect(found.source_revisions).toHaveLength(1);const read=reopened.read({kind:'lesson',id:done.lesson_ids[0]});expect(read.version).toBe(1);expect(Buffer.from(read.data,'base64').toString()).toContain('source_episode_refs');reopened.close();
 });
 it('rejects cross-attempt evidence and ambiguous paging',()=>{const {store}=fixture();expect(()=>store.note({run:'A',challenge:'X',session:'s',call:'n'},{related_ids:[99]},()=>true)).toThrow();expect(()=>store.records('A','X',{ids:[1],after_id:0})).toThrow();store.close();});
});

it('waits for another process transaction and preserves all three tables on reopen',async()=>{
 const {path,store}=fixture();store.close();
 const {spawn}=await import('node:child_process');const {existsSync}=await import('node:fs');const {setTimeout:delay}=await import('node:timers/promises');
 const marker=path+'.lock';
 const child=spawn(process.execPath,['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';import {writeFileSync} from 'node:fs';const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE');writeFileSync(process.argv[2],'ready');setTimeout(()=>{d.exec('COMMIT');d.close()},250);",path,marker],{stdio:'ignore'});
 const exited=new Promise<void>((done,reject)=>{child.once('exit',code=>code===0?done():reject(new Error('lock holder failed')));child.once('error',reject);});
 try{for(let i=0;i<100&&!existsSync(marker);i++)await delay(10);expect(existsSync(marker)).toBe(true);const reopened=new ExperienceStore(path);expect(reopened.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).toHaveLength(3);reopened.close();await exited;}finally{child.kill();}
});

it('short candidate redaction never changes host identities or bound source references',()=>{
 const {store}=fixture();store.addRedactions(['X','42']);const e=store.saveDraft({run_id:'run42',challenge_id:'X',outcome:'solved',outcome_ref:[{intent:'host42',state:'confirmed'}],end_reason:'completed',input:{sources:[{ref:'execution:42',content:'answer 42'}],experience_refs:['lesson:42@1']}});
 expect(e.challenge_id).toBe('X');expect(e.run_id).toBe('run42');expect(e.input.sources[0].ref).toBe('execution:42');expect(e.input.sources[0].content).toBe('answer <redacted>');
 e.episode_status='completed';store.saveEpisode(e);expect((store.getEpisode(e.episode_id)!.outcome_ref as any[])[0].intent).toBe('host42');store.close();
});

it('episode pages remain fixed while lesson processing metadata changes',()=>{
 const {store}=fixture(),e=draft(store);e.content=content;e.episode_status='completed';e.input.padding='p'.repeat(20000);store.saveEpisode(e);
 const first=store.read({kind:'episode',id:e.episode_id});expect(first.next_cursor).not.toBeNull();e.lesson_status='running';e.requests.push({phase:'lesson',state:'sent'});store.saveEpisode(e);
 expect(store.read({kind:'episode',id:e.episode_id})).toEqual(first);
 expect(()=>store.read({kind:'episode',id:e.episode_id,cursor:first.next_cursor})).toThrow('returned version');
 const second=store.read({kind:'episode',id:e.episode_id,version:first.version,cursor:first.next_cursor});const bytes=Buffer.concat([Buffer.from(first.data,'base64'),Buffer.from(second.data,'base64')]);expect(bytes.length).toBe(first.size);expect(JSON.parse(bytes.toString()).content.summary).toBe('template route');store.close();
});
