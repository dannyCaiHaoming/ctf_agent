import socket, subprocess, os, json, struct
out=[]
def add(name,fn):
 try: result=fn();out.append({'name':name,'reachable':True,'result':str(result)[:400]})
 except Exception as e:out.append({'name':name,'reachable':False,'error':str(e)})
def tcp(host,port=8080,family=socket.AF_INET):
 s=socket.socket(family,socket.SOCK_STREAM);s.settimeout(.6)
 try:s.connect((host,port));s.sendall(b'GET /sentinel HTTP/1.0\r\nHost: target.test:8080\r\n\r\n');return s.recv(200).decode()
 finally:s.close()
def udp(host,port=9000,family=socket.AF_INET):
 s=socket.socket(family,socket.SOCK_DGRAM);s.settimeout(.6)
 try:s.sendto(b'scope-probe',(host,port));return s.recv(200).decode()
 finally:s.close()
def curl(url,*opts,proxy=False):
 env=os.environ.copy();env.update(http_proxy='http://172.30.231.40:3128',HTTP_PROXY='http://172.30.231.40:3128',all_proxy='http://172.30.231.40:3128',ALL_PROXY='http://172.30.231.40:3128',NO_PROXY='',no_proxy='')
 if not proxy:
  for k in ['http_proxy','HTTP_PROXY','all_proxy','ALL_PROXY']:env.pop(k,None)
 p=subprocess.run(['curl','-sS','--fail','--max-time','2',*([] if proxy else ['--noproxy','*']),*opts,url],env=env,text=True,capture_output=True)
 if p.returncode:raise Exception(f'curl exit {p.returncode}: {p.stderr.strip()}')
 return p.stdout
mode=os.environ['PHASE'];host=os.environ['HOST_SENTINEL_IP'];hp=int(os.environ['HOST_SENTINEL_PORT'])
add('target.tcp',lambda:tcp('172.30.231.10'))
add('target.udp',lambda:udp('172.30.231.10'))
add('target.curl.no_proxy',lambda:curl('http://172.30.231.10:8080/sentinel'))
add('target6.tcp',lambda:tcp('fd25:d3:231::10',family=socket.AF_INET6))
add('target6.udp',lambda:udp('fd25:d3:231::10',family=socket.AF_INET6))
for name,ip in [('other','172.30.231.20'),('control','172.30.231.30'),('unauthorized','172.30.231.99')]:
 add(name+'.tcp',lambda ip=ip:tcp(ip));add(name+'.udp',lambda ip=ip:udp(ip));add(name+'.curl.bypass_proxy',lambda ip=ip:curl(f'http://{ip}:8080/sentinel'))
add('other4mapped.tcp',lambda:tcp('::ffff:172.30.231.20',family=socket.AF_INET6));add('other6.tcp',lambda:tcp('fd25:d3:231::20',family=socket.AF_INET6));add('other6.udp',lambda:udp('fd25:d3:231::20',family=socket.AF_INET6))
add('target.other_port',lambda:tcp('172.30.231.10',8081));add('target.udp_wrong_protocol',lambda:udp('172.30.231.10',8080))
add('host.owned_sentinel',lambda:tcp(host,hp));add('host.loopback_sentinel',lambda:tcp('127.0.0.1',hp));add('host.gateway_sentinel',lambda:tcp('172.30.231.1',hp))
add('shared_ip.other_origin',lambda:curl('http://other-origin.test:8080/sentinel','--resolve','other-origin.test:8080:172.30.231.10'))
add('shared_origin.control_path',lambda:curl('http://target.test:8080/admin-sentinel','--resolve','target.test:8080:172.30.231.10'))
add('redirect.other_ip',lambda:curl('http://target.test:8080/redirect-other','--resolve','target.test:8080:172.30.231.10','--resolve','other.test:8080:172.30.231.20','-L'))
add('redirect.same_ip_other_origin',lambda:curl('http://target.test:8080/redirect-same-ip','--resolve','target.test:8080:172.30.231.10','--resolve','other-origin.test:8080:172.30.231.10','-L'))
add('proxy.target',lambda:curl('http://target.test:8080/sentinel',proxy=True))
add('proxy.other',lambda:curl('http://other.test:8080/sentinel',proxy=True))
add('proxy.shared_ip_other_origin',lambda:curl('http://other-origin.test:8080/sentinel',proxy=True))
add('proxy.redirect.other_ip',lambda:curl('http://target.test:8080/redirect-other','-L',proxy=True))
add('proxy.shared_origin.control_path',lambda:curl('http://target.test:8080/admin-sentinel',proxy=True))
add('dns.rebind_name',lambda:socket.gethostbyname('rebind.test'))
add('dns.rebind_connect',lambda:tcp(socket.gethostbyname('rebind.test')))
# Fixed local DNS question sent directly to allowed and forbidden DNS endpoints.
def dns(ip):
 q=b'\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x06rebind\x04test\x00\x00\x01\x00\x01';s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.settimeout(.6)
 try:s.sendto(q,(ip,53));d=s.recv(512);return socket.inet_ntoa(d[-4:])
 finally:s.close()
add('dns.allowed_direct',lambda:dns('172.30.231.53'));add('dns.other_direct',lambda:dns('172.30.231.54'))
print(json.dumps({'phase':mode,'uid':os.getuid(),'uname':os.uname().machine,'status':open('/proc/self/status').read(),'routes':subprocess.run(['ip','route'],capture_output=True,text=True).stdout,'results':out},indent=2))
