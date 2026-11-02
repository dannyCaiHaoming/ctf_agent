import {describe,it,expect,vi,beforeEach} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const calls=vi.hoisted(()=>({start:vi.fn()}));
vi.mock('@ctf/opencode-bridge',()=>({startManagedOpenCode:calls.start}));
import {learnEpisodes} from '../../apps/launcher/src/episode-learning.js';
import {createCtfAgentHooks} from '../../apps/opencode-plugin/src/index.js';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
beforeEach(()=>{calls.start.mockReset();});
describe('learning lifecycle',()=>{
 it('old profile without learning budget and explicit stop persist inputs but never start a provider',async()=>{
  const root=mkdtempSync(join(tmpdir(),'learning-lifecycle-')),store=new ExperienceStore(join(root,'memory.sqlite'));
  const e=store.saveDraft({run_id:'A',challenge_id:'X',outcome:'unknown',outcome_ref:'unknown submission',end_reason:'deadline',input:{sources:[{ref:'x',content:'persist me'}]}});
  const options={store,episodes:[e],directory:join(root,'learning'),config:{model:'fake/model'},environment:{}};
  expect(await learnEpisodes(options)).toMatchObject({status:'pending',reason:'learning budget not configured',requests:0});
  expect(await learnEpisodes({...options,budget:{maxObservableTokens:100,wallClockMs:1000},explicitStop:true})).toMatchObject({status:'pending',reason:'explicit stop',requests:0});
  expect(calls.start).not.toHaveBeenCalled();store.close();const reopened=new ExperienceStore(join(root,'memory.sqlite'));expect(reopened.getEpisode(e.episode_id)!.input.sources[0].content).toBe('persist me');reopened.close();
 });
 it('unknown prior receipt is not automatically retried',async()=>{
  const root=mkdtempSync(join(tmpdir(),'learning-unknown-')),store=new ExperienceStore(join(root,'memory.sqlite'));
  const e=store.saveDraft({run_id:'A',challenge_id:'X',outcome:'unsolved',outcome_ref:[],end_reason:'completed',input:{sources:[]}});e.episode_status='unknown';e.requests=[{state:'unknown',sessionID:'old'}];store.saveEpisode(e);
  expect(await learnEpisodes({store,episodes:[e],directory:join(root,'learning'),config:{model:'fake/model'},environment:{},budget:{maxObservableTokens:10000,wallClockMs:1000}})).toMatchObject({status:'no_pending',requests:0});expect(calls.start).not.toHaveBeenCalled();store.close();
 });
});

function configuredFixture() {
 const root=mkdtempSync(join(tmpdir(),'learning-rpc-')),store=new ExperienceStore(join(root,'memory.sqlite'));
 const e=store.saveDraft({run_id:'A',challenge_id:'X',outcome:'unknown',outcome_ref:['unknown receipt'],end_reason:'completed',input:{sources:[{ref:'execution:1',content:'SQL_FAILED'}],experience_refs:[]}});
 return {store,e,options:{store,episodes:[e],directory:join(root,'learning'),config:{model:'local/script'},environment:{},budget:{maxObservableTokens:20000,wallClockMs:3000}}};
}
it('persists unknown receipt and refuses to repeat it after restart',async()=>{
 const {store,e,options}=configuredFixture();let admissions=0;
 calls.start.mockImplementation(async(input:any)=>{
  const hooks=createCtfAgentHooks(input.config.plugin[0][1]);
  return {close:async()=>{},client:{session:{create:async()=>({data:{id:'s1'}}),promptAsync:async()=>{
   const output={maxOutputTokens:4096};await hooks['chat.params']!({sessionID:'s1',agent:'reference',model:{providerID:'local',id:'script'},message:{id:'u1'}} as never,output as never);admissions++;throw new Error('lost response after admission');
  }}}};
 });
 const r=await learnEpisodes(options);expect(r.requests).toBe(1);expect(admissions).toBe(1);expect(store.getEpisode(e.episode_id)!.episode_status).toBe('unknown');
 const saved=store.getEpisode(e.episode_id)!;expect(saved.requests[0].state).toBe('unknown');expect(await learnEpisodes({...options,episodes:[saved]})).toMatchObject({status:'no_pending',requests:0});expect(calls.start).toHaveBeenCalledTimes(1);store.close();
});
it('budget too small never admits a request and leaves trusted outcome intact',async()=>{
 const {store,e,options}=configuredFixture();calls.start.mockResolvedValue({close:async()=>{},client:{session:{create:vi.fn(()=>{throw new Error('must not create a request');})}}});
 const r=await learnEpisodes({...options,budget:{maxObservableTokens:1,wallClockMs:3000}});expect(r.requests).toBe(0);expect(store.getEpisode(e.episode_id)).toMatchObject({episode_status:'budget_exhausted',outcome:'unknown',lesson_status:'pending'});store.close();
});

