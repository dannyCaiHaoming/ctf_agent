import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ControlService} from '../../apps/launcher/src/control-service.js';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
function fixture() {
 const root=mkdtempSync(join(tmpdir(),'recon-recording-')),materials=join(root,'workspace/X/materials');mkdirSync(materials,{recursive:true});
 const store=new ExperienceStore(join(root,'experience.sqlite'));
 const client={session:{get:async({sessionID}:any)=>({data:{id:sessionID,parentID:'root'}}),messages:async()=>({data:[]}),children:async()=>({data:[]}),abort:async()=>({data:true})}};
 const service=new ControlService({client:client as never,runId:'A',experienceStore:store,workdir:join(root,'opencode'),skillRoot:join(root,'skills'),expiresAt:Date.now()+60000,budget:{maxModelCalls:50,maxObservableTokens:10000,maxToolJobs:3},challenges:[{id:'X',title:null,target:null,reachability:null,materials:[],materialsDir:materials}]});
 service.bindRoot('root');
 service.bindings.set('recon',{sessionID:'recon',role:'recon',parentID:'root',via:'dispatch',scope:'run',expiresAt:Date.now()+60000,state:'active',boundAt:Date.now(),challengeId:'X'});
 service.bindings.set('reference',{sessionID:'reference',role:'reference',parentID:'root',via:'dispatch',scope:'run',expiresAt:Date.now()+60000,state:'active',boundAt:Date.now()});
 return {root,store,service};
}
describe('process and experience host tools',()=>{
 it('records actual failure without after hook and denies exploration if persistence fails',async()=>{
  const {store,service}=fixture();
  await expect(service.handle('recon','tool.execute',{tool:'http.request',callID:'http',messageID:'assistant1',args:{url:'http://127.0.0.1:1/'}})).rejects.toThrow();
  const r=store.records('A','X').records[0]!;expect(r.status).toBe('error');expect(r.message_id).toBe('assistant1');
  store.db.exec("CREATE TRIGGER no_write BEFORE INSERT ON recon_turns BEGIN SELECT RAISE(ABORT,'disk'); END;");
  await expect(service.handle('recon','tool.execute',{tool:'job.run',callID:'job',messageID:'assistant2',args:{argv:[process.execPath,'-e','throw Error()']}})).rejects.toThrow();
  expect(service.resourceSnapshot()).toHaveLength(1); // HTTP registered, refused before a socket; no job admitted.
  await expect(service.handle('recon','tool.before',{tool:'skill',callID:'read-method',args:{name:'recon-investigation'}})).resolves.toMatchObject({allowed:true});
  await expect(service.handle('recon','tool.before',{tool:'ctf_job_cancel',callID:'cancel',args:{job:'missing'}})).resolves.toMatchObject({allowed:true});store.close();
 });
 it('allows unbound Reference to read shared history, denies process tools and invalid evidence',async()=>{
  const {store,service}=fixture();expect(await service.handle('reference','tool.execute',{tool:'experience.search',callID:'s',args:{query:'template'}})).toMatchObject({results:[]});
  await expect(service.handle('reference','tool.execute',{tool:'recon.read',args:{}})).rejects.toThrow('tool not permitted');
  await expect(service.handle('recon','tool.execute',{tool:'recon.note',callID:'n',messageID:'a',args:{evidence_refs:['made-up']}})).rejects.toThrow();store.close();
 });
 it('late native parts backfill identity for pre-execute denial and preserve native error',async()=>{
  const {store,service}=fixture();await expect(service.handle('recon','tool.before',{tool:'bash',callID:'bad',args:{command:'echo no'}})).rejects.toThrow();
  await service.handle('recon','process.event',{part:{type:'tool',sessionID:'recon',messageID:'a1',callID:'bad',tool:'bash',state:{status:'error',input:{command:'echo no'},error:'denied'}}});
  const r=store.records('A','X').records[0]!;expect(r.status).toBe('error');expect(r.turn_no).toBe(1);expect(r.message_id).toBe('a1');store.close();
 });
});

