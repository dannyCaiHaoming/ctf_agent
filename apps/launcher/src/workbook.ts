/**
 * Challenge workbook (team-decision design §6.1): a mechanical fold of slotted decisions in the append-only
 * investigation record, never a second editable store. The host neither ranks nor selects entries by content:
 * caps choose which entries keep full text, pressure compresses before it drops, and every short row and omission is named.
 */
import {WORKBOOK_SLOTS,type WorkbookSlot} from './experience-store.js';

export const SLOT_CAPS:Record<WorkbookSlot,number>={facts:20,hypotheses:8,refuted:20,questions:8,candidate:3};
/** Statuses that keep an entry active (it can still be superseded) but out of the presented view. */
const CLOSED_STATUS=new Set(['answered','dropped','withdrawn']);
export type WorkbookRole='recon'|'domain-solver'|'engineer';
const VIEWS:Record<WorkbookRole,{slots:readonly WorkbookSlot[];host:readonly ('goal'|'candidate_host')[];maxChars:number}>={
  'domain-solver':{slots:WORKBOOK_SLOTS,host:['goal','candidate_host'],maxChars:12000},
  recon:{slots:['facts','hypotheses','refuted','questions'],host:['goal'],maxChars:12000},
  engineer:{slots:['candidate'],host:['candidate_host'],maxChars:4000},
};
/** The published-artifact catalog is not a workbook part: the same context block already carries it, uncapped and delta-by-ref, as `state.publications`. */
export interface WorkbookHost {
  goal:{challenge:string;materials:string[];submission:unknown};
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

/**
 * Omission rule (team-decision design §6.1, 2026-11-19): compress to short rows before dropping anything, and never drop
 * a protected entry (proposed candidate, open hypothesis, open question) unless even short rows cannot fit. Decided by
 * slot, status, author role, sequence and serialized length only; the host never reads the text to rank entries.
 */
export const SHORT_TEXT_CHARS=80;
export function isProtectedEntry(e:{slot:WorkbookSlot;status?:string}):boolean {
  if(e.slot==='candidate')return e.status===undefined||e.status==='proposed';
  if(e.slot==='hypotheses'||e.slot==='questions')return e.status===undefined||e.status==='open';
  return false;
}
const factsOrRefuted=(slot:WorkbookSlot)=>slot==='facts'||slot==='refuted';
/** Compression groups, in order: facts/refuted, other hypotheses/questions, protected entries (candidates fall in the last). */
const PRESSURE_GROUPS:((e:{slot:WorkbookSlot;status?:string})=>boolean)[]=[
  e=>factsOrRefuted(e.slot),
  e=>(e.slot==='hypotheses'||e.slot==='questions')&&!isProtectedEntry(e),
  isProtectedEntry,
];
/** Short row of a role view: identity, status, an 80-character text prefix and counts; expand it with recon.read by id. */
function shortRow(e:WorkbookEntry) {
  return {id:e.id,slot:e.slot,role:e.role,...(e.status===undefined?{}:{status:e.status}),
    text:Array.from(e.text.replace(/[\r\n\u2028\u2029]/g,'')).slice(0,SHORT_TEXT_CHARS).join('')+'…',truncated:true as const,
    evidence_refs_count:e.evidence_refs.length,...(e.slot==='refuted'&&e.scope!==undefined?{scope_truncated:true as const}:{})};
}
type Omission='slot_cap'|'total_cap';
interface Pressured {short:boolean;slot:WorkbookSlot;status?:string;id:number;sequence:number}
/**
 * Shared total-cap pass: compress groups oldest first, then drop short rows in the same group order. Ids of protected
 * entries that had to be dropped (capacity shortfall) are appended to `lost`. `between` runs once after compression and
 * before any drop (the Coordinator collapses older challenges there).
 */
function relieve<T extends Pressured>(rows:()=>T[],size:()=>number,cap:number,compress:(r:T)=>void,drop:(r:T)=>void,lost:number[],between?:()=>void) {
  for(const dropping of [false,true]) {
    if(dropping)between?.();
    const ordered=rows().sort((a,b)=>a.sequence-b.sequence);
    for(const inGroup of PRESSURE_GROUPS)for(const r of ordered) {
      if(size()<=cap)return;
      if(r.short!==dropping||!inGroup(r))continue;
      // A protected id is recorded before the rebuild so the shortfall list counts toward the cap it is measured against.
      if(dropping){if(isProtectedEntry(r))lost.push(r.id);drop(r);}else compress(r);
    }
  }
}

/** Role view: per-slot caps choose how many newest entries keep full text; older ones and total-cap pressure become short rows. */
export function workbookView(rows:any[],role:WorkbookRole,host:WorkbookHost) {
  const view=VIEWS[role],active=activeEntries(rows).filter(e=>view.slots.includes(e.slot)&&!(e.status&&CLOSED_STATUS.has(e.status)));
  const omitted=new Map<number,Omission>(),lost:number[]=[];
  type Row=Pressured&{e:WorkbookEntry};
  const shown=new Map<WorkbookSlot,Row[]>();
  for(const slot of view.slots) {
    const all=active.filter(e=>e.slot===slot).sort((a,b)=>a.sequence-b.sequence),full=all.length-SLOT_CAPS[slot];
    shown.set(slot,all.map((e,i)=>({e,short:i<full,slot:e.slot,...(e.status===undefined?{}:{status:e.status}),id:e.id,sequence:e.sequence})));
  }
  const hostPart=Object.fromEntries(view.host.map(k=>[k,host[k]]));
  const ids=(short:boolean)=>[...shown.values()].flat().filter(r=>r.short===short).map(r=>r.id).sort((a,b)=>a-b);
  const build=()=>({
    slots:Object.fromEntries(view.slots.map(s=>[s,shown.get(s)!.map(r=>r.short?shortRow(r.e):present(r.e))])),
    ...hostPart,
    coverage:{
      per_slot:Object.fromEntries(view.slots.map(s=>[s,{active:active.filter(e=>e.slot===s).length,presented:shown.get(s)!.length}])),
      omitted_ids:[...omitted.keys()].sort((a,b)=>a-b),omitted_reasons:Object.fromEntries([...omitted].map(([id,r])=>[id,r])),
      max_chars:view.maxChars,complete:omitted.size===0,
      full_ids:ids(false),short_ids:ids(true),
      ...(lost.length?{capacity_shortfall:true as const,protected_omitted_ids:[...lost].sort((a,b)=>a-b)}:{}),
    },
    guidance:'Current state of this challenge as written by Recon/Solver, not tool facts. Entries marked truncated are short rows: expand them with recon.read by id. Open hypotheses, open questions and proposed candidates are never omitted for space, at most shortened. Supersede your own role\'s entry to update it; read omitted ids with recon.read. Published artifacts are listed once, in state.publications of this context. Later context blocks carry workbook changes by entry id: upserted entries replace or add (each names its slot), removed ids leave the view, and only changed parts (goal, candidate_host, coverage) are repeated.',
  });
  let result=build();
  const size=()=>JSON.stringify(result).length;
  relieve(()=>[...shown.values()].flat(),size,view.maxChars,
    r=>{r.short=true;result=build();},
    r=>{shown.set(r.slot,shown.get(r.slot)!.filter(x=>x!==r));omitted.set(r.id,'total_cap');result=build();},lost);
  const included=[...shown.values()].flat().map(r=>r.id).sort((a,b)=>a-b);
  return {view:result,included_ids:included,omitted_ids:result.coverage.omitted_ids,short_ids:result.coverage.short_ids,
    ...(lost.length?{capacity_shortfall:true as const}:{}),chars:JSON.stringify(result).length};
}

/** Coordinator view (team-decision design §6.1): restricted fields, one-line facts, no candidate text, cleaned again at presentation. */
export const COORDINATOR_MAX_CHARS=8000,COORDINATOR_LINE=120;
/** Slots whose evidence refs the Coordinator sees next to the text: the support behind a fact, a refuted route or a hypothesis travels with it. */
const REF_SLOTS=new Set<WorkbookSlot>(['facts','refuted','hypotheses']);
export interface CoordinatorChallenge {
  id:string;rows:any[];
  host:{submission:unknown;packages:string[];completions:unknown[];executions:Record<string,{total:number;running:number}>};
}
type CoordinatorEntry={id:number;sequence:number;slot:WorkbookSlot;role:string;status?:string;text?:string;evidence_refs?:string[]};
/** Coordinator short row: id, author role and status (the slot is the list it sits in); hypotheses and candidates keep their cleaned evidence refs. */
const coordinatorShort=(e:CoordinatorEntry)=>({id:e.id,role:e.role,...(e.status===undefined?{}:{status:e.status}),
  ...((e.slot==='hypotheses'||e.slot==='candidate')&&e.evidence_refs!==undefined?{evidence_refs:e.evidence_refs}:{})});
export function coordinatorView(challenges:CoordinatorChallenge[],remainingMin:number|null,clean:(text:string)=>string,maxChars=COORDINATOR_MAX_CHARS) {
  const failed:Record<number,'assembly_failed'>={},truncated:number[]=[],omitted=new Map<number,Omission>(),lost:number[]=[];
  type Row=Pressured&{e:CoordinatorEntry};
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
        entries.push({...base,...(e.status?{status:e.status}:{}),text,...(REF_SLOTS.has(e.slot)?{evidence_refs:e.evidence_refs.map(clean)}:{})});
      }catch{failed[e.id]='assembly_failed';}
    }
    const shown=new Map<WorkbookSlot,Row[]>();
    for(const slot of WORKBOOK_SLOTS) {
      const all=entries.filter(e=>e.slot===slot).sort((a,b)=>a.sequence-b.sequence),full=all.length-SLOT_CAPS[slot];
      shown.set(slot,all.map((e,i)=>({e,short:i<full,slot:e.slot,...(e.status===undefined?{}:{status:e.status}),id:e.id,sequence:e.sequence})));
    }
    const updated=Math.max(0,...c.rows.map(r=>Number(r.updated_at??r.created_at??0)));
    return {id:c.id,updated,shown,host:c.host,collapsed:false};
  });
  const ids=(short:boolean)=>sections.filter(s=>!s.collapsed).flatMap(s=>[...s.shown.values()].flat()).filter(r=>r.short===short).map(r=>r.id).sort((a,b)=>a-b);
  const build=()=>({
    remaining_min:remainingMin,
    challenges:sections.map(s=>s.collapsed
      ?{challenge:s.id,collapsed:true,active:Object.fromEntries(WORKBOOK_SLOTS.map(k=>[k,s.shown.get(k)!.length]))}
      :{challenge:s.id,slots:Object.fromEntries(WORKBOOK_SLOTS.map(k=>[k,s.shown.get(k)!.map(r=>{if(r.short)return coordinatorShort(r.e);const {sequence:_q,slot:_s,...e}=r.e;return e;})])),...s.host}),
    coverage:{failed_ids:Object.keys(failed).map(Number).sort((a,b)=>a-b),failed_reasons:failed,truncated_ids:[...truncated].sort((a,b)=>a-b),
      omitted_ids:[...omitted.keys()].sort((a,b)=>a-b),omitted_reasons:Object.fromEntries(omitted),collapsed:sections.filter(s=>s.collapsed).map(s=>s.id),max_chars:maxChars,
      full_ids:ids(false),short_ids:ids(true),
      ...(lost.length?{capacity_shortfall:true as const,protected_omitted_ids:[...lost].sort((a,b)=>a-b)}:{})},
    guidance:'Workbook entries written by Recon/Solver/Coordinator, cleaned and restricted for coordination; not tool facts. Short rows carry only id, slot, author role and status; open hypotheses, open questions and proposed candidates are never omitted for space, at most shortened. Write or close questions with recon.note (challenge, slot=questions, supersedes). Later context blocks carry changes by entry id: upserted entries (with challenge and slot) replace or add, removed ids leave the view, changed challenge headers (host facts or collapsed state) replace the header, and remaining_min/coverage are repeated only when they change.',
  });
  let result=build();
  const size=()=>JSON.stringify(result).length;
  // Over the cap: compress every open challenge oldest first, then collapse the least recently updated challenges
  // (never the most recent one), then drop short rows of what remains open; never by content.
  relieve(()=>sections.filter(s=>!s.collapsed).flatMap(s=>[...s.shown.values()].flat()),size,maxChars,
    r=>{r.short=true;result=build();},
    r=>{const s=sections.find(x=>!x.collapsed&&x.shown.get(r.slot)!.includes(r))!;s.shown.set(r.slot,s.shown.get(r.slot)!.filter(x=>x!==r));omitted.set(r.id,'total_cap');result=build();},lost,
    ()=>{for(const s of [...sections].sort((a,b)=>a.updated-b.updated).slice(0,-1)){if(size()<=maxChars)break;s.collapsed=true;result=build();}});
  const included=sections.filter(s=>!s.collapsed).flatMap(s=>[...s.shown.values()].flat().map(r=>r.id)).sort((a,b)=>a-b);
  return {view:result,included_ids:included,short_ids:result.coverage.short_ids,...(lost.length?{capacity_shortfall:true as const}:{}),chars:JSON.stringify(result).length};
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

