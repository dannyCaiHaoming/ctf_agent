"""Small offline helpers for structured evidence."""
import json
import os
import collections
from contextlib import closing
from math import isfinite
from pathlib import Path
import re
import sqlite3
import subprocess

REPO = Path(__file__).resolve().parents[2]
GATE = REPO / 'docs/gates/candidate-baseline-20261119'
FORBIDDEN = {'solution', 'tests', 'private', '.git', 'node_modules'}
# VIEWS and COORDINATOR_MAX_CHARS in apps/launcher/src/workbook.ts.
WORKBOOK_CAPS = {'coordinator': 8000, 'domain-solver': 12000, 'engineer': 4000, 'recon': 12000}
CONTROL_ROLES = (*WORKBOOK_CAPS, 'intake', 'reference', 'strategy', 'verifier', 'recovery-critic')
WORKBOOK_STATUSES = (None, 'open', 'supported', 'refuted', 'answered', 'dropped', 'proposed', 'withdrawn')


def token(value, default='unknown'):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_./:@+\-]+', value) else default


def key_of(name):
    return re.sub(r'^(?:alibabactf-)?\d{4}-web-', '', name, flags=re.I)


def read_json(path):
    return json.loads(Path(path).read_text())


def dump(value, path=None):
    text = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    # All output records are metadata. A content-shaped value must never escape.
    if re.search(r'flag\{(?!synthetic)', text, re.I):
        raise ValueError('unsafe_output')
    if path is None:
        print(text, end='')
    else:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        path.chmod(0o644)


def audit_milestones(audit):
    """Same allow/op/t rules as workbook-run-check, without reading its broader inputs."""
    minutes = lambda t: None if t is None else round(t / 60000, 2)
    first = lambda op, role=None: min((a['t'] for a in audit if a.get('allow') and
        a.get('op') == op and (role is None or (a.get('detail') or {}).get('role') == role)), default=None)
    dispatch = [a for a in audit if a.get('op') == 'dispatch.register' and a.get('allow')]
    roles = sorted({(a.get('detail') or {}).get('role') for a in dispatch} - {None})
    return {
        'first_dispatch_min': {r: minutes(first('dispatch.register', r)) for r in roles},
        'dispatches': dict(collections.Counter((a.get('detail') or {}).get('role') for a in dispatch)),
        'first_package_min': minutes(first('package.published')),
        'first_completion_min': minutes(first('completion.saved')),
        'last_audit_min': minutes(max((a.get('t') or 0 for a in audit), default=None)),
    }


def workbook_query(run, run_id, query):
    """Read metadata from the nearest workbook holding this run."""
    for path in (run / 'experience.sqlite', run.parent / 'experience.sqlite'):
        if not path.is_file():
            continue
        try:
            wal = path.with_name(path.name + '-wal')
            shm = path.with_name(path.name + '-shm')
            pending_wal = wal.is_file() and wal.stat().st_size > 0
            if pending_wal and not shm.is_file():
                # A read-only connection cannot reconstruct SHM beside the source.
                continue
            mode = 'mode=ro' if pending_wal else 'mode=ro&immutable=1'
            with closing(sqlite3.connect(f'{path.as_uri()}?{mode}', uri=True)) as db:
                if db.execute('SELECT 1 FROM recon_turns WHERE run_id=? LIMIT 1',
                              (run_id,)).fetchone() is None:
                    continue
                return db.execute(query, (run_id,)).fetchall()
        except (OSError, sqlite3.Error):
            continue
    return None


def workbook_candidates(run, run_id):
    rows = workbook_query(run, run_id, """
        WITH entries AS (
            SELECT id, challenge_id, created_at,
                   json_extract(note_json, '$.slot') AS slot,
                   json_extract(note_json, '$.status') AS status,
                   json_extract(note_json, '$.supersedes') AS supersedes
            FROM recon_turns
            WHERE run_id=? AND kind='decision'
        )
        SELECT count(*),
               count(CASE WHEN a.status IS NOT 'withdrawn' AND NOT EXISTS (
                   SELECT 1 FROM entries b
                   WHERE b.challenge_id=a.challenge_id AND b.supersedes=a.id
               ) THEN 1 END),
               count(CASE WHEN a.status='withdrawn' THEN 1 END),
               min(a.created_at)
        FROM entries a
        WHERE a.slot='candidate'
    """)
    return rows[0] if rows is not None else None


