#!/usr/bin/env python3
"""Offline candidate census from run state, profiles, audit and workbook metadata.

python3 -I tests/manual/candidate-baseline.py BATCH_OR_RUN... --output SUMMARY
No message, tool-output or completion-result reads. Missing workbooks stay unknown.
"""
import argparse
import json
from pathlib import Path
import tempfile
import collections
import os
import re
import sqlite3
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _candidate_common import (
    candidate_audit_timing, dump, is_number, key_of, read_json, token,
    workbook_candidates, workbook_view_metrics,
)

REPO = Path(__file__).resolve().parents[2]
RUN_BATCHES = {'p1': 'candidate-baseline-20261119-p1', 'p2': 'candidate-baseline-20261119-p2'}


def self_test():
    with tempfile.TemporaryDirectory(prefix='baseline-self-') as tmp:
        root = Path(tmp)
        batch = root / 'misplaced-batch'
        profiles = root / 'separate-profiles'
        profiles.mkdir(parents=True)
        batch.mkdir()
        (batch / 'batch-meta.json').write_text(json.dumps({'batchId': 'candidate-baseline-20261119-p1'}))
        started_at = 1_000_000

        def event(minute, op, actor='coordinator', **detail):
            elapsed_ms = round(minute * 60000)
            return {'op': op, 'role': actor, 'detail': detail,
                    'at': started_at + elapsed_ms, 't': elapsed_ms + 30000, 'allow': True}

        def view(minute, actor, chars, included=(), omitted=()):
            return event(minute, 'context.presented', actor, workbook={
                'chars': chars, 'included_ids': list(included), 'omitted_ids': list(omitted),
            })

        def fixture(rid, audit, entries=None):
            outer = batch / 'runs' / rid
            run = outer / rid
            (run / 'state').mkdir(parents=True)
            (run / 'evidence').mkdir()
            (run / 'state/run.json').write_text(json.dumps({
                'runId': rid, 'budget': {'wallClockMs': 30 * 60000},
            }))
            (run / 'evidence/control-audit.json').write_text(json.dumps(audit))
            if entries is not None:
                db = sqlite3.connect(outer / 'experience.sqlite')
                try:
                    with db:
                        db.execute('PRAGMA journal_mode=wal')
                        db.execute('CREATE TABLE recon_turns (id INTEGER PRIMARY KEY, run_id TEXT, '
                                   'challenge_id TEXT, kind TEXT, created_at INTEGER, role TEXT, note_json TEXT)')
                        db.execute('INSERT INTO recon_turns VALUES (?, ?, ?, ?, ?, ?, ?)',
                                   (1, rid, 'synthetic', 'tool', started_at, 'recon', None))
                        db.executemany('INSERT INTO recon_turns VALUES (?, ?, ?, ?, ?, ?, ?)', [
                            (seq, rid, 'synthetic', 'decision', started_at + round(minute * 60000), role,
                             json.dumps({'slot': slot, 'status': status, 'supersedes': previous}))
                            for seq, minute, role, slot, status, previous in entries
                        ])
                finally:
                    db.close()
            return run

        withdrawn_id = 'p2-synthetic-withdrawn'
        run = fixture(withdrawn_id, [
            event(0, 'bind'),
            event(0.5, 'progress.note', route='continue'),
            event(1, 'dispatch.register', role='recovery-critic'),
            event(1.25, 'progress.note', 'recovery-critic', route='redirect'),
            event(1.5, 'model.call', 'domain-solver'),
            event(2, 'dispatch.register', role='engineer'),
            event(2.5, 'tool.registered', 'domain-solver'),
            event(2.75, 'model.call', 'engineer'),
            event(3, 'package.published', 'engineer'),
            view(3, 'engineer', 3900, omitted=(2,)),
            event(4, 'progress.note', route='stop_and_report'),
            event(4.5, 'model.call', 'domain-solver'),
            event(5, 'progress.note', route='stop_and_report'),
            view(5, 'engineer', 1000),
            view(0.5, 'coordinator', 2000),
        ], [
            (2, 0.75, 'domain-solver', 'candidate', 'proposed', None),
            (3, 3.5, 'domain-solver', 'candidate', 'withdrawn', 2),
        ])
        (profiles / f'{withdrawn_id}.profile.json').write_text(json.dumps({
            'budget': {'wallClockMs': 600000},
        }))
        fixture('p2-synthetic-missing', [
            event(0, 'bind'),
            event(1, 'package.published', 'engineer'),
            event(2, 'progress.note', route='stop_and_report'),
        ])
        fixture('p1-synthetic-empty', [
            event(0, 'bind'),
            view(0.5, 'domain-solver', 5000),
            event(1, 'dispatch.register', role='recovery-critic'),
            event(1.5, 'model.call', 'domain-solver'),
            view(2, 'domain-solver', 11900, included=(4,), omitted=(2, 3)),
            view(3, 'domain-solver', 12000, included=(4,), omitted=(2, 3)),
            view(3.5, 'recon', 4000, included=(2, 3, 4)),
        ], [
            (2, 1, 'recon', 'hypotheses', 'open', None),
            (3, 1.25, 'recon', 'questions', 'open', None),
            (4, 1.5, 'recon', 'facts', None, None),
        ])
        fixture('synthetic-active', [event(0, 'bind'), view(3, 'domain-solver', 1500, included=(2,))], [
            (2, 2, 'domain-solver', 'candidate', 'proposed', None),
        ])
        gate = root / 'summary.json'
        gate.write_text(json.dumps({'runs': [
            {'run': withdrawn_id, 'wall_clock_min': 5.5, 'solved': False}],
            'correction': {'offline_judge': {'runs': [{'runId': withdrawn_id, 'accepted': 1}]}}}))

        report = collect([batch, run], [gate], [profiles])
        rows = {row['run']: row for row in report['runs']}
        assert len(report['runs']) == len(rows) == 4
        row = rows[withdrawn_id]
        assert row.get('candidate_entries_total') == 2, 'nested workbook candidate census was missed'
        assert row['candidate_claimed'] is True, 'nested workbook candidate was missed'
        assert row['batch'] == 'candidate-baseline-20261119-p2'
        assert row['candidate_active_at_end'] == 0
        assert row['candidate_withdrawn'] == 1
        assert row['wall_minutes'] == 5.5 and row['first_candidate_entry_min'] == 0.75
        assert row['first_package_min'] == 3 and row['candidate_to_engineer_min'] == 1.25
        assert row['packaged'] is True and row['submitted'] is False and row['solved'] is False
        assert row['posthoc_accepted'] is True
        assert row['critic_first_min'] == 1 and row['critic_first_route'] == 'redirect'
        assert row['stop_note_min'] == 4 and row['remaining_at_stop_min'] == 6
        assert row['solver_work_after_critic'] == {'model_calls': 1, 'tools_registered': 1, 'span_min': 1}
        assert row.get('first_omission_min') == 2.5, 'omission timing must use the first context presentation'
        assert row['first_omission_role'] == 'engineer' and row['omitted_distinct'] == 1
        assert row['omitted_active'] == {'basis': 'run_end', 'total': 0, 'open_hypotheses': 0, 'open_questions': 0}
        assert row['omitted_kinds'] == [
            {'slot': 'candidate', 'status': 'proposed', 'role': 'domain-solver', 'count': 1},
        ]
        assert row['active_entries'] == {'max': 1, 'end': 1}
        assert row['supersede_writes'] == {'all': 1, 'domain-solver': 1}
        assert row['total_writes'] == {'all': 2, 'domain-solver': 2}

        missing = rows['p2-synthetic-missing']
        assert missing['candidate_claimed'] == missing['candidate_entries_total'] == 'unknown'
        assert missing['candidate_active_at_end'] == missing['candidate_withdrawn'] == 'unknown'
        assert missing['packaged'] is True and missing['first_candidate_entry_min'] is None
        assert missing['critic_first_min'] is None and missing['critic_first_route'] is None
        assert missing['stop_note_min'] == 2 and missing['remaining_at_stop_min'] is None
        assert missing['solver_work_after_critic'] is None
        assert missing['active_entries'] == {'max': None, 'end': None}

        empty = rows['p1-synthetic-empty']
        assert empty['candidate_claimed'] is False and empty['candidate_entries_total'] == 0
        assert empty['critic_first_min'] == 1 and empty['critic_first_route'] is None
        assert empty['stop_note_min'] is None and empty['remaining_at_stop_min'] is None
        assert empty['solver_work_after_critic'] is None
        assert empty['first_omission_min'] == 1.5 and empty['first_omission_role'] == 'domain-solver'
        assert empty['omitted_distinct'] == 2
        assert empty['omitted_active'] == {'basis': 'run_end', 'total': 2, 'open_hypotheses': 1, 'open_questions': 1}
        assert empty['workbook_view']['domain-solver'] == {
            'max_chars': 12000, 'cap_chars': 12000, 'max_ratio': 1,
            'presentations': 3, 'presentations_with_omission': 2,
        }
        assert empty['workbook_view']['recon']['presentations_with_omission'] == 0
        assert empty['active_entries'] == {'max': 3, 'end': 3}
        assert empty['total_writes'] == {'all': 3, 'domain-solver': 0}
        active = rows['synthetic-active']
        assert active['batch'] == 'unknown' and active['candidate_active_at_end'] == 1
        assert active['candidate_withdrawn'] == 0 and active['candidate_to_engineer_min'] is None
        assert active['first_omission_min'] is None and active['first_omission_role'] is None
        assert active['omitted_distinct'] == 0 and active['omitted_kinds'] == []
        assert report['totals']['candidate_claimed'] == {'true': 2, 'false': 1, 'unknown': 1, 'null': 0}
        assert report['totals']['candidate_entries_total'] == 3
        assert report['totals']['candidate_active_at_end'] == report['totals']['candidate_withdrawn'] == 1
        assert report['totals']['runs_with_omission'] == 2
        assert report['totals']['unsolved_runs_with_omission'] == 1
        assert report['totals']['first_omission_minutes'] == [1.5, 2.5]
        bad = root / 'bad'
        bad.mkdir()
        assert collect([bad], [])['skipped'][0]['reason'] == 'no_state_run_json'
    return {'self_test': True}


