import urllib2,json,re,os,glob
out={}
for path in ['/','/login']:
 try:
  r=urllib2.urlopen('http://127.0.0.1:4000'+path,timeout=10);b=r.read()
  out[path]={'status':r.getcode(),'bytes':len(b),'challenges_link':bool(re.search(r'href=[\x22\x27]/challenges',b)),'scoreboard_link':bool(re.search(r'href=[\x22\x27]/scoreboard',b)),'post_form':bool(re.search(r'<form[^>]*method=[\x22\x27]post',b,re.I)),'name_input':bool(re.search(r'<input[^>]*name=[\x22\x27]name',b,re.I)),'password_input':bool(re.search(r'<input[^>]*name=[\x22\x27]password',b,re.I))}
 except Exception as e:out[path]={'errorType':type(e).__name__}
fds=set()
for p in glob.glob('/proc/[0-9]*/fd/*'):
 try:
  dest=os.readlink(p)
  if dest.endswith('/ctfd.db'):fds.add(dest)
 except OSError:pass
out['open_database_paths']=sorted(fds)
print(json.dumps(out,sort_keys=True))
