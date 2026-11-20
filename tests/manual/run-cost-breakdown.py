#!/usr/bin/env python3
"""Offline cost/latency breakdown of finished runs (0 model calls, read-only).

Usage: python3 -I tests/manual/run-cost-breakdown.py <runDir> [<runDir> ...]
A runDir is `<batch>/runs/<runId>` containing `evidence/messages-*.json` and
`evidence/control-audit.json`. Output is JSON with structured counts only:
no message text, tool output, flags or oracle data.

wall_min spans the first assistant call start to the last assistant call
completion. The run's wall-clock start and end are outside this measure.
Only completed calls contribute to latency and interval unions. Token
totals sum reported values, with "unavailable" for fields with no reports.
Context and generation samples require all constituent token fields, and
worker timing statistics pair those samples with their own durations.
"""
import collections, glob, json, os, statistics, sys

MARK = '[CTF investigation context]'
CONTEXT_FIELDS = ('input', 'cache_read', 'cache_write')
GENERATION_FIELDS = ('output', 'reasoning')


def messages(run):
    for f in glob.glob(os.path.join(run, 'evidence', 'messages-*.json')):
        yield from json.load(open(f))


def calls(run):
    out = []
    for m in messages(run):
        i = m['info']
        if i.get('role') != 'assistant':
            continue
        t = i.get('tokens') or {}
        c = t.get('cache') or {}
        start = i['time']['created']
        end = i['time'].get('completed')
        out.append(dict(agent=i.get('agent'), start=start, end=end,
                        input=t.get('input'), cache_read=c.get('read'), cache_write=c.get('write'),
                        output=t.get('output'), reasoning=t.get('reasoning'), finish=i.get('finish')))
    return out


def union_ms(intervals):
    total, cur = 0, None
    for s, e in sorted(intervals):
        if cur is None or s > cur[1]:
            if cur:
                total += cur[1] - cur[0]
            cur = [s, e]
        else:
            cur[1] = max(cur[1], e)
    return total + (cur[1] - cur[0] if cur else 0)


def context_fields(run):
    """Bytes of each appended investigation-context field, per agent."""
    agg = collections.defaultdict(collections.Counter)
    modes = collections.Counter()
    for m in messages(run):
        agent = m['info'].get('agent')
        for p in m.get('parts', []):
            text = p.get('text') if p.get('type') == 'text' else None
            if not text:  # tool.execute.after appends to the tool output
                out = (p.get('state') or {}).get('output')
                text = out if isinstance(out, str) else None
            if not text or MARK not in text:
                continue
            body = text[text.index(MARK) + len(MARK):].strip()
            try:
                j = json.JSONDecoder().raw_decode(body)[0]
            except ValueError:
                modes[(agent, 'unparsed')] += 1
                continue
            modes[(agent, j.get('mode'))] += 1
            for k, v in j.items():
                if k in ('index', 'state') and isinstance(v, dict):
                    for k2, v2 in v.items():
                        agg[agent][f'{k}.{k2}'] += len(json.dumps(v2, ensure_ascii=False).encode())
                else:
                    agg[agent][k] += len(json.dumps(v, ensure_ascii=False).encode())
    return ({a: dict(c.most_common()) for a, c in agg.items()},
            {f'{a}:{mode}': n for (a, mode), n in modes.items()})


def token_usage(calls):
    totals, missing_fields = {}, {}
    for field in CONTEXT_FIELDS + GENERATION_FIELDS:
        reported = [call[field] for call in calls if call[field] is not None]
        key = 'input_uncached' if field == 'input' else field
        totals[key] = sum(reported) if reported else 'unavailable'
        missing_fields[field] = len(calls) - len(reported)
    return totals, missing_fields


def token_sample(call, fields):
    values = [call[field] for field in fields]
    return sum(values) if None not in values else None


def timed_token_samples(completed_calls, fields):
    amounts, durations = [], []
    for call in completed_calls:
        amount = token_sample(call, fields)
        if amount is not None:
            amounts.append(amount)
            durations.append((call['end'] - call['start']) / 1000)
    return amounts, durations


def correlation(amounts, durations):
    if len(amounts) > 2 and len(set(amounts)) > 1 and len(set(durations)) > 1:
        return round(statistics.correlation(amounts, durations), 2)
    return None


def breakdown(run):
    cs = calls(run)
    completed = [c for c in cs if c['end'] is not None]
    # Coordinator latency includes waiting for child tasks; exclude it from latency statistics.
    workers = [c for c in completed if c['agent'] != 'coordinator']
    generated, generation_durations = timed_token_samples(workers, GENERATION_FIELDS)
    context, context_durations = timed_token_samples(workers, CONTEXT_FIELDS)
    generation_sec = sum(generation_durations)
    by = collections.defaultdict(list)
    for c in cs:
        by[c['agent']].append(c)
    roles = {}
    for agent, rs in by.items():
        tokens, missing = token_usage(rs)
        contexts = [token_sample(r, CONTEXT_FIELDS) for r in rs]
        contexts = [amount for amount in contexts if amount is not None]
        durations = [(r['end'] - r['start']) / 1000 for r in rs if r['end'] is not None]
        roles[agent] = dict(
            calls=len(rs),
            incomplete_calls=len(rs) - len(durations),
            **tokens,
            missing_fields=missing,
            context_avg=int(statistics.mean(contexts)) if contexts else None,
            context_max=max(contexts) if contexts else None,
            latency_sec=round(sum(durations)) if durations else None,
            finish_length=sum(r['finish'] == 'length' for r in rs))
    worker_intervals = [(c['start'], c['end']) for c in workers]
    worker_busy = union_ms(worker_intervals)
    complete_intervals = [(c['start'], c['end']) for c in completed]
    wall = max(c['end'] for c in completed) - min(c['start'] for c in cs) if completed else None
    tokens, missing = token_usage(cs)
    fields, modes = context_fields(run)
    return dict(
        run=os.path.basename(os.path.normpath(run)),
        calls=len(cs), incomplete_calls=len(cs) - len(completed),
        wall_min=round(wall / 60000, 1) if wall is not None else None,
        busy_min=round(union_ms(complete_intervals) / 60000, 1) if completed else None,
        parallelism=round(sum(e - s for s, e in worker_intervals) / worker_busy, 2) if worker_busy else None,
        tokens=tokens, missing_fields=missing,
        corr_latency_generated_workers=correlation(generated, generation_durations),
        corr_latency_context_workers=correlation(context, context_durations),
        worker_generated_tokens_per_sec=round(sum(generated) / generation_sec) if generation_sec else None,
        roles=roles, appended_context_bytes=fields, appended_context_modes=modes)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    print(json.dumps([breakdown(r) for r in sys.argv[1:]], ensure_ascii=False, indent=1))
