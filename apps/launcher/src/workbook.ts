/**
 * Challenge workbook (team-decision design §6.1): a mechanical fold of slotted decisions in the append-only
 * investigation record, never a second editable store. The host neither ranks nor selects entries by content:
 * caps keep the newest entries by sequence and every omission is named.
 */
import {WORKBOOK_SLOTS,type WorkbookSlot} from './experience-store.js';

export const SLOT_CAPS:Record<WorkbookSlot,number>={facts:20,hypotheses:8,refuted:20,questions:8,candidate:3};
export const MATERIALS_CAP=12;
/** Statuses that keep an entry active (it can still be superseded) but out of the presented view. */
const CLOSED_STATUS=new Set(['answered','dropped','withdrawn']);
export type WorkbookRole='recon'|'domain-solver'|'engineer';
const VIEWS:Record<WorkbookRole,{slots:readonly WorkbookSlot[];host:readonly ('goal'|'materials'|'candidate_host')[];maxChars:number}>={
  'domain-solver':{slots:WORKBOOK_SLOTS,host:['goal','materials','candidate_host'],maxChars:12000},
  recon:{slots:['facts','hypotheses','refuted','questions'],host:['goal','materials'],maxChars:12000},
  engineer:{slots:['candidate'],host:['materials','candidate_host'],maxChars:4000},
};
export interface WorkbookHost {
  goal:{challenge:string;materials:string[];submission:unknown};
  materials:Array<{ref:string;kind:string;size:number}>;
  candidate_host:{packages:string[];completions:unknown[]};
}
export interface WorkbookEntry {id:number;sequence:number;slot:WorkbookSlot;role:string;status?:string;text:string;scope?:string;evidence_refs:string[];related_ids:number[]}

/** Active entries: slotted decisions not superseded by any later slotted decision of the same challenge. */
export function activeEntries(rows:any[]):WorkbookEntry[] {
  const notes=rows.filter(r=>r.kind==='decision'&&r.note_json&&typeof r.note_json.slot==='string'&&(WORKBOOK_SLOTS as readonly string[]).includes(r.note_json.slot));
  const superseded=new Set(notes.map(r=>r.note_json.supersedes).filter((v:unknown)=>typeof v==='number'));
  return notes.filter(r=>!superseded.has(Number(r.id))).map(r=>{const n=r.note_json;return {
    id:Number(r.id),sequence:Number(r.sequence),slot:n.slot,role:r.role??'recon',...(typeof n.status==='string'?{status:n.status}:{}),text:String(n.text??''),
    ...(typeof n.scope==='string'?{scope:n.scope}:{}),evidence_refs:Array.isArray(n.evidence_refs)?n.evidence_refs:[],related_ids:Array.isArray(n.related_ids)?n.related_ids:[]};});
}

const present=({sequence:_s,...e}:WorkbookEntry)=>e;

