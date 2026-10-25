"""Offline candidate only: replay trusted, post-bind metadata. Not product implementation."""
import json,pathlib,copy,hashlib
B=pathlib.Path(__file__).parent

def freeze(h,old):
 if h.get('stopped'):return 'unknown:stopped'
 b=h.get('binding');
 if not b or not h.get('messageID'):return 'unknown:missing-binding-or-user'
 e=[e for e in h['executions'] if e.get('childID')==h['sessionID'] and e['parent']==b.get('parentID') and e['state'] in ('running','starting') and not e['delivered']]
 if len(e)!=1:return 'unknown:execution-not-unique'
 e=e[0]; v={'ref':e['ref'],'parent':e['parent'],'callID':e['callID'],'childID':h['sessionID'],'userID':h['messageID'],'freezeAt':h['at']}
 if e['ref'] in old:
  
  if old[e['ref']].get('conflict'): return 'unknown:user-conflict'
  if old[e['ref']]['userID']==v['userID']: return old[e['ref']]
  old[e['ref']]['conflict']=True
  return 'unknown:user-conflict'
 old[e['ref']]=v;return v

def classify(f,messages,stopped=False):
 if stopped:return 'suppressed'
 if not isinstance(f,dict) or f.get('conflict'):return 'unknown'
 ms={m['id']:m for m in messages};u=ms.get(f['userID'])
 if not u or u['role']!='user':return 'unknown'
 aa=[m for m in ms.values() if m['role']=='assistant'and m.get('parentID')==u['id'] and m.get('time',{}).get('completed')]
 if len(aa)!=1 or aa[0].get('error'):return 'unknown'
 return 'incomplete'if aa[0].get('finish')=='length'else 'complete'if aa[0].get('finish')=='stop' and aa[0].get('textChars',0)>0 else 'unknown'

out=[]
for name in ['notice-read-partial','notice-read-empty','single-partial','single-empty','partial','empty','sync-resume','failure-early-resume-partial','failure-early-resume-empty']:
 p=B/name/'metadata.json'
 if not p.exists():continue
 d=json.loads(p.read_text());hh=[json.loads(s)for s in (B/name/'hooks.jsonl').read_text().splitlines()];frozen={};captures=[]
 for h in hh:
  if h.get('operation')=='chat.message'and h['phase']=='return'and h.get('agent')!='coordinator':captures.append({'hook':h,'candidate':freeze(h,frozen)})
 finals={}
 for s in d['snapshots']:finals[s['sessionID']]=s
 rows=[]
 for f in frozen.values():
  msgs=finals.get(f['childID'],{}).get('messages',[]);u=next((m for m in msgs if m['id']==f['userID']),None);aa=[m for m in msgs if m.get('parentID')==f['userID']]
  notices=[h for h in hh if h['phase']=='return'and h.get('operation')=='chat.message'and any(e['ref']==f['ref']and e.get('delivered') for e in h['executions'])];n=notices[0]if notices else None
  before=[s for s in d['snapshots']if s['sessionID']==f['childID']and n and s['at']<=n['at']]
  rows.append({**f,'userRole':u.get('role')if u else None,'assistants':aa,'finalClassification':classify(f,msgs),'noticeAt':n['at']if n else None,'classificationFromLastPreNoticePoll':classify(f,before[-1]['messages'])if before else 'unknown:no-pre-notice-poll','modelCallCrossCheck':any(h.get('operation')=='model.call'and h['sessionID']==f['childID']and h.get('messageID')==f['userID']for h in hh)})
 run=json.loads((B/name/'trusted-metadata.json').read_text());audit=run['correlationAudit']
 out.append({'case':name,'result':d['result'],'version':run.get('version'),'admittedModelCalls':run.get('admittedModelCalls'),'usageTotal':run.get('usageTotal','unavailable'),'captures':captures,'chains':rows,'finalExecutions':run['finalExecutions'],'noticeReads':[h for h in hh if h['phase'].startswith('notice-sdk-read')],'correlationAudit':[a for a in audit if a['op'] in ['bind','dispatch.register','dispatch.resume','task.execution','task.correlate','task.completion','task.delivered','task.completion.ignored'] or not a['allow']],'requests':d['requests']})
base=next(x for x in out if x['case']=='single-partial');f=base['chains'][0];h=base['captures'][0]['hook'];msgs=f['assistants']+[{'id':f['userID'],'role':'user'}];tests=[]
def test(name,actual,want):assert actual==want,(name,actual,want);tests.append({'case':name,'actual':actual,'expected':want})
test('wrong-child',freeze({**h,'sessionID':'wrong'},{}),'unknown:execution-not-unique')
test('wrong-parent',freeze({**h,'binding':{**h['binding'],'parentID':'wrong'}},{}),'unknown:execution-not-unique')
test('missing-user-id',freeze({**h,'messageID':None},{}),'unknown:missing-binding-or-user')
test('multiple-active',freeze({**h,'executions':h['executions']*2},{}),'unknown:execution-not-unique')
test('no-active-sync',freeze({**h,'executions':[{**e,'state':'completed','delivered':True}for e in h['executions']]},{}),'unknown:execution-not-unique')
test('stopped-hook',freeze({**h,'stopped':True},{}),'unknown:stopped')
test('missing-messages',classify(f,[]),'unknown')
test('wrong-user-assistant',classify(f,[{**m,'parentID':'wrong'}if m['role']=='assistant'else m for m in msgs]),'unknown')
test('duplicate-same-message',classify(f,msgs+msgs),'incomplete')
test('multiple-assistants',classify(f,msgs+[{**f['assistants'][0],'id':'another'}]),'unknown')
test('late-stop',classify(f,msgs,True),'suppressed')
test('assistant-error',classify(f,[{**m,'error':True}if m['role']=='assistant'else m for m in msgs]),'unknown')
old={};a=freeze(copy.deepcopy(h),old);test('duplicate-hook-idempotent',freeze(h,old),a);test('conflicting-user',freeze({**h,'messageID':'another'},old),'unknown:user-conflict')
test('conflict-then-read-stays-unknown',classify(old[a['ref']],msgs),'unknown')
test('conflict-then-repeat-stays-unknown',freeze(h,old),'unknown:user-conflict')
f2=base['chains'][1];test('old-notice-after-resume-stays-first',classify(f,msgs+f2['assistants']+[{'id':f2['userID'],'role':'user'}]),'incomplete')
(B/'minimal-evidence.json').write_text(json.dumps({'source':'same product launcher/plugin/ControlService plus native OpenCode1.19.3; metadata only','cases':out,'candidateTests':tests},indent=2))
print(json.dumps({'cases':[{ 'case':v['case'],'result':v['result']['status'],'chains':[(r['callID'],r['finalClassification'])for r in v['chains']]}for v in out],'candidateTests':len(tests)},indent=2))
