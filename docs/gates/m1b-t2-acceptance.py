#!/usr/bin/env python3
"""Read-only trajectory 2 behavior grading. Never starts a model or an attempt."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys

sys.dont_write_bytecode = True

# Reuse the existing, unchanged artifact/oracle/current-verification checks;
# T1's repair and stderr checks are deliberately not trajectory 2 requirements.
spec = importlib.util.spec_from_file_location('t1_acceptance', Path(__file__).with_name('m1-t1-acceptance.py'))
t1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t1)
COMMON = ('artifact_integrity', 'opencode_session', 'opencode_model_calls', 'current_verification',
          'oracle_accepted', 'ordered_independent_verification_and_submit', 'solved_checkpoint')


def command(value):
    if not isinstance(value, list) or len(value) < 2:
        return None
    return ['node' if Path(value[0]).name == 'node' else value[0], os.path.normpath(value[1]), *value[2:]]


def is_arithmetic_expression(value):
    if not isinstance(value, str) or re.fullmatch(r'[0-9\s.+*/%()\-]+', value) is None or re.search(r'[0-9]', value) is None:
        return False
    try:
        # Syntax check only, with the same Node grammar as the host. Input is
        # never evaluated and cannot contain identifiers, strings or statements.
        return subprocess.run(['node', '--check'], input=f'({value}\n)', text=True,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def grade(folder):
    folder = folder.resolve()
    base = t1.grade(folder)
    checks = {key: base.get('checks', {}).get(key, False) for key in COMMON}
    if not checks['artifact_integrity']:
        return {'passed': False, 'checks': checks, 'reason': base.get('reason')}
    db = sqlite3.connect(next((folder / 'state').glob('*.sqlite')).as_uri() + '?mode=ro', uri=True)
    try:
        rows = [(seq, json.loads(payload)) for seq, payload in db.execute('SELECT seq,payload FROM events ORDER BY seq')]
        checkpoints = [json.loads(payload) for (payload,) in db.execute('SELECT payload FROM checkpoints')]
    finally:
        db.close()
    start = next(event for _, event in rows if event.get('activity') == 'started')
    scope = {key: start[key] for key in ('runId', 'challengeId', 'taskId', 'sessionId', 'attemptId')}
    events = [(seq, event) for seq, event in rows if all(event.get(key) == val for key, val in scope.items())]
    tools = [(seq, event['data']) for seq, event in events if event.get('activity') == 'tool.result']
    starts = {event['data']['receipt_id']: (seq, event['data']) for seq, event in events if event.get('activity') == 'tool.started'}
    experiments = [(seq, event['data']) for seq, event in events if event.get('activity') == 'experiment.started']
    finals = [event for _, event in events if event.get('activity') == 'checkpoint']
    checks['trajectory2_material_isolation'] = start['data']['challenge'].get('trajectory') == 't2' and not any(
        re.match(r'readme(?:\.|$)', path, re.I) for path in start['data']['challenge'].get('workspace_files', []))

    def blob(ref):
        # t1.grade has already recursively checked hash, size and run-local paths.
        return Path(ref['path']).read_bytes()

    def tool_json(data):
        observation = data.get('observation', {})
        refs = observation.get('artifact_refs', [])
        if observation.get('outcome') != 'success' or len(refs) != 1 or blob(refs[0]) != observation.get('raw', '').encode():
            raise ValueError('semantic tool result lacks its immutable raw artifact')
        return json.loads(observation['raw'])

    names = ('ordered_model_premise_probe_delivery_rejection', 'different_route_actually_executed',
             'canonical_rejection_and_checkpoint', 'no_rejected_route_retry',
             'candidate_bound_to_new_route_stdout', 'independent_replay_receipt')
    checks.update({name: False for name in names})
    for conclusion_seq, event in events:
        if event.get('activity') != 'hypothesis.conclusion' or event['data'].get('conclusion', {}).get('verdict') != 'rejected':
            continue
        conclusion = event['data']
        try:
            exp_seq, exp = next((seq, data) for seq, data in experiments if data['experiment']['id'] == conclusion['experiment_id'])
            proposal_seq, proposed = next((seq, tool_json(data)) for seq, data in tools
                if data.get('tool') == 'hypothesis.propose' and data.get('receipt_id') == exp.get('proposal_receipt_id'))
            proposed_start, proposal_call = starts[exp['proposal_receipt_id']]
            result_seq, result = next((seq, data) for seq, data in tools if data.get('receipt_id') == exp['derived_from'])
            original = command(exp['experiment']['procedure'][0]['input']['command'])
            raw = blob(result['stdout_ref'])
            literal = json.loads(raw)
            delivered_seq = next(seq for seq, read in events if read.get('activity') == 'tool.chunk' and
                read['data'].get('stream') == 'stdout' and read['data'].get('delivered_to_model') is True and
                read['data'].get('receipt_id') == result['receipt_id'] and read['data'].get('artifact_ref') == result['stdout_ref'])
            model_conclusion_seq, _ = next((seq, data) for seq, data in starts.values() if data.get('tool') == 'hypothesis.conclude' and
                data.get('input', {}).get('verdict') == 'rejected' and data['input'].get('rationale') == conclusion['conclusion']['rationale'] and
                delivered_seq < seq < conclusion_seq)
            checks['ordered_model_premise_probe_delivery_rejection'] = (
                proposed_start < proposal_seq < exp_seq < result_seq < delivered_seq < model_conclusion_seq < conclusion_seq and
                proposed['hypothesis']['id'] == conclusion['hypothesis_id'] == exp['hypothesis']['id'] and
                proposed['hypothesis']['claim'] == proposal_call['input']['claim'] and
                proposed['hypothesis']['falsifier'] == proposal_call['input']['falsifier'] and
                proposed['prediction'] == exp['prediction'] == proposal_call['input']['prediction'] == 'expression_evaluates' and
                command(proposal_call['input']['command']) == command(proposed['command']) == original and
                literal.get('mode') == 'literal' and len(original) == 3 and literal.get('value') == original[2] and
                is_arithmetic_expression(original[2]) and
                result.get('exit_code') == 0 and result['observation'].get('outcome') == 'success' and
                result['observation'].get('complete') is True and raw == result['observation'].get('raw', '').encode() and
                result['receipt']['artifact_refs'] == conclusion['conclusion']['evidence_refs'] == [result['stdout_ref']])
            snapshot = json.loads(blob(finals[0]['data']['hypothesis_snapshot_ref']))
            rejected = next(item for item in snapshot['experiments'] if item['plan']['id'] == conclusion['experiment_id'])
            hypothesis = next(item for item in snapshot['hypotheses'] if item['id'] == conclusion['hypothesis_id'])
            checks['canonical_rejection_and_checkpoint'] = (
                rejected['status'] == 'succeeded' and rejected['conclusion'] == conclusion['conclusion'] and
                rejected['fingerprint'] == exp['fingerprint'] and hypothesis['state'] == 'rejected' and
                hypothesis['contradicting_refs'] == [result['stdout_ref']] and
                any(rejected['fingerprint'] in cp.get('rejectedFingerprints', []) for cp in checkpoints))
            switch_seq, switch = next((seq, e['data']) for seq, e in events if seq > conclusion_seq and
                e.get('activity') == 'strategy.switch' and e['data'].get('from') == hypothesis['id'])
            next_proposal_seq, next_proposal = next((seq, tool_json(data)) for seq, data in tools if
                data.get('tool') == 'hypothesis.propose' and data.get('receipt_id') == switch['proposal_receipt_id'])
            next_seq, new_exp = next((seq, data) for seq, data in experiments if data['hypothesis']['id'] == switch['to'])
            new_result_seq, new_result = next((seq, data) for seq, data in tools if data.get('receipt_id') == new_exp['derived_from'])
            checks['different_route_actually_executed'] = (
                conclusion_seq < switch_seq < next_proposal_seq < next_seq < new_result_seq and
                bool(switch.get('rationale', '').strip()) and switch['rationale'] == next_proposal['route_reason'] and
                switch['evidence_refs'] == [result['stdout_ref']] and next_proposal['prediction'] == 'other' and
                command(new_exp['experiment']['procedure'][0]['input']['command']) == command(next_proposal['command']) != original and
                new_result.get('exit_code') == 0 and new_result['observation'].get('complete') is True and
                new_result['observation'].get('outcome') == 'success' and blob(new_result['stdout_ref']) != raw)
            # The model already has the counterevidence at delivery. Delaying
            # its rejected annotation cannot erase any intervening retry.
            retries = [data for seq, data in starts.values() if seq > delivered_seq and (
                data.get('tool') == 'job.run' and command(data.get('input', {}).get('command')) is not None and (
                    command(data['input']['command']) == original or
                    command(data['input']['command'])[:2] == original[:2] and len(data['input']['command']) == 3 and
                    is_arithmetic_expression(data['input']['command'][2])) or
                data.get('tool') == 'hypothesis.propose' and data.get('input', {}).get('prediction') == 'expression_evaluates')]
            checks['no_rejected_route_retry'] = not retries
            chosen_seq, chosen = next((seq, e['data']) for seq, e in events if e.get('activity') == 'candidate' and e['data'].get('status') == 'accepted')
            candidate, resolution = chosen['candidate'], chosen['resolution']
            checks['candidate_bound_to_new_route_stdout'] = new_result_seq < chosen_seq and (
                candidate['evidence_refs'] == [new_result['stdout_ref']] and
                blob(candidate['value_ref']) == blob(new_result['stdout_ref']).removesuffix(b'\n'))
            receipts = []
            for ref in resolution.get('evidence_refs', []):
                try:
                    decoded = json.loads(blob(ref))
                    if isinstance(decoded, dict):
                        receipts.append(decoded)
                except (ValueError, UnicodeDecodeError):
                    pass
            checks['independent_replay_receipt'] = any(receipt.get('schema') == 'ctf-host-execution-receipt/v1' and
                receipt.get('mode') == 'replay' and receipt.get('status') == 'completed' and receipt.get('exitCode') == 0 and
                receipt.get('outputRef') == candidate['value_ref'] and receipt.get('generation') == 1 and
                Path(receipt.get('cwd', '')).resolve().parent == (folder / 'workspaces').resolve() and
                Path(receipt.get('cwd', '')).name != scope['taskId'] and
                all(ref in receipt.get('inputRefs', []) for ref in [*candidate['evidence_refs'], *start['data']['challenge']['material_refs']])
                for receipt in receipts)
            break
        except (KeyError, ValueError, TypeError, IndexError, StopIteration):
            continue
    return {'passed': all(checks.values()), 'checks': checks, 'run_id': scope['runId'], 'database_sha256': base.get('database_sha256')}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--deterministic', action='store_true')
    args = parser.parse_args()
    try:
        result = grade(args.folder)
    except (OSError, ValueError, KeyError, TypeError, StopIteration, sqlite3.Error) as error:
        result = {'passed': False, 'reason': str(error)}
    result['evidence_kind'] = 'deterministic_local_provider' if args.deterministic else 'canonical_behavior_only'
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result['passed'] else 1)
