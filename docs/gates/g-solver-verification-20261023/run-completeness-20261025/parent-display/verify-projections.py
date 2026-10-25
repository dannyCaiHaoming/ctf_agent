import json,pathlib,hashlib
p=pathlib.Path(__file__).parent
results=[]
for mode in ['partial','empty','unknown']:
 d=json.loads((p/f'final-{mode}/metadata.json').read_text());es=d['executions'];rs=d['requests'];assert len(es)==2 and len(rs)==(8 if mode=='unknown' else 7)
 root=next(e['sessionID'] for e in d['audits'] if e['op']=='bind' and e['detail']['role']=='coordinator')
 msgs=json.loads((pathlib.Path(d['result']['runDir'])/f'evidence/messages-{root}.json').read_text());projection=[]
 for m in msgs:
  if m['info']['role']!='user':continue
  parts=m.get('parts',[]);facts=[x for x in parts if x.get('type')=='text' and x.get('text','').startswith('[CTF host result facts] ')]
  if not facts:continue
  notices=[x for x in parts if x.get('type')=='text' and x.get('text','').startswith('<task id=')]
  assert len(facts)==1 and len(notices)==1
  fact=json.loads(facts[0]['text'].split('\n')[0].removeprefix('[CTF host result facts] '));e=next(e for e in es if e['ref']==fact['ref']);assert notices[0]['text']==e['result'] if 'result' in e else True
  raw=json.loads((pathlib.Path(d['result']['runDir'])/'evidence/task-executions.json').read_text());original=next(x for x in raw if x['ref']==fact['ref'])['result'];assert notices[0]['text']==original
  f=e['resultFacts'];assert all(fact[k]==f[k] for k in ['completeness','reason','finish']);assert fact['textChars']==(None if f['completeness']=='unknown' else f['textChars'])
  projection.append({'messageID':m['info']['id'],'notice':notices[0]['text'],'fact':fact,'noticeUnchanged':True,'factPartIdentity':{k:facts[0][k] for k in ['id','messageID','sessionID']}})
 assert len(projection)==2
 for i,r in enumerate(rs):
  facts=[]
  for x in r['displayProjection']:
   fact=json.loads(x['text'].split('\n')[0].removeprefix('[CTF host result facts] '));facts.append(fact)
  assert len(facts)==r['notices'];assert len({x['ref'] for x in facts})==len(facts)
  for f in facts:assert f in [x['fact'] for x in projection]
  if i<3:assert not facts
 assert len(rs[-1]['displayProjection'])==2
 results.append({'mode':mode,'requestCount':len(rs),'childCount':d['childCount'],'status':d['result']['status'],'requests':rs,'parentMessages':projection,'executions':es,'assertions':'passed'})
(p/'verified-projections.json').write_text(json.dumps(results,indent=2))
print('three native samples verified')
