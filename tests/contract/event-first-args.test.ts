import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {ControlService} from '../../apps/launcher/src/control-service.js';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';

// r17: in the real runtime message.part.updated arrives before tool.execute.before. Synthetic data only.
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'event-first-')),materials=join(root,'workspace/X/materials');mkdirSync(materials,{recursive:true});
  const store=new ExperienceStore(join(root,'experience.sqlite'));
  const client={session:{get:async({sessionID}:any)=>({data:{id:sessionID,parentID:'root'}}),messages:async()=>({data:[]}),children:async()=>({data:[]}),abort:async()=>({data:true})}};
  const service=new ControlService({client:client as never,runId:'A',experienceStore:store,workdir:join(root,'opencode'),skillRoot:join(root,'skills'),expiresAt:Date.now()+60000,
    budget:{maxModelCalls:50,maxObservableTokens:10000,maxToolJobs:3},challenges:[{id:'X',title:null,target:null,reachability:null,materials:[],materialsDir:materials}]});
  service.bindRoot('root');
  service.bindings.set('recon',{sessionID:'recon',role:'recon',parentID:'root',via:'dispatch',scope:'run',expiresAt:Date.now()+60000,state:'active',boundAt:Date.now(),challengeId:'X'} as never);
  (service as any).executions.set('ex-recon',{ref:'ex-recon',childID:'recon',role:'recon',state:'running',run:'A',parent:'root',challengeId:'X',delivered:true,source:{status:'conflict'}});
  return {store,service};
}
const ev=(callID:string,state:Record<string,unknown>)=>({part:{type:'tool',sessionID:'recon',messageID:'m-'+callID,callID,tool:'ctf_workspace_write',state}});
const rowOf=(store:ExperienceStore,call:string)=>store.allRecords('A','X').find(r=>r.call_id===call)!;

describe('event-first ordering keeps real arguments (r17)',()=>{
  it('(a) event without input, then tool.execute: args and completeness come from the real call',async()=>{
    const {store,service}=fixture();
    await service.handle('recon','process.event',ev('c1',{status:'running'}));
    const placeholder=rowOf(store,'c1');
    expect(placeholder.original_complete).toBe(false);expect(placeholder.args_meta).toMatchObject({complete:false});
    await service.handle('recon','tool.execute',{tool:'workspace.write',callID:'c1',messageID:'m-c1',args:{path:'work/a.txt',content:'echo synthetic'}});
    const row=rowOf(store,'c1');
    expect(row.args_json).toEqual({path:'work/a.txt',content:'echo synthetic'});expect(row.args_meta).toMatchObject({complete:true});expect(row.original_complete).toBe(true);
    expect(store.allRecords('A','X')).toHaveLength(1);
    expect(store.records('A','X').index[0]!.fingerprint).toBe(row.args_meta.sha256);
    store.close();
  });
  it('(a) managed tool via tool.execute after an event-first placeholder',async()=>{
    const {store,service}=fixture();
    await service.handle('recon','process.event',ev('w1',{status:'running'}));
    await service.handle('recon','tool.execute',{tool:'workspace.write',callID:'w1',messageID:'m-w1',args:{path:'work/n.txt',content:'synthetic'}});
    expect(rowOf(store,'w1').args_json).toMatchObject({path:'work/n.txt'});
    store.close();
  });
  it('(b) event only, never executed: args stay incomplete',async()=>{
    const {store,service}=fixture();
    await service.handle('recon','process.event',ev('d1',{status:'error',error:'denied before execute'}));
    const row=rowOf(store,'d1');
    expect(row.status).toBe('error');expect(row.args_meta).toMatchObject({complete:false});expect(row.original_complete).toBe(false);
    store.close();
  });
  it('(c) event carrying input is saved as before, and a later start cannot overwrite complete args',async()=>{
    const {store,service}=fixture();
    await service.handle('recon','process.event',ev('e1',{status:'running',input:{path:'work/e.txt',content:'first'}}));
    expect(rowOf(store,'e1')).toMatchObject({args_json:{path:'work/e.txt',content:'first'},original_complete:true});
    await service.handle('recon','tool.execute',{tool:'workspace.write',callID:'e1',messageID:'m-e1',args:{path:'work/e.txt',content:'second'}});
    expect(rowOf(store,'e1').args_json).toEqual({path:'work/e.txt',content:'first'});
    store.close();
  });
  it('(d) >16 KiB args stay an artifact ref when the event came first, hash matches the bytes',async()=>{
    const {store,service}=fixture();const big={path:'work/f.txt',content:'a'.repeat(40000)};
    await service.handle('recon','process.event',ev('f1',{status:'running'}));
    await service.handle('recon','tool.execute',{tool:'workspace.write',callID:'f1',messageID:'m-f1',args:big});
    const row=rowOf(store,'f1');
    expect(row.args_meta).toMatchObject({storage:'artifact',complete:true});expect(row.original_complete).toBe(true);
    expect(row.args_json).toMatchObject({ref:expect.any(String),sha256:expect.stringMatching(/^[0-9a-f]{64}$/)});
    const pages:Buffer[]=[];let cursor:string|undefined;
    do {const page=await (service as any).publications.read('A','X',{ref:row.args_json.ref,...(cursor?{cursor}:{})});pages.push(Buffer.from(page.data,'base64'));cursor=page.nextCursor??undefined;} while(cursor);
    const bytes=Buffer.concat(pages);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.args_json.sha256);expect(row.args_meta.sha256).toBe(row.args_json.sha256);
    store.close();
  });
  it('result and terminal monotonicity are unchanged by the backfill',async()=>{
    const {store,service}=fixture();
    await service.handle('recon','process.event',ev('g1',{status:'error',error:'cancelled'}));
    await service.handle('recon','tool.execute',{tool:'workspace.write',callID:'g1',messageID:'m-g1',args:{path:'work/g.txt',content:'x'}});
    const row=rowOf(store,'g1');
    expect(row).toMatchObject({status:'error',args_json:{path:'work/g.txt',content:'x'}});expect(row.result_json).toMatchObject({error:'cancelled'});
    store.close();
  });
  it('pending event with input {} is a placeholder; tool.execute supplies the real args',async()=>{
    const {store,service}=fixture();
    await service.handle('recon','process.event',ev('p1',{status:'pending',input:{},raw:''}));
    expect(rowOf(store,'p1')).toMatchObject({original_complete:false,args_meta:{complete:false}});
    await service.handle('recon','tool.execute',{tool:'workspace.write',callID:'p1',messageID:'m-p1',args:{path:'work/p.txt',content:'real'}});
    expect(rowOf(store,'p1')).toMatchObject({args_json:{path:'work/p.txt',content:'real'},original_complete:true,args_meta:{complete:true}});
    store.close();
  });
  it('pending event with input {} is upgraded by a later running event carrying the real input',async()=>{
    const {store,service}=fixture();
    await service.handle('recon','process.event',ev('p2',{status:'pending',input:{},raw:''}));
    await service.handle('recon','process.event',ev('p2',{status:'running',input:{path:'work/q.txt',content:'real'}}));
    expect(rowOf(store,'p2')).toMatchObject({args_json:{path:'work/q.txt',content:'real'},original_complete:true,args_meta:{complete:true}});
    store.close();
  });
  it('pending event alone leaves args incomplete',async()=>{
    const {store,service}=fixture();
    await service.handle('recon','process.event',ev('p3',{status:'pending',input:{},raw:''}));
    expect(rowOf(store,'p3')).toMatchObject({original_complete:false,args_meta:{complete:false}});
    store.close();
  });
});
