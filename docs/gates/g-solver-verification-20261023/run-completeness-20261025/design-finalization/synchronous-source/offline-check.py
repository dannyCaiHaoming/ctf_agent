import json,pathlib,copy
O=pathlib.Path(__file__).parent
rows=[]
for f in O.glob('candidate-*/hooks.jsonl'):
 for l in f.read_text().splitlines():
  h=json.loads(l)
  if h['phase']=='sync-after-exact-read': rows.append({'case':f.parent.name,**h})
def classify(c):
 if c.get('stopped'):return 'suppressed'
 if c.get('conflict') or c.get('readError') or not c.get('metadataChildMatches') or not c.get('metadataParentMatches'):return 'unknown'
 u=[m for m in c['messages'] if m['id']==c['userID'] and m['role']=='user']
 a=[m for m in c['messages'] if m['role']=='assistant'and m['parentID']==c['userID'] and m['completed']]
 if len(u)!=1 or len(a)!=1 or a[0]['error']:return 'unknown'
 return 'incomplete'if a[0]['finish']=='length'else 'complete'if a[0]['finish']=='stop'and a[0]['textChars']>0 else 'unknown'
tests=[]
def check(name,c,want):
 actual=classify(c);assert actual==want,(name,actual,want);tests.append({'name':name,'result':actual})
for r in rows:check(r['case'],r,'incomplete'if r['case']in ['candidate-pure-partial','candidate-pure-empty']else'complete')
b=next(r for r in rows if r['case']=='candidate-pure-partial')
for name,patch,want in [('wrong-parent',{'metadataParentMatches':False},'unknown'),('wrong-child',{'metadataChildMatches':False},'unknown'),('stop-after-sdk-read',{'stopped':True},'suppressed'),('sdk-failure',{'readError':True},'unknown'),('different-user-reentry',{'conflict':True},'unknown'),('missing-user',{'userID':'absent'},'unknown'),('same-call-duplicate-same-user',{},'incomplete')]:check(name,{**b,**patch},want)
check('different-assistant-parent',{**b,'messages':[{**m,'parentID':'wrong'}if m['role']=='assistant'else m for m in b['messages']]},'unknown')
check('multiple-assistants',{**b,'messages':b['messages']+[{**b['messages'][1],'id':'second'}]},'unknown')
# Registry policy negative cases, pure functions only; not naturally observed races.
def admit(old,parent,call,child,stopped=False):
 if stopped:return 'suppressed'
 if (parent,call)in old:return 'duplicate'
 if any(v['child']==child and not v['done']for v in old.values()):return 'conflict'
 old[(parent,call)]={'child':child,'done':False};return 'accepted'
r={};assert admit(r,'p','c','s')=='accepted';assert admit(r,'p','c','s')=='duplicate';assert admit(r,'p','c2','s')=='conflict';assert admit(r,'p','c3','s',True)=='suppressed'
(O/'minimal-evidence.json').write_text(json.dumps({'rows':[{**r,'classification':classify(r)}for r in rows],'offlineTests':tests,'offlineRegistryChecks':4},indent=2))
print(json.dumps({'nativeRows':len(rows),'classificationChecks':len(tests),'registryChecks':4}))