it('binds host final judge alongside inconclusive verifier and validates only presented sources',async()=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');
 const {store,e}=configuredFixture();e.outcome='solved';e.input.completion={state:'confirmed',solved:true,businessOutcome:'accepted'};e.input.verifications=[{judgment:'inconclusive'}];
 e.input.sources=Array.from({length:100},(_,i)=>({ref:'recon:'+i,content:{kind:'tool',result_json:'x'.repeat(2000)}}));
 e.input.sources.push({ref:'execution:final',role:'verifier',content:'no judge call was made during verifier phase'},{ref:'recon:decision',content:{kind:'decision',note_json:{assessment:'template route'}}});
 const p=prepareEpisodeInput(e);expect(p.result).toMatchObject({outcome:'unknown'}); // persisted host result remains authority, not mutable model output
 delete e.input.result;const current=prepareEpisodeInput(e);expect(current.result).toMatchObject({outcome:'solved',completion:{businessOutcome:'accepted'},verifications:[{judgment:'inconclusive'}]});
 expect(current.sources.some(s=>s.ref==='execution:final')).toBe(true);expect(current.sources.some(s=>s.ref==='recon:decision')).toBe(true);expect(current.coverage.omitted_refs.length).toBeGreaterThan(0);store.close();
});

it.each(['length','tool-calls',undefined])('retains finish=%s response and usage, never parses it as complete or creates lessons',async(finish)=>{
 const {store,e,options}=configuredFixture();
 calls.start.mockImplementation(async(input:any)=>{
  const hooks=createCtfAgentHooks(input.config.plugin[0][1]);
  return {close:async()=>{},client:{session:{create:async()=>({data:{id:'s1'}}),promptAsync:async()=>{
   await hooks['chat.params']!({sessionID:'s1',agent:'reference',model:{providerID:'local',id:'script'},message:{id:'u1'}} as never,{maxOutputTokens:4096} as never);
  },messages:async()=>({data:[{info:{role:'assistant',time:{completed:1},finish,tokens:{input:10,output:3073,reasoning:1023}},parts:[{type:'text',text:'{"summary":"valid JSON must still fail"}'}]}]})}}};
 });
 const r=await learnEpisodes(options),saved=store.getEpisode(e.episode_id)!;
 expect(r.requests).toBe(1);expect(saved.episode_status).toBe('failed');expect(saved.lesson_status).toBe('pending');expect(saved.content).toBeNull();expect(saved.requests[0]).toMatchObject({state:'received',finish:finish??null,usage:{output:3073,reasoning:1023},response:{text:'{"summary":"valid JSON must still fail"}'}});expect(store.search({query:'valid'}).results).toEqual([]);store.close();
});

