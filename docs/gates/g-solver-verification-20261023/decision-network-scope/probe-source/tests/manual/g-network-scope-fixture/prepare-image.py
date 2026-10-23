#!/usr/bin/env python3
"""Run-outside-job Ubuntu dependency preparation; temporary relay only to ports.ubuntu.com."""
from pathlib import Path
import subprocess,http.server,urllib.parse,threading,json
E=Path('docs/gates/g-solver-verification-20261023/decision-network-scope');events=[]
class Relay(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  u=urllib.parse.urlsplit(self.path)
  if u.scheme!='http' or u.hostname!='ports.ubuntu.com' or not u.path.startswith('/ubuntu-ports/'):
   self.send_error(403);return
  p=subprocess.run(['curl','--fail','--silent','--show-error','--max-time','180',self.path],capture_output=True)
  events.append({'url':self.path,'exitCode':p.returncode,'bytes':len(p.stdout),'stderr':p.stderr.decode()})
  self.send_response(200 if p.returncode==0 else 502);self.send_header('Content-Length',str(len(p.stdout)));self.end_headers()
  try:self.wfile.write(p.stdout)
  except (BrokenPipeError,ConnectionResetError):pass
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('0.0.0.0',0),Relay);threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 args=['docker','build','--build-arg',f'http_proxy=http://host.docker.internal:{server.server_port}','-t','gdec-network-scope-tools:25d3','tests/manual/g-network-scope-fixture']
 with (E/'image-build-relay.log').open('w') as f:p=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT)
 (E/'image-build-relay-status.json').write_text(json.dumps({'argv':args,'exitCode':p.returncode,'relayRestrictedTo':'ports.ubuntu.com/ubuntu-ports/','relayClosedAfterBuild':True},indent=2)+'\n')
finally:
 server.shutdown();(E/'dependency-downloads.json').write_text(json.dumps(events,indent=2)+'\n')
raise SystemExit(p.returncode)
