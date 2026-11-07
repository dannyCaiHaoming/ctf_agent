#!/usr/bin/env python3
"""Offline replay of candidate closure triggers (0 model calls).

Reads only structured fields from progress.jsonl (role, op, kind, elapsedMs,
facts.tool, facts.role, facts.ref, facts.safeArgs.ref), state/run.json
(deadlineMs, stopReason) and evidence/completion-results.json (state, solved).
Never reads request/response bodies, scripts, candidates or attachments.

Usage: closure-trigger-replay.py OUT.json RUN_DIR...
"""
import json, sys, os

LONG_ROLES = ('domain-solver', 'recon')
RESERVES_MIN = (4, 6, 8)


def load(run_dir):
    events = []
    with open(os.path.join(run_dir, 'progress.jsonl')) as f:
        for line in f:
            line = line.strip()
            if line:
                events.append(json.loads(line))
    events.sort(key=lambda e: e.get('seq', 0))
    run = json.load(open(os.path.join(run_dir, 'state/run.json')))
    try:
        comp = json.load(open(os.path.join(run_dir, 'evidence/completion-results.json')))
    except FileNotFoundError:
        comp = []
    solved = any(c.get('solved') is True for c in comp)
    return events, run, solved


def rounds_of(events):
    """Round = coordinator dispatch (register/resume) of a role until the next one of any role."""
    starts = [(e['elapsedMs'], (e.get('facts') or {}).get('role')) for e in events
              if e.get('kind') == 'dispatch' and e.get('op') in ('dispatch.register', 'dispatch.resume')]
    rounds = []
    for i, (t, role) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else float('inf')
        rounds.append({'role': role, 'start': t, 'next_dispatch': end, 'calls': 0, 'tools': 0,
                       'first': None, 'last': None, 'published': []})
    def find(t, role):
        for r in reversed(rounds):
            if r['role'] == role and r['start'] <= t:
                return r
        return None
    for e in events:
        role, t = e.get('role'), e.get('elapsedMs', 0)
        if role not in LONG_ROLES:
            continue
        r = find(t, role)
        if r is None:
            continue
        op = e.get('op')
        if e.get('kind') == 'model' and op == 'model.call' and e.get('status') == 'admitted':
            r['calls'] += 1
        elif op == 'tool.registered':
            r['tools'] += 1
        elif op == 'artifact.published':
            r['published'].append({'t': t, 'ref': (e.get('facts') or {}).get('ref'),
                                   'calls_before': r['calls'], 'tools_before': r['tools']})
        else:
            continue
        r['first'] = t if r['first'] is None else r['first']
        r['last'] = t
    return [r for r in rounds if r['role'] in LONG_ROLES]


def analyse(run_dir):
    events, run, solved = load(run_dir)
    deadline = run.get('deadlineMs')
    end_ms = max(e.get('elapsedMs', 0) for e in events)
    engineer_reads = {}
    for e in events:
        if e.get('role') == 'engineer' and e.get('op') == 'tool.registered' and (e.get('facts') or {}).get('tool') == 'artifact.read':
            ref = ((e.get('facts') or {}).get('safeArgs') or {}).get('ref')
            if isinstance(ref, str):
                engineer_reads.setdefault(ref, e['elapsedMs'])
    engineer_start = next((e['elapsedMs'] for e in events if e.get('kind') == 'dispatch'
                           and e.get('op') == 'dispatch.register' and (e.get('facts') or {}).get('role') == 'engineer'), None)
    first_completion = next((e['elapsedMs'] for e in events if e.get('op') == 'tool.registered'
                             and (e.get('facts') or {}).get('tool') == 'completion.request'), None)
    if first_completion is None:
        first_completion = next((e['elapsedMs'] for e in events if e.get('op') in ('completion.saved',)), None)
    rounds = rounds_of(events)
    out_rounds = []
    for r in rounds:
        consumed = [p for p in r['published'] if p['ref'] in engineer_reads]
        active_end = r['last'] if r['last'] is not None else r['start']
        out_rounds.append({
            'role': r['role'],
            'start_min': round(r['start'] / 60000, 2),
            'active_min': round((active_end - r['start']) / 60000, 2),
            'model_calls': r['calls'],
            'tool_calls': r['tools'],
            'published': len(r['published']),
            # Material the Engineer later read: the round carried a candidate-bearing artifact.
            'engineer_consumed': len(consumed),
            'calls_before_first_consumed': consumed[0]['calls_before'] if consumed else None,
            'tools_before_first_consumed': consumed[0]['tools_before'] if consumed else None,
            'min_before_first_consumed': round((consumed[0]['t'] - r['start']) / 60000, 2) if consumed else None,
        })
    phase = {}
    if deadline:
        for res in RESERVES_MIN:
            t = deadline - res * 60000
            inflight = [r['role'] for r in rounds if r['start'] <= t and (r['last'] or r['start']) >= t]
            phase[f'reserve_{res}min'] = {
                'trigger_min': round(t / 60000, 2),
                'reached': end_ms >= t,
                'inflight_long_roles': sorted(set(inflight)),
                'engineer_started_before': engineer_start is not None and engineer_start < t,
                'first_completion_before': first_completion is not None and first_completion < t,
            }
    return {
        'run': run.get('runId'), 'solved': solved, 'stopReason': run.get('stopReason'),
        'deadline_min': round(deadline / 60000, 2) if deadline else None,
        'end_min': round(end_ms / 60000, 2),
        'engineer_start_min': round(engineer_start / 60000, 2) if engineer_start is not None else None,
        'first_completion_min': round(first_completion / 60000, 2) if first_completion is not None else None,
        'rounds': out_rounds, 'wallclock_phase': phase,
    }


def main():
    out, dirs = sys.argv[1], sys.argv[2:]
    runs = [analyse(d) for d in dirs]
    def dist(rs, key):
        v = sorted(x[key] for x in rs if x[key] is not None)
        return {'n': len(v), 'min': v[0], 'max': v[-1], 'values': v} if v else {'n': 0}
    solver_success = [r for run in runs if run['solved'] for r in run['rounds']
                      if r['role'] == 'domain-solver' and r['engineer_consumed']]
    solver_unsolved = [r for run in runs if not run['solved'] for r in run['rounds'] if r['role'] == 'domain-solver']
    recon_all = [r for run in runs for r in run['rounds'] if r['role'] == 'recon']
    summary = {
        'success_solver_rounds_to_consumed_material': {
            'model_calls': dist(solver_success, 'calls_before_first_consumed'),
            'tool_calls': dist(solver_success, 'tools_before_first_consumed'),
            'minutes': dist(solver_success, 'min_before_first_consumed'),
        },
        'unsolved_solver_rounds': {
            'model_calls': dist(solver_unsolved, 'model_calls'),
            'tool_calls': dist(solver_unsolved, 'tool_calls'),
            'minutes': dist(solver_unsolved, 'active_min'),
        },
        'recon_rounds': {'model_calls': dist(recon_all, 'model_calls'), 'minutes': dist(recon_all, 'active_min')},
    }
    json.dump({'tool': 'tests/manual/closure-trigger-replay.py', 'model_calls': 0,
               'fields': 'progress.jsonl role/op/kind/elapsedMs/facts.tool/facts.role/facts.ref/facts.safeArgs.ref; run.json deadlineMs/stopReason; completion-results solved',
               'summary': summary, 'runs': runs}, open(out, 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