it('rejects an existing but omitted source rather than treating all stored IDs as presented',async()=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');const {store,e,options}=configuredFixture();
 e.input.sources=Array.from({length:90},(_,i)=>({ref:`recon:${i}`,content:'x'.repeat(2000)}));
 const prepared=prepareEpisodeInput(e),omitted='recon:not-in-list';expect(prepared.coverage.omitted_refs.length).toBeGreaterThan(0);
 const response={summary:'bounded',tech_tags:[],steps:[{stage:'recon',action:'check',observation:'observed',reason:'compare',source_refs:[omitted]}],failed_paths:[],unresolved:[],experience_refs:[]};
 calls.start.mockImplementation(async(input:any)=>{const hooks=createCtfAgentHooks(input.config.plugin[0][1]);return {close:async()=>{},client:{session:{create:async()=>({data:{id:'s1'}}),promptAsync:async()=>{await hooks['chat.params']!({sessionID:'s1',agent:'reference',model:{providerID:'local',id:'script'},message:{id:'u1'}} as never,{maxOutputTokens:4096} as never);},messages:async()=>({data:[{info:{role:'assistant',time:{completed:1},finish:'stop',tokens:{input:10,output:10,reasoning:0}},parts:[{type:'text',text:JSON.stringify(response)}]}]})}}};});
 await learnEpisodes({...options,budget:{maxObservableTokens:100000,wallClockMs:3000}});const saved=store.getEpisode(e.episode_id)!;expect(saved.error).toContain('unbound episode step source');expect(saved.content).toBeNull();expect(saved.lesson_status).toBe('pending');expect((saved.model_input as any).sources.some((s:any)=>s.ref===omitted)).toBe(false);store.close();
});

it.each(['ascii','unicode'])('preserves each final role delivery under heavy decision history within 20 KB (%s)',async(encoding)=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');const {store,e}=configuredFixture();const text=(encoding==='unicode'?'调':'x').repeat(4000);
 e.input.sources=Array.from({length:30},(_,i)=>({ref:'recon:'+i,content:{kind:'decision',note_json:{observation:text,assessment:text,next_action:text,next_reason:text}}}));
 e.input.sources.push({ref:'recon:handoff',content:{kind:'handoff',note_json:{assessment:text}}});
 for(const role of ['recon','domain-solver','engineer','verifier']){e.input.sources.push({ref:`execution:${role}:old`,role,content:[text]},{ref:`execution:${role}:final`,role,content:[text]});}
 const prepared=prepareEpisodeInput(e);
 for(const ref of ['recon:handoff','recon:29',...['recon','domain-solver','engineer','verifier'].map(r=>`execution:${r}:final`)])expect(prepared.sources.some(s=>s.ref===ref),ref).toBe(true);
 expect(Buffer.byteLength(JSON.stringify(prepared.sources))).toBeLessThanOrEqual(20000);expect(prepared.coverage.omitted_count).toBeGreaterThan(0);store.close();
});

// ---- design §7 mechanical source selection (synthetic trajectories only) ----
const fam=(seq:number,tool:string,args:any,http?:number,extra:any={})=>({ref:`recon:${seq}`,content:{id:seq,sequence:seq,kind:'tool',tool,status:'completed',args_json:args,result_json:http===undefined?{state:'ok'}:{status:http,preview:'p'.repeat(1500)},...extra}});
const post=(path:string,names:string[])=>({method:'POST',url:`https://app.example.test${path}`,body:names.map(n=>`${n}=v`).join('&')});
function syntheticAttempt() {
 const sources:any[]=[];let n=0;
 const add=(tool:string,args:any,http?:number,extra?:any)=>sources.push(fam(++n,tool,args,http,extra));
 add('http.request',{method:'GET',url:'https://app.example.test/health'},200);            // singleton family
 for(let i=0;i<5;i++)add('http.request',post('/register',['email','name']),302);           // early success
 for(let i=0;i<30;i++)add('http.request',{method:'GET',url:'https://app.example.test/list'},i%2?500:200); // many change points
 for(let i=0;i<30;i++)add('http.request',post('/register',['email','name']),i<27?302:403); // late failure, one change point (index 27)
 add('http.request',post('/register',['other']),403);
 return sources;
}
const seqs=(refs:any[])=>refs.map(s=>Number(String(s.ref).split(':')[1]));
function draft(sources:any[]) {const {store,e}=configuredFixture();e.input.sources=sources;return {store,e};}

