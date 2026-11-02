// Read-only replay of the original r15 evidence through current deterministic logic.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
import {ControlService} from '../../apps/launcher/src/control-service.js';
import {prepareEpisodeInput,decodeLearningResponse} from '../../apps/launcher/src/episode-learning.js';
import {investigationView,retrievalSignals,digest} from '../../apps/launcher/src/investigation-context.js';
const evidenceRoot=process.env.RECON_ORIGINAL_ROOT??'/Users/caihaoming/Documents/pentest-agent-run-data/experience-real-20261030-r15-ab';
const originalPath=join(evidenceRoot,'runs/experience.sqlite'),original=new DatabaseSync(originalPath,{readOnly:true});
const root=await mkdtemp(join(tmpdir(),'recon-original-replay-')),store=new ExperienceStore(join(root,'replay.sqlite'));
const reports:any[]=[];
try{
 const episodes=original.prepare('SELECT body FROM episodes ORDER BY run_id').all().map(r=>JSON.parse(String(r.body)));
 for(const e of episodes){
  const rows=original.prepare('SELECT * FROM recon_turns WHERE run_id=? AND challenge_id=? ORDER BY id').all(e.run_id,e.challenge_id).map((r:any)=>({...r,args_json:r.args_json?JSON.parse(r.args_json):null,result_json:r.result_json?JSON.parse(r.result_json):null,note_json:r.note_json?JSON.parse(r.note_json):null}));
  assert(rows.length>40);assert(!rows.some(r=>r.kind==='decision'));
  const fresh=store.saveDraft({run_id:e.run_id,challenge_id:e.challenge_id,outcome:e.outcome,outcome_ref:e.outcome_ref,end_reason:e.end_reason,input:e.input});
  const prepared=prepareEpisodeInput(fresh);assert.equal(prepared.result.outcome,'solved');assert.equal(prepared.result.completion.solved,true);assert(prepared.result.verifications.some((v:any)=>v.judgment==='inconclusive'));
  assert(prepared.sources.some(s=>s.role==='verifier'));assert(prepared.sources.some(s=>s.content.includes('handoff')));assert(prepared.coverage.omitted_refs.length>0);
  store.db.exec('DELETE FROM recon_turns'); // disposable per-attempt replay only
  // Import exact original rows into disposable replay storage; the source database remains read-only.
  for(const row of original.prepare('SELECT * FROM recon_turns WHERE run_id=? AND challenge_id=? ORDER BY id').all(e.run_id,e.challenge_id)){
   const keys=Object.keys(row);store.db.prepare(`INSERT INTO recon_turns(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]!));
  }
  (store as any).migrateReconV2(); // the store's own R3 backfill (step_id/sequence) for rows imported after open
  // Design §4: the complete original trajectory is mechanically navigable, with no recency/decision/byte selection.
  const view=investigationView(store,e.run_id,e.challenge_id,{tail:true});
  assert.equal(view.all.length,rows.length);assert(view.all.some(r=>r.kind==='handoff'));assert(view.gaps.includes('decision not recorded'));
  assert.equal(view.coverage.complete,rows.length<=view.index.length);assert(view.recent.length>0&&view.recent.every(s=>s.status!=='running'));
  const materials=join(root,e.run_id,'workspace',e.challenge_id,'materials');await mkdir(materials,{recursive:true});
  const service=new ControlService({client:{session:{get:async({sessionID}:any)=>({data:{id:sessionID,parentID:'root'}})}} as any,runId:e.run_id,experienceStore:store,workdir:join(root,e.run_id,'opencode'),skillRoot:join(root,'skills'),expiresAt:Date.now()+60000,budget:{maxModelCalls:20,maxObservableTokens:100000},challenges:[{id:e.challenge_id,title:null,target:null,reachability:null,materials:[],materialsDir:materials}]});
  service.bindRoot('root');service.bindings.set('replay',{sessionID:'replay',role:'recon',parentID:'root',via:'dispatch',scope:'run',expiresAt:Date.now()+60000,state:'active',boundAt:Date.now(),challengeId:e.challenge_id});
  (service as any).executions.set('replay-execution',{ref:'replay-execution',childID:'replay',role:'recon',state:'running'});
  const projection=await service.handle('replay','context.prepare',{messageID:'replay-user',placement:'chat.message'}) as any,projected=JSON.parse(projection.text.slice(projection.text.indexOf('\n')+1));
  assert.equal(projected.mode,'full');assert.deepEqual(projected.index.entries.map((x:any)=>x.id),view.index.map(x=>x.id));assert.equal(projected.index.coverage.total,rows.length);
  // An explicitly scripted closing note tests new behavior; do not rewrite or pretend this existed in the original run.
  const result=await service.handle('replay','tool.execute',{tool:'recon.note',callID:'replay-handoff',messageID:'replay-assistant',args:{kind:'handoff',next_reason:'offline export of original evidence'}}) as any;
  assert.equal(result.snapshot.status,'complete');assert.equal(result.snapshot.coverage.total,rows.length+1);
  const pub=(service as any).publications,index=JSON.parse((await pub.bytes(e.run_id,e.challenge_id,result.snapshot.export.ref)).bytes.toString());
  const bytes=Buffer.concat(await Promise.all(index.parts.map(async(p:any)=>(await pub.bytes(e.run_id,e.challenge_id,p.ref)).bytes))),fixed=JSON.parse(bytes.toString());
  assert.equal(bytes.length,index.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),index.sha256);assert.equal(fixed.records.length,rows.length+1);assert.equal(fixed.records.at(-1).kind,'handoff');
  const signals=retrievalSignals(store,'',[],rows);
  reports.push({run:e.run_id,original_rows:rows.length,original_kind_counts:Object.fromEntries(['tool','decision','handoff'].map(k=>[k,rows.filter(r=>r.kind===k).length])),original_input_hash:e.input_hash,input_bytes:Buffer.byteLength(JSON.stringify(e.input)),projection_version:projection.version,projection_records:view.index.map(x=>x.id),projection_bytes:Buffer.byteLength(projection.text),projection_gaps:view.gaps,prompt_source_refs:prepared.sources.map(s=>s.ref),prompt_omitted:prepared.coverage.omitted_refs.length,result:{outcome:prepared.result.outcome,completion:prepared.result.completion,verifications:prepared.result.verifications.map((v:any)=>({judgment:v.judgment}))},snapshot:{total:fixed.records.length,original_rows_sha256:digest(fixed.records.slice(0,rows.length)),size:bytes.length,sha256:index.sha256},retrieval_signal_refs:signals.signals.map(s=>s.ref),semantic_relevance:'not asserted'});
 }
 const nativePath=join(evidenceRoot,'runs/experience-r15-b-mfw-1/learning/data/opencode/opencode.db'),native=new DatabaseSync(nativePath,{readOnly:true});
 try{
  const answers=native.prepare('SELECT id,data FROM message WHERE session_id=?').all('ses_e72c3f987ffeUtLY7kWCSeDyJE').map(r=>({id:r.id,data:JSON.parse(String(r.data))}));
  const answer=answers.find(r=>r.data.role==='assistant'&&r.data.finish==='length');assert(answer);
  const raw=native.prepare('SELECT data FROM part WHERE message_id=? ORDER BY time_created,id').all(answer.id!).map(r=>JSON.parse(String(r.data))).filter(p=>p.type==='text').map(p=>p.text).join('\n');
  assert.equal(raw.length,10498);assert.throws(()=>decodeLearningResponse(raw,answer.data.finish),/length exhausted/);
  reports.push({run:'original-B-learning',finish:answer.data.finish,responseChars:raw.length,responseSha256:createHash('sha256').update(raw).digest('hex'),tokens:answer.data.tokens,classification:'learning output length exhausted',jsonParsingAttempted:false});
 }finally{native.close();}
 const out=resolve('docs/gates/recon-context-interface-20261031/product-original-replay.json');await writeFile(out,JSON.stringify({status:'passed',realModelCalls:0,source:originalPath,reports,proof:'original evidence replay; new closing note is scripted in disposable storage; no original run or model behavior changed'},null,2));console.log(JSON.stringify({status:'passed',out,originalRows:reports.slice(0,2).map(r=>r.original_rows),originalBChars:reports.at(-1).responseChars,realModelCalls:0}));
}finally{store.close();original.close();}
