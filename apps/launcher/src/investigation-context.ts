import {createHash} from 'node:crypto';
import type {ExperienceStore} from './experience-store.js';
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=(v:any)=>typeof v==='string'?JSON.parse(v):v;
const stepKey=(row:any):[number,number]=>[Number(row.sequence??row.id??0),Number(row.id??0)];
const compareSteps=(left:any,right:any)=> {
  const [leftSequence,leftId]=stepKey(left),[rightSequence,rightId]=stepKey(right);
  return leftSequence-rightSequence||leftId-rightId;
};
const cursorFor=(row:any)=>`${stepKey(row)[0]}:${stepKey(row)[1]}`;
const afterCursor=(row:any,cursor:string|undefined)=> {
  if(!cursor)return true;
  const match=/^(\d+):(\d+)$/.exec(cursor);if(!match)throw new Error('invalid investigation cursor');
  const sequence=Number(match[1]),id=Number(match[2]),[rowSequence,rowId]=stepKey(row);
  return rowSequence>sequence||(rowSequence===sequence&&rowId>id);
};
/** Navigable projection of the append-only investigation record, never a second editable source. */
export function investigationView(rows:any[], options:{cursor?:string;limit?:number}={}) {
  const limit=options.limit??20;if(!Number.isInteger(limit)||limit<1||limit>40)throw new Error('invalid investigation limit');
  const ordered=[...rows].sort(compareSteps),remainingRows=ordered.filter(row=>afterCursor(row,options.cursor)),index=remainingRows.slice(0,limit),remaining=remainingRows.length-index.length;
  const selected:any[]=[],seen=new Set<number>();let bytes=0;
  const decisions=rows.filter(r=>r.kind==='decision'||r.kind==='handoff');
  for(const row of [...decisions.slice(-8).reverse(),...rows.filter(r=>r.status==='running').slice(-8),...rows.slice(-16).reverse()]) {
    if(seen.has(row.id))continue;
    const text=JSON.stringify(row),value=text.length>3000?{id:row.id,kind:row.kind,status:row.status,updated_at:row.updated_at,preview:text.slice(0,2500),truncated:true}:row;
    const n=Buffer.byteLength(JSON.stringify(value));if(bytes+n>18000)continue;
    bytes+=n;seen.add(row.id);selected.push(value);
  }
  return {version:digest(rows),records:selected,index:index.map(row=>({id:row.id,sequence:stepKey(row)[0],kind:row.kind,tool:row.tool??null,status:row.status??null})),
    coverage:{total:ordered.length,returned:index.length,remaining,complete:remaining===0,next_cursor:remaining?cursorFor(index.at(-1)!):null,included_ids:index.map(row=>row.id)},
    in_flight_ids:rows.filter(r=>r.status==='running').slice(0,32).map(r=>r.id),in_flight_total:rows.filter(r=>r.status==='running').length,gaps:[...(!rows.some(r=>r.kind==='decision')?['decision not recorded']:[]),...(!rows.some(r=>r.kind==='handoff')?['handoff not recorded']:[])],
    interpretation:'Observations and model judgments are distinct; conflicting judgments remain unresolved. A successful tool does not establish a successful method.'};
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
