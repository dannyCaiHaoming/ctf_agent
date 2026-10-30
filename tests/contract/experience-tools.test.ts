import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
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
