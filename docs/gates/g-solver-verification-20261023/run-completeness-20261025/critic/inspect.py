from pathlib import Path
import json,hashlib,collections
root=Path('/Users/caihaoming/Documents/pentest-agent')
r=Path('/Users/caihaoming/Documents/pentest-agent-run-data/throwback-debug-20261024-r2/runs/throwback-debug-20261024-r2-1')
ev=[json.loads(x) for x in (r/'progress.jsonl').read_text().splitlines()]
msgs=json.loads((r/'evidence/messages-ses_e9197d24fffe3RpnIQlNVHMpAf.json').read_text())
tools=[]; notices=[]
for m in msgs:
 for p in m['parts']:
  if p.get('type')=='tool':
   s=p.get('state',{});i=s.get('input',{})
   tools.append({'messageID':m['info']['id'],'callID':p.get('callID'),'tool':p.get('tool'),'status':s.get('status'),'time':s.get('time'),'subagent':i.get('subagent_type'),'resume':bool(i.get('task_id'))})
  if p.get('type')=='text' and p.get('synthetic') and p.get('text','').startswith('<task id='):
   notices.append({'messageID':m['info']['id'],'at':m['info'].get('time',{}),'hasTaskResult':'<task_result>' in p['text']})
boundaries=[]
for v in ev:
 if v['op'] not in ['task.completion','progress.note']:continue
 groups=collections.defaultdict(list)
 for x in ev:
  if x['seq']>=v['seq']:break
  f=x.get('facts',{})
  if x['op']=='tool.registered' and f.get('tool') and f.get('argFingerprint'):
   groups[(f['tool'],f['argFingerprint'])].append(x)
 repeated=[{'tool':k[0],'fingerprint':k[1][:16],'count':len(xs),'sessions':sorted({x.get('sessionId','') for x in xs}),'firstSeq':xs[0]['seq'],'lastSeq':xs[-1]['seq']} for k,xs in groups.items() if len(xs)>=3]
 boundaries.append({'seq':v['seq'],'at':v['at'],'op':v['op'],'repeated3':repeated,'criticsBefore':sum(x.get('role')=='recovery-critic' for x in ev if x['seq']<v['seq'])})
assets={}
for n in ['coordinator','recovery-critic']:
 a=r/f'opencode/config/opencode/agents/{n}.md';b=root/f'product/opencode/agents/{n}.md'
 assets[n]={'savedSha256':hashlib.sha256(a.read_bytes()).hexdigest(),'matchesCurrent':a.read_bytes()==b.read_bytes()}
result={'sourceRun':str(r),'sourceHashes':{p:hashlib.sha256((r/p).read_bytes()).hexdigest() for p in ['progress.jsonl','evidence/task-executions.json','evidence/messages-ses_e9197d24fffe3RpnIQlNVHMpAf.json']},'assetHashes':assets,'rootProgressReadCalls':sum(t['tool']=='ctf_progress_read' for t in tools),'rootCriticDispatches':sum(t['tool']=='task' and t['subagent']=='recovery-critic' for t in tools),'rootProgressNotes':sum(t['tool']=='ctf_progress_note' for t in tools),'toolCounts':dict(collections.Counter(t['tool'] for t in tools)),'boundaries':boundaries,'notices':notices,'tasks':[t for t in tools if t['tool']=='task']}
Path(__file__).with_name('observations.json').write_text(json.dumps(result,indent=2))
print(json.dumps({'rootProgressReadCalls':result['rootProgressReadCalls'],'rootCriticDispatches':result['rootCriticDispatches'],'rootProgressNotes':result['rootProgressNotes'],'boundaries':[{'seq':b['seq'],'repeated3Groups':len(b['repeated3'])} for b in boundaries]}))
