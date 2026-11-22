/**
 * Run-level HTTP accounting (G design §5.6, §4.6): what the managed http.request actually sent to each
 * challenge target. The ledger only records; the control service enforces the limits and reports refused hops
 * here. Counts are per challenge (one authorized origin each):
 *
 * - calls: registered tool calls, calls refused before registration by the concurrency limit, and the settled
 *   result of each registered call (completed, timeout, cancelled, refusal codes). Active calls and unknown
 *   cleanup remain unsettled until the host confirms a final result.
 * - hops: a hop is `started` when the request for an in-scope hop is created (counted even if the connection
 *   then fails, so the count never understates what may have reached the target) and `responded` when its full
 *   response has been read. `unresolved` = started - responded: the outcome at the target is unknown
 *   (connection failure, timeout, cancellation). Out-of-scope or over-limit redirects are never started.
 * - rejected: hops refused by the per-target rate or the per-run total before any request was created.
 * - peaks: the most hops started inside any 1 s and any 60 s window, the basis for choosing rate limits.
 *
 * Memory-only, like the rest of the run state; written to evidence at the end of the run.
 */

export const HTTP_LEDGER_MAX_TIMES = 100_000;

interface Entry {
  origin: string | null;
  registered: number;
  deniedBeforeRegistration: Record<string, number>;
  results: Record<string, number>;
  started: number;
  responded: number;
  rejected: Record<string, number>;
  /** Monotonic start times, capped so a runaway run cannot grow memory without bound. */
  times: number[];
  timesTruncated: boolean;
  firstAt: number | null;
  lastAt: number | null;
}

export interface HttpLedgerChallenge {
  challengeId: string;
  origin: string | null;
  calls: { registered: number; deniedBeforeRegistration: Record<string, number>; results: Record<string, number>; unsettled: number };
  hops: { started: number; responded: number; unresolved: number; rejected: Record<string, number> };
  peaks: { perSecond: number; perMinute: number; basis: 'all_hops' | 'first_hops_only' };
  firstHopAt: string | null;
  lastHopAt: string | null;
}

export interface HttpLimits { perSecond: number; burst: number; maxHopsPerRun: number }

export interface HttpLedgerRecord {
  version: 1;
  limits: HttpLimits | null;
  challenges: HttpLedgerChallenge[];
  totals: { registered: number; hopsStarted: number; hopsResponded: number; hopsUnresolved: number; hopsRejected: number };
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}

function peak(times: readonly number[], windowMs: number): number {
  let best = 0;
  for (let lo = 0, hi = 0; hi < times.length; hi++) {
    while (times[hi]! - times[lo]! >= windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}

export class HttpLedger {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly wallNow: () => number = Date.now,
    private readonly limits: HttpLimits | null = null,
    private readonly monotonicNow: () => number = () => performance.now()
  ) {}

  private entry(challengeId: string, target?: string): Entry {
    let entry = this.entries.get(challengeId);
    if (!entry) {
      entry = { origin: originOf(target), registered: 0, deniedBeforeRegistration: {}, results: {}, started: 0, responded: 0, rejected: {}, times: [], timesTruncated: false, firstAt: null, lastAt: null };
      this.entries.set(challengeId, entry);
    } else if (entry.origin === null && target) entry.origin = originOf(target);
    return entry;
  }

  denied(challengeId: string, reason: string, target?: string): void {
    const counts = this.entry(challengeId, target).deniedBeforeRegistration;
    counts[reason] = (counts[reason] ?? 0) + 1;
  }

  registered(challengeId: string, target?: string): void { this.entry(challengeId, target).registered++; }

  hopStarted(challengeId: string): void {
    const entry = this.entry(challengeId);
    entry.started++;
    const at = this.wallNow();
    entry.firstAt ??= at;
    entry.lastAt = at;
    if (entry.times.length < HTTP_LEDGER_MAX_TIMES) entry.times.push(this.monotonicNow()); else entry.timesTruncated = true;
  }

  hopResponded(challengeId: string): void { this.entry(challengeId).responded++; }

  hopRejected(challengeId: string, reason: string): void {
    const counts = this.entry(challengeId).rejected;
    counts[reason] = (counts[reason] ?? 0) + 1;
  }

  settled(challengeId: string, result: string): void {
    const results = this.entry(challengeId).results;
    results[result] = (results[result] ?? 0) + 1;
  }

  snapshot(): HttpLedgerRecord {
    const challenges = [...this.entries.entries()].map(([challengeId, e]): HttpLedgerChallenge => {
      const settled = Object.values(e.results).reduce((a, b) => a + b, 0);
      return {
        challengeId, origin: e.origin,
        calls: { registered: e.registered, deniedBeforeRegistration: { ...e.deniedBeforeRegistration }, results: { ...e.results }, unsettled: Math.max(0, e.registered - settled) },
        hops: { started: e.started, responded: e.responded, unresolved: Math.max(0, e.started - e.responded), rejected: { ...e.rejected } },
        peaks: { perSecond: peak(e.times, 1000), perMinute: peak(e.times, 60_000), basis: e.timesTruncated ? 'first_hops_only' : 'all_hops' },
        firstHopAt: e.firstAt === null ? null : new Date(e.firstAt).toISOString(),
        lastHopAt: e.lastAt === null ? null : new Date(e.lastAt).toISOString()
      };
    });
    const sum = (f: (c: HttpLedgerChallenge) => number) => challenges.reduce((a, c) => a + f(c), 0);
    return { version: 1, limits: this.limits ? { ...this.limits } : null, challenges,
      totals: { registered: sum(c => c.calls.registered), hopsStarted: sum(c => c.hops.started), hopsResponded: sum(c => c.hops.responded), hopsUnresolved: sum(c => c.hops.unresolved),
        hopsRejected: sum(c => Object.values(c.hops.rejected).reduce((a, b) => a + b, 0)) } };
  }
}
