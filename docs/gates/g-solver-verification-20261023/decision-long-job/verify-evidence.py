"""Offline checks only; no providers or product processes are started."""
import json
from pathlib import Path
base = Path(__file__).resolve().parent
summaries = []
for scenario in ['success', 'timeout', 'abort']:
    directory = base / 'runtime' / 'checked' / scenario
    read = lambda name: json.loads((directory / name).read_text())
    result, events, provider, resources, audit = map(read, ['result.json', 'events.json', 'provider.json', 'tool-resources.json', 'control-audit.json'])
    assert not result.get('failure') and not result.get('observedError')
    during = next(e['task'] for e in events if e['event'] == 'parent.task.during')
    tasks = [p for m in read('messages-' + result['rootID'] + '.json') for p in m['parts'] if p.get('tool') == 'task']
    assert len(tasks) == 1
    final = tasks[0]
    assert during['id'] == final['id'] and during['callID'] == final['callID']
    assert during['state']['status'] == 'running'
    assert final['state']['status'] == ('error' if scenario == 'abort' else 'completed')
    jobs = [r for r in resources if r['tool'] == 'job.run']
    assert len(jobs) == 1 and jobs[0]['job'] == result['jobID']
    job = jobs[0]
    registrations = [r for r in audit if r['op'] == 'tool.registered' and r.get('detail', {}).get('callID') == job['callID']]
    settlements = [r for r in audit if r['op'] == 'tool.settled' and r.get('detail', {}).get('callID') == job['callID']]
    assert len(registrations) == len(settlements) == 1
    assert job['result'] == {'success': 'exited', 'timeout': 'timed_out', 'abort': 'cancelled'}[scenario]
    during_requests = [r for r in provider if r['child'] and result['initialAt'] < r['at'] < settlements[0]['at']]
    assert not during_requests
    assert sum(c['name'] == 'ctf_job_run' for r in provider for c in r['calls']) == 1
    if scenario != 'abort':
        assert result['jobID'] in final['state']['output']
        assert 'FINAL_STATE=' + job['result'] in final['state']['output']
    summaries.append({'scenario': scenario, 'sameOriginalTask': final['id'], 'originalTaskCallID': final['callID'],
                      'job': job['job'], 'jobCallID': job['callID'], 'parentBefore': 'running', 'parentAfter': final['state']['status'],
                      'result': job['result'], 'registrations': len(registrations), 'settlements': len(settlements),
                      'childProviderRequestsDuringWait': len(during_requests), 'msInitialToSettlement': settlements[0]['at'] - result['initialAt']})
(base / 'verification.json').write_text(json.dumps(summaries, indent=2))
print(json.dumps({'assertions': 'passed', 'scenarios': summaries}, indent=2))
