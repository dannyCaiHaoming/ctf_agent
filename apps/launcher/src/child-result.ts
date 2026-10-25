/** Background execution facts only: never persist text, reasoning or error payloads. */
export interface ChildSource {
  status: 'unknown' | 'associated' | 'conflict'; userMessageID: string | null;
  observedAt: number | null; reason: string;
}
export interface ChildResult {
  userMessageID: string | null; assistantMessageID: string | null;
  finish: string | null; completed: boolean; textChars: number; hasError: boolean;
  completeness: 'complete' | 'incomplete' | 'unknown'; reason: string; observedAt: number;
}
export type ChildMessage = { info: { id?: string; sessionID?: string; role: string; parentID?: string; finish?: string; error?: unknown; time?: { created?: number; completed?: number } }; parts?: Array<{ type: string; text?: string }> };
export const unknownChildResult = (source: ChildSource, reason: string): ChildResult => ({userMessageID:source.userMessageID,assistantMessageID:null,finish:null,completed:false,textChars:0,hasError:false,completeness:'unknown',reason,observedAt:Date.now()});
export function classifyChildResult(messages: readonly ChildMessage[], childID: string, source: ChildSource): ChildResult {
  const result = unknownChildResult(source, 'missing_user');
  if (source.status !== 'associated' || !source.userMessageID) return unknownChildResult(source, source.status === 'conflict' ? 'source_conflict' : 'missing_source');
  // Only project fields used by this decision; duplicates must agree, never last-write-wins.
  const projection = (m: ChildMessage) => ({id:m.info.id??null,sessionID:m.info.sessionID??null,role:m.info.role,parentID:m.info.parentID??null,finish:m.info.finish??null,completed:m.info.time?.completed??null,hasError:!!m.info.error,text:(m.parts??[]).filter(p=>p.type==='text').map(p=>p.text??'').join('')});
  const relevant = messages.filter(m=>m.info.id===source.userMessageID || m.info.role==='assistant'&&m.info.parentID===source.userMessageID);
  const selectedIDs = new Set(relevant.map(m=>m.info.id));
  const unique = new Map<string, ReturnType<typeof projection>>();
  for (const m of messages.filter(m=>selectedIDs.has(m.info.id))) {
    const p=projection(m);
    if (!p.id) return {...result,reason:'message_identity'};
    const prior=unique.get(p.id);
    if(prior && JSON.stringify(prior)!==JSON.stringify(p)) return {...result,reason:'message_conflict'};
    unique.set(p.id,p);
  }
  if([...unique.values()].some(m=>m.sessionID!==null && m.sessionID!==childID))return {...result,reason:'message_identity'};
  const user=unique.get(source.userMessageID);
  if(!user || user.role!=='user') return result;
  const assistants=[...unique.values()].filter(m=>m.role==='assistant'&&m.parentID===source.userMessageID);
  if(assistants.length!==1) return {...result,reason:assistants.length?'multiple_assistants':'missing_assistant'};
  const assistant=assistants[0]!;
  result.assistantMessageID=assistant.id;result.finish=assistant.finish;
  result.completed=typeof assistant.completed==='number'&&Number.isFinite(assistant.completed);
  result.textChars=assistant.text.length;result.hasError=assistant.hasError;
  if(result.hasError){result.completeness='incomplete';result.reason='error';}
  else if(!result.completed)result.reason='not_completed';
  else if(result.finish==='length'){result.completeness='incomplete';result.reason='length';}
  else if(result.finish==='stop'){result.completeness=assistant.text.trim()?'complete':'incomplete';result.reason=assistant.text.trim()?'stop':'missing_text';}
  else result.reason='unknown_finish';
  return result;
}