it('collects two challenge attempts separately and binds host result without treating verifier as solved',async()=>{
 const {store,service}=fixture();const options=(service as any).options;
 options.challenges.push({...options.challenges[0],id:'Y'});
 options.client.session.messages=async({sessionID}:any)=>({data:[{info:{role:'assistant'},parts:[{type:'text',text:sessionID==='recon'?'X SQL_FAILED then template':'Y stopped without candidate'}]}]});
 service.executionSnapshot=()=>[{ref:'ex',childID:'recon',role:'recon',challengeId:'X',state:'completed',delivered:true,resultFacts:{completeness:'complete'}},{ref:'ey',childID:'other',role:'domain-solver',challengeId:'Y',state:'completed',delivered:true,resultFacts:{completeness:'complete'}}] as any;
 service.completionSnapshot=()=>[{intent:'trusted',challenge:'X',state:'confirmed',solved:true,businessOutcome:'accepted'},{intent:'uncertain',challenge:'Y',state:'unknown',solved:false}] as any;
 service.stopReason='completed';const episodes=await service.learningInputs();expect(episodes).toHaveLength(2);
 expect(episodes.find(e=>e.challenge_id==='X')).toMatchObject({outcome:'solved'});expect(episodes.find(e=>e.challenge_id==='Y')).toMatchObject({outcome:'unknown'});
 expect(JSON.stringify(episodes.find(e=>e.challenge_id==='X')!.input)).not.toContain('Y stopped');expect(JSON.stringify(episodes.find(e=>e.challenge_id==='Y')!.input)).not.toContain('X SQL_FAILED');
 expect((await service.learningInputs()).map(e=>[e.episode_id,e.version])).toEqual(episodes.map(e=>[e.episode_id,e.version]));store.close();
});

it('R1: terminal UPDATE failure after real HTTP pauses the challenge across Recon sessions while preserving handoff',async()=>{
 const {createServer}=await import('node:http');let hits=0;
 const target=createServer((_q,r)=>{hits++;r.end('observed');});await new Promise<void>(done=>target.listen(0,'127.0.0.1',done));
 const {store,service}=fixture();const url=`http://127.0.0.1:${(target.address() as {port:number}).port}/`;
 const options=(service as any).options;options.challenges[0].target={url};
 (service as any).executions.set('exec-recon',{ref:'exec-recon',childID:'recon',state:'running',role:'recon',run:'A',challengeId:'X',parent:'root'});
 try {
  await service.handle('recon','tool.execute',{tool:'workspace.write',callID:'saved',messageID:'a0',args:{path:'work/report.txt',content:'existing observation'}});
  store.db.exec("CREATE TRIGGER terminal_write_failure BEFORE UPDATE OF result_json ON recon_turns BEGIN SELECT RAISE(ABORT,'terminal disk failure'); END;");
  const request=(sessionID:string,callID:string)=>service.handle(sessionID,'tool.execute',{tool:'http.request',callID,messageID:'a1',args:{url}});
  await expect(request('recon','first')).rejects.toThrow('exploration paused');expect(hits).toBe(1);
  await expect(request('recon','second')).rejects.toThrow('exploration paused');
  service.bindings.set('new-recon',{...service.bindings.get('recon')!,sessionID:'new-recon'});
  await expect(request('new-recon','third')).rejects.toThrow('exploration paused');
  service.bindings.set('same-challenge-solver',{...service.bindings.get('recon')!,sessionID:'same-challenge-solver',role:'domain-solver'});
  await expect(request('same-challenge-solver','solver-bypass')).rejects.toThrow('exploration paused');expect(hits).toBe(1);
  expect(store.allRecords('A','X').filter((r:any)=>r.tool==='http.request')).toHaveLength(1);
  await expect(service.handle('recon','tool.execute',{tool:'workspace.read',callID:'read',args:{path:'work/report.txt'}})).resolves.toMatchObject({text:'existing observation'});
  await expect(service.handle('recon','tool.before',{tool:'ctf_job_cancel',callID:'cancel',args:{job:'missing'}})).resolves.toMatchObject({allowed:true});
  await expect(service.handle('recon','tool.execute',{tool:'artifact.publish',callID:'fixed',args:{source:'file',path:'work/report.txt'}})).resolves.toHaveProperty('ref');
  await expect(service.handle('recon','tool.execute',{tool:'recon.read',callID:'history',args:{}})).resolves.toMatchObject({process_storage:{state:'paused'},export:{snapshotFixed:true}});
  await expect(service.handle('recon','tool.execute',{tool:'recon.note',callID:'handoff',args:{kind:'handoff',next_reason:'history persistence failed; fixed existing report'}})).resolves.toHaveProperty('id');
  store.db.exec('DROP TRIGGER terminal_write_failure');
  await expect(request('new-recon','after-db-recovery')).rejects.toThrow('exploration paused');
  options.challenges.push({...options.challenges[0],id:'Y'});service.bindings.set('other',{...service.bindings.get('recon')!,sessionID:'other',challengeId:'Y'});
  await expect(request('other','other-http')).resolves.toHaveProperty('status',200);
  expect(hits).toBe(2);
 }finally{store.close();await new Promise<void>(done=>{target.close(()=>done());target.closeAllConnections();});}
});

