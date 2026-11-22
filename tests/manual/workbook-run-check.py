#!/usr/bin/env python3
"""Offline workbook check of one finished run (team-decision design §6.1). 0 model calls, read-only.

Usage: python3 -B -I tests/manual/workbook-run-check.py <runDir> [<experience.sqlite>]
       python3 -B -I tests/manual/workbook-run-check.py --self-test
runDir contains `evidence/` and `state/run.json`.
entry_id_refs counts standalone numbers in a dispatch prompt that equal existing workbook entry ids; small ids (1, 2, ...)
can match incidental numbers, so treat low counts as approximate. Output is JSON with counts and sizes only:
no message text, tool output, flags or oracle data.
"""
import collections, glob, json, os, re, sqlite3, sys
from pathlib import Path
import subprocess
import tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _candidate_common import audit_milestones


def self_test():
    def presented(mode, size, **detail):
        return {'op': 'context.presented', 'allow': True, 'sessionID': 'synthetic-coordinator',
                'detail': {'mode': mode, 'bytes': size, **detail}}

    def run_report(root, presentations, *, workbook=True):
        inputs = {
            'state/run.json': {'runId': 'synthetic', 'status': 'completed',
                               'context': {'index': 'full', 'workbook': workbook}},
            'evidence/sessions.json': [{'id': 'synthetic-coordinator', 'agents': ['coordinator']}],
            'evidence/task-executions.json': [],
            'evidence/control-audit.json': [
                {'op': 'dispatch.register', 'allow': True, 't': 60000, 'detail': {'role': 'engineer'}},
                {'op': 'package.published', 'allow': True, 't': 120000},
                *presentations,
            ],
        }
        for name, data in inputs.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data))
        return json.loads(subprocess.check_output(
            [sys.executable, '-B', '-I', __file__, str(root)], text=True))

    with tempfile.TemporaryDirectory(prefix='workbook-check-self-') as tmp:
        root = Path(tmp)
        report = run_report(root / 'context-only', [presented('full', 100)], workbook=False)
        actual = report['presentation']['coordinator']
        no_workbook = {'presented': 1, 'workbook_sent': 0, 'workbook_chars_sent': 0,
                       'max_bytes': 100, 'first_full_entries': None}
        assert actual == no_workbook, actual
        milestones = report['milestones']
        assert milestones['first_dispatch_min'] == {'engineer': 1.0}
        assert milestones['dispatches'] == {'engineer': 1}
        assert milestones['first_package_min'] == 2.0

        report = run_report(root / 'mixed', [
            presented('full', 100),
            presented('full', 600, workbook={'sent': 'full', 'included_ids': [1, 2], 'chars': 310}),
            presented('delta', 200, workbook={'sent': 'entries', 'included_ids': [1, 2, 3], 'chars': 410}),
            presented('delta', 140, workbook={'sent': False, 'included_ids': [1, 2, 3], 'chars': 410}),
        ])
        actual = report['presentation']['coordinator']
        assert actual == {'presented': 4, 'workbook_sent': 2, 'workbook_chars_sent': 310,
                          'max_bytes': 600, 'first_full_entries': 2, 'delta_bytes_with_workbook': 200,
                          'sent_kinds': {'full': 1, 'entries': 1}}, actual

        legacy_metadata = {'challenges': ['synthetic'], 'included_ids': [], 'omitted_ids': [],
                           'failed_ids': [], 'truncated_ids': [], 'collapsed': [], 'chars': 75}
        for name, mode, metadata, entries, chars in [
            ('legacy-boolean', 'delta', {'sent': True, 'included_ids': [1], 'chars': 60}, 1, 60),
            ('legacy-coordinator', 'full', legacy_metadata, 0, 75),
        ]:
            report = run_report(root / name, [presented(mode, 200, workbook=metadata)])
            actual = report['presentation']['coordinator']
            assert actual == {'presented': 1, 'workbook_sent': 1, 'workbook_chars_sent': chars,
                              'max_bytes': 200, 'first_full_entries': entries, 'sent_kinds': {'True': 1}}, actual

        report = run_report(root / 'unrecognized', [
            presented('full', 100, workbook={}),
            presented('full', 100, workbook=['full']),
            presented('full', 100, workbook={'chars': 75}),
            presented('full', 100, workbook={**legacy_metadata, 'sent': 'unknown'}),
            presented('full', 100, workbook={**legacy_metadata, 'sent': 1}),
            presented('full', 100, workbook={**legacy_metadata, 'sent': False}),
            presented('delta', 100, workbook=legacy_metadata),
        ])
        actual = report['presentation']['coordinator']
        assert actual == {**no_workbook, 'presented': 7}, actual

        report = run_report(root / 'disabled-but-sent', [
            presented('full', 200, workbook={'sent': 'full', 'included_ids': [1], 'chars': 80}),
        ], workbook=False)
        assert report['milestones']['context']['workbook'] is False
        actual = report['presentation']['coordinator']
        assert actual == {'presented': 1, 'workbook_sent': 1, 'workbook_chars_sent': 80,
                          'max_bytes': 200, 'first_full_entries': 1, 'sent_kinds': {'full': 1}}, actual
    print(json.dumps({'self_test': True}))