it('keeps family first/last and change points, deleting only middle steps when over the input limit',async()=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');
 const sources=syntheticAttempt(),{store,e}=draft(sources),p:any=prepareEpisodeInput(e),got=new Set(seqs(p.sources));
 expect(Buffer.byteLength(JSON.stringify(p.sources))).toBeLessThanOrEqual(20000);
 const regFirst=sources.findIndex(s=>s.content.args_json.url?.endsWith('/register'))+1,reg=sources.filter(s=>s.content.args_json.body==='email=v&name=v');
 const regSeqs=reg.map(s=>s.content.sequence),regLast=regSeqs.at(-1)!,firstRegErr=reg.find(s=>s.content.result_json.status===403)!.content.sequence;
 expect(regFirst).toBe(regSeqs[0]);
 for(const q of [1,regSeqs[0],regLast,firstRegErr])expect(got.has(q),'seq '+q).toBe(true);   // singleton, early 302, late 403, change point
 const list=sources.filter(s=>s.content.args_json.url?.endsWith('/list')).map(s=>s.content.sequence);
 expect(got.has(list[0])&&got.has(list.at(-1)!)).toBe(true);                                  // first/last of the churning family
 expect(got.has(sources.at(-1)!.content.sequence)).toBe(true);                                // other-parameter-names family
 expect(p.sources.length).toBeLessThan(sources.length);expect(p.omitted_ranges.some((r:any)=>r.reason==='not_in_summary'&&r.count>0)).toBe(true);
 expect(prepareEpisodeInput(e)).toEqual(p);                                                      // stable for the same input
 store.close();
});

it('omits whole families with their key when even first/last do not fit, never silently truncating',async()=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');
 const sources=Array.from({length:60},(_,i)=>fam(i+1,'workspace.read',{path:`/w/file${i}`},undefined,{result_json:{text:'t'.repeat(3000)}}));
 const {store,e}=draft(sources),p:any=prepareEpisodeInput(e),provided=new Set(p.sources.map((s:any)=>s.ref));
 expect(Buffer.byteLength(JSON.stringify(p.sources))).toBeLessThanOrEqual(20000);
 const omittedFamilies=p.omitted_ranges.filter((r:any)=>r.reason==='not_in_summary');expect(omittedFamilies.length).toBeGreaterThan(0);
 for(const s of sources){if(provided.has(s.ref))continue;expect(omittedFamilies.some((r:any)=>r.family==='workspace.read:'+s.content.args_json.path&&r.start_sequence<=s.content.sequence&&s.content.sequence<=r.end_sequence),s.ref).toBe(true);}
 expect(p.sources.filter((s:any)=>s.prompt_truncated).length).toBeGreaterThanOrEqual(0);store.close();
});

it('marks omitted incomplete steps source_missing, separate from not_in_summary',async()=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');
 const sources=syntheticAttempt();const mid=sources.find(s=>s.content.sequence===20)!;mid.content.result_meta={complete:false};mid.content.result_json={status:500,preview:'partial'};
 const {store,e}=draft(sources),p:any=prepareEpisodeInput(e);
 expect(p.sources.some((s:any)=>s.ref===mid.ref)).toBe(false);
 expect(p.omitted_ranges.some((r:any)=>r.reason==='source_missing'&&r.start_sequence<=20&&20<=r.end_sequence)).toBe(true);
 expect(p.omitted_ranges.some((r:any)=>r.reason==='not_in_summary')).toBe(true);store.close();
});

