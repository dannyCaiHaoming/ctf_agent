"""Read-only audit of the final native batch; output is JSON, does not alter evidence."""
from pathlib import Path
import json, hashlib
base=Path(__file__).resolve().parent
repo=base.parents[3]
batch=base/'runtime-final-2'
h=lambda b:hashlib.sha256(b).hexdigest()
sources=json.loads((batch/'source-hashes.json').read_text())
assert len({s['path'] for s in sources})==len(sources)
for s in sources:
 assert h((repo/s['path']).read_bytes())==s['sha256'],s['path']
 assert h((batch/'source'/s['path']).read_bytes())==s['sha256'],s['path']
rows=[]
for scenario in ['control','lost','prep-stop','job-stop','late','budget']:
 d=batch/scenario
 load=lambda p:json.loads((d/p).read_text())
 summary=load('summary.json'); provider=load('provider.json'); audit=load('evidence/control-audit.json'); resources=load('evidence/tool-resources.json'); executions=load('evidence/task-executions.json'); publications=load('evidence/publications.json')
 v=next(e for e in executions if e['role']=='verifier');pkg=next(p for p in publications if p['source']['kind']=='package')
 assert v['version']==pkg['ref']
 assert len({next(e for e in executions if e['role']==r)['childID'] for r in ['domain-solver','engineer','verifier']})==3
 assert h((d/'workspace/X'/pkg['path']).read_bytes())==pkg['sha256']
 calls=[c for p in provider for c in p['calls']]
 assert sum(c['name']=='ctf_package_prepare' for c in calls)==1
 assert all(r['state']=='settled' for r in resources)
 assign=next(a for a in audit if a['op']=='assign' and a['detail'].get('version')==v['version'])
 creation=next(a for a in audit if a['op']=='task.execution' and a['detail']['ref']==v['ref'])
 binding=next(a for a in audit if a['op']=='bind' and a['sessionID']==v['childID'])
 admission=next(a for a in audit if a['op']=='model.call' and a['sessionID']==v['childID'] and a['allow'])
 assert assign['seq']<creation['seq']<binding['seq']<admission['seq']
 prepared=next((a['detail'] for a in audit if a['op']=='package.prepared'),None)
 if prepared:
  work=d/'workspace/X/work'/v['childID']
  assert (work/prepared['candidatePath']).read_bytes()==(d/'expected-candidate.bin').read_bytes()
  assert (work/prepared['directory']/'raw.bin').read_bytes()==(d/'expected-raw.bin').read_bytes()
 job=next((r for r in resources if r['tool']=='job.run' and r['sessionID']==v['childID']),None)
 output=None
 if job:
  terminal=next(a['detail'] for a in audit if a['op']=='verification.job.terminal' and a['detail']['job']==job['job'])
  assert terminal['execution']==v['ref'] and terminal['continuousIntegrity']=='unknown'
  stdout=(d/'state/jobs'/v['childID']/job['job']/'stdout.bin').read_bytes()
  stderr=(d/'state/jobs'/v['childID']/job['job']/'stderr.bin').read_bytes()
  assert stdout==(d/('expected-candidate.bin' if scenario=='control' else 'expected-raw.bin')).read_bytes()
  output={'job':job['job'],'state':terminal['terminal']['state'],'stdoutBytes':len(stdout),'stdoutSha256':h(stdout),'stderrBytes':len(stderr),'stderrSha256':h(stderr)}
 if scenario in ['prep-stop','job-stop','late']:
  recon=next(e for e in executions if e['role']=='recon')
  delivery=next(a for a in audit if a['op']=='task.delivered' and a['detail']['ref']==recon['ref'])
  stop=next(a for a in audit if a['op']=='tool.before' and a['detail']['tool']=='ctf_task_stop')
  assert delivery['seq']<stop['seq'] and v['state']=='cancelled'
 contexts=load('loadedContext.json')
 for c in contexts:
  body=(repo/f"product/opencode/agents/{c['role']}.md").read_text().split('---',2)[2].strip()
  assert body==c['expectedRoleBody'] and body in c['system'] and h(body.encode())==c['roleBodySha256']
 rows.append({'scenario':scenario,'verdict':summary['verdict'],'runStatus':summary['result']['status'],'providerRequests':len(provider),'prepared':bool(prepared),'verifierSession':v['childID'],'verifierExecution':v['ref'],'version':v['version'],'ordering':{'assign':assign['seq'],'taskExecution':creation['seq'],'bind':binding['seq'],'firstAdmission':admission['seq']},'resourceCount':len(resources),'allSettled':True,'jobOutput':output,'loadedRoles':[c['role'] for c in contexts]})
print(json.dumps({'worktree':str(repo),'sourceCount':len(sources),'sourceMismatches':[],'versions':json.loads((batch/'control/versions.json').read_text()),'runtimeBatch':'runtime-final-2','cases':rows,'realModelCalls':0,'realUsage':'unavailable','parentReview':'pending'},ensure_ascii=False,indent=2))
