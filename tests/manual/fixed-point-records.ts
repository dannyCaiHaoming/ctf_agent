// Offline helpers for fixed-point-harness.mts. Values are observations from the public SDK, never estimates.
export interface UsageMessage {
  info: {
    id: string; sessionID: string; role: string; cost?: unknown;
    tokens?: { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } };
  };
}
export interface UsageRound { round: number; messages: UsageMessage[] }
const source = 'opencode assistant message info';
const fields = ['input', 'output', 'reasoning', 'cache_read', 'cache_write', 'cost'] as const;
type Field = typeof fields[number];
type Value = number | 'unavailable';
const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const values = ({ info }: UsageMessage): Record<Field, unknown> => ({
  input: info.tokens?.input, output: info.tokens?.output, reasoning: info.tokens?.reasoning,
  cache_read: info.tokens?.cache?.read, cache_write: info.tokens?.cache?.write, cost: info.cost
});

function metrics(messages: UsageMessage[]) {
  const observed = messages.map(values);
  const missing_fields = Object.fromEntries(fields.map(f => [f, observed.filter(v => !numeric(v[f])).length])) as Record<Field, number>;
  const sum = (f: Field): Value => {
    const numbers = observed.map(v => v[f]).filter(numeric);
    return numbers.length ? numbers.reduce((a, b) => a + b, 0) : 'unavailable';
  };
  return {
    source, messages_total: messages.length,
    // Denominator is assistant messages only; a partial token report still counts as a report.
    messages_with_tokens: observed.filter(v => fields.some(f => f !== 'cost' && numeric(v[f]))).length,
    messages_missing_fields: observed.filter(v => fields.some(f => !numeric(v[f]))).length,
    missing_fields,
    // Sums cover reported fields only. missing_fields must accompany any interpretation of partial totals.
    tokens: { input: sum('input'), output: sum('output'), reasoning: sum('reasoning'), cache: { read: sum('cache_read'), write: sum('cache_write') } },
    cost: sum('cost')
  };
}
type Metrics = ReturnType<typeof metrics>;
export type Usage = (Metrics & { rounds: Array<Metrics & { round: number }> }) | 'unavailable';

function distinctRounds(rounds: UsageRound[]): UsageRound[] {
  const seen = new Set<string>();
  return rounds.map(({ round, messages }) => ({ round, messages: messages.filter(m => {
    if (m.info.role !== 'assistant') return false;
    const key = JSON.stringify([m.info.sessionID, m.info.id]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }) }));
}

export function summarizeUsage(snapshots: UsageRound[]): { usage: Usage; usage_coverage?: Metrics & { rounds: Array<Metrics & { round: number }> } } {
  const rounds = distinctRounds(snapshots);
  const total = metrics(rounds.flatMap(r => r.messages));
  const details = { ...total, rounds: rounds.map(r => ({ round: r.round, ...metrics(r.messages) })) };
  // Keep coverage even when the literal unavailable is required. Missing data is never turned into zero.
  return total.messages_with_tokens ? { usage: details } : { usage: 'unavailable', usage_coverage: details };
}

// Independent mock assertion against the SDK observations, including the serialized summary's per-round values.
// Deliberately has no dependency on the scripted provider's 10/5 values or OpenCode's adapter conversion rules.
export function usageMatchesMessages(usage: Usage, snapshots: UsageRound[]): boolean {
  if (usage === 'unavailable') return false;
  const rounds = distinctRounds(snapshots);
  const matches = (reported: Metrics, messages: UsageMessage[]) => {
    const raw = messages.map(values);
    const expected = (field: Field): Value => {
      const reported = raw.map(v => v[field]).filter(numeric);
      return reported.length ? reported.reduce((a, b) => a + b, 0) : 'unavailable';
    };
    return reported.source === source && reported.messages_total === messages.length &&
      reported.messages_with_tokens === raw.filter(v => fields.some(f => f !== 'cost' && numeric(v[f]))).length &&
      reported.messages_missing_fields === raw.filter(v => fields.some(f => !numeric(v[f]))).length &&
      fields.every(f => reported.missing_fields[f] === raw.filter(v => !numeric(v[f])).length) &&
      reported.tokens.input === expected('input') && reported.tokens.output === expected('output') &&
      reported.tokens.reasoning === expected('reasoning') && reported.tokens.cache.read === expected('cache_read') &&
      reported.tokens.cache.write === expected('cache_write') && reported.cost === expected('cost');
  };
  return rounds.length === usage.rounds.length && rounds.some(r => r.messages.length > 0) &&
    matches(usage, rounds.flatMap(r => r.messages)) && rounds.every((r, i) => usage.rounds[i]?.round === r.round && matches(usage.rounds[i]!, r.messages));
}

export function reviewSkeleton(caseID: string, variant: string, expected: { next_step: string; must_not: string[] }) {
  return { case: caseID, variant, expected_next_step: expected.next_step, must_not: expected.must_not,
    verdict: null, next_step: null, must_not_observed: null, reason: null, reviewer: null,
    ...(caseID === 'handback-decoy' ? { decoy_unchecked: null } : {}) };
}

interface HandbackEvent {
  kind: string;
  round?: number;
  t_ms: number;
  tool?: string;
  status?: 'proposed' | 'withdrawn';
  reminder_shown?: boolean;
  started?: boolean;
  active_candidates?: number;
}

export function summarizeCandidateHandback(events: HandbackEvent[], roundCount: number) {
  return Array.from({ length: roundCount }, (_, round) => {
    const endIndex = events.findIndex(e => e.round === round && e.kind === 'round.handback');
    const end = events[endIndex];
    const firstIndex = events.findIndex((e, i) => (!end || i < endIndex) && e.round === round && e.kind === 'candidate.write');
    const first = events[firstIndex];
    const after = first && end ? events.slice(firstIndex + 1, endIndex).filter(e => e.round === round) : null;
    const tools = new Map<string, number>();
    for (const event of after ?? []) {
      if (event.kind === 'tool.call' && event.tool) tools.set(event.tool, (tools.get(event.tool) ?? 0) + 1);
    }
    const writes = first ? events.slice(firstIndex, end ? endIndex : undefined)
      .filter(e => e.round === round && e.kind === 'candidate.write') : null;
    return {
      round,
      first_write_t_ms: first?.t_ms ?? null,
      first_write_event_seq: first ? firstIndex + 1 : null, // One-based index into transcript.events.
      model_calls_after: after?.filter(e => e.kind === 'model.call').length ?? null,
      tool_calls_after: after ? Object.fromEntries(tools) : null,
      jobs_after: after?.filter(e => e.kind === 'job.start' && e.started).length ?? null,
      elapsed_ms: first && end ? end.t_ms - first.t_ms : null,
      statuses: writes?.map(e => e.status) ?? null,
      active_candidates_at_end: first ? end?.active_candidates ?? null : null,
      reminder_shown: writes?.some(e => e.reminder_shown) ?? null
    };
  });
}
