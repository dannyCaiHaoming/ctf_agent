#!/usr/bin/env python3
"""Local-only Docker experiment. Never sends test traffic to a public destination."""
from pathlib import Path
import subprocess, json, socket, threading, http.server, http.client, uuid, sys, time, hashlib
ROOT=Path(__file__).resolve().parents[2]; E=ROOT/(sys.argv[1] if len(sys.argv)>1 else 'docs/gates/g-solver-verification-20261023/decision-network-scope/accepted');E.mkdir(parents=True,exist_ok=True)
(E/'started.json').write_text(json.dumps({'startedUnix':time.time(),'candidateSha256':hashlib.sha256((ROOT/'docs/gates/g-solver-verification-20261023/decision-network-scope/design-candidates.md').read_bytes()).hexdigest(),'probeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'modelUsage':'unavailable; no model/provider invoked'},indent=2)+'\n')
PREFIX='gdec-network-scope-'+uuid.uuid4().hex[:8]; IMAGE='gdec-network-scope-tools:25d3';created=[];net=None;commands=[];phase_results={};fails=[]
def run(args,check=True):
 p=subprocess.run(args,text=True,capture_output=True,timeout=90);commands.append({'argv':args,'exitCode':p.returncode,'stdout':p.stdout,'stderr':p.stderr})
 if check and p.returncode:raise RuntimeError(str(args)+': '+p.stderr)
 return p
host_events=[]
class Host(http.server.BaseHTTPRequestHandler):
 def do_GET(self): host_events.append({'path':self.path,'client':self.client_address[0],'time':time.time()});self.send_response(200);self.end_headers();self.wfile.write(b'OWNED_HOST_SENTINEL')
 def log_message(self,*a):pass
host=http.server.ThreadingHTTPServer(('0.0.0.0',0),Host);threading.Thread(target=host.serve_forever,daemon=True).start()
def container(suffix,ip=None,extra=[],cmd=['sleep','infinity'],untrusted=False):
 name=PREFIX+'-'+suffix;a=['docker','run','-d','--name',name,'--label','scope-probe='+PREFIX]
 if ip:a+=['--network',net,'--ip','172.30.231.'+str(ip),'--ip6','fd25:d3:231::'+str(ip)]
 a+=['--security-opt','no-new-privileges','--read-only','--tmpfs','/tmp:rw,nosuid,nodev,size=16m']
 if untrusted:a+=['--user','65532:65532','--cap-drop','ALL']
 a+=extra+['--entrypoint',cmd[0],IMAGE]+cmd[1:];run(a);created.append(name);return name
def logs(phase):
 for n in created:
  (E/(phase+'-'+n.removeprefix(PREFIX+'-')+'.log')).write_text(run(['docker','logs',n],False).stdout)
def rules(anchor,mode):
 # Trusted init only. Job containers have no capabilities; namespace is not exposed to any provider.
 base=['iptables -F OUTPUT','iptables -F INPUT','iptables -P OUTPUT DROP','iptables -P INPUT DROP','iptables -A OUTPUT -o lo -j ACCEPT','iptables -A INPUT -i lo -j ACCEPT','iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT','iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT','ip6tables -F OUTPUT','ip6tables -F INPUT','ip6tables -P OUTPUT DROP','ip6tables -P INPUT DROP','ip6tables -A OUTPUT -o lo -j ACCEPT','ip6tables -A INPUT -i lo -j ACCEPT','ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT','ip6tables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT']
 if mode=='namespace':
  for proto,port in [('tcp',8080),('udp',9000)]:
   base += [f'iptables -A OUTPUT -d 172.30.231.10 -p {proto} --dport {port} -j ACCEPT',f'ip6tables -A OUTPUT -d fd25:d3:231::10 -p {proto} --dport {port} -j ACCEPT']
  base+=['iptables -A OUTPUT -d 172.30.231.53 -p udp --dport 53 -j ACCEPT']
 elif mode=='proxy':base+=['iptables -A OUTPUT -d 172.30.231.40 -p tcp --dport 3128 -j ACCEPT']
 # IPv6 neighbor discovery is local link control, not arbitrary job UDP; raw sockets cannot be created.
 base+=['ip6tables -A OUTPUT -p ipv6-icmp --icmpv6-type neighbor-solicitation -j ACCEPT','ip6tables -A OUTPUT -p ipv6-icmp --icmpv6-type neighbor-advertisement -j ACCEPT','ip6tables -A INPUT -p ipv6-icmp --icmpv6-type neighbor-solicitation -j ACCEPT','ip6tables -A INPUT -p ipv6-icmp --icmpv6-type neighbor-advertisement -j ACCEPT']
 run(['docker','exec',anchor,'sh','-ec','\n'.join(base)])
 for tool in ['iptables-save','ip6tables-save']:(E/(mode+'-'+tool+'.txt')).write_text(run(['docker','exec',anchor,tool,'-c']).stdout)
def phase(name,anchor):
 resolver=E/'resolv.conf';resolver.write_text('nameserver 172.30.231.53\noptions timeout:1 attempts:1\n')
 c=container(name,extra=['--network','container:'+anchor,'--mount',f'type=bind,src={ROOT}/tests/manual/g-network-scope-fixture,dst=/fixture,readonly','--mount',f'type=bind,src={resolver},dst=/etc/resolv.conf,readonly','-e','PHASE='+name,'-e','HOST_SENTINEL_IP='+hostip,'-e','HOST_SENTINEL_PORT='+str(host.server_port)],untrusted=True,cmd=['python3','/fixture/client.py'])
 status=run(['docker','wait',c]);data=run(['docker','logs',c]);(E/(name+'.json')).write_text(data.stdout);phase_results[name]=json.loads(data.stdout);assert status.stdout.strip()=='0'
 inspect=json.loads(run(['docker','inspect',c]).stdout)[0];(E/(name+'-container.json')).write_text(json.dumps({k:inspect[k] for k in ['Name','Image','Config','HostConfig','NetworkSettings']},indent=2))
 (E/(name+'-anchor.json')).write_text(run(['docker','inspect',anchor]).stdout)
 # Job cannot mutate namespace rules or create raw sockets.
 logs(name)
 (E/(name+'-host-events.json')).write_text(json.dumps(host_events,indent=2)+'\n')
 for tool in ['iptables-save','ip6tables-save']:
  p=run(['docker','exec',anchor,tool,'-c'],False);(E/(name+'-'+tool+'.txt')).write_text(p.stdout+p.stderr)
try:
 run(['docker','version']);v=run(['docker','run','--rm','--name',PREFIX+'-versions','--network','none','--user','65532:65532','--cap-drop','ALL','--entrypoint','sh',IMAGE,'-c','uname -a; python3 --version; curl --version; iptables --version; ip6tables --version; dpkg-query -W python3 curl iptables iproute2 util-linux libcap2-bin']);(E/'versions.txt').write_text(v.stdout);run(['docker','image','inspect',IMAGE]);run(['docker','image','inspect','ubuntu:24.04'])
 net=PREFIX+'-net';run(['docker','network','create','--label','scope-probe='+PREFIX,'--ipv6','--subnet','172.30.231.0/24','--subnet','fd25:d3:231::/64',net]);(E/'network.json').write_text(run(['docker','network','inspect',net]).stdout)
 for suffix,ip,mode in [('target',10,'services'),('other',20,'services'),('control',30,'services'),('unauthorized',99,'services'),('dns',53,'dns'),('other-dns',54,'dns'),('proxy',40,'proxy')]:container(suffix,ip,['-e','MODE='+mode,'--mount',f'type=bind,src={ROOT}/tests/manual/g-network-scope-fixture,dst=/fixture,readonly'],['python3','/fixture/service.py'])
 anchor=container('plain',60,untrusted=True)
 hostip=run(['docker','exec',anchor,'getent','ahostsv4','host.docker.internal']).stdout.split()[0]
 local=http.client.HTTPConnection('127.0.0.1',host.server_port);local.request('GET','/sentinel');resp=local.getresponse();(E/'host-loopback-positive.json').write_text(json.dumps({'status':resp.status,'body':resp.read().decode(),'port':host.server_port},indent=2));local.close()
 # Wait for ready services using logs, not assumed timing.
 for _ in range(100):
  if all('"ready": true' in run(['docker','logs',n],False).stdout for n in created[:7]):break
  time.sleep(.05)
 else:raise Exception('fixture not ready')
 (E/'network-with-services.json').write_text(run(['docker','network','inspect',net]).stdout)
 phase('proxy-env-only',anchor)
 ns=container('namespace',61,['--cap-drop','ALL','--cap-add','NET_ADMIN']);rules(ns,'namespace');phase('namespace-pinned',ns)
 run(['docker','exec',PREFIX+'-dns','touch','/tmp/dns-rebound']);phase('namespace-rebound',ns)
 proxyns=container('proxy-namespace',62,['--cap-drop','ALL','--cap-add','NET_ADMIN']);rules(proxyns,'proxy');phase('proxy-enforced',proxyns)
 # Non-root / capless checks performed on a live job-equivalent container in the namespace.
 check=container('privilege-check',extra=['--network','container:'+ns],untrusted=True)
 for label,cmd in [('identity',['sh','-c','id; uname -m; readlink /proc/self/ns/net; cat /proc/self/status; test ! -S /var/run/docker.sock']),('rules-denied',['iptables','-A','OUTPUT','-j','ACCEPT']),('raw-denied',['python3','-c','import socket; socket.socket(socket.AF_INET,socket.SOCK_RAW,socket.IPPROTO_ICMP)'])]:
  p=run(['docker','exec',check,*cmd],False);(E/(label+'.json')).write_text(json.dumps({'exitCode':p.returncode,'stdout':p.stdout,'stderr':p.stderr},indent=2))
  if (label!='identity' and p.returncode==0) or (label=='identity' and p.returncode!=0):fails.append(label)
 # Distinguish expected failures (candidate rejected / L7 gap) from infrastructure failures.
 def reachable(phase,name):return next(x['reachable'] for x in phase_results[phase]['results'] if x['name']==name)
 positives=['target.tcp','target.udp','target.curl.no_proxy','target6.tcp','target6.udp','dns.allowed_direct','dns.rebind_connect']
 denied=['other.tcp','other.udp','other.curl.bypass_proxy','control.tcp','control.udp','control.curl.bypass_proxy','unauthorized.tcp','unauthorized.udp','unauthorized.curl.bypass_proxy','other4mapped.tcp','other6.tcp','other6.udp','target.other_port','host.owned_sentinel','host.loopback_sentinel','host.gateway_sentinel','redirect.other_ip','proxy.target','dns.other_direct']
 for n in positives:
  if not reachable('namespace-pinned',n):fails.append('namespace positive '+n)
 for n in denied:
  if reachable('namespace-pinned',n):fails.append('namespace deny '+n)
 for n in ['other.tcp','other.udp','other.curl.bypass_proxy','control.tcp','control.udp','unauthorized.tcp','unauthorized.udp','other4mapped.tcp','other6.tcp','other6.udp','target.other_port','host.owned_sentinel','dns.other_direct']:
  if not reachable('proxy-env-only',n):fails.append('baseline unavailable '+n)
 if reachable('namespace-rebound','dns.rebind_connect'):fails.append('DNS rebinding bypass')
 for n in ['proxy.target']:
  if not reachable('proxy-enforced',n):fails.append('proxy positive '+n)
 for n in ['target.tcp','target.udp','target6.tcp','other.tcp','other.udp','host.owned_sentinel','dns.allowed_direct','proxy.other','proxy.shared_ip_other_origin','proxy.redirect.other_ip']:
  if reachable('proxy-enforced',n):fails.append('proxy deny '+n)
 for n in ['shared_ip.other_origin','shared_origin.control_path','redirect.same_ip_other_origin']:
  if not reachable('namespace-pinned',n):fails.append('expected IP-only limitation not reproduced '+n)
 (E/'result.json').write_text(json.dumps({'prefix':PREFIX,'image':IMAGE,'hostSentinelPort':host.server_port,'hostSentinelIP':hostip,'infrastructure_failures':fails,'namespace_l3_l4_mechanism_passed':not fails,'product_scope_passed':False,'reason':'IP/port cannot distinguish origins or management paths; production provisioning not integrated; no browser execution; proxy cannot support arbitrary TCP/UDP','phases':list(phase_results)},indent=2)+'\n')
except Exception as ex:
 fails.append(str(ex));(E/'infrastructure-error.txt').write_text(str(ex)+'\n');raise
finally:
 host.shutdown()
 for n in reversed(created):run(['docker','rm','-f',n],False)
 for n in run(['docker','ps','-a','--filter','label=scope-probe='+PREFIX,'--format','{{.Names}}'],False).stdout.splitlines():run(['docker','rm','-f',n],False)
 if net:run(['docker','network','rm',net],False)
 (E/'commands.json').write_text(json.dumps(commands,indent=2)+'\n')
 (E/'cleanup.json').write_text(json.dumps({'ownedPrefix':PREFIX,'created':created,'remaining':run(['docker','ps','-a','--filter','label=scope-probe='+PREFIX,'--format','{{.Names}}'],False).stdout,'networkRemaining':run(['docker','network','ls','--filter','label=scope-probe='+PREFIX,'--format','{{.Name}}'],False).stdout},indent=2)+'\n')
print(json.dumps({'infrastructure_failures':fails,'evidence':str(E)},indent=2));sys.exit(1 if fails else 0)
