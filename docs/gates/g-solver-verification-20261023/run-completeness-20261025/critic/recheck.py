"""Read-only historical metadata projection; never emits reasoning, tool bodies or secrets."""
from pathlib import Path
import json, hashlib, subprocess, re
root=Path(__file__).resolve().parents[5]
r=Path('/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261024-r2/runs/throwback-debug-20261024-r2-1')
def read(p): return json.loads(p.read_text())
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
msgs=read(r/'evidence/messages-ses_e9197d24fffe3RpnIQlNVHMpAf.json')
audit=read(r/'evidence/control-audit.json'); admissions=read(r/'evidence/admissions.json')
profile=r.parents[1]/'profile.json'; config=Path(read(profile)['opencode']['configPath'])
# JS serialisation follows launch.ts exactly; env references stay unresolved.
js='''const fs=require('fs'),crypto=require('crypto');const base=JSON.parse(fs.readFileSync(process.argv[1]));const loaded=JSON.parse(fs.readFileSync(process.argv[2]));const c={...base,default_agent:'coordinator',plugin:undefined,model:loaded.model,small_model:loaded.model,provider:loaded.provider,...(loaded.enabled_providers?{enabled_providers:loaded.enabled_providers}:{})};console.log(crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex'));'''
config_hash=subprocess.check_output(['node','-e',js,str(root/'product/opencode/opencode.json'),str(config)],text=True).strip()
terminals=[]
for f in sorted((r/'evidence').glob('messages-*.json')):
 for m in read(f):
  i=m['info']
  if i.get('role')=='assistant' and i.get('finish')!='tool-calls':
   t=i.get('tokens',{})
   terminals.append({'session':f.stem.removeprefix('messages-'),'id':i['id'],'parentID':i.get('parentID'),'finish':i.get('finish'),'time':i.get('time'),'output':t.get('output'),'reasoning':t.get('reasoning'),'textCodePoints':sum(len(p.get('text','')) for p in m['parts'] if p.get('type')=='text')})
notices=[];resumes=[]
for m in msgs:
 for p in m['parts']:
  if p.get('type')=='text' and p.get('synthetic') and p.get('text','').startswith('<task id='):
   b=re.search(r'<task_result>\s*(.*?)\s*</task_result>',p['text'],re.S)
   notices.append({'id':m['info']['id'],'created':m['info'].get('time',{}).get('created'),'resultCodePoints':len(b.group(1)) if b else None})
  if p.get('type')=='tool' and p.get('tool')=='task':
   st=p.get('state',{}); inp=st.get('input',{})
   if not inp.get('task_id'):continue
   b=re.search(r'<task_result>\s*(.*?)\s*</task_result>',st.get('output',''),re.S)
   time=st.get('time',{}); child=inp['task_id']
   candidates=[t for t in terminals if t['session']==child and time.get('start',0)<=t.get('time',{}).get('created',0)<=time.get('end',0)]
   resumes.append({'callID':p['callID'],'role':inp.get('subagent_type'),'child':child,'parentAssistantID':m['info']['id'],'parentInputID':m['info'].get('parentID'),'time':time,'resultCodePoints':len(b.group(1)) if b else None,'childTerminalCandidates':candidates,'contextCaution':'Time-window projection only, not trusted product association or captured provider request'})
paths=[profile,config,root/'product/opencode/opencode.json',r/'state/run.json',r/'evidence/control-audit.json',r/'evidence/admissions.json',*sorted((r/'evidence').glob('messages-*.json'))]
result={'sourceRun':str(r),'sourceHashes':{str(p):digest(p) for p in paths},'config':{'path':str(config),'configuredOutput':read(config)['provider']['volcano-coding']['models']['deepseek-v4-1-flash-261017']['limit']['output'],'reconstructedHash':config_hash,'savedHash':read(r/'state/run.json')['configSha256'],'matches':config_hash==read(r/'state/run.json')['configSha256']},'admissionBounds':{'min':min(x['detail']['maxOutputTokens'] for x in admissions),'max':max(x['detail']['maxOutputTokens'] for x in admissions)},'notices':notices,'resumes':resumes,'terminals':terminals,'progressNoteSeqs':[x['seq'] for x in audit if x['op']=='progress.note'],'limits':'No original HTTP request capture. No reasoning/body output. Counts are Unicode code points, not JS textChars. Prompt purpose and content observations are manually reviewed in report.md.'}
assert result['config']['matches'];assert len(resumes)==7
Path(__file__).with_name('recheck.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'config':result['config'],'admissionBounds':result['admissionBounds'],'resumes':len(resumes)},ensure_ascii=False))
