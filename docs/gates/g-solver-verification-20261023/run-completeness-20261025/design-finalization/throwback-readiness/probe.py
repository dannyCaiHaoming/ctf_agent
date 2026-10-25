import subprocess,json,tarfile,io,hashlib,sqlite3,tempfile,os,pathlib
ROOT=pathlib.Path(__file__).parent
IMAGE='sha256:ec0deee9a8a45ac74494e7dfc92357711fcf0b1e1c58543f09d6f824f3d9be98'
def command(args):
 r=subprocess.run(args,capture_output=True)
 if r.returncode: raise RuntimeError('command_failed:'+args[0]+':'+str(r.returncode))
 return r.stdout
def file(cid,p):
 data=command(['docker','cp',cid+':'+p,'-'])
 with tarfile.open(fileobj=io.BytesIO(data)) as t:return t.extractfile(next(m for m in t if m.isfile())).read()
def snapshot(cid):
 out={}
 for p in ['serve.py','CTFd/__init__.py','CTFd/config.py','CTFd/ctfd.db']:
  b=file(cid,'/root/throwback/'+p)
  out[p]={'sha256':hashlib.sha256(b).hexdigest(),'git_blob':hashlib.sha1(('blob '+str(len(b))+'\0').encode()+b).hexdigest(),'bytes':len(b)}
  if p.endswith('/ctfd.db'):
   f=tempfile.NamedTemporaryFile(delete=False);f.write(b);f.close()
   try:
    db=sqlite3.connect('file:'+f.name+'?mode=ro',uri=True)
    out['database']={'path':'/root/throwback/CTFd/ctfd.db','counts':{k:db.execute('select count(*) from '+k).fetchone()[0] for k in ['challenges','keys','files','solves','teams','config','pages']},'schema':{k:[r[1:3] for r in db.execute('pragma table_info('+k+')')] for k in ['challenges','keys','files','solves','teams','config','pages']}};db.close()
   finally:os.unlink(f.name)
 return out
def identity(cid):
 d=json.loads(command(['docker','inspect',cid]))[0]
 return {'id':d['Id'],'image':d['Image'],'startedAt':d['State']['StartedAt'],'status':d['State']['Status'],'network':d['HostConfig']['NetworkMode'],'mounts':len(d['Mounts']),'portsPublished':bool(d['HostConfig']['PortBindings'])}
if __name__=='__main__':
 import sys
 cid=sys.argv[1];phase=sys.argv[2]
 out={'identity':identity(cid),'files':snapshot(cid)}
 (ROOT/(phase+'.json')).write_text(json.dumps(out,indent=2)+'\n')
 print(json.dumps({'phase':phase,'identity':out['identity'],'hashes':{k:v['sha256'] for k,v in out['files'].items() if 'sha256' in v},'counts':out['files']['database']['counts']}))
