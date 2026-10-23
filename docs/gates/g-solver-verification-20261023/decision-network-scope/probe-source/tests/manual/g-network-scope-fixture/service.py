import http.server, socket, socketserver, threading, json, os, struct, urllib.parse, http.client
LOCK=threading.Lock()
def event(**kw):
 with LOCK: print(json.dumps(kw),flush=True)
class HTTP(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  event(protocol='http',path=self.path,host=self.headers.get('Host'),port=self.server.server_port,client=self.client_address[0])
  if self.path=='/redirect-other':
   self.send_response(302);self.send_header('Location','http://other.test:8080/sentinel');self.end_headers();return
  if self.path=='/redirect-same-ip':
   self.send_response(302);self.send_header('Location','http://other-origin.test:8080/sentinel');self.end_headers();return
  self.send_response(200);self.end_headers();self.wfile.write(('SENTINEL '+self.headers.get('Host','')+' '+self.path).encode())
 def log_message(self,*a):pass
class V6(http.server.ThreadingHTTPServer):
 address_family=socket.AF_INET6
 def server_bind(self):
  self.socket.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1);super().server_bind()
class UDP(socketserver.BaseRequestHandler):
 def handle(self):
  data,s=self.request; event(protocol='udp',data=data.decode(errors='replace'),port=self.server.server_address[1],client=self.client_address[0]);s.sendto(b'UDP_SENTINEL',self.client_address)
class UDP6(socketserver.ThreadingUDPServer):
 address_family=socket.AF_INET6
 def server_bind(self):
  self.socket.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1);super().server_bind()
class DNS(socketserver.BaseRequestHandler):
 def handle(self):
  data,s=self.request;i=12;labels=[]
  while data[i]: n=data[i];labels.append(data[i+1:i+1+n].decode());i+=n+1
  name='.'.join(labels);question=data[12:i+5];qt=struct.unpack('!H',data[i+1:i+3])[0]
  target='172.30.231.20' if os.path.exists('/tmp/dns-rebound') else '172.30.231.10'
  event(protocol='dns',name=name,qtype=qt,answer=target)
  ans=b'\xc0\x0c'+struct.pack('!HHIH',1,1,0,4)+socket.inet_aton(target) if qt==1 else b''
  s.sendto(data[:2]+struct.pack('!HHHHH',0x8180,1,1 if ans else 0,0,0)+question+ans,self.client_address)
class Proxy(http.server.BaseHTTPRequestHandler):
 def do_CONNECT(self):self.send_error(403,'CONNECT not granted in HTTP fixture')
 def do_GET(self):
  u=urllib.parse.urlsplit(self.path);ok=u.scheme=='http' and u.hostname=='target.test' and (u.port or 80)==8080
  event(protocol='proxy',url=self.path,allowed=ok)
  if not ok:self.send_error(403);return
  c=http.client.HTTPConnection('172.30.231.10',8080,timeout=2);c.request('GET',u.path or '/',headers={'Host':'target.test:8080'});r=c.getresponse();self.send_response(r.status)
  if r.getheader('Location'):self.send_header('Location',r.getheader('Location'))
  self.end_headers();self.wfile.write(r.read());c.close()
 def log_message(self,*a):pass
mode=os.environ.get('MODE','services')
def serve(server):threading.Thread(target=server.serve_forever,daemon=True).start()
if mode=='dns':serve(socketserver.ThreadingUDPServer(('0.0.0.0',53),DNS))
elif mode=='proxy':serve(http.server.ThreadingHTTPServer(('0.0.0.0',3128),Proxy))
else:
 for p in [8080,8081]:serve(http.server.ThreadingHTTPServer(('0.0.0.0',p),HTTP))
 serve(socketserver.ThreadingUDPServer(('0.0.0.0',9000),UDP))
 serve(V6(('::',8080),HTTP));serve(UDP6(('::',9000),UDP))
event(ready=True,mode=mode)
threading.Event().wait()
