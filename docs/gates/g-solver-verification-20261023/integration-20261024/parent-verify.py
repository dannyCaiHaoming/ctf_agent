import json,pathlib,hashlib
root=pathlib.Path(__file__).resolve().parents[4];ev=pathlib.Path(__file__).resolve().parent
load=lambda p:json.loads(p.read_text())
rows=[]
for scenario in ['success','stop-job','stop-http','resume','active','budget']:
 p=ev.parent/'joint-async-lifecycle/runtime/parent-integration-review-20261024'/scenario;r=load(p/'result.json');assert not r.get('failure'),r
 run=load(p/'run.json');provider=load(p/'provider.json');audit=load(p/'control-audit.json');events=load(p/'events.json');ex=load(p/'task-executions.json');resources=load(p/'tool-resources.json');bindings=load(p/'bindings.json')
 assert run['status']==('budget_exceeded' if scenario=='budget' else 'completed')
 assert len(provider)==len([a for a in audit if a['op']=='model.call' and a['allow']])==run['admittedModelCalls']
 for q in provider:
  for tool in q.get('tools',[]):
   if tool['function']['name']=='ctf_job_run': assert not {'wait_ms','completion'} & set(tool['function']['parameters'].get('properties',{}))
 parent=run['rootSessionId'];messages=load(p/f'messages-{parent}.json');parts=[part for m in messages for part in m['parts']]
 assert len({e['ref'] for e in ex})==len(ex)
 for e in ex:
  assert e['run']==scenario and e['parent']==parent and e['challengeId']=='X'
  native=[part for part in parts if part.get('type')=='tool' and part.get('callID')==e['callID']]
  assert len(native)==1 and native[0]['state']['output']==e['initialOutput']
  assert e['childID'] in e['initialOutput'] and 'state="running"' in e['initialOutput']
  assert e['delivery']==('suppressed' if scenario=='budget' else 'stop_reply' if e['state']=='cancelled' else 'consumed'),e
  if e['delivery']=='consumed':assert e.get('noticeMessageID') and sum(a['op']=='task.delivered' and a.get('detail',{}).get('ref')==e['ref'] for a in audit)==1
 # Every waiting tool excludes intermediate child model requests (a final request may precede SDK audit return by milliseconds).
 for res in resources:
  if res['tool'] not in ['job.run','http.request']:continue
  start=next(a['at'] for a in audit if a['op']=='tool.registered' and a.get('detail',{}).get('callID')==res['callID'])
  end=next(a['at'] for a in audit if a['op']=='tool.settled' and a.get('detail',{}).get('callID')==res['callID'])
  role=next(b['role'] for b in bindings if b['sessionID']==res['sessionID']);who='a' if role=='recon' else 'b'
  assert not [q for q in provider if q['who']==who and start<q['at']<end],(scenario,res)
 if scenario in ['success','resume','active','budget']:
  res=next(r for r in resources if r['tool']=='job.run');times=[a['at'] for a in audit if a['op'] in ['tool.registered','tool.settled'] and a.get('detail',{}).get('callID')==res['callID']];duration=max(times)-min(times);assert duration>=6400
  initialParent=next(q for q in provider if q['who']=='p' and q['step']==2); parentAdmission=[a for a in audit if a['op']=='model.call' and a['allow'] and a['sessionID']==parent][2]; assert parentAdmission['at']<max(times)
  if scenario!='active':
   statuses=[e for e in events if e['type']=='session.status' and e['properties']['sessionID']==parent]; prior=[e for e in statuses if e['at']<=min(times)]; assert prior and prior[-1]['properties']['status']['type']=='idle'; assert not [e for e in statuses if min(times)<e['at']<max(times) and e['properties']['status']['type']=='busy']
 if scenario.startswith('stop'):
  canceled=next(e for e in ex if e['state']=='cancelled');stop=next(a for a in audit if a['op']=='task.stop.result' and a['sessionID']==canceled['childID']);revoke=next(a for a in audit if a['op']=='revoke' and a['sessionID']==canceled['childID']);assert revoke['at']<=stop['at']
  assert stop['detail']['resources']=='settled' and stop['detail']['sessionAbort']=='confirmed'
  assert len([a for a in audit if a['op']=='aborted' and a['sessionID']==canceled['childID']])==1
  assert any(a['op']=='tool.registered' and a['at']>stop['at'] and a['sessionID']!=canceled['childID'] for a in audit)
  if scenario=='stop-job':assert any(o.get('pid') and o['alive'] is False for o in load(p/'stop-observations.json'));assert any(b'early' in f.read_bytes() for f in (p/'job-output').rglob('stdout.bin'))
  else:assert r['httpEntered']<revoke['at']<=r['httpClosed']<=stop['at']+50
 if scenario=='resume':assert len(ex)==2 and ex[0]['childID']==ex[1]['childID'] and ex[0]['ref']!=ex[1]['ref']
 if scenario=='active':
  completion=next(a for a in audit if a['op']=='task.completion'); assert parentAdmission['at']<completion['at']<initialParent['at']; assert any(q['who']=='p' and q['step']>=3 and 'A_DONE' in str(q['messages']) for q in provider)
 if scenario=='budget':assert len(provider)==6 and not any(q['who']=='p' and q['step']>=3 for q in provider);assert any(a.get('reason')=='budget denied' for a in audit)
 rows.append({'scenario':scenario,'status':run['status'],'providerRequests':len(provider),'executions':len(ex),'usage':run['usageTotal'],'assertions':'passed'})