def run_profile(run, run_id, profile_dirs):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', run_id):
        return {}
    for directory in (*profile_dirs, *(p / 'configs' for p in (run, *run.parents))):
        path = directory / f'{run_id}.profile.json'
        if path.is_file():
            try:
                profile = read_json(path)
            except (OSError, ValueError):
                continue
            if isinstance(profile, dict):
                return profile
    return {}


def batch_for_run(state, profile, meta, slots):
    prefix, separator, _ = state['runId'].partition('-')
    if separator and prefix in RUN_BATCHES:
        return RUN_BATCHES[prefix]
    explicit = token(state.get('batchId'), token(profile.get('batchId')))
    if explicit != 'unknown':
        return explicit
    batch_id = token(meta.get('batchId'))
    profile_id = token(profile.get('profileId'))
    if batch_id != 'unknown' and (slots or meta.get('runId') == state['runId']
                                  or profile_id.startswith(batch_id + '-')):
        return batch_id
    return 'unknown'


def collect(inputs, gates, profile_dirs=()):
    index, corrections = {}, {}
    for path in gates:
        g = read_json(path)
        records = g.get('runs', [])
        if isinstance(g.get('run'), dict):
            records = [*records, g['run']]
        elif isinstance(g.get('run'), str):
            records = [*records, dict(g, runId=g['run'])]
        for rec in records:
            rid = rec.get('runId', rec.get('run'))
            if not isinstance(rid, str):
                continue
            index[rid] = rec
        for rec in ((g.get('correction') or {}).get('offline_judge') or {}).get('runs', []):
            if isinstance(rec.get('accepted'), (int, bool)):
                corrections[rec.get('runId')] = rec['accepted'] > 0
    rows, skipped, seen = [], [], set()
    for input_path in inputs:
        base = Path(input_path).resolve()
        if not base.is_dir():
            skipped.append({'batch': token(base.name), 'reason': 'directory_missing'})
            continue
        run_dirs = []
        if (base / 'state/run.json').is_file():
            run_dirs = [base]
        else:
            for current, dirs, files in os.walk(base):
                # Discover only state directories, never traverse evidence or content trees.
                dirs[:] = [d for d in dirs if d not in {'evidence', 'solution', 'tests', 'private',
                    'product', 'public', 'statements', 'configs', 'judges', '.git', 'node_modules',
                    'workspace', 'opencode'} and not (Path(current) / d).is_symlink()]
                if Path(current).name == 'state' and 'run.json' in files:
                    run_dirs.append(Path(current).parent)
                    dirs[:] = []
        if not run_dirs:
            skipped.append({'batch': token(base.name), 'reason': 'no_state_run_json'})
        for run in sorted(run_dirs):
            if run in seen:
                continue
            seen.add(run)
            try:
                state = read_json(run / 'state/run.json')
                if not isinstance(state, dict) or not isinstance(state.get('runId'), str):
                    raise ValueError('invalid_state')
                ap = run / 'evidence/control-audit.json'
                audit = read_json(ap) if ap.exists() else None
                if audit is not None and (not isinstance(audit, list) or
                        any(not isinstance(a, dict) for a in audit)):
                    raise ValueError('invalid_audit')
                rid = state['runId']
                meta_path = next((p / 'batch-meta.json' for p in (run, *run.parents)
                                  if (p / 'batch-meta.json').is_file()), None)
                meta = read_json(meta_path) if meta_path is not None else {}
                profile = run_profile(run, rid, profile_dirs)
                census = workbook_candidates(run, rid)
                row = run_record(state, audit, index.get(rid, {}), meta, corrections.get(rid),
                                 run.name, profile, census)
                row.update(workbook_view_metrics(run, rid, audit))
                rows.append(row)
            except (OSError, ValueError, TypeError, KeyError):
                skipped.append({'batch': token(base.name), 'run': token(run.name), 'reason': 'invalid_structured_run'})
    rows.sort(key=lambda r: (r['batch'], r['run']))
    groups = collections.defaultdict(list)
    for row in rows:
        groups[(row['challenge'], row['product_head'], row['product_dirty'], row['product_source'])].append(row)
    grouped = []
    for (challenge, head, dirty, source), members in sorted(groups.items(), key=lambda x: str(x[0])):
        grouped.append({'challenge': challenge, 'product_head': head, 'product_dirty': dirty,
            'product_source': source, 'runs': len(members), **counts(members)})
    omitted_runs = [r for r in rows if r['omitted_distinct']]
    return {'runs': rows, 'groups': grouped, 'totals': {'runs': len(rows),
        'batches': len({r['batch'] for r in rows}), 'challenges': len({r['challenge'] for r in rows
            if r['challenge'] != 'unknown'}), **counts(rows),
        'runs_with_omission': len(omitted_runs),
        'unsolved_runs_with_omission': sum(r['solved'] is False for r in omitted_runs),
        'first_omission_minutes': sorted(r['first_omission_min'] for r in omitted_runs
                                         if r['first_omission_min'] is not None)}, 'skipped': skipped}


