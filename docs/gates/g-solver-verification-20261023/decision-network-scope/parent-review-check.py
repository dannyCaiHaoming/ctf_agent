from pathlib import Path
import json
p=Path('/Users/caihaoming/.codex/worktrees/25d3/pentest-agent/docs/gates/g-solver-verification-20261023/decision-network-scope/accepted')
phases=['proxy-env-only','namespace-pinned','namespace-rebound','proxy-enforced'];all_results={};checks=[]
for phase in phases:
 j=json.loads((p/f'{phase}.json').read_text());assert j['uid']==65532 and j['uname']=='aarch64';assert 'CapEff:\t0000000000000000' in j['status'] and 'NoNewPrivs:\t1' in j['status'];assert len(j['results'])==35
 d={x['name']:x['reachable'] for x in j['results']};all_results[phase]=d
 inspect=json.loads((p/f'{phase}-container.json').read_text());inspect=inspect[0] if isinstance(inspect,list) else inspect
 assert inspect['HostConfig']['ReadonlyRootfs'];assert inspect['HostConfig']['CapDrop']==['ALL'];assert not any('docker.sock' in x['Target'] for x in inspect['HostConfig']['Mounts'])
 for name in ['http_proxy','HTTP_PROXY','ALL_PROXY']:assert any(x.startswith(name+'=') for x in inspect['Config']['Env'])
for phase in phases[1:]:
 for server in ['other','control','unauthorized','other-dns']:
  assert (p/f'{phase}-{server}.log').read_bytes()==(p/f'proxy-env-only-{server}.log').read_bytes();checks.append(f'{phase}:{server}:no new requests')
 assert json.loads((p/f'{phase}-host-events.json').read_text())==json.loads((p/'proxy-env-only-host-events.json').read_text());checks.append(f'{phase}:host:no new requests')
 for name in ['other.tcp','other.udp','other.curl.bypass_proxy','control.tcp','control.udp','unauthorized.tcp','other4mapped.tcp','other6.tcp','other6.udp','target.other_port','host.owned_sentinel','dns.other_direct']:assert all_results[phase][name] is False,(phase,name)
for phase in ['namespace-pinned','namespace-rebound']:
 for name in ['target.tcp','target.udp','target6.tcp','target6.udp','shared_ip.other_origin','shared_origin.control_path','redirect.same_ip_other_origin']:assert all_results[phase][name] is True
assert all_results['namespace-pinned']['dns.rebind_connect'] and not all_results['namespace-rebound']['dns.rebind_connect']
assert all_results['proxy-env-only']['other.curl.bypass_proxy'] and all_results['proxy-env-only']['control.tcp']
assert all_results['proxy-enforced']['proxy.target'] and all_results['proxy-enforced']['proxy.shared_origin.control_path']
assert not all_results['proxy-enforced']['proxy.shared_ip_other_origin'] and not all_results['proxy-enforced']['target.tcp'] and not all_results['proxy-enforced']['target.udp']
for n in ['rules-denied','raw-denied']:assert json.loads((p/f'{n}.json').read_text())['exitCode']!=0
r=json.loads((p/'result.json').read_text());assert r['namespace_l3_l4_mechanism_passed'] and not r['product_scope_passed'];c=json.loads((p/'cleanup.json').read_text());assert not c['remaining'] and not c['networkRemaining']
report={'parentReview':'independent offline check of raw probe outputs, configuration and server logs; no network probe rerun','exitCode':0,'phases':4,'observationsPerPhase':35,'serverLogChecks':checks,'productScopePassed':False}
Path('/tmp/g-parent-network-review.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