it('publishes complete large process payloads and pauses on publication failure',async()=>{
 const {store,service}=fixture();
 const large={stdout:'a'.repeat(40000),stderr:'b'.repeat(40000),password:'private-secret'};
 store.addRedactions(['private-secret']);
 const event=(callID:string)=>({part:{type:'tool',sessionID:'recon',messageID:'msg-'+callID,callID,tool:'bash',state:{status:'completed',input:large,output:large}}});
 await expect(service.handle('recon','process.event',event('large'))).resolves.toEqual({recorded:true});
 const row=store.allRecords('A','X').find(r=>r.call_id==='large')!;
 for(const payload of [row.args_json,row.result_json]){
  expect(payload).toMatchObject({ref:expect.stringMatching(/^[0-9a-f-]{36}$/),sha256:expect.stringMatching(/^[0-9a-f]{64}$/),size:expect.any(Number),originalComplete:true,rangeComplete:true});
  const pages:Buffer[]=[];let cursor:string|undefined;
  do {const page=await (service as any).publications.read('A','X',{ref:payload.ref,...(cursor?{cursor}:{})});pages.push(Buffer.from(page.data,'base64'));cursor=page.nextCursor??undefined;} while(cursor);
  const bytes=Buffer.concat(pages),decoded=JSON.parse(bytes.toString()) as typeof large;
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(payload.sha256);
  expect(bytes.length).toBe(payload.size);expect(decoded).toEqual({...large,password:'<redacted>'});expect(bytes.toString()).not.toContain('private-secret');
 }
 expect(row.args_meta).toMatchObject({storage:'artifact',complete:true,transformation:'redacted'});
 expect(row.result_meta).toMatchObject({storage:'artifact',complete:true,transformation:'redacted'});

 (service as any).publications.publish=async()=>{throw new Error('disk unavailable');};
 await expect(service.handle('recon','process.event',event('failed'))).rejects.toThrow('exploration paused');
 const failed=store.allRecords('A','X').find(r=>r.call_id==='failed')!;
 expect(failed.args_json).toMatchObject({publication:{status:'error',reason:'disk unavailable'}});
 expect(failed.args_meta).toMatchObject({storage:'artifact',complete:false});
 expect(failed.original_complete).toBe(false);
 expect(service.audit.some(a=>a.op==='process.paused'&&!a.allow)).toBe(true);
 store.close();
});

