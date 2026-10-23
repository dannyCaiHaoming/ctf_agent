from pathlib import Path
import subprocess,json,uuid,sys
root=Path(__file__).resolve().parent
name='gdec-resource-limits-'+uuid.uuid4().hex[:10]
image='sha256:7e5c5a015288ad55115573b5b25f4bcd668489f1b88b4137ea8563980706672f'
cmd=['docker','run','--name',name,'--user','10001:10001','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','96m','--cpus','0.5','--pids-limit','32','--tmpfs','/quota:rw,size=1048576,uid=10001,gid=10001,mode=0700','--mount',f'type=bind,src={root},dst=/probe,readonly','--entrypoint','node',image,'/probe/container-quota.cjs']
records=[]
def run(args,out):
 r=subprocess.run(args,capture_output=True,text=True);(root/out).write_text(r.stdout+r.stderr);records.append({'command':args,'exitCode':r.returncode,'log':out});return r
try:
 first=run(cmd,'logs/container-quota.log')
 run(['docker','inspect',name],'container-inspect.json')
 # The same container restarted: tmpfs is recreated, so this is NOT persistent product storage.
 restart=run(['docker','start','-a',name],'logs/container-restart.log')
finally:
 run(['docker','rm','-f',name],'logs/container-cleanup.log')
(root/'container-commands.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records,indent=2));sys.exit(0 if first.returncode==restart.returncode==0 else 1)
