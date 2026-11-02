import {createHash} from 'node:crypto';
import type {ExperienceStore} from './experience-store.js';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=(v:any)=>typeof v==='string'?JSON.parse(v):v;
/** Fixed mechanical rule: the latest terminal steps of any kind, never chosen by content. */
export const RECENT_STEPS=6;
export const INDEX_PAGE=200;
/** Compact navigation entry derived from the store's own index (same ids, cursors and fingerprints as recon.read). */
export const indexEntry=(e:any)=>({id:e.id,step_id:e.step_id,sequence:e.sequence,cursor:e.cursor,session_id:e.session_id,kind:e.kind,tool:e.tool??null,status:e.status??null,
  fingerprint:e.fingerprint,args_ref:e.args_ref,result_ref:e.result_ref,result_size:e.result_size,result_complete:e.result_complete,original_complete:e.original_complete});
/**
 * Navigable projection of the append-only investigation record, never a second editable source.
 * Pages are mechanical (sequence order, fixed size); every step stays reachable through the same cursor recon.read accepts.
 */
export function investigationView(store:ExperienceStore,run:string,challenge:string,options:{cursor?:string;limit?:number;tail?:boolean}={}) {
  const limit=options.limit??INDEX_PAGE;if(!Number.isInteger(limit)||limit<1||limit>INDEX_PAGE)throw new Error('invalid investigation limit');
  if(options.cursor!==undefined&&options.tail)throw new Error('cursor and tail are exclusive');
  const complete=store.records(run,challenge,options.cursor?{cursor:options.cursor,limit:1}:{limit:1}),all=complete.index.map(indexEntry);
  let start=0;
  if(options.cursor){const [sequence,id]=options.cursor.split(':').map(Number);start=all.findIndex(e=>e.sequence>sequence!||(e.sequence===sequence&&e.id>id!));if(start<0)start=all.length;}
  else if(options.tail)start=Math.max(0,all.length-limit);
  const entries=all.slice(start,start+limit),remaining=all.length-start-entries.length;
  const terminal=all.filter(e=>e.status!=='running').slice(-RECENT_STEPS);
  // One id per read: the store's page byte budget must not silently drop any selected complete step.
  const recent=terminal.map(e=>store.records(run,challenge,{ids:[e.id]}).records[0]).filter(Boolean).map((r:any)=>({id:Number(r.id),step_id:r.step_id,sequence:Number(r.sequence),cursor:`${r.sequence}:${r.id}`,session_id:r.session_id,kind:r.kind,tool:r.tool??null,status:r.status,
    fingerprint:all.find(e=>e.id===Number(r.id))!.fingerprint,args:r.args_json,args_meta:r.args_meta,result:r.result_json,result_meta:r.result_meta,note:r.note_json,original_complete:r.original_complete}));
  return {fingerprint:complete.fingerprint,index:entries,all,
    coverage:{total:all.length,returned:entries.length,earlier:start,remaining,complete:start===0&&remaining===0,next_cursor:remaining?entries.at(-1)?.cursor??null:null,
      ...(start>0?{earlier_access:'recon.read without cursor (or start_sequence/end_sequence) pages from the first step'}:{})},
    recent,in_flight_ids:all.filter(e=>e.status==='running').map(e=>e.id),
    gaps:[...(!all.some(e=>e.kind==='decision')?['decision not recorded']:[]),...(!all.some(e=>e.kind==='handoff')?['handoff not recorded']:[])],
    interpretation:'Observations and model judgments are distinct; conflicting judgments remain unresolved. A successful tool does not establish a successful method. Same fingerprint means a previously tried input; retrying needs a stated change of premise or evidence.'};
}
/** Only visible statement, material metadata and explicit observations/judgments produce keywords. */
export function retrievalSignals(store:ExperienceStore,statement:string,materials:string[],rows:any[]) {
  const decisions=rows.filter(r=>r.kind==='decision'||r.kind==='handoff').slice(-8).reverse().map(r=>{
    const note=parse(r.note_json)??{};
    return {ref:`recon:${r.id}`,group:'decision',text:JSON.stringify([note.assessment,note.next_action,note.next_reason,note.observation])};
  });
  const observations=rows.filter(r=>r.kind==='tool'&&['workspace.read','http.request'].includes(r.tool)).slice(-4).reverse().map(r=>({ref:`recon:${r.id}`,group:'observation',text:JSON.stringify(parse(r.result_json))}));
  const inputs=[...decisions,...observations,{ref:'material:statement.md',group:'material',text:statement},...materials.slice(0,16).map(name=>({ref:`material:${name}`,group:'material',text:name}))];
  // Do not mine arbitrary job stdout, URLs, encoded bodies or title/answer guesses.
  const stop=new Set(['the','and','this','that','with','from','for','are','not','null','true','false','content','data','encoding','base64','utf8','json','redacted','flag','http','https','result','path','source','statement','observation','assessment','next_action','next_reason','evidence_refs','related_ids','kind']);
  const signals=inputs.map(i=>({ref:i.ref,group:i.group,words:[...new Set((String(store.clean(i.text)).replace(/https?:\/\/\S+/g,' ').toLowerCase().match(/[a-z][a-z0-9_-]{2,31}|[\u4e00-\u9fff]{2,8}/g)??[]).filter(w=>!stop.has(w)))].slice(0,24)})).filter(i=>i.words.length);
  // Round-robin across source groups: fixed materials cannot starve fresh judgments or observations.
  const groups=['decision','observation','material'].map(group=>[...new Set(signals.filter(s=>s.group===group).flatMap(s=>s.words))]);
  const words:string[]=[],seen=new Set<string>();let chars=0;
  for(let i=0;i<Math.max(...groups.map(g=>g.length));i++)for(const group of groups){
    const word=group[i];if(!word||seen.has(word))continue;seen.add(word);
    const size=word.length+(words.length?1:0);if(words.length>=50||chars+size>500)continue;
    words.push(word);chars+=size;
  }
  return {signals,query:words.join(' ')};
}