def workbook_presentations(audit):
    """Collect per-role view sizes and distinct omitted IDs from audit metadata."""
    def view_counts(role):
        return {
            'max_chars': None, 'cap_chars': WORKBOOK_CAPS.get(role), 'max_ratio': None,
            'presentations': 0 if audit is not None else None,
            'presentations_with_omission': 0 if audit is not None else None,
        }

    views = {role: view_counts(role) for role in WORKBOOK_CAPS}
    events = sorted((a for a in (audit or []) if a.get('op') == 'context.presented'),
                    key=lambda a: a['at'] if is_number(a.get('at')) else float('inf'))
    origin = events[0].get('at') if events else None
    omitted = set()
    first_minute = first_role = None
    for event in events:
        workbook = (event.get('detail') or {}).get('workbook')
        if not isinstance(workbook, dict):
            continue
        role = event.get('role')
        role = role if role in CONTROL_ROLES else 'unknown'
        if role not in views:
            views[role] = view_counts(role)
        view = views[role]
        view['presentations'] += 1
        chars = workbook.get('chars')
        if is_number(chars) and chars >= 0 and (view['max_chars'] is None or chars > view['max_chars']):
            view['max_chars'] = chars
            if view['cap_chars'] is not None:
                view['max_ratio'] = round(chars / view['cap_chars'], 6)
        ids = workbook.get('omitted_ids')
        ids = {entry_id for entry_id in ids if type(entry_id) is int} if isinstance(ids, list) else set()
        if ids:
            view['presentations_with_omission'] += 1
            omitted.update(ids)
            if first_role is None:
                first_role = role
                if is_number(event.get('at')) and is_number(origin):
                    first_minute = round((event['at'] - origin) / 60000, 2)
    return views, omitted, first_minute, first_role


def workbook_view_metrics(run, run_id, audit):
    views, omitted, first_minute, first_role = workbook_presentations(audit)
    rows = workbook_query(run, run_id, """
        SELECT id, role, json_extract(note_json, '$.slot') AS slot,
               json_extract(note_json, '$.status'), json_extract(note_json, '$.supersedes')
        FROM recon_turns
        WHERE run_id=? AND kind='decision'
          AND slot IN ('facts', 'hypotheses', 'refuted', 'questions', 'candidate')
        ORDER BY id
    """)
    entries = {}
    active = set()
    peak = 0
    total_writes = collections.Counter()
    supersede_writes = collections.Counter()
    for entry_id, role, slot, status, supersedes in rows or ():
        role = role if role in CONTROL_ROLES else 'unknown'
        status = status if status in WORKBOOK_STATUSES else 'unknown'
        entries[entry_id] = (slot, status, role)
        total_writes[role] += 1
        if type(supersedes) is int:
            supersede_writes[role] += 1
            active.discard(supersedes)
        # Closed entries remain active until another write supersedes them.
        active.add(entry_id)
        peak = max(peak, len(active))

    kinds = collections.Counter(entries.get(entry_id, ('unknown', 'unknown', 'unknown'))
                                for entry_id in omitted)
    active_omissions = omitted & active
    # Audit delivery time does not identify the exact workbook revision at presentation.
    joined = audit is not None and omitted <= entries.keys()
    return {
        'workbook_view': views,
        'first_omission_min': first_minute,
        'first_omission_role': first_role,
        'omitted_distinct': len(omitted) if audit is not None else None,
        'omitted_kinds': [
            {'slot': slot, 'status': status, 'role': role, 'count': count}
            for (slot, status, role), count in sorted(kinds.items(), key=lambda item: str(item[0]))
        ] if audit is not None else None,
        'omitted_active': {
            'basis': 'run_end',
            'total': len(active_omissions) if joined else None,
            'open_hypotheses': sum(entries[i][:2] == ('hypotheses', 'open') for i in active_omissions)
            if joined else None,
            'open_questions': sum(entries[i][:2] == ('questions', 'open') for i in active_omissions)
            if joined else None,
        },
        'active_entries': {'max': peak, 'end': len(active)} if rows is not None else {'max': None, 'end': None},
        'total_writes': {
            'all': len(entries) if rows is not None else None,
            'domain-solver': total_writes['domain-solver'] if rows is not None else None,
        },
        'supersede_writes': {
            'all': sum(supersede_writes.values()) if rows is not None else None,
            'domain-solver': supersede_writes['domain-solver'] if rows is not None else None,
        },
    }


def is_number(value):
    return type(value) in (int, float) and isfinite(value)