it('R1: asynchronous job terminal persistence failure pauses new jobs even after running reply was delivered',async()=>{
 const {readFile}=await import('node:fs/promises');const {setTimeout:delay}=await import('node:timers/promises');
 const {root,store,service}=fixture(),marker=join(root,'job-actually-ran.txt');
 store.db.exec("CREATE TRIGGER async_terminal_failure BEFORE UPDATE OF result_json ON recon_turns WHEN NEW.status != 'running' BEGIN SELECT RAISE(ABORT,'terminal disk failure'); END;");
 const first=await service.handle('recon','tool.execute',{tool:'job.run',callID:'async-first',messageID:'a1',args:{argv:[process.execPath,'-e',`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'first'),100)`],wait_ms:0,timeout_ms:3000}}) as {job:string;state:string};
 expect(first.state).toBe('running');
 for(let i=0;i<200&&!service.audit.some(a=>a.op==='process.paused');i++)await delay(10);
 expect(await readFile(marker,'utf8')).toBe('first');expect(service.audit.some(a=>a.op==='process.paused')).toBe(true);
 service.bindings.set('new-recon',{...service.bindings.get('recon')!,sessionID:'new-recon'});
 await expect(service.handle('new-recon','tool.execute',{tool:'job.run',callID:'async-second',args:{argv:[process.execPath,'-e',`require('node:fs').appendFileSync(${JSON.stringify(marker)},'second')`]}})).rejects.toThrow('exploration paused');
 expect(await readFile(marker,'utf8')).toBe('first');expect(service.resourceSnapshot()).toHaveLength(1);expect(service.resourceSnapshot()[0]!.state).toBe('settled');
 await expect(service.handle('recon','tool.execute',{tool:'job.read',callID:'read-job',args:{job:first.job,stream:'stdout'}})).resolves.toHaveProperty('data');
 await expect(service.handle('recon','tool.execute',{tool:'job.cancel',callID:'cancel-job',args:{job:first.job}})).resolves.toHaveProperty('job');store.close();
});

it('projects judgments before actions, refreshes old rows and automatically presents versioned lessons without search',async()=>{
 const {store,service}=fixture();
 const e=store.saveDraft({run_id:'old',challenge_id:'old',outcome:'solved',outcome_ref:[],end_reason:'done',input:{sources:[]}});e.content={summary:'template method',tech_tags:['template'],steps:[],failed_paths:[],unresolved:[],experience_refs:[]};e.episode_status='completed';store.saveEpisode(e);
 const done=store.completeLessons(e,[{title:'template arithmetic',tags:['template'],when:'template evaluation',steps:['compare arithmetic'],checks:['numeric result'],avoid:['literal reflection'],limits:['verify current behavior']}]);
 const scope={run:'A',challenge:'X',session:'recon',call:'tool',message:'a1'};store.start(scope,'workspace.read',{path:'materials/source.php'});
 store.note({...scope,call:'note'},{kind:'decision',assessment:'template route',next_action:'compare arithmetic'},()=>true);
 const first=await service.handle('recon','context.prepare',{messageID:'u1',placement:'chat.message'}) as any;const payload=JSON.parse(first.text.slice(first.text.indexOf('\n')+1));
 expect(payload.experience.lessons[0].id).toBe(done.lesson_ids[0]);expect(payload.state.gaps).not.toContain('decision not recorded');
 store.finish(scope,'completed',{content:'changed result'});
 const next=await service.handle('recon','context.prepare',{messageID:'u1',placement:'chat.message'}) as any;expect(next.version).not.toBe(first.version);
 expect(await service.handle('recon','context.prepare',{messageID:'u1',placement:'chat.message'})).toEqual(next);
 expect(await service.handle('reference','context.prepare',{messageID:'u2',placement:'chat.message'})).toEqual({});
 expect(store.records('A','X',{kind:'decision'}).records.every(r=>r.kind==='decision')).toBe(true);
 (service as any).options.challenges.push({...((service as any).options.challenges[0]),id:'Y'});
 service.bindings.set('other',{...service.bindings.get('recon')!,sessionID:'other',role:'domain-solver',challengeId:'Y'});
 const otherText=(await service.handle('other','context.prepare',{messageID:'other-user',placement:'chat.message'}) as any).text,other=JSON.parse(otherText.slice(otherText.indexOf('\n')+1));
 expect(other.index.entries).toEqual([]);expect(other.recent).toEqual([]);expect(other.experience.lessons).toEqual([]);
 const revision=store.saveDraft({run_id:'old',challenge_id:'old',outcome:'unsolved',outcome_ref:[],end_reason:'corrected',input:{sources:[]}});
 expect(revision.version).toBe(2);
 const refreshedText=(await service.handle('recon','context.prepare',{messageID:'u1',placement:'chat.message'}) as any).text,refreshed=JSON.parse(refreshedText.slice(refreshedText.indexOf('\n')+1));
 expect(refreshed.experience.lessons[0].source_revisions[0].latest.outcome).toBe('unsolved');
 store.db.exec('DROP TABLE lessons');await expect(service.handle('recon','context.prepare',{messageID:'u1',placement:'chat.message'})).rejects.toThrow();
 expect(service.audit.at(-1)).toMatchObject({op:'context.prepare',allow:false});store.close();
});

