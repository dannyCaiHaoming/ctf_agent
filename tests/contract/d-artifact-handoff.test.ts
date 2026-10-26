import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { ControlService } from '../../apps/launcher/src/control-service.js';

const services: ControlService[] = [];
afterAll(async () => { await Promise.all(services.map(s => s.stopAll('test end'))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'd-handoff-'));
  const materialsDir = join(root, 'X/materials'); await mkdir(materialsDir, { recursive: true });
  const client = { session: { get: async ({sessionID}: any) => ({data: {id: sessionID, parentID: 'root', agent: sessionID === 'other' ? 'engineer' : sessionID}}),
    children: async () => ({data: []}), messages: async ({sessionID}: {sessionID:string}) => ({data: sessionID === 'root' ? [{info:{id:'intake-dispatch',sessionID:'root',role:'user'},parts:['intake','it'].map(callID=>({type:'tool',tool:'task',callID,state:{metadata:{sessionId:'intake'}}}))}] : []}), abort: async () => ({data: true}) } };
  const service = new ControlService({runId: 'D-test', client: client as never, budget: {maxModelCalls: 100, maxObservableTokens: 100000},
    expiresAt: Date.now()+60000, workdir: join(root, 'opencode'), skillRoot: join(root, 'skills'),
    challenges: [{id:'X', title:null, target:null, reachability:null, materials:[], materialsDir}, {id:'Y', title:null, target:null, reachability:null, materials:[], materialsDir:join(root,'Y/materials')}]});
  services.push(service); service.bindRoot('root'); let n=0;
  const exec = (sid: string, tool: string, args: object = {}) => service.handle(sid, 'tool.execute', {tool, args, callID: `c${++n}`}) as Promise<any>;
  async function bind(sid: string, role: string, challenge='X') {
    await exec('root','challenge.assign',{role,challenge});
    const callID=`t${++n}`;
    await service.handle('root','tool.before',{tool:'task',callID,args:{subagent_type:role,background:true}});
    await service.handle('root','tool.after',{tool:'task',callID,metadata:{sessionId:sid},output:'running'});
    await service.handle(sid,'chat.message',{agent:role});
  }
  await bind('domain-solver','domain-solver'); await bind('engineer','engineer');
  return {root,service,exec,bind,work:join(root,'X/work/domain-solver'),published:join(root,'X/published')};
}