if sys.argv[1:] == ['--self-test']:
    self_test()
    sys.exit(0)

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
                # workbook_writes counts accepted writes only; refused attempts are counted under refused.
                if st.get('status') == 'error':
                    refused[f"{who}:{str(st.get('error'))[:120]}"] += 1
                else:
                    writes[key + (':supersedes' if inp.get('supersedes') else '')] += 1
            if p['tool'] == 'task' and who == 'coordinator':
                pr = inp.get('prompt', '')
                dispatch.append({'to': inp.get('subagent_type'), 'status': st.get('status'), 'resume': bool(inp.get('task_id')), 'chars': len(pr),
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
    d = a['detail']
    x = sent[label.get(a['sessionID'], '?')]
    x['presented'] += 1
    x['max_bytes'] = max(x['max_bytes'], d.get('bytes') or 0)
    w = d.get('workbook')
    if not isinstance(w, dict):
        continue
    kind = w.get('sent')
    included_ids, chars = w.get('included_ids'), w.get('chars')
    # Early Coordinator full views recorded entry IDs and chars without a sent marker.
    if ('sent' not in w and d.get('mode') == 'full' and isinstance(included_ids, list)
            and type(chars) is int and chars >= 0):
        kind = True
    full = kind is True or kind == 'full'
    if not full and kind != 'entries':
        continue
    x['workbook_sent'] += 1
    x.setdefault('sent_kinds', collections.Counter())[str(kind)] += 1
    if full:
        if type(chars) is int and chars >= 0:
            x['workbook_chars_sent'] += chars
        if x['first_full_entries'] is None and isinstance(included_ids, list):
            x['first_full_entries'] = len(included_ids)
    else:
        x['delta_bytes_with_workbook'] = x.get('delta_bytes_with_workbook', 0) + (d.get('bytes') or 0)
out['presentation'] = dict(sent)
out['prepare_failures'] = sum(1 for a in audit if a.get('op') == 'context.prepare' and not a.get('allow'))

# Paired-control milestones (team-decision design §7.2), minutes from the control service's first audit entry.
# Both arms produce them; the candidate-entry time exists only where the workbook is on.
t0_at = (audit[0].get('at') - audit[0].get('t')) if audit and audit[0].get('at') is not None and audit[0].get('t') is not None else None
minutes = lambda t: None if t is None else round(t / 60000, 2)
audit_times = audit_milestones(audit)
out['milestones'] = {
    'context': state.get('context'),
    'first_dispatch_min': audit_times['first_dispatch_min'],
    'dispatches': audit_times['dispatches'],
    'first_candidate_entry_min': None,
    'first_package_min': audit_times['first_package_min'],
    'first_completion_min': audit_times['first_completion_min'],
    'solved': any(c.get('solved') for c in completions),
    'completions': len(completions),
    'last_audit_min': audit_times['last_audit_min'],
    'stop_reason': state.get('stopReason'),
    'root_finish': (state.get('rootResult') or {}).get('finish'),
    'usage': state.get('usageTotal') or 'unavailable',
}

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
    first_candidate = db.execute("SELECT min(created_at) FROM recon_turns WHERE run_id=? AND kind='decision' AND json_extract(note_json,'$.slot')='candidate'", (state.get('runId'),)).fetchone()[0]
    if first_candidate is not None and t0_at is not None:
        out['milestones']['first_candidate_entry_min'] = minutes(first_candidate - t0_at)
    out['tool_steps'] = dict(steps)
    out['cross_session_repeats'] = dict(repeats)
    # A dispatch references the workbook when it names ids of existing workbook entries (any format).
    entry_ids = {r[0] for r in db.execute("SELECT id FROM recon_turns WHERE run_id=? AND json_extract(note_json,'$.slot') IS NOT NULL", (state.get('runId'),))}
    for d in out['dispatch']:
        d['entry_id_refs'] = len(set(d.pop('numbers')) & entry_ids)
    out['active_entries_end'] = db.execute("""SELECT count(*) FROM recon_turns a WHERE a.run_id=? AND a.kind='decision' AND json_extract(a.note_json,'$.slot') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM recon_turns b WHERE b.run_id=a.run_id AND b.challenge_id=a.challenge_id AND json_extract(b.note_json,'$.supersedes')=a.id)""", (state.get('runId'),)).fetchone()[0]
json.dump(out, sys.stdout, ensure_ascii=False, indent=1, default=dict)
