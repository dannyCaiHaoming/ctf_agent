import json,pathlib,copy,hashlib,tarfile,re
P=pathlib.Path(__file__).parent
def load(n):return json.loads((P/(n+'.json')).read_text())
src=load('local/source-check'); expected={x['path'].replace('CTFd/','',1):x['sha256'] for x in src['files'] if x['path'] in ['CTFd/serve.py','CTFd/CTFd/__init__.py','CTFd/CTFd/config.py','CTFd/CTFd/ctfd.db']}
phases=['before-start','after-start','after-get','second-before-start','second-after-start','second-after-get','first-after-restart']
for n in phases:
 d=load(n);assert all(d['files'][k]['sha256']==v for k,v in expected.items());assert d['files']['database']['counts']==src['bundled_db_counts']
for n in ['http-first','http-second']:
 h=load(n);assert all(h[x]['status']==200 for x in ['/','/login']);assert h['/']['challenges_link'] and h['/']['scoreboard_link'];assert all(h['/login'][x] for x in ['post_form','name_input','password_input'])
material=pathlib.Path('/Users/caihaoming/Documents/pentest-agent-run-data/web-validation/targets/throwback/throwback_templates.tar.gz')
b=material.read_bytes();assert hashlib.sha256(b).hexdigest()==src['files'][-1]['sha256']
with tarfile.open(fileobj=__import__('io').BytesIO(b)) as t:
 texts=[t.extractfile(m).read().decode('utf8') for m in t if m.isfile() and m.name.endswith('.html')]
 markers={'challenges':any('/challenges' in x for x in texts),'scoreboard':any('/scoreboard' in x for x in texts),'post_form':any(re.search(r'<form[^>]*method=[\x22\x27]post',x,re.I) for x in texts),'name_input':any(re.search(r'<input[^>]*name=[\x22\x27]name',x,re.I) for x in texts),'password_input':any(re.search(r'<input[^>]*name=[\x22\x27]password',x,re.I) for x in texts)}
assert all(markers.values());(P/'template-marker-projection.json').write_text(json.dumps({'material_sha256':hashlib.sha256(b).hexdigest(),'markers':markers},indent=2))
base={'source':src['upstream_ref'],'material':src['files'][-1]['sha256'],'image':load('after-get')['identity']['image'],'instance':load('after-get')['identity']['id'],'startedAt':load('after-get')['identity']['startedAt'],'policy':'throwback-local-prototype-v1','db':expected['CTFd/ctfd.db'],'http':load('http-first')}
def evaluate(mode,observation,current,reason=None):
 if mode=='not_applicable':return 'not_applicable' if reason else 'blocked'
 if mode!='required':return 'not_checked'
 if not observation:return 'blocked'
 for key in ['source','material','image','instance','startedAt','policy','db']:
  if observation.get(key)!=current.get(key):return 'blocked'
 h=observation.get('http',{})
 try:return 'ready' if h['/']['status']==200 and h['/login']['status']==200 and h['/']['challenges_link'] and h['/']['scoreboard_link'] and all(h['/login'][x] for x in ['post_form','name_input','password_input']) else 'blocked'
 except KeyError:return 'blocked'
results=[{'case':'real-first-positive','kind':'real-projection','actual':evaluate('required',base,base),'expected':'ready'}]
for key in ['source','material','image','instance','startedAt','policy','db']:
 m=copy.deepcopy(base);m[key]='changed';results.append({'case':'changed-'+key,'kind':'synthetic-metadata','actual':evaluate('required',base,m),'expected':'blocked'})
for name,mode,obs,reason,expected_result in [('missing','required',None,None,'blocked'),('tcp-only','required',{'tcp':True},None,'blocked'),('na','not_applicable',None,'materials-only','not_applicable'),('na-no-reason','not_applicable',None,None,'blocked'),('legacy',None,None,None,'not_checked')]:results.append({'case':name,'kind':'synthetic-metadata','actual':evaluate(mode,obs,base,reason),'expected':expected_result})
for phase,key in [('second-after-get','instance'),('first-after-restart','startedAt')]:
 current=copy.deepcopy(base);current[key]=load(phase)['identity']['id' if key=='instance' else key];results.append({'case':'real-'+phase+'-invalidates-old','kind':'real-identity-transition','actual':evaluate('required',base,current),'expected':'blocked'})
assert all(x['actual']==x['expected'] for x in results)
(P/'offline-results.json').write_text(json.dumps(results,indent=2));print(json.dumps({'phase_hash_checks':len(phases),'http_positive_checks':2,'offline_cases':len(results),'all_passed':True}))
