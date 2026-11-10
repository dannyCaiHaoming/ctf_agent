#!/usr/bin/env python3
"""Offline size estimate for the team-decision workbook (design §6.1). 0 model calls, read-only.

Usage: python3 -I tests/manual/workbook-size-estimate.py <runDir> [<runDir> ...]
A runDir is `<batch>/runs/<slot>/<runId>` with `evidence/`. Output is JSON with counts and
character sizes only: no message text, tool output, flags or oracle data.

Proxies for what a workbook would have to hold, per run:
- dispatch: Coordinator `task` prompts per target role (chars, list lines, refs).
- handback: per-execution handback text chars (task-executions resultFacts.textChars) and list lines.
- notes: ctf_recon_note calls (count by kind, chars per field).
- steps: tool calls per solving role (log growth the workbook must not scale with).
- injected: chars of host investigation-context parts seen per role.
"""
import collections, glob, json, os, re, statistics, sys

MARK = '[CTF investigation context]'
SOLVING = {'recon', 'domain-solver', 'engineer'}
LIST = re.compile(r'^\s*(?:[-*•]|\d+[.)、])\s+')
REF = re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b')
NOTE_FIELDS = ('observation', 'assessment', 'next_action', 'next_reason')


def load(path, default):
    try:
        return json.load(open(path))
    except (OSError, ValueError):
        return default


def dist(xs):
    xs = sorted(xs)
    if not xs:
        return None
    pct = lambda p: xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))]
    return dict(n=len(xs), min=xs[0], p50=pct(.5), p90=pct(.9), max=xs[-1], sum=sum(xs))


def run_stats(run):
    ev = os.path.join(run, 'evidence')
    sessions = {s['id']: (s.get('agents') or ['?'])[0] for s in load(os.path.join(ev, 'sessions.json'), [])}
    dispatch = collections.defaultdict(list)
    notes = collections.Counter()
    note_chars = collections.defaultdict(list)
    steps = collections.Counter()
    injected = collections.defaultdict(list)
    texts = {}
    for f in glob.glob(os.path.join(ev, 'messages-*.json')):
        for m in load(f, []):
            texts[m['info'].get('id')] = '\n'.join(p.get('text') or '' for p in m.get('parts') or []
                                                   if p.get('type') == 'text' and MARK not in (p.get('text') or ''))
            role = sessions.get(m['info'].get('sessionID'), m['info'].get('agent') or '?')
            for p in m.get('parts') or []:
                if p.get('type') == 'text' and MARK in (p.get('text') or ''):
                    injected[role].append(len(p['text']))
                if p.get('type') != 'tool':
                    continue
                tool, inp = p.get('tool'), (p.get('state') or {}).get('input') or {}
                if role in SOLVING:
                    steps[role] += 1
                if tool == 'task':
                    prompt = inp.get('prompt') or ''
                    lines = prompt.splitlines()
                    dispatch[inp.get('subagent_type') or '?'].append(dict(
                        chars=len(prompt), list_lines=sum(1 for l in lines if LIST.match(l)),
                        refs=len(set(REF.findall(prompt)))))
                elif tool == 'ctf_recon_note':
                    notes[inp.get('kind') or 'decision'] += 1
                    for k in NOTE_FIELDS:
                        if isinstance(inp.get(k), str):
                            note_chars[k].append(len(inp[k]))
                    note_chars['total'].append(sum(len(inp[k]) for k in NOTE_FIELDS if isinstance(inp.get(k), str)))
    handback = collections.defaultdict(list)
    handback_lines = collections.defaultdict(list)
    for e in load(os.path.join(ev, 'task-executions.json'), []):
        rf = e.get('resultFacts') or {}
        if isinstance(rf.get('textChars'), int):
            handback[e.get('role') or '?'].append(rf['textChars'])
        text = texts.get(rf.get('assistantMessageID'))
        if text:
            handback_lines[e.get('role') or '?'].append(sum(1 for l in text.splitlines() if LIST.match(l)))
    return dict(
        dispatch={r: dict(count=len(v), chars=dist([x['chars'] for x in v]),
                          list_lines=dist([x['list_lines'] for x in v]), refs=dist([x['refs'] for x in v]))
                  for r, v in sorted(dispatch.items())},
        handback={r: dist(v) for r, v in sorted(handback.items())},
        handback_list_lines={r: dist(v) for r, v in sorted(handback_lines.items())},
        notes=dict(counts=dict(notes), chars={k: dist(v) for k, v in note_chars.items()}),
        steps=dict(steps),
        injected={r: dist(v) for r, v in sorted(injected.items())})


def main(runs):
    out = {}
    for run in runs:
        key = '/'.join(os.path.normpath(run).split(os.sep)[-4:])
        out[key] = run_stats(run)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
