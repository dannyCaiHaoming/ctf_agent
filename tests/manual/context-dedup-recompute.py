#!/usr/bin/env python3
"""Offline recomputation of appended investigation-context bytes under the dedup rules (0 model calls, read-only).

Usage: python3 -I tests/manual/context-dedup-recompute.py <runDir> [<runDir> ...]
Reads the recorded payload sequence of each session (`evidence/messages-*.json`), replays it as
one chain per session and reports, per agent and field, the old bytes and the bytes the new
rules would append: signals dropped from the experience block, experience block only when the
lesson (id, version) set changes, delta state limited to changed sub-fields, publications as
upserted items plus removed refs. Output has counts only; no message text. Approximation: the
chain assumes each delta's base is the previous payload of the same session file.
"""
import collections, glob, json, os, sys

MARK = '[CTF investigation context]'
size = lambda v: len(json.dumps(v, ensure_ascii=False).encode())


def payloads(path):
    for m in json.load(open(path)):
        agent = m['info'].get('agent')
        for p in m.get('parts', []):
            text = p.get('text') if p.get('type') == 'text' else (p.get('state') or {}).get('output')
            if not isinstance(text, str) or MARK not in text:
                continue
            try:
                yield agent, json.JSONDecoder().raw_decode(text[text.index(MARK) + len(MARK):].strip())[0]
            except ValueError:
                pass


def lesson_key(exp):
    return json.dumps([exp.get('status'), [[l.get('id'), l.get('version')] for l in exp.get('lessons', [])]])


def add(agg, agent, field, old, new):
    agg[agent][field][0] += old
    agg[agent][field][1] += new


def run(run_dir):
    agg = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    for path in sorted(glob.glob(os.path.join(run_dir, 'evidence', 'messages-*.json'))):
        state, exp_key = {}, None
        for agent, j in payloads(path):
            for k, v in j.items():
                if k in ('index', 'state') and isinstance(v, dict):
                    for k2, v2 in v.items():
                        old = size(v2)
                        if j['mode'] == 'delta' and k == 'state':
                            if k2 == 'publications':
                                prev = {p['ref']: p for p in state.get('publications', [])}
                                cur = {p['ref']: p for p in v2}
                                new = size([p for r, p in cur.items() if prev.get(r) != p]) + size([r for r in prev if r not in cur])
                            else:
                                new = old if state.get(k2) != v2 else 0
                        else:
                            new = old
                        add(agg, agent, f'{k}.{k2}', old, new)
                elif k == 'experience':
                    old = size(v)
                    stripped = {a: b for a, b in v.items() if a != 'signals'}
                    key = lesson_key(v)
                    new = size(stripped) if (j['mode'] == 'full' or key != exp_key) else 0
                    add(agg, agent, k, old, new)
                else:
                    add(agg, agent, k, size(v), size(v))
            if j['mode'] == 'full':
                state = dict(j.get('state', {}))
            elif 'state' in j:
                state.update(j['state'])
            if 'experience' in j:
                exp_key = lesson_key(j['experience'])
    out = {a: {f: dict(old=o, new=n) for f, (o, n) in sorted(fs.items(), key=lambda x: -x[1][0])} for a, fs in agg.items()}
    tot = {'old': sum(v['old'] for fs in out.values() for v in fs.values()), 'new': sum(v['new'] for fs in out.values() for v in fs.values())}
    return dict(run=os.path.basename(os.path.normpath(run_dir)), total_bytes=tot, by_agent=out)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    print(json.dumps([run(r) for r in sys.argv[1:]], ensure_ascii=False, indent=1))