/** Role view with per-slot caps (newest by sequence) and a total character cap (oldest presented entries move to omitted first). */
export function workbookView(rows:any[],role:WorkbookRole,host:WorkbookHost) {
  const view=VIEWS[role],active=activeEntries(rows).filter(e=>view.slots.includes(e.slot)&&!(e.status&&CLOSED_STATUS.has(e.status)));
  const omitted=new Map<number,'slot_cap'|'total_cap'>();
  const shown=new Map<WorkbookSlot,WorkbookEntry[]>();
  for(const slot of view.slots) {
    const all=active.filter(e=>e.slot===slot).sort((a,b)=>a.sequence-b.sequence),keep=all.slice(-SLOT_CAPS[slot]);
    for(const e of all.slice(0,all.length-keep.length))omitted.set(e.id,'slot_cap');
    shown.set(slot,keep);
  }
  const hostPart=Object.fromEntries(view.host.map(k=>[k,k==='materials'?host.materials.slice(-MATERIALS_CAP):host[k]]));
  const build=()=>({
    slots:Object.fromEntries(view.slots.map(s=>[s,shown.get(s)!.map(present)])),
    ...hostPart,
    coverage:{
      per_slot:Object.fromEntries(view.slots.map(s=>[s,{active:active.filter(e=>e.slot===s).length,presented:shown.get(s)!.length}])),
      ...(view.host.includes('materials')?{materials:{total:host.materials.length,presented:Math.min(host.materials.length,MATERIALS_CAP)}}:{}),
      omitted_ids:[...omitted.keys()].sort((a,b)=>a-b),omitted_reasons:Object.fromEntries([...omitted].map(([id,r])=>[id,r])),
      max_chars:view.maxChars,complete:omitted.size===0&&(!view.host.includes('materials')||host.materials.length<=MATERIALS_CAP),
    },
    guidance:'Current state of this challenge as written by Recon/Solver, not tool facts. Supersede your own role\'s entry to update it; read omitted ids with recon.read. Later context blocks carry workbook changes by entry id: upserted entries replace or add (each names its slot), removed ids leave the view, and only changed parts (goal, materials, candidate_host, coverage) are repeated.',
  });
  let result=build();
  // Total cap: drop the oldest presented entry (by sequence, any slot) until the view fits; never by content.
  while(JSON.stringify(result).length>view.maxChars) {
    const oldest=[...shown.values()].flat().sort((a,b)=>a.sequence-b.sequence)[0];
    if(!oldest)break;
    shown.set(oldest.slot,shown.get(oldest.slot)!.filter(e=>e.id!==oldest.id));omitted.set(oldest.id,'total_cap');
    result=build();
  }
  const included=[...shown.values()].flat().map(e=>e.id).sort((a,b)=>a-b);
  return {view:result,included_ids:included,omitted_ids:result.coverage.omitted_ids,chars:JSON.stringify(result).length};
}