/** Coordinator view base: entries keyed by id (with challenge and slot), each challenge header, and the top-level parts. */
export function coordinatorBase(view:Record<string,any>,hash:(v:unknown)=>string):WorkbookBase {
  const entries=new Map<number,string>(),parts:Record<string,string>={};
  for(const c of view.challenges??[]) {
    const {slots,...header}=c;parts[`challenge:${c.challenge}`]=hash(header);
    for(const [slot,list] of Object.entries(slots??{}) as [string,any[]][])for(const e of list)entries.set(Number(e.id),hash({challenge:c.challenge,slot,...e}));
  }
  for(const k of ['remaining_min','coverage'])parts[k]=hash(view[k]);
  return {hash:hash(view),entries,parts};
}
/**
 * Coordinator delta: upserted entries (each names challenge and slot), removed ids, changed challenge headers
 * (host facts or collapsed state), removed challenges, and remaining_min/coverage when they changed.
 */
export function coordinatorDelta(view:Record<string,any>,current:WorkbookBase,base:WorkbookBase) {
  if(current.hash===base.hash)return null;
  const upserted:any[]=[];
  for(const c of view.challenges??[])for(const [slot,list] of Object.entries(c.slots??{}) as [string,any[]][])
    for(const e of list)if(base.entries.get(Number(e.id))!==current.entries.get(Number(e.id)))upserted.push({challenge:c.challenge,slot,...e});
  const removed=[...base.entries.keys()].filter(id=>!current.entries.has(id)).sort((a,b)=>a-b);
  const headers=(view.challenges??[]).filter((c:any)=>base.parts[`challenge:${c.challenge}`]!==current.parts[`challenge:${c.challenge}`]).map(({slots:_s,...h}:any)=>h);
  const removedChallenges=Object.keys(base.parts).filter(k=>k.startsWith('challenge:')&&!(k in current.parts)).map(k=>k.slice('challenge:'.length));
  const top=Object.fromEntries(['remaining_min','coverage'].filter(k=>base.parts[k]!==current.parts[k]).map(k=>[k,view[k]]));
  return {mode:'entries',upserted,removed,...(headers.length?{challenges:headers}:{}),...(removedChallenges.length?{removed_challenges:removedChallenges}:{}),...top};
}
