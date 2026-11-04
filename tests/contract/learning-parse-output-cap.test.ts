// R8: unknown-key tolerance on model replies, model-derived output cap, manual re-learning on a copy. Synthetic data only.
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const calls=vi.hoisted(()=>({start:vi.fn()}));
vi.mock('@ctf/opencode-bridge',()=>({startManagedOpenCode:calls.start}));
import {learnEpisodes,prepareEpisodeInput,modelOutputLimit} from '../../apps/launcher/src/episode-learning.js';
import {createCtfAgentHooks} from '../../apps/opencode-plugin/src/index.js';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
import {prepareRelearn} from '../manual/relearn-episodes.js';
beforeEach(()=>{calls.start.mockReset();});

const step=(r:string)=>({stage:'recon',action:'a',observation:'o',reason:'r',source_refs:[r]});
const lessonBody=(extra:any={})=>({title:'t',tags:['a'],when:'w',steps:['s'],checks:['c'],avoid:['a'],limits:['l'],...extra});
function fixture(model='local/script',providers?:any) {
 const root=mkdtempSync(join(tmpdir(),'learning-r8-')),store=new ExperienceStore(join(root,'memory.sqlite'));
 const e=store.saveDraft({run_id:'A',challenge_id:'X',outcome:'unknown',outcome_ref:['unknown receipt'],end_reason:'completed',input:{sources:[{ref:'recon:1',content:{id:1,sequence:1,kind:'tool',tool:'http.request',status:'completed',args_json:{method:'GET',url:'https://app.example.test/a'},result_json:{status:403}}}],experience_refs:[]}});
 const first=(prepareEpisodeInput(e) as any).sources[0].ref as string;
 return {root,store,e,first,options:{store,episodes:[e],directory:join(root,'learning'),config:{model,...(providers?{provider:providers}:{})} as any,environment:{},budget:{maxObservableTokens:100000,wallClockMs:3000}}};
}
/** Scripted replies in order; records the output limit each request was admitted with and how many sessions were created. */
function script(responses:any[],finish='stop') {
 const seen={limits:[] as number[],created:0};let i=-1;
 calls.start.mockImplementation(async(input:any)=>{const hooks=createCtfAgentHooks(input.config.plugin[0][1]);return {close:async()=>{},client:{session:{create:async()=>{seen.created++;return {data:{id:'s1'}};},promptAsync:async()=>{
  i++;const out:any={maxOutputTokens:1e9};await hooks['chat.params']!({sessionID:'s1',agent:'reference',model:{providerID:'local',id:'script'},message:{id:'u'+i}} as never,out as never);seen.limits.push(out.maxOutputTokens);
 },messages:async()=>({data:[{info:{role:'assistant',time:{completed:1},finish,tokens:{input:10,output:10,reasoning:0}},parts:[{type:'text',text:JSON.stringify(responses[Math.min(i,responses.length-1)])}]}]})}}};});
 return seen;
}
const ep=(first:string,extra:any={})=>({summary:'s',tech_tags:[],steps:[step(first)],failed_paths:[],unresolved:[],experience_refs:[],...extra});

