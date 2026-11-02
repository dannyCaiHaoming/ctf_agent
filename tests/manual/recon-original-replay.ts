// Read-only replay of the original r15 evidence through current deterministic logic.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ExperienceStore,describeSource} from '../../apps/launcher/src/experience-store.js';
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
  store.db.exec('DELETE FROM recon_turns'); // disposable per-attempt replay only
  // Import exact original rows into disposable replay storage; the source database remains read-only.
  for(const row of original.prepare('SELECT * FROM recon_turns WHERE run_id=? AND challenge_id=? ORDER BY id').all(e.run_id,e.challenge_id)){
   const keys=Object.keys(row);store.db.prepare(`INSERT INTO recon_turns(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]!));
  }
  (store as any).migrateReconV2(); // the store's own R3 backfill (step_id/sequence) for rows imported after open
  // Design §7: rebuild the complete input as learningInputs does (every stored step plus the non-step sources of the original episode).
  const allSources=[...store.allRecords(e.run_id,e.challenge_id).map((r:any)=>({ref:`recon:${r.id}`,content:r})),...e.input.sources.filter((s:any)=>!String(s.ref).startsWith('recon:'))];
  const fresh=store.saveDraft({run_id:e.run_id,challenge_id:e.challenge_id,outcome:e.outcome,outcome_ref:e.outcome_ref,end_reason:e.end_reason,input:{...e.input,sources:allSources,source_manifest:allSources.map((s:any,i:number)=>({ref:s.ref,role:s.role,...describeSource(s,i),gaps:s.gaps??[]}))}});
  const prepared=prepareEpisodeInput(fresh);assert.equal(prepared.result.outcome,'solved');assert.equal(prepared.result.completion.solved,true);assert(prepared.result.verifications.some((v:any)=>v.judgment==='inconclusive'));
  assert(prepared.sources.some(s=>s.role==='verifier'));assert(prepared.sources.some(s=>s.content.includes('handoff')));assert(prepared.coverage.omitted_refs.length>0);
  // Source contract: the host range covers every stored step; each family keeps first/last or is listed whole with its key.
  assert.equal(fresh.input.source_range.total,rows.length);assert.equal(fresh.input.source_range.first_sequence,1);assert.equal(fresh.input.source_range.last_sequence,rows.length);
  assert.equal(fresh.input.source_range.fingerprint,store.records(e.run_id,e.challenge_id).fingerprint);
  const shown=new Set(prepared.sources.map(s=>s.ref)),famMembers=new Map<string,any[]>();
  for(const [i,s] of allSources.entries()){const d=describeSource(s,i);famMembers.set(d.family,[...(famMembers.get(d.family)??[]),{ref:s.ref,...d}]);}
  const sizeDist:number[]=[];let changePoints=0,lostEnds=0;
  for(const [family,members] of famMembers){
   sizeDist.push(members.length);changePoints+=members.filter((m,i)=>i>0&&m.cls!==members[i-1].cls).length;
   const whole=prepared.omitted_ranges.some((r:any)=>r.family===family&&r.whole_family);
   for(const end of [members[0],members.at(-1)])if(!shown.has(end.ref)&&!whole)lostEnds++;
  }
  assert.equal(lostEnds,0);
  const covered=allSources.filter((s:any)=>!shown.has(s.ref)).every((s:any,)=>{const d=describeSource(s,allSources.indexOf(s));return prepared.omitted_ranges.some((r:any)=>r.family===d.family&&(r.refs?.includes(s.ref)||d.sequence!==null&&r.start_sequence<=d.sequence&&d.sequence<=r.end_sequence));});
  assert(covered);
  // Step list: every step is listed or inside a named sequence range; the four design counter-example steps are listed.
  const listed=new Set(prepared.step_list.lines.map((l:string)=>Number(l.split('|')[0])));
  const inRange=(q:number)=>prepared.step_list.omitted_sequences.some((r:any)=>r.start_sequence<=q&&q<=r.end_sequence);
  for(let q=1;q<=rows.length;q++)assert(listed.has(q)||inRange(q),'step '+q);
  if(e.run_id.includes('-a-'))for(const q of [55,56,73,74])assert(listed.has(q),'listed '+q);
  assert(prepared.step_list.bytes<=48*1024);
  const rangeSummary={step_list:{lines:prepared.step_list.lines.length,bytes:prepared.step_list.bytes,omitted_sequences:prepared.step_list.omitted_sequences.length},excerpt_bytes:Buffer.byteLength(JSON.stringify(prepared.sources)),excerpt_steps:prepared.sources.filter((x:any)=>x.sequence!==null).length,families:famMembers.size,step_count_distribution:sizeDist.sort((a,b)=>b-a),change_points:changePoints,provided:prepared.sources.length,omitted_ranges_total:prepared.omitted_ranges.length,omitted_ranges:prepared.omitted_ranges.map((r:any)=>({tool:String(r.family).split(':')[0],reason:r.reason,count:r.count,whole_family:r.whole_family,start_sequence:r.start_sequence,end_sequence:r.end_sequence}))};
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
  reports.push({run:e.run_id,original_rows:rows.length,original_kind_counts:Object.fromEntries(['tool','decision','handoff'].map(k=>[k,rows.filter(r=>r.kind===k).length])),original_input_hash:e.input_hash,input_bytes:Buffer.byteLength(JSON.stringify(e.input)),projection_version:projection.version,projection_records:view.index.map(x=>x.id),projection_bytes:Buffer.byteLength(projection.text),projection_gaps:view.gaps,prompt_source_refs:prepared.sources.map(s=>s.ref),prompt_omitted:prepared.coverage.omitted_refs.length,source_range:fresh.input.source_range,source_contract:rangeSummary,result:{outcome:prepared.result.outcome,completion:prepared.result.completion,verifications:prepared.result.verifications.map((v:any)=>({judgment:v.judgment}))},snapshot:{total:fixed.records.length,original_rows_sha256:digest(fixed.records.slice(0,rows.length)),size:bytes.length,sha256:index.sha256},retrieval_signal_refs:signals.signals.map(s=>s.ref),semantic_relevance:'not asserted'});
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
