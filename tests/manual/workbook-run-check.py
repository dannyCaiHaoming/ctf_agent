#!/usr/bin/env python3
"""Offline workbook check of one finished run (team-decision design §6.1). 0 model calls, read-only.

Usage: python3 -I tests/manual/workbook-run-check.py <runDir> [<experience.sqlite>]
runDir contains `evidence/` and `state/run.json`.
entry_id_refs counts standalone numbers in a dispatch prompt that equal existing workbook entry ids; small ids (1, 2, ...)
can match incidental numbers, so treat low counts as approximate. Output is JSON with counts and sizes only:
no message text, tool output, flags or oracle data.
"""
import collections, glob, json, os, re, sqlite3, sys

run = sys.argv[1]
ev = os.path.join(run, 'evidence')
load = lambda name: json.load(open(os.path.join(ev, name)))
sessions = load('sessions.json')
label = {}
counts = collections.Counter()
for s in sessions:
    role = (s.get('agents') or ['?'])[0]
    counts[role] += 1
    label[s['id']] = role if role in ('coordinator', 'intake', 'recon') else f'{role}#{counts[role]}'

state = json.load(open(os.path.join(run, 'state', 'run.json')))

def has_run(path):
    try:
        return sqlite3.connect(f'file:{path}?mode=ro', uri=True).execute('SELECT 1 FROM recon_turns WHERE run_id=? LIMIT 1', (state.get('runId'),)).fetchone() is not None
    except sqlite3.Error:
        return False
# The store may sit in the run directory or in the batch runs directory; use the one holding this run's records.
db_path = sys.argv[2] if len(sys.argv) > 2 else next((p for p in [os.path.join(run, 'experience.sqlite'), os.path.join(os.path.dirname(run), 'experience.sqlite')] if os.path.exists(p) and has_run(p)), None)
out = {'run': os.path.basename(run), 'revision': (state.get('productRevision') or {}).get('commit', '')[:8],
       'status': state.get('status'), 'stop_reason': state.get('stopReason'), 'model_calls': state.get('admittedModelCalls'),
       'agent_options': state.get('agentOptions'), 'assistant_messages': {label[s['id']]: s.get('assistantMessages') for s in sessions}}
out['executions'] = collections.Counter(f"{e.get('role')}:{e.get('state')}" for e in load('task-executions.json'))
completions = load('completion-results.json') if os.path.exists(os.path.join(ev, 'completion-results.json')) else []
out['completions'] = [{k: c.get(k) for k in ('state', 'solved', 'admission', 'rejection')} for c in completions]

writes, refused, tools = collections.Counter(), collections.Counter(), collections.Counter()
dispatch = []
for f in glob.glob(os.path.join(ev, 'messages-*.json')):
    for m in json.load(open(f)):
        who = label.get(m['info'].get('sessionID'), '?')
        for p in m.get('parts') or []:
            if p.get('type') != 'tool':
                continue
            st, inp = p.get('state') or {}, (p.get('state') or {}).get('input') or {}
            tools[(who, p['tool'])] += 1
            if p['tool'] == 'ctf_recon_note':
                key = f"{who}:{inp.get('slot') or 'kind:' + str(inp.get('kind', 'decision'))}"
                writes[key + (':supersedes' if inp.get('supersedes') else '')] += 1
                if st.get('status') == 'error':
                    refused[f"{who}:{str(st.get('error'))[:120]}"] += 1
            if p['tool'] == 'task' and who == 'coordinator':
                pr = inp.get('prompt', '')
                dispatch.append({'to': inp.get('subagent_type'), 'chars': len(pr),
                                 'numbers': sorted({int(n) for n in re.findall(r'(?<![\w.])(\d{1,5})(?![\w.])', pr)}),
                                 'tested_list': bool(re.search('未測|未测|tested', pr))})
out['workbook_writes'] = dict(sorted(writes.items()))
out['refused'] = dict(refused)
out['dispatch'] = dispatch

audit = load('control-audit.json')
sent = collections.defaultdict(lambda: {'presented': 0, 'workbook_sent': 0, 'workbook_chars_sent': 0, 'max_bytes': 0, 'first_full_entries': None})
for a in audit:
    if a.get('op') != 'context.presented':
        continue
    d, w = a['detail'], a['detail'].get('workbook') or {}
    x = sent[label.get(a['sessionID'], '?')]
    x['presented'] += 1
    x['max_bytes'] = max(x['max_bytes'], d.get('bytes') or 0)
    # sent: 'full' (whole view), 'entries' (entry-level delta, size is part of the delta bytes), True (whole view, pre-825bc343).
    kind = w.get('sent', True)
    if kind:
        x['workbook_sent'] += 1
        x.setdefault('sent_kinds', collections.Counter())[str(kind)] += 1
        if kind in (True, 'full'):
            x['workbook_chars_sent'] += w.get('chars') or 0
        else:
            x['delta_bytes_with_workbook'] = x.get('delta_bytes_with_workbook', 0) + (d.get('bytes') or 0)
    if d.get('mode') == 'full' and x['first_full_entries'] is None:
        x['first_full_entries'] = len(w.get('included_ids') or [])
out['presentation'] = dict(sent)
out['prepare_failures'] = sum(1 for a in audit if a.get('op') == 'context.prepare' and not a.get('allow'))

if db_path:
    db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    rows = db.execute("SELECT session_id,tool,args_meta_json FROM recon_turns WHERE run_id=? AND kind='tool' AND tool NOT LIKE 'recon.%' ORDER BY sequence", (state.get('runId'),)).fetchall()
    seen, repeats, steps = {}, collections.Counter(), collections.Counter()
    for sid, tool, meta in rows:
        k = (tool, (json.loads(meta or '{}') or {}).get('sha256'))
        steps[label.get(sid, sid[-4:])] += 1
        if k in seen and seen[k] != sid:
            repeats[f"{label.get(sid, '?')}<-{label.get(seen[k], '?')}:{tool}"] += 1
        seen.setdefault(k, sid)
    out['tool_steps'] = dict(steps)
    out['cross_session_repeats'] = dict(repeats)
    # A dispatch references the workbook when it names ids of existing workbook entries (any format).
    entry_ids = {r[0] for r in db.execute("SELECT id FROM recon_turns WHERE run_id=? AND json_extract(note_json,'$.slot') IS NOT NULL", (state.get('runId'),))}
    for d in out['dispatch']:
        d['entry_id_refs'] = len(set(d.pop('numbers')) & entry_ids)
    out['active_entries_end'] = db.execute("""SELECT count(*) FROM recon_turns a WHERE a.run_id=? AND a.kind='decision' AND json_extract(a.note_json,'$.slot') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM recon_turns b WHERE b.run_id=a.run_id AND b.challenge_id=a.challenge_id AND json_extract(b.note_json,'$.supersedes')=a.id)""", (state.get('runId'),)).fetchone()[0]
json.dump(out, sys.stdout, ensure_ascii=False, indent=1, default=dict)