before=load(ev/'candidate-hashes-before.json');after={p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in before};diff=[p for p in before if before[p]!=after[p]];assert not diff,diff
(ev/'parent-candidate-hashes-after.json').write_text(json.dumps(after,indent=2));(ev/'parent-verification.json').write_text(json.dumps({'candidateSourceDrift':diff,'scenarios':rows,'realModelCalls':0,'coverage':'runtime scenarios plus separately labelled deterministic boundaries'},indent=2));print(json.dumps(rows,indent=2))

team=ev/'parent-team-runtime'
summary=load(team/'summary.json');assert summary['gWiring']=='passed' and summary['solved'] is False
bindings=load(team/'bindings.json');resources=load(team/'tool-resources.json');ex=load(team/'task-executions.json');provider=load(team/'provider.json');audit=load(team/'control-audit.json')
assert len(provider)==summary['requests']==40==len([r for r in audit if r['op']=='model.call' and r['allow']])
for role in ['engineer','verifier']:
 b=next(b for b in bindings if b['role']==role);jobs=[r['job'] for r in resources if r['tool']=='job.run' and r['sessionID']==b['sessionID']];assert len(jobs)==1
 assert (team/'job-output'/b['sessionID']/jobs[0]/'stdout.bin').read_bytes()==b'42\n'
solver=next(b for b in bindings if b['role']=='domain-solver');outs=[f.read_bytes() for f in (team/'job-output'/solver['sessionID']).rglob('stdout.bin')];assert b'42\n' in outs
assert any(b'fixture-script-error' in f.read_bytes() for f in (team/'job-output'/solver['sessionID']).rglob('stderr.bin'))
assert len(ex)==5 and all(e['delivery']=='consumed' for e in ex) and all(r['state']=='settled' for r in resources)
parent=next(b for b in bindings if b['role']=='coordinator')['sessionID'];messages=load(team/f'messages-{parent}.json');parts=[p for m in messages for p in m['parts']]
for e in ex:
 p=next(p for p in parts if p.get('callID')==e['callID']);assert p['state']['output']==e['initialOutput'];assert e['challengeId']=='X'
(ev/'parent-team-verification.json').write_text(json.dumps({'rawOutputs':'42 and original script failure independently checked','requests':len(provider),'executions':len(ex),'resources':len(resources),'status':'passed','D':'unimplemented','solved':False},indent=2))
print('team saved outputs and correlation passed')
