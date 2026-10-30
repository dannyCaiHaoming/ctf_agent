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
