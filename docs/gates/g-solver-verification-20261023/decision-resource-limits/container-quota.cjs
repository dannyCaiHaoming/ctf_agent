const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const results = { uid: process.getuid(), gid: process.getgid(), arch: process.arch, node: process.version, path: process.env.PATH, mounts: fs.readFileSync('/proc/mounts', 'utf8').split('\n').filter(x => x.includes('/quota ')), initialEntries: fs.readdirSync('/quota'), operations: [] };
const emit = (name, fn) => { try { const value = fn(); results.operations.push({ name, ok: true, value }); } catch (e) { results.operations.push({ name, ok: false, code: e.code, message: e.message }); } };
const p = '/quota/data';
emit('below-1048576', () => { fs.writeFileSync(p, Buffer.alloc(1044480, 65)); return fs.statSync(p).size; });
emit('equal-1048576', () => { fs.appendFileSync(p, Buffer.alloc(4096, 66)); return fs.statSync(p).size; });
emit('over-1048576', () => { fs.appendFileSync(p, 'x'); return fs.statSync(p).size; });
results.bytesAfterDeniedAppend = fs.statSync(p).size;
// Existing target cannot be atomically replaced while its full-size temp also occupies the quota.
emit('atomic-temp-spike', () => fs.writeFileSync('/quota/temp', 'x'));
fs.rmSync('/quota/temp', { force: true }); fs.truncateSync(p, 4096);
emit('reuse-after-shrink', () => { fs.writeFileSync('/quota/after', Buffer.alloc(8192)); return fs.statSync('/quota/after').size; });
for (const name of fs.readdirSync('/quota')) fs.rmSync(`/quota/${name}`);
emit('sparse-logical-size-exceeds-storage-cap', () => { const fd=fs.openSync('/quota/sparse','w'); fs.ftruncateSync(fd,2097152); fs.closeSync(fd); const s=fs.statSync('/quota/sparse'); const value={logicalBytes:s.size,allocatedBytes:s.blocks*512}; fs.unlinkSync('/quota/sparse'); return value; });
// Two independent writers share the same finite capacity; no unbounded stress.
const child = `const f=require('fs');try{f.writeFileSync(process.argv[1],Buffer.alloc(655360));console.log('ok')}catch(e){console.log(e.code);process.exitCode=2}`;
const parallel = spawnSync(process.execPath, ['-e', `const {spawn}=require('child_process');const code=${JSON.stringify(child)}; Promise.all(['a','b'].map(n=>new Promise(r=>{const c=spawn(process.execPath,['-e',code,'/quota/'+n],{stdio:['ignore','pipe','pipe']});let o='';c.stdout.on('data',b=>o+=b);c.on('close',exit=>r({name:n,exit,out:o.trim()}))}))).then(x=>console.log(JSON.stringify(x)))`], { encoding: 'utf8' });
results.parallel = { exit: parallel.status, stdout: parallel.stdout, stderr: parallel.stderr, logicalBytes: fs.readdirSync('/quota').reduce((n, f) => n + fs.statSync('/quota/' + f).size, 0) };
results.tools = Object.fromEntries(['node', 'python3', 'sh', 'curl', 'prlimit'].map(name => [name, spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'probe', name], { encoding: 'utf8' }).stdout.trim()]));
results.criteriaMet = results.uid !== 0 && results.operations.find(x=>x.name==='below-1048576').value===1044480 && results.operations.find(x=>x.name==='equal-1048576').value===1048576 && results.operations.find(x=>x.name==='over-1048576').code==='ENOSPC' && results.bytesAfterDeniedAppend===1048576 && results.operations.find(x=>x.name==='atomic-temp-spike').code==='ENOSPC' && results.parallel.logicalBytes<=1048576;
console.log(JSON.stringify(results,null,2)); if (!results.criteriaMet) process.exitCode=1;
