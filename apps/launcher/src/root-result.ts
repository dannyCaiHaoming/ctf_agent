/** Host-only metadata projection. Never retains message text or reasoning. */
export interface RootResult {
  userMessageID: string | null; assistantMessageID: string | null;
  userCreated: number | null; assistantCreated: number | null; assistantCompleted: number | null;
  finish: string | null; completed: boolean; textChars: number; hasError: boolean;
  completeness: 'complete' | 'incomplete' | 'unknown'; reason: string;
  evidence: string | null; observedAt: number | null; exportedSourceMatches: boolean | null;
}
type RootMessage = { info: { id?: string; role: string; parentID?: string; finish?: string; error?: unknown; time?: { created?: number; completed?: number } }; parts?: Array<{ type: string; text?: string }> };
const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function classifyRootResult(messages: readonly RootMessage[], evidence: string | null = null): RootResult {
  const result: RootResult = { userMessageID: null, assistantMessageID: null, userCreated: null, assistantCreated: null,
    assistantCompleted: null, finish: null, completed: false, textChars: 0, hasError: false,
    completeness: 'unknown', reason: 'missing_user', observedAt: null, exportedSourceMatches: null, evidence };
  const latest = (items: readonly RootMessage[]): RootMessage | undefined => {
    if (!items.length || items.some(m => !m.info.id || !timestamp(m.info.time?.created))) return;
    const max = Math.max(...items.map(m => m.info.time!.created!));
    const matches = items.filter(m => m.info.time!.created === max);
    return matches.length === 1 && items.filter(m => m.info.id === matches[0]!.info.id).length === 1 ? matches[0] : undefined;
  };
  const user = latest(messages.filter(m => m.info.role === 'user'));
  if (!user) return result;
  result.userMessageID = user.info.id!; result.userCreated = user.info.time!.created!;
  result.reason = 'unresolved_assistant';
  // A later unassociated assistant must not be hidden by an older associated reply.
  const assistants = messages.filter(m => m.info.role === 'assistant' &&
    (!timestamp(m.info.time?.created) || m.info.time!.created! >= result.userCreated!));
  const assistant = latest(assistants);
  if (!assistant || assistant.info.parentID !== user.info.id || assistant.info.time!.created! < result.userCreated) return result;
  result.assistantMessageID = assistant.info.id!; result.assistantCreated = assistant.info.time!.created!;
  result.assistantCompleted = timestamp(assistant.info.time?.completed) ? assistant.info.time!.completed! : null;
  result.completed = result.assistantCompleted !== null;
  result.finish = typeof assistant.info.finish === 'string' ? assistant.info.finish : null;
  const text = (assistant.parts ?? []).filter(p => p.type === 'text').map(p => p.text ?? '').join('');
  result.textChars = text.length; result.hasError = !!assistant.info.error;
  if (result.hasError) { result.reason = 'error'; result.completeness = 'incomplete'; }
  else if (result.finish === 'length') { result.reason = 'length'; result.completeness = 'incomplete'; }
  else if (result.finish === 'tool-calls') { result.reason = 'tool_calls'; result.completeness = 'incomplete'; }
  else if (!result.completed) result.reason = 'not_completed';
  else if (result.finish === 'stop') { result.reason = text.trim() ? 'stop' : 'missing_text'; result.completeness = text.trim() ? 'complete' : 'incomplete'; }
  else result.reason = 'unknown_finish';
  return result;
}
export function canSettleRoot(result: RootResult): boolean {
  return !!result.assistantMessageID && result.completed && result.finish !== 'tool-calls';
}