describe('A: keys outside the schema are dropped and named; everything else still rejected',()=>{
 it('accepts lessons carrying title_note:null, stores only schema fields, reports the dropped keys',async()=>{
  const f=fixture();script([ep(f.first),{lessons:[lessonBody({title_note:null}),lessonBody({title:'u',title_note:null})]}]);
  const r=await learnEpisodes(f.options),saved=f.store.getEpisode(f.e.episode_id)!;
  expect(saved.lesson_status).toBe('completed');expect(saved.lesson_ids).toHaveLength(2);expect(r.status).toBe('completed');
  expect(r.episodes[0].dropped_keys.lesson).toEqual(['lessons.0.title_note','lessons.1.title_note']);
  expect(r.episodes[0].episode_status).toBe('completed');expect(r.episodes[0].lesson_status).toBe('completed');
  expect(r.episodes[0].finish).toEqual({episode:'stop',lesson:'stop'});
  expect(saved.requests.at(-1).dropped_keys).toEqual(['lessons.0.title_note','lessons.1.title_note']);
  const stored=JSON.parse(String((f.store.db.prepare('SELECT body FROM lessons').get() as any).body));expect(stored).not.toHaveProperty('title_note');expect(Object.keys(stored)).toContain('title');
  f.store.close();
 });
 it('drops extra keys in episode top level, steps and failed_paths/unresolved objects',async()=>{
  const f=fixture();script([{...ep(f.first,{failed_paths:[{text:'x',source_refs:[f.first],confidence:1}],unresolved:[{text:'y',source_refs:[f.first],why:null}]}),mood:'ok',steps:[{...step(f.first),note:null}]},{lessons:[]}]);
  await learnEpisodes(f.options);const saved=f.store.getEpisode(f.e.episode_id)!;
  expect(saved.episode_status).toBe('completed');expect(JSON.stringify(saved.content)).not.toMatch(/mood|note|confidence|why/);
  expect(saved.requests[0].dropped_keys.sort()).toEqual(['failed_paths.0.confidence','mood','steps.0.note','unresolved.0.why']);f.store.close();
 });
 it.each([
  ['missing title',{lessons:[{tags:[],when:'w',steps:[],checks:[],avoid:[],limits:[],title_note:null}]}],
  ['wrong type',{lessons:[lessonBody({tags:'a',title_note:null})]}],
  ['over bounds',{lessons:[lessonBody({tags:Array(9).fill('a'),title_note:null})]}],
  ['4 lessons',{lessons:Array(4).fill(lessonBody())}],
 ])('still rejects a lesson reply with %s',async(_n,reply)=>{
  const f=fixture();script([ep(f.first),reply]);await learnEpisodes(f.options);
  const saved=f.store.getEpisode(f.e.episode_id)!;expect(saved.lesson_status).toBe('failed');expect(saved.lesson_ids).toEqual([]);expect(f.store.db.prepare('SELECT 1 FROM lessons').all()).toEqual([]);f.store.close();
 });
 it('still rejects an episode missing a required field even with extra keys',async()=>{
  const f=fixture();const {summary:_s,...rest}=ep(f.first);script([{...rest,extra:1}]);await learnEpisodes(f.options);
  expect(f.store.getEpisode(f.e.episode_id)).toMatchObject({episode_status:'failed',content:null});f.store.close();
 });
 it('stored schemas stay strict',()=>{
  const f=fixture();expect(()=>f.store.completeLessons({...f.e,episode_status:'completed'} as any,[lessonBody({title_note:null}) as any])).toThrow();f.store.close();
 });
});

describe('dropped key names are model-chosen: redacted and bounded',()=>{
 it('redacts, truncates names and caps the list',async()=>{
  const f=fixture(),secret='sk-synthetic-secret-0001';f.store.addRedactions([secret]);
  const extras:any={};extras[`k_${secret}`]=1;extras['n'.repeat(300)]=1;for(let i=0;i<40;i++)extras['x'+i]=1;
  script([{...ep(f.first),...extras},{lessons:[]}]);
  await learnEpisodes(f.options);const d=f.store.getEpisode(f.e.episode_id)!.requests[0].dropped_keys as string[];
  expect(JSON.stringify(d)).not.toContain(secret);expect(d).toHaveLength(33);expect(d.some(k=>k.endsWith('[truncated]')&&k.length<=128+12)).toBe(true);expect(d.at(-1)).toBe('[10 more dropped]');
  expect(d.every(k=>k.length<=140)).toBe(true);f.store.close();
 });
});

describe('report carries the learning finish reason',()=>{
 it('reports finish=length and failed episode status when the reply is cut',async()=>{
  const f=fixture();script([ep(f.first)],'length');const r=await learnEpisodes(f.options);
  expect(r.episodes[0].episode_status).toBe('failed');expect(r.episodes[0].finish).toBe('length');f.store.close();
 });
});

describe('B: output cap comes from the model config',()=>{
 const providers=(output:number)=>({local:{models:{script:{limit:{context:100000,output}}}}});
 it('reads limit.output, falls back to a default when absent',()=>{
  expect(modelOutputLimit({model:'local/script',provider:providers(8000)} as any)).toBe(8000);
  expect(modelOutputLimit({model:'local/script'} as any)).toBe(8000);
  expect(modelOutputLimit({model:'a/b/c',provider:{a:{models:{'b/c':{limit:{output:12000}}}}}} as any)).toBe(12000);
 });
 it('admits requests with maxOutputTokens=limit.output when the budget allows, and shrinks under a tight budget',async()=>{
  let f=fixture('local/script',providers(8000));let seen=script([ep(f.first),{lessons:[]}]);await learnEpisodes(f.options);expect(seen.limits).toEqual([8000,8000]);f.store.close();
  f=fixture('local/script',providers(16000));seen=script([ep(f.first),{lessons:[]}]);await learnEpisodes(f.options);expect(seen.limits).toEqual([16000,16000]);f.store.close();
  f=fixture('local/script',providers(8000));seen=script([ep(f.first),{lessons:[]}]);
  const r=await learnEpisodes({...f.options,budget:{maxObservableTokens:9000,wallClockMs:3000}});
  expect(seen.limits[0]).toBeLessThan(8000);expect(seen.limits[0]).toBeGreaterThanOrEqual(256);expect(r.requests).toBeGreaterThanOrEqual(1);f.store.close();
 });
 it('budget below the floor still reports learning budget exhausted without a request',async()=>{
  const f=fixture('local/script',providers(8000));const seen=script([ep(f.first)]);
  await learnEpisodes({...f.options,budget:{maxObservableTokens:100,wallClockMs:3000}});
  expect(seen.created).toBe(0);expect(f.store.getEpisode(f.e.episode_id)).toMatchObject({episode_status:'budget_exhausted'});f.store.close();
 });
 it('refuses before any request when the model limit is below what a bounded reply needs',async()=>{
  const f=fixture('local/script',providers(4096));const seen=script([ep(f.first)]);const r=await learnEpisodes(f.options);
  const saved=f.store.getEpisode(f.e.episode_id)!;expect(r.requests).toBe(0);expect(seen.created).toBe(0);expect(saved.episode_status).toBe('failed');expect(saved.error).toMatch(/output limit 4096 is below/);f.store.close();
 });
 it('finish=length is still fail-closed and not retried',async()=>{
  const f=fixture('local/script',providers(8000));const seen=script([ep(f.first)],'length');const r=await learnEpisodes(f.options);
  expect(r.requests).toBe(1);expect(seen.created).toBe(1);expect(f.store.getEpisode(f.e.episode_id)).toMatchObject({episode_status:'failed',content:null});f.store.close();
 });
});