RESULTS = ('candidate_claimed', 'packaged', 'submitted', 'solved', 'posthoc_accepted')
CANDIDATE_COUNTS = ('candidate_entries_total', 'candidate_active_at_end', 'candidate_withdrawn')


def counts(rows):
    summary = {field: {label: sum(('true' if r[field] is True else 'false' if r[field] is False
        else 'null' if r[field] is None else 'unknown') == label for r in rows)
        for label in ('true', 'false', 'unknown', 'null')} for field in RESULTS}
    summary.update({field: sum(r[field] for r in rows if isinstance(r[field], int))
                    for field in CANDIDATE_COUNTS})
    return summary


def run_record(state, audit, rec, meta, correction, run_name, profile, census):
    accepted = [a for a in (audit or []) if a.get('allow')]
    slots = [v for v in (meta.get('slots') or {}).values() if v.get('runId') == state['runId']]
    batch = batch_for_run(state, profile, meta, slots)
    profile_ms = (profile.get('budget') or {}).get('wallClockMs')
    profile_ms = profile_ms if is_number(profile_ms) and profile_ms > 0 else None
    total, active, withdrawn, first_candidate_at = census if census is not None else (
        'unknown', 'unknown', 'unknown', None)
    candidate = total > 0 if census is not None else 'unknown'
    times = candidate_audit_timing(audit, first_candidate_at, profile_ms)
    declared = {key_of(token(v)) for v in [rec.get('challenge'), *(s.get('challenge') for s in slots)]
        if token(v) != 'unknown'}
    observed = {key_of(token((a.get('detail') or {}).get('challengeId'))) for a in (audit or [])
        if a.get('op') in ('bind', 'dispatch.register') and
        token((a.get('detail') or {}).get('challengeId')) != 'unknown'}
    challenges = declared | observed
    challenge = next(iter(challenges)) if len(challenges) == 1 else 'unknown'
    packaged = any(a.get('op') == 'package.published' for a in accepted) if audit is not None else 'unknown'
    if is_number(rec.get('first_package_min')):
        packaged = True
    completion = [(a.get('detail') or {}) for a in accepted if a.get('op') == 'completion.saved']
    submitted = any(c.get('sent') is True or isinstance(c.get('sentAt'), (int, float)) for c in completion)
    if audit is None:
        submitted = 'unknown'
    # A saved completion is not necessarily sent, and a refused request is not a submission.
    solved = any(c.get('solved') is True for c in completion) if completion else 'unknown'
    if isinstance(state.get('solved'), bool):
        solved = state['solved']
    elif isinstance(rec.get('solved'), bool):
        solved = rec['solved']
    elif isinstance((rec.get('outcome') or {}).get('solved'), bool):
        solved = rec['outcome']['solved']
    elif audit is not None and state.get('status') in ('completed', 'deadline_exceeded', 'budget_exceeded', 'failed'):
        solved = any(c.get('solved') is True for c in completion)
    revision = state.get('productRevision') or {}
    head = revision.get('commit')
    head = head[:12] if isinstance(head, str) and re.fullmatch(r'[0-9a-f]{8,40}', head) else 'unknown'
    thinking = (((state.get('agentOptions') or {}).get('domain-solver') or {}).get('thinking') or {}).get('type')
    budget_ms = profile_ms if profile_ms is not None else (state.get('budget') or {}).get('wallClockMs')
    timeline = state.get('timeline') or []
    starts = [x.get('t') for x in timeline if x.get('event') == 'start' and isinstance(x.get('t'), (int, float))]
    ends = [x.get('t') for x in timeline if x.get('event') == 'opencode_closed' and isinstance(x.get('t'), (int, float))]
    recorded_wall = rec.get('wall_clock_min')
    elapsed = round((max(ends) - min(starts)) / 60000, 2) if starts and ends else (
        recorded_wall if is_number(recorded_wall) else 'unavailable')
    usage = state.get('usageTotal') or {}
    numbers = [usage.get(k) for k in ('input_tokens', 'output_tokens', 'reasoning_tokens')]
    observable = sum(numbers) if usage.get('availability') not in (None, 'unavailable') and all(
        isinstance(n, int) and n >= 0 for n in numbers) else 'unavailable'
    return {'batch': batch, 'run': token(state.get('runId'), token(run_name)), 'challenge': challenge,
        'product_head': head, 'product_dirty': revision.get('productDirty') if isinstance(revision.get('productDirty'), bool) else 'unknown',
        'product_source': token(rec.get('product_source') or rec.get('productSource')),
        'model': token(state.get('model')), 'solver_thinking': token(thinking),
        'deadline_min': budget_ms / 60000 if is_number(budget_ms) else 'unknown',
        'arm': token(rec.get('arm') or meta.get('arm')), 'candidate_claimed': candidate,
        'candidate_source': 'workbook' if census is not None else 'unavailable',
        'candidate_entries_total': total, 'candidate_active_at_end': active,
        'candidate_withdrawn': withdrawn, 'packaged': packaged, 'submitted': submitted,
        'solved': solved, 'posthoc_accepted': correction, 'stop_reason': token(state.get('stopReason')),
        'wall_clock_min': elapsed, 'wall_minutes': elapsed, **times, 'observable_tokens': observable,
        'usage_lower_bound': usage.get('lowerBound') if isinstance(usage.get('lowerBound'), bool) else 'unknown'}


def default_gates():
    paths = []
    for pattern in ('workbook-*/summary.json', 'runtime-diag-*/summary.json'):
        paths.extend(sorted((REPO / 'docs/gates').glob(pattern)))
    return sorted(set(paths))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directories', nargs='*', type=Path)
    parser.add_argument('--gate-summary', action='append', type=Path, default=[])
    parser.add_argument('--profile-dir', action='append', type=Path, default=[],
                        help='additional directory containing <runId>.profile.json files')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        dump(self_test())
        return
    if not args.directories:
        parser.error('provide batch or run directories')
    report = collect(args.directories, [*default_gates(), *args.gate_summary], args.profile_dir)
    if args.output:
        dump(report, args.output)
    for row in report['runs']:
        print(json.dumps(row, ensure_ascii=False))
    dump({'groups': report['groups'], 'totals': report['totals'], 'skipped': report['skipped']})


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        dump({'error': type(exc).__name__})
        sys.exit(1)