it('host fills source_range over the complete trajectory and keeps drafts idempotent',()=>{
 const {store}=configuredFixture(),scope=(call:string)=>({run:'R',challenge:'X',session:'s',call});
 for(let i=1;i<=7;i++){store.start(scope('c'+i),'http.request',{method:'GET',url:'https://app.example.test/a'});if(i<7)store.finish(scope('c'+i),'completed',{status:200});}
 const make=()=>store.saveDraft({run_id:'R',challenge_id:'X',outcome:'unsolved',outcome_ref:[],end_reason:'completed',input:{sources:[{ref:'recon:1',content:{sequence:1}}],source_manifest:[{ref:'artifact:art-1'}]}});
 const a=make(),b=make(),records=store.records('R','X');
 expect(b.episode_id).toBe(a.episode_id);expect(b.version).toBe(1);expect(b.input_hash).toBe(a.input_hash);
 expect(a.input.source_range).toMatchObject({first_sequence:1,last_sequence:7,total:7,fingerprint:records.fingerprint,artifact_refs:['artifact:art-1'],running:1,unknown:0});
 store.close();
});

function scripted(response:any){
 calls.start.mockImplementation(async(input:any)=>{const hooks=createCtfAgentHooks(input.config.plugin[0][1]);return {close:async()=>{},client:{session:{create:async()=>({data:{id:'s1'}}),promptAsync:async()=>{await hooks['chat.params']!({sessionID:'s1',agent:'reference',model:{providerID:'local',id:'script'},message:{id:'u1'}} as never,{maxOutputTokens:4096} as never);},messages:async()=>({data:[{info:{role:'assistant',time:{completed:1},finish:'stop',tokens:{input:10,output:10,reasoning:0}},parts:[{type:'text',text:JSON.stringify(response)}]}]})}}};});
}
const step=(r:string)=>({stage:'recon',action:'a',observation:'o',reason:'r',source_refs:[r]});
it.each([
 ['ref outside provided sources',[{text:'403 on empty form',source_refs:['recon:omitted']}],'unbound episode'],
 ['bare string (no source binding)',['403 on empty form'],'unbound episode'],
 ['empty source_refs',[{text:'403',source_refs:[]}],'unbound episode'],
])('rejects failed_paths/unresolved bound to %s',async(_n,items,message)=>{
 for(const field of ['failed_paths','unresolved'] as const){
  const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');const {store,e,options}=configuredFixture();
  e.input.sources=Array.from({length:60},(_,i)=>fam(i+1,'workspace.read',{path:`/w/${i}`},undefined,{result_json:{text:'t'.repeat(3000)}}));
  const p:any=prepareEpisodeInput(e),first=p.sources[0].ref;
  scripted({summary:'s',tech_tags:[],steps:[step(first)],failed_paths:[],unresolved:[],experience_refs:[],[field]:JSON.parse(JSON.stringify(items))});
  await learnEpisodes({...options,episodes:[e],budget:{maxObservableTokens:100000,wallClockMs:3000}});
  expect(store.getEpisode(e.episode_id)!.error).toContain(message);expect(store.getEpisode(e.episode_id)!.content).toBeNull();store.close();
 }
});
it('accepts source-bound failed_paths/unresolved, and old string episodes still read',async()=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');const {store,e,options}=configuredFixture();
 e.input.sources=[fam(1,'http.request',{method:'GET',url:'https://app.example.test/a'},403)];
 const first=(prepareEpisodeInput(e) as any).sources[0].ref;
 scripted({summary:'s',tech_tags:[],steps:[step(first)],failed_paths:[{text:'403 on empty form',source_refs:[first]}],unresolved:[{text:'cause unknown',source_refs:[first]}],experience_refs:[]});
 await learnEpisodes({...options,episodes:[e],budget:{maxObservableTokens:100000,wallClockMs:3000}});
 expect(store.getEpisode(e.episode_id)!.content).toMatchObject({failed_paths:[{text:'403 on empty form',source_refs:[first]}],unresolved:[{text:'cause unknown',source_refs:[first]}]});
 const old=store.saveDraft({run_id:'old',challenge_id:'old',outcome:'solved',outcome_ref:[],end_reason:'done',input:{sources:[]}});
 old.content={summary:'legacy',tech_tags:['legacy'],steps:[],failed_paths:['plain string'] as any,unresolved:[],experience_refs:[]};old.episode_status='completed';store.saveEpisode(old);
 expect(store.search({query:'legacy',kind:'episode'}).results).toHaveLength(1);
 expect(JSON.parse(Buffer.from(store.read({kind:'episode',id:old.episode_id}).data,'base64').toString()).content.failed_paths).toEqual(['plain string']);store.close();
});