it('handoff freezes all pages including final note and running rows, downstream reads immutable chunk index',async()=>{
 const {store,service}=fixture();
 for(let i=0;i<160;i++){const scope={run:'A',challenge:'X',session:'recon',call:'c'+i,message:'a'+i};store.start(scope,'workspace.read',{path:'materials/a'});if(i<159)store.finish(scope,'completed',{data:'x'.repeat(7000)});}
 (service as any).executions.set('ex',{ref:'ex',childID:'recon',role:'recon',state:'running'});
 const result=await service.handle('recon','tool.execute',{tool:'recon.note',callID:'handoff',messageID:'last',args:{kind:'handoff',assessment:'baseline available',next_action:'solve'}}) as any;
 expect(result.snapshot.status,JSON.stringify(service.audit.slice(-3))).toBe('complete');expect(result.snapshot.coverage.total).toBe(161);expect(result.snapshot.coverage.in_flight_ids).toHaveLength(1);
 const pub=(service as any).publications,index=JSON.parse((await pub.bytes('A','X',result.snapshot.export.ref)).bytes.toString());expect(index.parts.length).toBeGreaterThan(1);
 const fixed=JSON.parse(Buffer.concat(await Promise.all(index.parts.map(async(p:any)=>(await pub.bytes('A','X',p.ref)).bytes))).toString());
 expect(fixed.records.at(-1).kind).toBe('handoff');expect(fixed.records.at(-2).status).toBe('running');
 store.finish({run:'A',challenge:'X',session:'recon',call:'c159'},'completed',{later:true});
 expect(JSON.parse((await pub.bytes('A','X',result.snapshot.export.ref)).bytes.toString())).toEqual(index);
 const repeat=await service.handle('recon','tool.execute',{tool:'recon.note',callID:'handoff',messageID:'last',args:{kind:'handoff'}});expect(repeat).toEqual(result);store.close();
});

it('saved handoff survives export failure without blocking closure or retrying publication',async()=>{
 const {store,service}=fixture();let calls=0;(service as any).publications.publish=async()=>{calls++;throw new Error('disk unavailable');};
 (service as any).executions.set('ex',{ref:'ex',childID:'recon',role:'recon',state:'running'});
 const body={tool:'recon.note',callID:'handoff',messageID:'last',args:{kind:'handoff',next_reason:'blocked'}};
 const first=await service.handle('recon','tool.execute',body) as any;expect(first.snapshot.status).toBe('partial');expect(store.allRecords('A','X').at(-1).kind).toBe('handoff');
 expect(await service.handle('recon','tool.execute',body)).toEqual(first);expect(calls).toBe(1);store.close();
});

it('new decision and observation survive a saturated statement/material keyword budget',async()=>{
 const {retrievalSignals}=await import('../../apps/launcher/src/investigation-context.js');const {store}=fixture();
 const statement=Array.from({length:24},(_,i)=>'statementword'+i).join(' '),materials=Array.from({length:16},(_,i)=>'materialword'+i+'_file'+i+'.txt');
 const baseline=retrievalSignals(store,statement,materials,[]);
 const changed=retrievalSignals(store,statement,materials,[{id:1,kind:'decision',note_json:{assessment:'jinja2 template injection'}},{id:2,kind:'tool',tool:'workspace.read',result_json:{text:'twig observed'}}]);
 expect(changed.query).not.toBe(baseline.query);expect(changed.query.split(' ')).toContain('jinja2');expect(changed.query.split(' ')).toContain('twig');
 expect(changed.query.length).toBeLessThanOrEqual(500);expect(changed.query.split(' ').length).toBeLessThanOrEqual(50);
 expect(changed.query.split(' ').every(w=>changed.signals.some(s=>s.words.includes(w)))).toBe(true);store.close();
});

