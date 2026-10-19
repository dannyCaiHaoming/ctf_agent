#!/usr/bin/env python3
"""Grade OpenCode trajectory 1 from canonical SQLite/artifacts; never invoke a model."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import sys


def grade(folder):
    folder = folder.resolve()
    databases = list((folder / 'state').glob('*.sqlite'))
    if len(databases) != 1:
        return {'passed': False, 'reason': 'exactly one canonical database required'}
    db = sqlite3.connect(databases[0].as_uri() + '?mode=ro', uri=True)
    try:
        events = [(seq, json.loads(payload)) for seq, payload in db.execute('SELECT seq,payload FROM events ORDER BY seq')]
        effects = [dict(zip(('id', 'state', 'outcome', 'response', 'payload'), row)) for row in db.execute(
            "SELECT id,state,business_outcome,response,payload FROM effects WHERE operation='candidate.submit'")]
    finally:
        db.close()
    checks, blobs = {}, {}
    seen_refs = set()

    def collect(value):
        if isinstance(value, dict):
            if {'hash', 'size', 'path'} <= value.keys() and (value['hash'], value['size'], value['path']) not in seen_refs:
                path = Path(value['path']).resolve()
                if not path.is_relative_to((folder / 'artifacts-store').resolve()):
                    raise ValueError('artifact outside this run')
                raw = path.read_bytes()
                if len(raw) != value['size'] or hashlib.sha256(raw).hexdigest() != value['hash']:
                    raise ValueError('artifact hash/size mismatch')
                seen_refs.add((value['hash'], value['size'], value['path']))
                first_content = value['hash'] not in blobs
                blobs[value['hash']] = raw
                if first_content:
                    try:
                        collect(json.loads(raw))
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass
            for item in value.values():
                collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    try:
        collect([event for _, event in events])
        checks['artifact_integrity'] = True
    except (OSError, ValueError, TypeError, KeyError) as error:
        return {'passed': False, 'reason': str(error), 'checks': {'artifact_integrity': False}}
    starts = [(seq, event) for seq, event in events if event.get('activity') == 'started']
    terminals = [(seq, event) for seq, event in events if event.get('activity') == 'checkpoint']
    if len(starts) != 1 or len(terminals) != 1:
        return {'passed': False, 'reason': 'one canonical start and checkpoint required'}
    _, start = starts[0]
    final_seq, final = terminals[0]
    scope = {key: start[key] for key in ('runId', 'challengeId', 'taskId', 'sessionId')}
    activity = [(seq, event) for seq, event in events if all(event.get(key) == value for key, value in scope.items())]
    checks['opencode_session'] = start['data'].get('engine') == 'opencode' and scope['sessionId'].startswith('ses_')
    checks['opencode_model_calls'] = any(event.get('activity') == 'driver.call' and event['data'].get('engine') == 'opencode'
                                        for _, event in activity)
    tools = [(seq, event['data']) for seq, event in activity if event.get('activity') == 'tool.result']
    commands = {event['data']['receipt_id']: event['data'].get('input', {}).get('command')
                for _, event in activity if event.get('activity') == 'tool.started' and event['data'].get('tool') == 'job.run'}
    failures = [(seq, data) for seq, data in tools if data.get('tool') == 'job.run' and
                isinstance(data.get('exit_code'), int) and data['exit_code'] != 0 and
                data.get('observation', {}).get('complete') is True and data.get('stderr_ref', {}).get('size', 0) > 0 and
                data['observation'].get('raw', '').encode() == blobs.get(data['stderr_ref']['hash'])]
    successes = [(seq, data) for seq, data in tools if data.get('tool') == 'job.run' and data.get('exit_code') == 0 and
                 data.get('observation', {}).get('complete') is True and data['observation'].get('outcome') == 'success']
    delivered = [(seq, event['data']) for seq, event in activity if event.get('activity') == 'tool.chunk' and
                 event['data'].get('stream') == 'stderr' and event['data'].get('delivered_to_model') is True]
    patch_starts = {event['data']['receipt_id']: event['data'].get('input', {}) for _, event in activity
                    if event.get('activity') == 'tool.started' and event['data'].get('tool') == 'workspace.patch'}
    patches = []
    local = True
    for seq, data in tools:
        if data.get('tool') != 'workspace.patch' or data.get('observation', {}).get('outcome') != 'success':
            continue
        try:
            patch = json.loads(data['observation']['raw'])
            before, after = blobs[patch['before']['hash']], blobs[patch['after']['hash']]
            args = patch_starts[data['receipt_id']]
            find, replace = args['find'].encode(), args['replace'].encode()
            # Validate a proper local substring operation, without prescribing its
            # bytes, number of patches, byte delta, or the intended repair.
            valid = bool(find) and find.strip() != before.strip() and before.count(find) == 1 and before != after and (
                before.replace(find, replace, 1) == after) and patch['path'] == args['path']
            local = local and valid
            patches.append((seq, patch))
        except (KeyError, ValueError, TypeError):
            local = False
    checks['local_patch_operations'] = bool(patches) and local
    chains = [(failed_seq, success_seq, data) for failed_seq, failed in failures for success_seq, data in successes
              if commands.get(failed['receipt_id']) == commands.get(data['receipt_id']) and
              any(failed_seq < read_seq < patch_seq < success_seq and read.get('receipt_id') == failed['receipt_id'] and
                  read.get('artifact_ref') == failed.get('stderr_ref') and
                  patch['path'] == commands[data['receipt_id']][1]
                  for read_seq, read in delivered for patch_seq, patch in patches)]
    checks['failed_stderr_model_patch_success_chain'] = bool(chains)
    accepted = [(seq, event['data']) for seq, event in activity if event.get('activity') == 'candidate' and
                event['data'].get('status') == 'accepted' and event['data'].get('authoritative') is True]
    chosen_seq, chosen = accepted[0] if len(accepted) == 1 else (0, {})
    candidate, resolution = chosen.get('candidate', {}), chosen.get('resolution', {})
    value_ref = candidate.get('value_ref', {})
    value = blobs.get(value_ref.get('hash'))
    evidence = candidate.get('evidence_refs', [])
    checks['candidate_bound_to_successful_stdout'] = len(evidence) == 1 and any(
        data.get('stdout_ref') == evidence[0] and value is not None and
        blobs[evidence[0]['hash']].removesuffix(b'\n') == value for _, _, data in chains)
    verification = resolution.get('verification', {})
    checks['current_verification'] = verification.get('status') == 'verified' and verification.get('current') is True and (
        verification.get('candidateHash') == value_ref.get('hash')) and verification.get('generation') == chosen.get('generation') == 1
    checks['oracle_accepted'] = any(effect['id'] == resolution.get('submit_effect_id') and effect['state'] == 'confirmed' and
        json.loads(effect['outcome'] or 'null') == 'accepted' and json.loads(effect['response'] or '{}').get('authoritative') is True and
        json.loads(effect['response'] or '{}').get('completed') is True and
        json.loads(effect['payload']).get('candidate', '').encode() == value and
        json.loads(effect['payload']).get('challengeId') == scope['challengeId'] and
        json.loads(effect['payload']).get('task') == scope['taskId'] and
        json.loads(effect['payload']).get('lease') == start['data'].get('binding', {}).get('lease_id') for effect in effects)
    completed = {event['data']['stage']: seq for seq, event in activity if event.get('activity') == 'candidate.stage' and
                 event['data'].get('candidate_id') == chosen.get('candidate_id') and event['data'].get('state') == 'completed'}
    checks['ordered_independent_verification_and_submit'] = 0 < completed.get('engineering', 0) < completed.get('verification', 0) < (
        completed.get('oracle_submit', 0)) < chosen_seq < final_seq
    receipts = []
    receipt_hashes = {ref['hash'] for ref in resolution.get('evidence_refs', [])}
    for digest, raw in blobs.items():
        if digest not in receipt_hashes:
            continue
        try:
            decoded = json.loads(raw)
            if isinstance(decoded, dict) and decoded.get('schema') == 'ctf-host-execution-receipt/v1':
                receipts.append(decoded)
        except (ValueError, UnicodeDecodeError):
            pass
    checks['independent_replay_receipt'] = any(receipt.get('mode') == 'replay' and receipt.get('status') == 'completed' and
        receipt.get('exitCode') == 0 and receipt.get('outputRef') == value_ref and receipt.get('generation') == 1 and
        Path(receipt.get('cwd', '')).resolve().parent == (folder / 'workspaces').resolve() and Path(receipt.get('cwd', '')).name != scope['taskId'] and
        all(ref in receipt.get('inputRefs', []) for ref in evidence) and
        any(patch['after'] in receipt.get('inputRefs', []) for _, patch in patches) for receipt in receipts)
    checks['solved_checkpoint'] = all(final['data'].get(key) == expected for key, expected in
                                      {'status': 'solved', 'outcome': 'solved', 'solve_state': 'finished'}.items()) and all(
                                          final.get(key) == value for key, value in scope.items())
    return {'passed': all(checks.values()), 'checks': checks, 'run_id': scope['runId'],
            'database_sha256': hashlib.sha256(databases[0].read_bytes()).hexdigest()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['grade', 'check', 'run-next'])
    parser.add_argument('folder', nargs='?')
    parser.add_argument('--deterministic', action='store_true', help='label local deterministic-provider evidence; not formal model acceptance')
    args = parser.parse_args()
    if args.action != 'grade':
        print(json.dumps({'blocked': True, 'reason': 'STOP_RULE: external model acceptance is paused; the old 12-attempt batch stays frozen. T-D requires a separately frozen OpenCode batch.'}))
        sys.exit(2)
    try:
        result = grade(Path(args.folder))
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError, sqlite3.Error) as error:
        result = {'passed': False, 'reason': str(error)}
    result['evidence_kind'] = 'deterministic_local_provider' if args.deterministic else 'canonical_behavior_only'
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result['passed'] else 1)