/** Coordinator view (team-decision design §6.1): restricted fields, one-line facts, no candidate text, cleaned again at presentation. */
export const COORDINATOR_MAX_CHARS=8000,COORDINATOR_LINE=120;
export interface CoordinatorChallenge {
  id:string;rows:any[];
  host:{submission:unknown;packages:string[];completions:unknown[];executions:Record<string,{total:number;running:number}>};
}
type CoordinatorEntry={id:number;sequence:number;slot:WorkbookSlot;role:string;status?:string;text?:string;evidence_refs?:string[]};
export function coordinatorView(challenges:CoordinatorChallenge[],remainingMin:number|null,clean:(text:string)=>string,maxChars=COORDINATOR_MAX_CHARS) {
  const failed:Record<number,'assembly_failed'>={},truncated:number[]=[],omitted=new Map<number,'slot_cap'|'total_cap'>();
  const sections=challenges.map(c=>{
    const entries:CoordinatorEntry[]=[];
    for(const e of activeEntries(c.rows)) {
      if(e.status&&CLOSED_STATUS.has(e.status))continue;
      try {
        const raw=c.rows.find(r=>Number(r.id)===e.id)?.note_json;
        if(typeof raw?.text!=='string')throw new Error('entry text is not a string');
        const base={id:e.id,sequence:e.sequence,slot:e.slot,role:e.role};
        if(e.slot==='candidate'){entries.push({...base,status:e.status,evidence_refs:e.evidence_refs.map(clean)});continue;}
        let text=clean(raw.text);
        if((e.slot==='facts'||e.slot==='refuted')&&text.length>COORDINATOR_LINE){text=text.slice(0,COORDINATOR_LINE-1)+'…';truncated.push(e.id);}
        entries.push({...base,...(e.status?{status:e.status}:{}),text,...(e.slot==='facts'||e.slot==='refuted'?{evidence_refs:e.evidence_refs.map(clean)}:{})});
      }catch{failed[e.id]='assembly_failed';}
    }
    const shown=new Map<WorkbookSlot,CoordinatorEntry[]>();
    for(const slot of WORKBOOK_SLOTS) {
      const all=entries.filter(e=>e.slot===slot).sort((a,b)=>a.sequence-b.sequence),keep=all.slice(-SLOT_CAPS[slot]);
      for(const e of all.slice(0,all.length-keep.length))omitted.set(e.id,'slot_cap');
      shown.set(slot,keep);
    }
    const updated=Math.max(0,...c.rows.map(r=>Number(r.updated_at??r.created_at??0)));
    return {id:c.id,updated,shown,host:c.host,collapsed:false};
  });
  const build=()=>({
    remaining_min:remainingMin,
    challenges:sections.map(s=>s.collapsed
      ?{challenge:s.id,collapsed:true,active:Object.fromEntries(WORKBOOK_SLOTS.map(k=>[k,s.shown.get(k)!.length]))}
      :{challenge:s.id,slots:Object.fromEntries(WORKBOOK_SLOTS.map(k=>[k,s.shown.get(k)!.map(({sequence:_q,slot:_s,...e})=>e)])),...s.host}),
    coverage:{failed_ids:Object.keys(failed).map(Number).sort((a,b)=>a-b),failed_reasons:failed,truncated_ids:[...truncated].sort((a,b)=>a-b),
      omitted_ids:[...omitted.keys()].sort((a,b)=>a-b),omitted_reasons:Object.fromEntries(omitted),collapsed:sections.filter(s=>s.collapsed).map(s=>s.id),max_chars:maxChars},
    guidance:'Workbook entries written by Recon/Solver/Coordinator, cleaned and restricted for coordination; not tool facts. Write or close questions with recon.note (challenge, slot=questions, supersedes).',
  });
  let result=build();
  // Over the cap: collapse the least recently updated challenges first (never the most recent one), then drop the oldest
  // entries of what remains open; never by content.
  for(const s of [...sections].sort((a,b)=>a.updated-b.updated).slice(0,-1)) {
    if(JSON.stringify(result).length<=maxChars)break;
    s.collapsed=true;result=build();
  }
  while(JSON.stringify(result).length>maxChars) {
    const open=sections.filter(s=>!s.collapsed).flatMap(s=>[...s.shown.values()].flat().map(e=>({s,e}))).sort((a,b)=>a.e.sequence-b.e.sequence)[0];
    if(!open)break;
    open.s.shown.set(open.e.slot,open.s.shown.get(open.e.slot)!.filter(x=>x.id!==open.e.id));omitted.set(open.e.id,'total_cap');result=build();
  }
  const included=sections.filter(s=>!s.collapsed).flatMap(s=>[...s.shown.values()].flat().map(e=>e.id)).sort((a,b)=>a-b);
  return {view:result,included_ids:included,chars:JSON.stringify(result).length};
}

/** Per-entry and per-part hashes of a presented role view: the base for entry-level deltas. */
export interface WorkbookBase {hash:string;entries:Map<number,string>;parts:Record<string,string>}
export function workbookBase(view:Record<string,any>,hash:(v:unknown)=>string):WorkbookBase {
  const entries=new Map<number,string>();
  for(const list of Object.values(view.slots??{}) as any[][])for(const e of list)entries.set(Number(e.id),hash(e));
  const parts=Object.fromEntries(Object.keys(view).filter(k=>k!=='slots'&&k!=='guidance').map(k=>[k,hash(view[k])]));
  return {hash:hash(view),entries,parts};
}
/**
 * Entry-level delta against a visible base: changed or new entries (each carries its slot), ids no longer presented,
 * and only the host parts that changed. Applying it to the base view rebuilds the current view.
 */
export function workbookDelta(view:Record<string,any>,current:WorkbookBase,base:WorkbookBase) {
  if(current.hash===base.hash)return null;
  const upserted=(Object.values(view.slots??{}) as any[][]).flat().filter(e=>base.entries.get(Number(e.id))!==current.entries.get(Number(e.id)));
  const removed=[...base.entries.keys()].filter(id=>!current.entries.has(id)).sort((a,b)=>a-b);
  const parts=Object.fromEntries(Object.keys(current.parts).filter(k=>base.parts[k]!==current.parts[k]).map(k=>[k,view[k]]));
  return {mode:'entries',upserted,removed,...parts};
}
