#!/usr/bin/env python3
"""Offline cost/latency breakdown of finished runs (0 model calls, read-only).

Usage: python3 -I tests/manual/run-cost-breakdown.py <runDir> [<runDir> ...]
A runDir is `<batch>/runs/<runId>` containing `evidence/messages-*.json` and
`evidence/control-audit.json`. Output is JSON with structured counts only:
no message text, tool output, flags or oracle data.
"""
import collections, glob, json, os, statistics, sys

MARK = '[CTF investigation context]'


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
        end = i['time'].get('completed') or start
        out.append(dict(agent=i.get('agent'), start=start, end=end,
                        input=t.get('input', 0), cache_read=c.get('read', 0), cache_write=c.get('write', 0),
                        output=t.get('output', 0), reasoning=t.get('reasoning', 0), finish=i.get('finish')))
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


def breakdown(run):
    cs = calls(run)
    # Coordinator latency includes waiting for child tasks; exclude it from latency statistics.
    worker = [c for c in cs if c['agent'] != 'coordinator']
    gen = [c['output'] + c['reasoning'] for c in worker]
    lat = [(c['end'] - c['start']) / 1000 for c in worker]
    ctx = [c['input'] + c['cache_read'] + c['cache_write'] for c in worker]
    by = collections.defaultdict(list)
    for c in cs:
        by[c['agent']].append(c)
    roles = {}
    for agent, rs in by.items():
        roles[agent] = dict(
            calls=len(rs),
            input_uncached=sum(r['input'] for r in rs),
            context_avg=int(statistics.mean(r['input'] + r['cache_read'] + r['cache_write'] for r in rs)),
            context_max=max(r['input'] + r['cache_read'] + r['cache_write'] for r in rs),
            output=sum(r['output'] for r in rs), reasoning=sum(r['reasoning'] for r in rs),
            latency_sec=round(sum((r['end'] - r['start']) / 1000 for r in rs)),
            finish_length=sum(r['finish'] == 'length' for r in rs))
    non_coord = [(c['start'], c['end']) for c in cs if c['agent'] != 'coordinator']
    fields, modes = context_fields(run)
    t0, t1 = min(c['start'] for c in cs), max(c['end'] for c in cs)
    return dict(
        run=os.path.basename(os.path.normpath(run)),
        calls=len(cs), wall_min=round((t1 - t0) / 60000, 1),
        busy_min=round(union_ms([(c['start'], c['end']) for c in cs]) / 60000, 1),
        parallelism=round(sum(e - s for s, e in non_coord) / union_ms(non_coord), 2) if non_coord else None,
        tokens=dict(input_uncached=sum(c['input'] for c in cs), cache_read=sum(c['cache_read'] for c in cs),
                    output=sum(c['output'] for c in cs), reasoning=sum(c['reasoning'] for c in cs)),
        corr_latency_generated_workers=round(statistics.correlation(gen, lat), 2) if len(worker) > 2 else None,
        corr_latency_context_workers=round(statistics.correlation(ctx, lat), 2) if len(worker) > 2 else None,
        worker_generated_tokens_per_sec=round(sum(gen) / sum(lat)) if sum(lat) else None,
        roles=roles, appended_context_bytes=fields, appended_context_modes=modes)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    print(json.dumps([breakdown(r) for r in sys.argv[1:]], ensure_ascii=False, indent=1))
