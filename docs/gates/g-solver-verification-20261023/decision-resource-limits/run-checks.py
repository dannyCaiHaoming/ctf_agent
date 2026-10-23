from pathlib import Path
import os,subprocess,json,sys
root=Path(__file__).resolve().parent
repo=root.parents[3]
env=os.environ.copy();env['GDEC_EVIDENCE_DIR']=str(root)
checks=[('targeted', ['npx','vitest','run','tests/contract/g-resource-limits.test.ts','tests/contract/slow-tools.test.ts','tests/contract/http-lifecycle.test.ts','tests/contract/job-tools.test.ts','--reporter=verbose']),('typecheck',['npm','run','typecheck']),('build',['npm','run','build']),('full',['npm','test'])]
records=[]
for name,cmd in checks:
 with (root/f'logs/{name}.log').open('w') as f:r=subprocess.run(cmd,cwd=repo,env=env,stdout=f,stderr=subprocess.STDOUT)
 records.append({'command':cmd,'cwd':str(repo),'exitCode':r.returncode,'log':f'logs/{name}.log'})
 (root/'check-commands.json').write_text(json.dumps(records,indent=2)+'\n')
 print(name,r.returncode,flush=True)
 if r.returncode: print((root/f'logs/{name}.log').read_text()[-4000:],flush=True)
sys.exit(int(any(x['exitCode'] for x in records)))
