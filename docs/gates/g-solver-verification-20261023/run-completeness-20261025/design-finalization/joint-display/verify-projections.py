from pathlib import Path
import json
p=Path(__file__).parent
summary={}
for mode in ['resume-partial','resume-empty','pure-empty','pure-partial','combined','failed']:
 case='closed-projection-failed' if mode=='failed' else 'closed-'+mode
 d=json.loads((p/case/'metadata.json').read_text()); hs=[json.loads(x) for x in (p/case/'hooks.jsonl').read_text().splitlines()]
 assert d['result']['status']=='completed' and d['result']['code']==0
 roots=[x for x in d['requests'] if x['isRoot']]; last=roots[-1]; ds=last['displays']; sync=[x for x in ds if x['synchronous']]; bg=[x for x in ds if not x['synchronous']]
 assert all(h['prefixPreserved'] for h in hs if h['hook']=='after-output')
 assert all(len({json.dumps(x,sort_keys=True) for x in r['displays']})==len(r['displays']) for r in roots)
 for fact in bg:
  e=next(e for e in d['executions'] if e['ref']==fact['facts']['ref']); f=e['resultFacts']; assert all(fact['facts'][k]==f[k] for k in ['completeness','reason','finish','textChars']);assert e['delivery']=='consumed'
 for fact in sync:
  a=next(a for a in d['audits'] if a['op']=='sync.result' and a['detail']['callID']==fact['facts']['callID']);assert all(fact['facts'][k]==a['detail']['facts'][k] for k in ['completeness','reason','finish','textChars'])
 if mode.startswith('resume'):
  assert len(bg)==len(sync)==1 and len(d['executions'])==1
  assert bg[0]['facts']['finish']=='length' and sync[0]['facts']['finish']=='stop'
  a=next(a for a in d['audits'] if a['op']=='sync.result');assert a['detail']['source']['userMessageID']!=d['executions'][0]['source']['userMessageID']
 if mode.startswith('pure'):
  assert len(sync)==1 and not bg and not d['executions'] and len(d['requests'])==3 and sync[0]['facts']['completeness']=='incomplete'
 if mode=='combined':
  assert len(bg)==2 and len(sync)==1 and last['notices']==2
  delivered=[a for a in d['audits'] if a['op']=='task.delivered'];assert len(delivered)==2 and len({a['detail']['admitNo'] for a in delivered})==1
  a=next(a for a in d['audits'] if a['op']=='sync.result');assert a['at']-a['detail']['source']['observedAt']>=700
  assert all(r['at']<a['detail']['source']['observedAt'] or r['at']>a['at'] for r in roots)
 if mode=='failed':assert last['notices']==1 and len(bg)==1 and d['executions'][0]['state']=='failed' and bg[0]['facts']['reason']=='error'
 summary[mode]={'case':case,'status':d['result']['status'],'requests':len(d['requests']),'parentRequests':len(roots),'lastNoticeCount':last['notices'],'lastFacts':ds,'delivered':[a['detail'] for a in d['audits'] if a['op']=='task.delivered']}
c=json.loads((p/'final-compaction/metadata.json').read_text());hs=[json.loads(x) for x in (p/'final-compaction/hooks.jsonl').read_text().splitlines()];assert c['compactionResult']=={'error':True,'status':500};assert not any(h['hook']=='compacting' for h in hs);assert not any(a['op']=='task.delivered' for a in c['audits']);summary['compaction']={'attempts':1,'http':500,'hookEntered':False,'status':c['result']['status'],'deliveries':0,'source':'pre-review-source-hashes.json'}
(p/'verified-projections.json').write_text(json.dumps(summary,indent=2));print('6 final-source native projections and 1 pre-review compaction-entry failure checked')
