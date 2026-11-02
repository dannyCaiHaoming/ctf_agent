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
 const prepared=prepareEpisodeInput(e),omitted=prepared.coverage.omitted_refs[0];expect(omitted).toBeDefined();
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
