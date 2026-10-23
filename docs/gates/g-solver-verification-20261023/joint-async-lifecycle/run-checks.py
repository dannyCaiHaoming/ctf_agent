import subprocess,json,time,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[4]; ev=pathlib.Path(__file__).resolve().parent
checks=[('27-directed-final',['npx','--no-install','vitest','run','tests/contract/g-async-lifecycle.test.ts','tests/contract/control-service.test.ts','tests/contract/g-coordinator-stop.test.ts','tests/contract/slow-tools.test.ts','tests/contract/launch-evidence.test.ts']),('28-typecheck-final',['npm','run','typecheck']),('29-build-final',['npm','run','build']),('30-full-final',['npm','test']),('31-runtime-final',['npx','--no-install','tsx','tests/manual/g-joint-lifecycle.ts','final'])]
for name,argv in checks:
 if (ev/(name+'.log')).exists():raise FileExistsError("Preserve original evidence: use individual commands with a fresh runtime label")
 start=time.time()
 with (ev/(name+'.log')).open('w') as f: code=subprocess.run(argv,cwd=root,stdout=f,stderr=subprocess.STDOUT).returncode
 row={'name':name,'argv':argv,'exitCode':code,'elapsedSeconds':round(time.time()-start,3)}
 with (ev/'commands.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
 print(json.dumps(row),flush=True)