describe('C: manual re-learning works on a copy',()=>{
 const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
 async function failedStore(kind:'episode'|'lesson') {
  const f=fixture('local/script');script([kind==='episode'?{summary:'x'}:ep(f.first),{lessons:[{tags:[]}]}]);await learnEpisodes(f.options);
  const e=f.store.getEpisode(f.e.episode_id)!;expect(kind==='episode'?e.episode_status:e.lesson_status).toBe('failed');f.store.close();
  return {f,id:e.episode_id,db:join(f.root,'memory.sqlite')};
 }
 it.each(['episode','lesson'] as const)('resets a failed %s on the copy, runs to completion, leaves the original untouched',async(kind)=>{
  const {f,id,db}=await failedStore(kind),before=hash(db),out=join(f.root,'copy-'+kind);
  const prepared=await prepareRelearn(db,out,[id,'missing-id'],8000);
  expect(prepared.skipped).toEqual([{id:'missing-id',reason:'not found'}]);expect(prepared.requests).toBe(kind==='episode'?2:1);expect(prepared.estimated_reserved_tokens).toBeGreaterThan(0);
  expect(calls.start).toHaveBeenCalledTimes(1); // only the failing first pass; preparing sent nothing
  const lesson={lessons:[lessonBody({title_note:null})]},seen=script(kind==='episode'?[ep(f.first),lesson]:[lesson]);
  const report=await learnEpisodes({store:prepared.store,episodes:prepared.episodes,directory:join(out,'learning'),config:{model:'local/script'} as any,environment:{},budget:{maxObservableTokens:100000,wallClockMs:3000}});
  expect(report.status).toBe('completed');expect(seen.limits).toHaveLength(kind==='episode'?2:1);
  expect(prepared.store.getEpisode(id)).toMatchObject({episode_status:'completed',lesson_status:'completed'});expect(prepared.store.db.prepare('SELECT 1 FROM lessons').all()).toHaveLength(1);
  prepared.store.close();expect(hash(db)).toBe(before);
  const original=new ExperienceStore(db);expect(kind==='episode'?original.getEpisode(id)!.episode_status:original.getEpisode(id)!.lesson_status).toBe('failed');original.close();
 });
 it('the copy store redacts a supplied secret like the launch path',async()=>{
  const {f,id,db}=await failedStore('lesson'),secret='sk-synthetic-secret-0002';
  const p=await prepareRelearn(db,join(f.root,'secret-copy'),[id],8000,[secret]);
  expect(String(p.store.clean('error '+secret))).not.toContain(secret);p.store.close();
  const q=await prepareRelearn(db,join(f.root,'plain-copy'),[id],8000);expect(String(q.store.clean('error '+secret))).toContain(secret);q.store.close();
 });
 it('skips episodes that are not in a failed state and refuses to overwrite an existing copy',async()=>{
  const f=fixture();const db=join(f.root,'memory.sqlite');f.store.close();
  const p=await prepareRelearn(db,join(f.root,'c1'),[f.e.episode_id],8000);expect(p.skipped[0]!.reason).toMatch(/not a failed state/);expect(p.requests).toBe(0);p.store.close();
  await expect(prepareRelearn(db,join(f.root,'c1'),[f.e.episode_id],8000)).rejects.toThrow('already exists');
 });
});