describe('D artifact handoff: trusted snapshots, not candidate verification', () => {
  // Missing publish dispatch is the original failure; the expected bytes are independent fixtures.
  it('H1/H3 fixes exact binary bytes, retains old version and separates equal-content provenance',async()=>{
    const f=await fixture();
    await f.exec('domain-solver','workspace.write',{path:'work/a.bin',content:'AAEC/w==',encoding:'base64'});
    const first=await f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a.bin'});
    expect(first.path).toMatch(/^published\/[\w-]+\.bin$/); expect(JSON.stringify(first)).not.toContain(f.root);
    expect((await f.exec('engineer','artifact.read',{ref:first.ref})).data).toBe('AAEC/w==');
    await f.exec('domain-solver','workspace.write',{path:'work/a.bin',content:'new'});
    expect((await f.exec('engineer','artifact.read',{ref:first.ref})).data).toBe('AAEC/w==');
    const second=await f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a.bin'});
    expect(second.ref).not.toBe(first.ref);
    await f.exec('engineer','workspace.write',{path:'work/e.bin',content:'new'});
    const third=await f.exec('engineer','artifact.publish',{source:'file',path:'work/e.bin'});
    expect(third.sha256).toBe(second.sha256); expect(third.ref).not.toBe(second.ref);
    const records=f.service.publicationSnapshot();
    expect(records.find(r=>r.ref===third.ref)?.source.sessionID).toBe('engineer');
    await expect(f.exec('engineer','workspace.read',{path:'work/../domain-solver/a.bin'})).rejects.toThrow('denied');
  });
  it('H4 denies source forgery, cross challenge/run, sibling, symlinks and direct published writes',async()=>{
    const f=await fixture();
    await f.exec('domain-solver','workspace.write',{path:'work/a',content:'public'});
    const p=await f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a'});
    for(const path of ['/tmp/private','work/../engineer/private','published/'+p.ref+'.bin','work/link']) {
      if(path==='work/link') { await writeFile(join(f.root,'sentinel'),'PRIVATE_SENTINEL'); await symlink(join(f.root,'sentinel'),join(f.work,'link')); }
      await expect(f.exec('domain-solver','artifact.publish',{source:'file',path})).rejects.toThrow('denied');
    }
    await expect(f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a',hash:p.sha256,session:'engineer'})).rejects.toThrow('denied');
    await expect(f.exec('engineer','artifact.read',{ref:'forged'})).rejects.toThrow('denied');
    await expect(f.exec('engineer','workspace.write',{path:p.path,content:'bad'})).rejects.toThrow('denied');
    await f.bind('other','engineer','Y');
    await expect(f.exec('other','artifact.read',{ref:p.ref})).rejects.toThrow('denied');
    const g=await fixture(); await expect(g.exec('engineer','artifact.read',{ref:p.ref})).rejects.toThrow('denied');
    await f.service.handle('root','tool.before',{tool:'task',callID:'intake',args:{subagent_type:'intake'}});
    await f.service.handle('intake','chat.message',{agent:'intake'});
    for(const sid of ['root','intake','unbound']) await expect(f.exec(sid,'artifact.publish',{source:'file',path:'work/a'})).rejects.toThrow('denied');
    await f.service.stopAll('stop'); await expect(f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a'})).rejects.toThrow('denied');
    expect(JSON.stringify(f.service.publicationSnapshot())).not.toContain('PRIVATE_SENTINEL');
  });
  it('H2/H6 binds real settled job bytes, preserves truncation and original execution',async()=>{
    const f=await fixture();
    const j=await f.exec('domain-solver','job.run',{argv:[process.execPath,'-e',"process.stdout.write('abc'); process.stderr.write('ERR')"],timeout_ms:5000});
    const p=await f.exec('domain-solver','artifact.publish',{source:'job',job:j.job,stream:'stdout',start:1,end:3});
    expect((await f.exec('engineer','artifact.read',{ref:p.ref})).data).toBe('YmM=');
    expect(p.originalComplete).toBe(true); expect(p.rangeComplete).toBe(true);
    await expect(f.exec('engineer','artifact.publish',{source:'job',job:j.job,stream:'stdout'})).rejects.toThrow('denied');
    await expect(f.exec('domain-solver','artifact.publish',{source:'job',job:j.job,stream:'stdout',end:4})).rejects.toThrow('denied');
    const firstExecution=f.service.publicationSnapshot().find(r=>r.ref===p.ref)!.source.execution;
    await f.service.handle('root','chat.message',{agent:'coordinator',messageID:'notice',parts:[{type:'text',synthetic:true,text:`<task id="domain-solver" state="completed">\n<summary>Background task completed: [ctf:${firstExecution}]</summary>`}]});
    await f.service.handle('root','tool.before',{tool:'task',callID:'resume',args:{subagent_type:'domain-solver',task_id:'domain-solver',background:true}});
    expect(f.service.executionSnapshot().filter(e=>e.childID==='domain-solver')).toHaveLength(2);
    // A later publication must retain the resource's producing execution, regardless of current execution lookup.
    const again=await f.exec('domain-solver','artifact.publish',{source:'job',job:j.job,stream:'stdout'});
    expect(f.service.publicationSnapshot().find(r=>r.ref===again.ref)!.source.execution).toBe(firstExecution);
    const big=await f.exec('domain-solver','job.run',{argv:[process.execPath,'-e',"process.stdout.write('x'.repeat(1048577))"],timeout_ms:5000});
    const cut=await f.exec('domain-solver','artifact.publish',{source:'job',job:big.job,stream:'stdout'});
    expect(cut.size).toBe(1048576); expect(cut.originalComplete).toBe(false); expect(cut.rangeComplete).toBe(true);
    expect((await f.exec('engineer','artifact.read',{ref:cut.ref})).nextCursor).toBe('32768');
  });
  it('H2/H6 takes HTTP from original adapter bytes even if editable work copy changes',async()=>{
    const f=await fixture(); const server=createServer((_q,r)=>r.end('HTTP-original'));
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    try {
      // Fixture mutates only configured target before request; identity and adapter execution remain real.
      (f.service as any).options.challenges[0].target={protocol:'http',url:`http://127.0.0.1:${(server.address() as any).port}`};
      const h=await f.exec('domain-solver','http.request',{url:(f.service as any).options.challenges[0].target.url});
      await f.exec('domain-solver','workspace.write',{path:h.bodyPath,content:'forged-work-copy'});
      const p=await f.exec('domain-solver','artifact.publish',{source:'http',resource:h.resource});
      expect((await f.exec('engineer','artifact.read',{ref:p.ref})).data).toBe('SFRUUC1vcmlnaW5hbA==');
      const raw=await f.exec('domain-solver','artifact.publish',{source:'file',path:h.bodyPath});
      expect(f.service.publicationSnapshot().find(r=>r.ref===raw.ref)!.source.kind).toBe('file');
      await expect(f.exec('engineer','artifact.publish',{source:'http',resource:h.resource})).rejects.toThrow('denied');
    } finally { await new Promise<void>(r=>server.close(()=>r())); }
  });
  it('H7 rejects modified published content through artifact and G workspace reads',async()=>{
    const f=await fixture(); await f.exec('domain-solver','workspace.write',{path:'work/a',content:'fixed'});
    const p=await f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a'});
    await writeFile(join(f.root,'X',p.path),'corrupt');
    await expect(f.exec('engineer','artifact.read',{ref:p.ref})).rejects.toThrow('denied');
    await expect(f.exec('engineer','workspace.read',{path:p.path})).rejects.toThrow('denied');
  });
});

import * as fs from 'node:fs/promises';
import { ArtifactPublisher, snapshotFile } from '../../apps/launcher/src/artifact-tools.js';
import { JobManager } from '../../apps/launcher/src/job-tools.js';

describe('D deterministic phase-controlled races and failures (not runtime)',()=>{
  const source={kind:'file' as const,run:'r',challenge:'x',sessionID:'solver',execution:'native-exec',path:'work/a'};
  it.each(['same-length-in-place','rename-file','replace-parent','symlink-parent','symlink-leaf'] as const)('H5 %s rejects modified or out-of-root source with exact phase order',async(kind)=>{
    const root=await mkdtemp(join(tmpdir(),'d-race-'));const dir=join(root,'work'); await mkdir(join(dir,'sub'),{recursive:true});
    const path=join(dir,'sub/a');await writeFile(path,Buffer.alloc(131072,65));
    const outside=join(root,'outside');await mkdir(outside);await writeFile(join(outside,'a'),'PRIVATE_SENTINEL');
    const order:string[]=[];let mutated=false;
    const io={lstat:fs.lstat,open:async(...args:Parameters<typeof fs.open>)=>{
      order.push('ancestry-validated');
      if(kind==='symlink-leaf') {await fs.rename(path,path+'.old');await fs.symlink(join(outside,'a'),path);order.push('leaf-swapped');return fs.open(...args);}
      if(kind==='replace-parent'||kind==='symlink-parent') {
        await fs.rename(join(dir,'sub'),join(dir,'sub-old'));
        if(kind==='replace-parent') {await mkdir(join(dir,'sub'));await writeFile(path,'PRIVATE_SENTINEL');}
        else await fs.symlink(outside,join(dir,'sub'));
        order.push('parent-swapped');return fs.open(...args);
      }
      const h=await fs.open(...args);const read=h.read.bind(h);
      h.read=(async(...readArgs:any[])=>{
        if(!mutated) {mutated=true;order.push('descriptor-validated');
          if(kind==='rename-file') {await writeFile(path+'.new',Buffer.alloc(131072,66));await fs.rename(path+'.new',path);}
          else {const w=await fs.open(path,'r+');await w.write(Buffer.alloc(65536,66),0,65536,65536);await w.close();}
          order.push('source-mutated-before-read');
        }
        const r=await (read as any)(...readArgs);order.push('read-chunk');return r;
      }) as typeof h.read;
      return h;
    }};
    await expect(snapshotFile(dir,['sub','a'],io as any)).rejects.toThrow();
    expect(order[0]).toBe('ancestry-validated');expect(order.length).toBeGreaterThan(1);
    console.log(JSON.stringify({criterion:'H5',kind,order,result:'refused',timing:'explicit awaited phase, no sleep'}));
  });
  it('H5 quiescent atomic rename selects a whole version; hash does not stop same-uid writes',async()=>{
    const root=await mkdtemp(join(tmpdir(),'d-version-'));await writeFile(join(root,'a'),'OLD');
    const before=await snapshotFile(root,['a']);await writeFile(join(root,'new'),'NEW');await fs.rename(join(root,'new'),join(root,'a'));
    const after=await snapshotFile(root,['a']);expect(before.toString()).toBe('OLD');expect(after.toString()).toBe('NEW');
    // Deterministic OS counterexample: host-authorized bytes are writable outside the managed tool interface.
    const publisher=new ArtifactPublisher();const p=await publisher.publish(root,source,before,null,{},()=>{});
    await writeFile(join(root,p.ref+'.bin'),'UID');
    expect((await readFile(join(root,p.ref+'.bin'))).toString()).toBe('UID');
    await expect(publisher.read('r','x',{ref:p.ref})).rejects.toThrow();
    console.log(JSON.stringify({criterion:'H5',osCounterexample:'same uid directly rewrote published bytes; managed read detects but cannot prevent',isolation:false}));
  });
  it.each(['write-failure','cancel-before-write','cancel-after-rename','deadline-after-rename','reply-lost'] as const)('H7 %s leaves no half ref or implicit source replay',async(kind)=>{
    const root=await mkdtemp(join(tmpdir(),'d-persist-'));let live=true,commits=0;const order:string[]=[];
    const publisher=new ArtifactPublisher({...fs,
      writeFile:async(...args:any[])=>{order.push('write');if(kind==='write-failure')throw new Error('injected disk failure');return (fs.writeFile as any)(...args);},
      rename:async(...args:any[])=>{await (fs.rename as any)(...args);commits++;order.push('rename');if(kind==='cancel-after-rename'||kind==='deadline-after-rename')live=false;}
    } as any);
    if(kind==='cancel-before-write')live=false;
    const action=()=>{order.push('check-live');if(!live)throw new Error(kind);};
    if(kind==='reply-lost') {
      // The transport drops the result after publisher linearization. Source bytes are NOT re-produced.
      await publisher.publish(root,source,Buffer.from('fixed'),true,{},action);
      const visible=publisher.snapshot();expect(visible).toHaveLength(1);
      expect((await publisher.read('r','x',{ref:visible[0]!.ref})).data).toBe('Zml4ZWQ=');expect(commits).toBe(1);
    } else {
      await expect(publisher.publish(root,source,Buffer.from('fixed'),true,{},action)).rejects.toThrow();
      expect(publisher.snapshot()).toHaveLength(0);expect(await fs.readdir(root)).toEqual([]);
    }
    console.log(JSON.stringify({criterion:'H7',kind,order,commits,visibleRefs:publisher.snapshot().length,sourceReplay:0}));
  });
  it('H6 refuses in-flight job snapshots and reports real failed/truncated HTTP honestly',async()=>{
    const f=await fixture();const manager=new JobManager({jobsRoot:join(f.root,'jobs')});
    const binding={sessionId:'solver',challengeId:'X',workDir:f.work,materialsDir:join(f.root,'X/materials'),publishedDir:f.published};
    const job=await manager.run(binding,{argv:[process.execPath,'-e','setInterval(()=>{},1000)'],wait_ms:0});
    expect(()=>manager.outputSnapshot(binding,job.job,'stdout')).toThrow('job not settled');await manager.cancelAll();
    const server=createServer((q,r)=>{if(q.url==='/failed')r.destroy();else r.end('x'.repeat(1048577));});
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    try {
      const url=`http://127.0.0.1:${(server.address() as any).port}`;(f.service as any).options.challenges[0].target={protocol:'http',url};
      const h=await f.exec('domain-solver','http.request',{url});expect(h.bodyTruncated).toBe(true);
      const p=await f.exec('domain-solver','artifact.publish',{source:'http',resource:h.resource,start:0,end:2});
      expect(p.snapshotFixed).toBe(true);expect(p.rangeComplete).toBe(true);expect(p.originalComplete).toBe(false);expect(p.size).toBe(2);
      await expect(f.exec('domain-solver','artifact.publish',{source:'http',resource:h.resource,start:2,end:1048577})).rejects.toThrow('denied');
      const before=f.service.publicationSnapshot().length;await expect(f.exec('domain-solver','http.request',{url:url+'/failed'})).rejects.toThrow('denied');
      expect(f.service.publicationSnapshot()).toHaveLength(before);
    } finally {await new Promise<void>(r=>server.close(()=>r()));}
  });
});

// If G search/list still walks the raw published directory, an OS-level planted file leaks through managed tools.
it('H4/H7 G list/search use the publication registry and refuse corrupted registered bytes',async()=>{
 const f=await fixture();await f.exec('domain-solver','workspace.write',{path:'work/a',content:'safe searchable'});
 const p=await f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a'});
 await writeFile(join(f.published,'unregistered'),'PRIVATE_SENTINEL');
 const list=await f.exec('engineer','workspace.list',{path:'published'});expect(list.entries.map((v:any)=>v.name)).toEqual([p.ref+'.bin']);
 const search=await f.exec('engineer','workspace.search',{needle:'PRIVATE_SENTINEL'});expect(search.matches).toEqual([]);
 expect((await f.exec('engineer','workspace.search',{path:'published',needle:'searchable'})).matches).toHaveLength(1);
 await writeFile(join(f.published,p.ref+'.bin'),'PRIVATE_SENTINEL');
 await expect(f.exec('engineer','workspace.search',{path:'published',needle:'PRIVATE_SENTINEL'})).rejects.toThrow('denied');
});

it('H4 visibility-independent C precheck rejects publish by wrong roles and missing identity',async()=>{
 const f=await fixture();
 await f.service.handle('root','tool.before',{tool:'task',callID:'it',args:{subagent_type:'intake'}});
 await f.service.handle('intake','chat.message',{agent:'intake'});
 for(const sid of ['root','intake','unbound']) await expect(f.service.handle(sid,'tool.before',{tool:'ctf_artifact_publish',callID:'deny',args:{source:'file',path:'work/a'}})).rejects.toThrow('denied');
 await f.service.revoke('domain-solver');
 await expect(f.service.handle('domain-solver','tool.before',{tool:'ctf_artifact_publish',callID:'revoked',args:{source:'file',path:'work/a'}})).rejects.toThrow('denied');
});
it('H5 external writer rendezvous between reads rejects a mixed buffer with deterministic order',async()=>{
 const root=await mkdtemp(join(tmpdir(),'d-barrier-'));await writeFile(join(root,'a'),Buffer.alloc(131072,65));
 let reached!:()=>void,release!:()=>void;const atBarrier=new Promise<void>(r=>reached=r),resume=new Promise<void>(r=>release=r);const order:string[]=[];
 const io={lstat:fs.lstat,open:async(...args:Parameters<typeof fs.open>)=>{
   const h=await fs.open(...args),read=h.read.bind(h);let reads=0;
   h.read=(async(...readArgs:any[])=>{reads++;if(reads===2){order.push('second-read-blocked');reached();await resume;order.push('second-read-released');}
     const r=await (read as any)(...readArgs);order.push('read-'+reads);return r;}) as typeof h.read;return h;
 }};
 const pending=snapshotFile(root,['a'],io as any);await atBarrier;
 const w=await fs.open(join(root,'a'),'r+');await w.write(Buffer.alloc(65536,66),0,65536,65536);await w.close();order.push('external-write-completed');release();
 await expect(pending).rejects.toThrow();expect(order).toEqual(['read-1','second-read-blocked','external-write-completed','second-read-released','read-2']);
 console.log(JSON.stringify({criterion:'H5',barrier:'awaited external writer between chunks',order,result:'mixed buffer refused before publication'}));
});

it('H3 preserves managed file producer execution across resume and labels untracked writes unknown',async()=>{
 const f=await fixture();await f.exec('domain-solver','workspace.write',{path:'work/a',content:'old producer bytes'});
 const oldExecution=f.service.executionSnapshot().find(e=>e.childID==='domain-solver')!.ref;
 await f.service.handle('root','chat.message',{agent:'coordinator',messageID:'file-notice',parts:[{type:'text',synthetic:true,text:`<task id="domain-solver" state="completed">\n<summary>Background task completed: [ctf:${oldExecution}]</summary>`}]});
 await f.service.handle('root','tool.before',{tool:'task',callID:'file-resume',args:{subagent_type:'domain-solver',task_id:'domain-solver',background:true}});
 const p=await f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a'});
 expect(f.service.publicationSnapshot().find(r=>r.ref===p.ref)!.source.execution).toBe(oldExecution);
 await writeFile(join(f.work,'a'),'untracked bytes');
 const unknown=await f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a'});
 const record=f.service.publicationSnapshot().find(r=>r.ref===unknown.ref)!;
 expect(record.source.execution).toBeNull();expect(record.source.selectedExecution).not.toBe(oldExecution);
});

it('H3 concurrent publication audit attaches each own ref rather than last registry entry',async()=>{
 const f=await fixture();await f.exec('domain-solver','workspace.write',{path:'work/a',content:'A'});await f.exec('engineer','workspace.write',{path:'work/b',content:'B'});
 const publisher=(f.service as any).publications as ArtifactPublisher;
 const real=publisher.publish.bind(publisher);let arrived=0,release!:()=>void;const both=new Promise<void>(r=>release=r);const order:string[]=[];
 publisher.publish=async(...args:Parameters<ArtifactPublisher['publish']>)=>{
   const p=await real(...args);order.push('committed:'+p.ref);if(++arrived===2)release();await both;order.push('reply:'+p.ref);return p;
 };
 const [a,b]=await Promise.all([f.exec('domain-solver','artifact.publish',{source:'file',path:'work/a'}),f.exec('engineer','artifact.publish',{source:'file',path:'work/b'})]);
 const audits=f.service.audit.filter(a=>a.op==='artifact.published');
 expect((audits.find(a=>a.sessionID==='domain-solver')!.detail as any).ref).toBe(a.ref);
 expect((audits.find(a=>a.sessionID==='engineer')!.detail as any).ref).toBe(b.ref);
 expect(order.slice(0,2).every(s=>s.startsWith('committed:'))).toBe(true);
 console.log(JSON.stringify({criterion:'H3',interleaving:'two real commits before either C reply resumes',order,result:'audit source matched own ref'}));
});
