from pathlib import Path
import json, hashlib
p=Path(__file__).parent
repo=p.parents[4]
# Resolve against this worktree, never an earlier prototype checkout.
while not (repo/'package.json').exists(): repo=repo.parent
hashes=json.loads((p/'source-hashes.json').read_text())
assert all(hashlib.sha256((repo/f).read_bytes()).hexdigest()==h for f,h in hashes.items())
assert json.loads((p/'isolation.json').read_text())['externalConnect']=='EPERM'
summary={}
for mode in ['resume-partial','resume-empty','pure-empty','pure-partial','combined','failed']:
 d=json.loads((p/('closed-projection-'+mode)/'metadata.json').read_text())
 assert d['result']['status']=='completed' and d['result']['code']==0
 roots=[r for r in d['requests'] if r['isRoot']]; last=roots[-1]
 sync=[f['facts'] for f in last['displays'] if f['synchronous']]
 bg=[f['facts'] for f in last['displays'] if not f['synchronous']]
 for r in roots:
  identities=[('call' if f['synchronous'] else 'ref',f['facts'].get('callID',f['facts'].get('ref'))) for f in r['displays']]
  assert len(set(identities))==len(identities)
 for fact in bg:
  e=next(e for e in d['executions'] if e['ref']==fact['ref']); f=e['resultFacts']
  assert all(fact[k]==f[k] for k in ['completeness','reason','finish','textChars'])
  assert fact['source']==e['source']['status'] and fact['role']==e['role'] and e['delivery']=='consumed'
  assert any(f'[ctf:{e["ref"]}]' in t and f'<task id="{e["childID"]}"' in t and ('<task_error>' if e['state']=='failed' else '<task_result>') in t for t in last['nativeNotices'])
 for fact in sync:
  a=next(a for a in d['audits'] if a['op']=='sync.result' and a['detail']['callID']==fact['callID']); f=a['detail']['facts']
  assert all(fact[k]==f[k] for k in ['completeness','reason','finish','textChars'])
  assert fact['source']==a['detail']['source']['status']
  b=next(b for b in d['audits'] if b['op']=='bind' and b['sessionID']==a['detail']['childID'])
  assert fact['role']==b['detail']['role']
  t=next(t for t in last['toolOutputs'] if t['tool_call_id']==fact['callID'])['content']
  assert t.startswith(f'<task id="{a["detail"]["childID"]}" state="completed">\n<task_result>')
  assert '</task>\n[CTF host synchronous result facts]' in t
  assert len([a for a in d['audits'] if a['op']=='sync.result' and a['detail']['callID']==fact['callID']])==1
 delivered=[a for a in d['audits'] if a['op']=='task.delivered']
 assert len(delivered)==len(d['executions'])==len({a['detail']['ref'] for a in delivered})
 assert all(a['detail']['messageID']==next(e for e in d['executions'] if e['ref']==a['detail']['ref'])['noticeMessageID'] for a in delivered)
 if mode.startswith('resume'):
  assert len(bg)==len(sync)==1 and bg[0]['finish']=='length' and sync[0]['finish']=='stop'
  a=next(a for a in d['audits'] if a['op']=='sync.result')
  assert a['detail']['source']['userMessageID']!=d['executions'][0]['source']['userMessageID']
  assert bg[0]['textChars']==(0 if mode.endswith('empty') else 7) and sync[0]['textChars']==8
 if mode.startswith('pure'):
  assert len(sync)==1 and not bg and not d['executions'] and len(d['requests'])==3
  assert sync[0]['completeness']=='incomplete' and sync[0]['finish']=='length'
  assert sync[0]['textChars']==(0 if mode.endswith('empty') else 7)
 if mode=='combined':
  assert len(bg)==2 and len(sync)==1 and last['notices']==2
  assert len({a['detail']['admitNo'] for a in delivered})==1
  a=next(a for a in d['audits'] if a['op']=='sync.result')
  assert a['at']-a['detail']['source']['observedAt']>=700
  assert all(r['at']<a['detail']['source']['observedAt'] or r['at']>a['at'] for r in roots)
 if mode=='failed':
  assert len(bg)==1 and last['notices']==1 and d['executions'][0]['state']=='failed' and bg[0]['reason']=='error'
 summary[mode]={'status':d['result']['status'],'requests':len(d['requests']),'parentRequests':len(roots),'lastNoticeCount':last['notices'],'lastFacts':last['displays'],'delivered':[a['detail'] for a in delivered]}
(p/'verified-projections.json').write_text(json.dumps(summary,indent=2)+'\n')
print('6 final-source native provider projections checked; source hashes match; external EPERM')