it('lists every step one line even when its excerpt is omitted, and the line is citable',async()=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');const {store,e,options}=configuredFixture();
 e.input.sources=Array.from({length:60},(_,i)=>fam(i+1,'workspace.read',{path:`/w/${i}`},undefined,{result_json:{text:'t'.repeat(3000)}}));
 const p:any=prepareEpisodeInput(e),shown=new Set(p.sources.map((s:any)=>s.ref)),gone=e.input.sources.find((s:any)=>!shown.has(s.ref))!;
 expect(p.step_list.lines).toHaveLength(60);expect(p.step_list.omitted_sequences).toEqual([]);
 const line=p.step_list.lines.find((l:string)=>l.startsWith(`${gone.content.sequence}|${gone.ref}|`))!;expect(line).toContain('workspace.read:/w/');expect(line).not.toContain('ttt');
 scripted({summary:'s',tech_tags:[],steps:[step(p.sources[0].ref)],failed_paths:[{text:'x',source_refs:[gone.ref]}],unresolved:[],experience_refs:[]});
 await learnEpisodes({...options,episodes:[e],budget:{maxObservableTokens:100000,wallClockMs:3000}});
 expect(store.getEpisode(e.episode_id)!.content).toMatchObject({failed_paths:[{source_refs:[gone.ref]}]});store.close();
});
it('caps the step list at 48 KiB and names the remaining sequences as ranges',async()=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');
 const sources=Array.from({length:1500},(_,i)=>fam(i+1,'workspace.read',{path:`/w/${'d'.repeat(40)}${i}`},undefined));
 const {store,e}=draft(sources),p:any=prepareEpisodeInput(e),l=p.step_list;
 expect(l.bytes).toBeLessThanOrEqual(48*1024);expect(l.lines.length).toBeLessThan(1500);
 const listed=l.lines.map((x:string)=>Number(x.split('|')[0])),ranged=l.omitted_sequences;
 const covered=new Set(listed);for(const r of ranged)for(let q=r.start_sequence;q<=r.end_sequence;q++)covered.add(q);
 expect(covered.size).toBe(1500);expect(ranged.reduce((n:number,r:any)=>n+r.count,0)+listed.length).toBe(1500);
 store.close();
});
it('drops single-step families before multi-step ones when excerpts overflow',async()=>{
 const {prepareEpisodeInput}=await import('../../apps/launcher/src/episode-learning.js');
 const sources=Array.from({length:40},(_,i)=>fam(i+1,'workspace.read',{path:`/single/${i}`},undefined,{result_json:{text:'t'.repeat(3000)}}));
 for(let i=0;i<4;i++)sources.push(fam(41+i,'workspace.read',{path:'/multi'},undefined,{result_json:{text:'t'.repeat(3000)}}));
 const {store,e}=draft(sources),p:any=prepareEpisodeInput(e),shown=new Set(p.sources.map((s:any)=>s.ref));
 expect(shown.has('recon:41')&&shown.has('recon:44')).toBe(true);expect(p.omitted_ranges.some((r:any)=>r.whole_family&&r.family.includes('/single/'))).toBe(true);store.close();
});
