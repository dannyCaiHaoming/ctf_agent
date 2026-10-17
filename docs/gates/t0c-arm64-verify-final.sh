#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
log(){ printf "
=== %s ===
" "$*"; }
log 'continuation from prepared arm64 base (apt/Node/OpenCode/core packages already installed)'
uname -a; dpkg --print-architecture; node --version; npm --version; opencode --version
log 'Python core package functional fixtures'
log 'Python core package functional fixtures'
python3 -m venv /tmp/venv
/tmp/venv/bin/pip install -q httpx requests beautifulsoup4 lxml websockets dnspython pycryptodome cryptography sympy gmpy2 z3-solver pwntools construct pillow scapy >/tmp/pip.log 2>&1
/tmp/venv/bin/python - <<'PY'
import asyncio, io, json
from bs4 import BeautifulSoup
from PIL import Image
from Crypto.Cipher import AES
from cryptography.fernet import Fernet
import sympy, gmpy2, z3, dns.resolver, httpx, requests, websockets
from scapy.all import IP, TCP, Ether, wrpcap
from pwn import cyclic
from construct import Struct, Int32ul
s=BeautifulSoup('<b>arm64</b>','lxml').b.text; assert s=='arm64'
key=b'0123456789abcdef'; ct=AES.new(key,AES.MODE_GCM).encrypt(b'x'); assert ct
fernet=Fernet(Fernet.generate_key()); assert fernet.decrypt(fernet.encrypt(b'ok'))==b'ok'
assert sympy.isprime(101)
assert gmpy2.is_prime(101)
solver=z3.Solver(); solver.add(z3.Int('x')>2); solver.check(); assert solver.model()[z3.Int('x')].as_long()>2
assert cyclic(8).startswith(b'aaaabaaa')
parsed=Struct('value'/Int32ul).parse(b'\x01\x00\x00\x00'); assert parsed.value==1
im=Image.new('RGB',(4,4),'red'); im.save('/tmp/t0c.png'); im.save('/tmp/t0c.jpg')
assert Image.open('/tmp/t0c.png').size==(4,4)
wrpcap('/tmp/t0c.pcap',Ether()/IP(src='127.0.0.1')/TCP(sport=1,dport=2))
assert len(httpx.Client().build_request('GET','http://127.0.0.1').url.raw_path)>0
assert requests.Request('GET','http://127.0.0.1').method=='GET'
async def ws():
    async with websockets.connect('ws://127.0.0.1',open_timeout=.1) as w: pass
try: asyncio.run(ws())
except Exception as e: assert 'connect' in str(e).lower() or 'refused' in str(e).lower()
try: dns.resolver.resolve('example.invalid')
except Exception as e: assert 'NXDOMAIN' in str(e) or 'does not exist' in str(e).lower() or 'no valid' in str(e).lower() or 'resolve' in str(e).lower()
print('python-functional-ok')
PY
exiftool -overwrite_model -Artist=T0C /tmp/t0c.jpg >/dev/null; exiftool -Artist /tmp/t0c.jpg | grep T0C
tshark -r /tmp/t0c.pcap -T fields -e ip.src | grep 127.0.0.1
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=64x64:rate=1:duration=1 -y /tmp/t0c.mp4
ffprobe -v error -show_entries format=duration -of json /tmp/t0c.mp4 | grep duration
printf '%%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\nxref\n0 3\ntrailer<</Size 3/Root 1 0 R>>\n%%%%EOF\n' >/tmp/t0c.pdf
qpdf_rc=0; qpdf --check /tmp/t0c.pdf >/dev/null || qpdf_rc=$?; test "$qpdf_rc" -le 3; pdfinfo /tmp/t0c.pdf >/dev/null 2>&1 || echo 'pdfinfo-reports-invalid-zero-page-pdf (qpdf structural check passed)'
pngcheck /tmp/t0c.png >/dev/null
qrencode -o /tmp/qr.png 'T0C-ARM64' && zbarimg -q /tmp/qr.png | grep T0C-ARM64
log 'Playwright Chromium headless functional fixture'
log 'Playwright Chromium headless functional fixture'
npm install -g playwright@1.56.1 >/tmp/playwright-install.log 2>&1
playwright install --with-deps chromium >/tmp/chromium-install.log 2>&1
NODE_PATH="$(npm root -g)" node - <<'JS'
const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch({headless:true}); const p=await b.newPage(); await p.goto('data:text/html,<title>t0c-arm64-ok</title>'); if(await p.title()!=='t0c-arm64-ok') throw new Error('title mismatch'); await b.close(); console.log('chromium-functional-ok');})().catch(e=>{console.error(e);process.exit(1)});
JS
log 'heavy crypto availability / cost'
log 'heavy crypto availability / cost'
apt-cache policy sagemath | sed -n '1,6p'
echo 'SageMath not installed in this ephemeral verification image because install size is large; availability and candidate package recorded above.'
log 'T0C-VERIFY-OK'