def candidate_audit_timing(audit, first_candidate_at, wall_clock_ms):
    """Use only absolute audit timestamps and event identities for timing."""
    events = sorted((a for a in (audit or []) if is_number(a.get('at'))),
                    key=lambda a: a['at'])
    origin = events[0]['at'] if events else None

    def minutes_since_start(at):
        return round((at - origin) / 60000, 2) if origin is not None and is_number(at) else None

    dispatches = {}
    first_package_at = None
    stop_index = None
    for index, event in enumerate(events):
        op = event.get('op')
        detail = event.get('detail') or {}
        if op == 'dispatch.register' and detail.get('role') in ('engineer', 'recovery-critic'):
            dispatches.setdefault(detail.get('role'), index)
        elif op == 'package.published' and first_package_at is None:
            first_package_at = event['at']
        elif op == 'progress.note' and detail.get('route') == 'stop_and_report' and stop_index is None:
            stop_index = index

    engineer_index = dispatches.get('engineer')
    engineer_at = events[engineer_index]['at'] if engineer_index is not None else None
    critic_index = dispatches.get('recovery-critic')
    critic_at = events[critic_index]['at'] if critic_index is not None else None
    stop_at = events[stop_index]['at'] if stop_index is not None else None
    critic_route = None
    solver_work = None
    if critic_index is not None:
        first_note = next((a for a in events[critic_index + 1:] if a.get('op') == 'progress.note'), None)
        if first_note is not None:
            critic_route = token((first_note.get('detail') or {}).get('route'), None)
        if stop_index is not None and critic_index < stop_index:
            work = [a for a in events[critic_index + 1:stop_index] if a.get('role') == 'domain-solver'
                    and a.get('op') in ('model.call', 'tool.registered')]
            counts = collections.Counter(a['op'] for a in work)
            solver_work = {
                'model_calls': counts['model.call'],
                'tools_registered': counts['tool.registered'],
                'span_min': round((work[-1]['at'] - work[0]['at']) / 60000, 2) if work else None,
            }
    return {
        'first_candidate_entry_min': minutes_since_start(first_candidate_at),
        'first_package_min': minutes_since_start(first_package_at),
        'candidate_to_engineer_min': round((engineer_at - first_candidate_at) / 60000, 2)
        if engineer_at is not None and is_number(first_candidate_at) else None,
        'critic_first_min': minutes_since_start(critic_at),
        'critic_first_route': critic_route,
        'stop_note_min': minutes_since_start(stop_at),
        'remaining_at_stop_min': round(max(0, wall_clock_ms - (stop_at - origin)) / 60000, 2)
        if stop_at is not None and wall_clock_ms is not None else None,
        'solver_work_after_critic': solver_work,
    }


def compose_structure(path):
    """Parse with the already-installed YAML package; subprocess emits a whitelist only.

    Values of environment variables, command, entrypoint and build arguments never leave Node.
    No compose command, Docker invocation or application code is executed.
    """
    script = r'''
const fs = require('node:fs'), Y = require('yaml');
try {
 const doc = Y.parse(fs.readFileSync(process.argv[1], 'utf8'));
 const safe = x => typeof x === 'string' && /^[A-Za-z0-9_./:@+\-]+$/.test(x) ? x : null;
 const port = p => { const n = typeof p === 'object' ? p.target : String(p).split(':').at(-1).split('/')[0];
   return /^\d+$/.test(String(n)) && Number(n)>0 && Number(n)<65536 ? Number(n) : null; };
 const services = Object.entries(doc.services || {}).map(([name,s]) => ({name:safe(name),
   ports:[...(s.expose||[]),...(s.ports||[])].map(port).filter(x=>x!==null),
   environment_names:(Array.isArray(s.environment)?s.environment.map(x=>String(x).split('=')[0]):Object.keys(s.environment||{})).map(safe).filter(Boolean),
   image:safe(s.image), build_present:!!s.build}));
 process.stdout.write(JSON.stringify({ok:services.length>0,services}));
} catch { process.stdout.write(JSON.stringify({ok:false,services:[]})); }
'''
    result = subprocess.run(['node', '-e', script, str(path)], cwd=REPO,
                            capture_output=True, text=True, timeout=15)
    if result.returncode:
        return {'ok': False, 'services': [], 'reason': 'yaml_parser_unavailable'}
    return json.loads(result.stdout)


def environment_files(root):
    """Walk build context only, refusing symlinks and protected subtrees."""
    for current, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if d not in FORBIDDEN and not (Path(current) / d).is_symlink()]
        for name in sorted(files):
            path = Path(current) / name
            if not path.is_symlink():
                yield path