it('snapshot read failure returns saved note and cached partial with audit instead of a generic rejection',async()=>{
 const {store,service}=fixture();(service as any).executions.set('ex',{ref:'ex',childID:'recon',role:'recon',state:'running'});
 let reads=0;const original=store.allRecords.bind(store);store.allRecords=()=>{reads++;throw new Error('snapshot read unavailable');};
 const body={tool:'recon.note',callID:'handoff-read-failure',messageID:'last',args:{kind:'handoff',next_reason:'ready'}};
 const first=await service.handle('recon','tool.execute',body) as any;
 expect(first).toMatchObject({id:expect.any(Number),snapshot:{status:'partial'}});expect(original('A','X').at(-1).id).toBe(first.id);
 expect(service.audit.some(r=>r.op==='recon.snapshot'&&!r.allow&&(r.detail as any).handoff_id===first.id)).toBe(true);
 expect(await service.handle('recon','tool.execute',body)).toEqual(first);expect(reads).toBe(1);expect(service.publicationSnapshot()).toEqual([]);store.close();
});

it('decision history cannot evict Solver delivery at the earlier persistent-input size bound',async()=>{
 const {store,service}=fixture();
 for(let i=0;i<100;i++)store.note({run:'A',challenge:'X',session:'recon',call:'n'+i,message:'m'+i},{kind:'decision',observation:'a'.repeat(4000),assessment:'b'.repeat(4000),next_action:'c'.repeat(4000),next_reason:'d'.repeat(4000)},()=>true);
 (service as any).options.client.session.messages=async()=>({data:[{info:{role:'assistant'},parts:[{type:'text',text:'solver evidence '.repeat(1000)},{type:'text',text:'final route '.repeat(1000)},{type:'text',text:'verification '.repeat(1000)}]}]});
 service.executionSnapshot=()=>[{ref:'solver-delivery',childID:'solver',role:'domain-solver',challengeId:'X',state:'completed',delivered:true,resultFacts:{completeness:'complete'}}] as any;
 const e=(await service.learningInputs())[0]!;expect(e.input.sources.some((s:any)=>s.ref==='execution:solver-delivery')).toBe(true);expect(e.input.gaps.some((g:string)=>g.includes('input size bound'))).toBe(true);store.close();
});

it('R3: oversized process payloads persist as fixed artifact refs and publication failure is never complete',async()=>{
 const {store,service}=fixture();
 try {
  const content='x'.repeat(40_000);
  await service.handle('recon','tool.execute',{tool:'workspace.write',callID:'big',messageID:'a1',args:{path:'work/big.txt',content}});
  const row=store.allRecords('A','X').find((r:any)=>r.call_id==='big')!;
  expect(row.args_meta).toMatchObject({storage:'artifact',complete:true});
  const index=store.records('A','X',{ids:[row.id]}).index[0]!;
  expect(index.args_ref).toEqual(expect.any(String));
  let cursor:string|undefined,bytes=Buffer.alloc(0);
  for(;;){const page:any=await service.handle('recon','tool.execute',{tool:'artifact.read',callID:'r'+bytes.length,args:{ref:index.args_ref,...(cursor?{cursor}:{})}});
   bytes=Buffer.concat([bytes,Buffer.from(page.data,'base64')]);if(!page.nextCursor)break;cursor=page.nextCursor;}
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.args_meta.sha256);
  expect(JSON.parse(bytes.toString('utf8'))).toEqual({path:'work/big.txt',content});
  (service as any).publications.publish=async()=>{throw new Error('publish disk failure');};
  await expect(service.handle('recon','tool.execute',{tool:'workspace.write',callID:'lost',messageID:'a2',args:{path:'work/lost.txt',content}})).resolves.toBeDefined();
  const lost=store.allRecords('A','X').find((r:any)=>r.call_id==='lost')!;
  expect(lost).toMatchObject({status:'error',original_complete:false});
  expect(lost.result_meta.complete).toBe(false);
  await expect(service.handle('recon','tool.execute',{tool:'http.request',callID:'after',messageID:'a3',args:{url:'http://127.0.0.1:1/'}})).rejects.toThrow('exploration paused');
 }finally{store.close();}
});
