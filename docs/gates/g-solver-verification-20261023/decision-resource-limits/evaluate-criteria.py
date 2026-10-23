from pathlib import Path
import json,sys
root=Path(__file__).resolve().parent
o=json.loads((root/'observations.json').read_text())
checks=[
 {'criterion':'workspace aggregate denies overflow, including HTTP and direct job writes','met':o['workspaceAggregate']['criterionMet'] and o['aggregateWriters']['criterionMet'],'evidence':'observations.json workspaceAggregate / aggregateWriters'},
 {'criterion':'job PATH fixed by product rather than inherited launcher environment','met':o['path']['fixedByProduct'],'evidence':'observations.json path'},
 {'criterion':'durable run tool admission and reservation recovery without resetting totals','met':o['runAccounting']['persistentToolAdmissionLedger'],'evidence':'observations.json runAccounting; control-service.ts constructor; launch.ts final-only saves'},
 {'criterion':'eight same-challenge HTTP slots reserve atomically and confirmed cancellation releases','met':o['httpConcurrency']['sameChallengeAccepted']==8 and o['httpConcurrency']['excessRefused']==1 and o['httpConcurrency']['knownCancellationReleased'],'evidence':'observations.json httpTrace'},
 {'criterion':'unknown HTTP keeps eight reservations and blocks ninth','met':o['httpUnknown']['retainedSlots']==8 and o['httpUnknown']['ninthRefused'],'evidence':'observations.json httpUnknownTrace'},
 {'criterion':'job session/challenge limits and known cancellation/failure release','met':o['jobConcurrency']['perSessionOverflowRefused'] and o['jobConcurrency']['perChallengeOverflowRefused'] and o['jobConcurrency']['cancelledAndFailedToStartReleased'],'evidence':'observations.json jobTrace'},
 {'criterion':'numeric defaults calibrated against real solving needs','met':None,'evidence':'not run; no model authorization'}]
result={'outcome':'partial; aggregate limits and product default applicability are NOT finalized','criteria':checks}
(root/'criteria.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2));sys.exit(1 if any(x['met'] is not True for x in checks) else 0)
