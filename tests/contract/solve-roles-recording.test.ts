import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {ControlService} from '../../apps/launcher/src/control-service.js';
import {ExperienceStore} from '../../apps/launcher/src/experience-store.js';
import {investigationView} from '../../apps/launcher/src/investigation-context.js';
import {prepareEpisodeInput} from '../../apps/launcher/src/episode-learning.js';

const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const ROLES=['recon','domain-solver','engineer','verifier'] as const;
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'solve-roles-')),materials=join(root,'workspace/X/materials');mkdirSync(materials,{recursive:true});
  const store=new ExperienceStore(join(root,'experience.sqlite'));
  const client={session:{get:async({sessionID}:any)=>({data:{id:sessionID,parentID:'root'}}),messages:async()=>({data:[]}),children:async()=>({data:[]}),abort:async()=>({data:true})}};
  const service=new ControlService({client:client as never,runId:'A',experienceStore:store,workdir:join(root,'opencode'),skillRoot:join(root,'skills'),expiresAt:Date.now()+60000,
    budget:{maxModelCalls:50,maxObservableTokens:10000,maxToolJobs:3},challenges:[{id:'X',title:null,target:null,reachability:null,materials:[],materialsDir:materials}]});
  service.bindRoot('root');
  for(const role of [...ROLES,'coordinator'] as const)service.bindings.set(role,{sessionID:role,role,parentID:'root',via:'dispatch',scope:'run',expiresAt:Date.now()+60000,state:'active',boundAt:Date.now(),challengeId:'X'} as never);
  for(const role of ROLES)(service as any).executions.set(`ex-${role}`,{ref:`ex-${role}`,childID:role,role,state:'running',run:'A',parent:'root',challengeId:'X',delivered:true,source:{status:'conflict'}});
  return {root,store,service};
}
const event=(session:string,callID:string,state:Record<string,unknown>)=>({part:{type:'tool',sessionID:session,messageID:'m-'+callID,callID,tool:'bash',state}});

describe('step recording for every challenge-bound solving role (design §3)',()=>{
  it('records each role\'s tool calls with the bound role, large results and failures included; Coordinator stays out',async()=>{
    const {store,service}=fixture();
    const big={stdout:'z'.repeat(40000)};
    for(const role of [...ROLES,'coordinator']) {
      await service.handle(role,'process.event',event(role,'ok-'+role,{status:'completed',input:{command:'echo synthetic'},output:role==='verifier'?big:{stdout:'ok'}}));
      await service.handle(role,'process.event',event(role,'bad-'+role,{status:'error',input:{command:'false'},error:'exit 1'}));
    }
    const rows=store.allRecords('A','X');
    expect(rows.map(r=>r.role)).toEqual(['recon','recon','domain-solver','domain-solver','engineer','engineer','verifier','verifier']);
    expect(rows.map(r=>r.sequence)).toEqual([1,2,3,4,5,6,7,8]);
    expect(rows.filter(r=>r.status==='error')).toHaveLength(4);
    const large=rows.find(r=>r.call_id==='ok-verifier')!;
    expect(large.result_json).toMatchObject({ref:expect.any(String),originalComplete:true});
    expect(large.result_meta).toMatchObject({storage:'artifact',complete:true});
    expect(store.records('A','X').index.map(e=>e.role)).toEqual(rows.map(r=>r.role));
    store.close();
  });

  it('records through tool.execute for a Solver too, and never trusts a model-supplied role',async()=>{
    const {store,service}=fixture();
    await service.handle('domain-solver','tool.execute',{tool:'workspace.write',callID:'w',messageID:'a1',args:{path:'work/n.txt',content:'synthetic',role:'recon'}});
    const [row]=store.allRecords('A','X');
    expect(row).toMatchObject({role:'domain-solver',tool:'workspace.write',status:'completed'});
    store.close();
  });

  it('migrates a v2 store to v3 with role=recon on old rows, idempotently',() => {
    const path=join(mkdtempSync(join(tmpdir(),'solve-roles-v2-')),'m.sqlite');
    const first=new ExperienceStore(path);
    first.start({run:'A',challenge:'X',session:'s',call:'c'},'workspace.read',{path:'work/a'});
    first.db.exec('ALTER TABLE recon_turns DROP COLUMN role;PRAGMA user_version=2');
    first.close();
    const raw=new DatabaseSync(path);expect(raw.prepare('PRAGMA table_info(recon_turns)').all().some((c:any)=>c.name==='role')).toBe(false);raw.close();
    for(let i=0;i<2;i++) {
      const store=new ExperienceStore(path);
      expect(store.db.prepare('PRAGMA user_version').get()).toMatchObject({user_version:3});
      expect(store.allRecords('A','X').map(r=>r.role)).toEqual(['recon']);
      store.close();
    }
  });

  it('opens recon.read to Domain Solver and Engineer (read-only), not to Verifier or Coordinator; recon.note stays Recon-only',async()=>{
    const {store,service}=fixture();
    await service.handle('recon','process.event',event('recon','r1',{status:'completed',input:{command:'echo r'},output:{stdout:'recon result'}}));
    await service.handle('domain-solver','process.event',event('domain-solver','s1',{status:'completed',input:{command:'echo s'},output:{stdout:'solver result'}}));
    for(const role of ['domain-solver','engineer']) {
      const page=await service.handle(role,'tool.execute',{tool:'recon.read',callID:'read-'+role,args:{}}) as any;
      expect(page.records.map((r:any)=>r.role)).toEqual(['recon','domain-solver']);
      await expect(service.handle(role,'tool.before',{tool:'ctf_recon_read',callID:'b-'+role,args:{}})).resolves.toMatchObject({allowed:true});
      await expect(service.handle(role,'tool.execute',{tool:'recon.note',callID:'n-'+role,args:{kind:'decision'}})).rejects.toThrow('tool not permitted');
    }
    for(const role of ['verifier','coordinator'])
      await expect(service.handle(role,'tool.execute',{tool:'recon.read',callID:'read-'+role,args:{}})).rejects.toThrow('tool not permitted');
    // Reading the trace is not itself a step.
    expect(store.allRecords('A','X').map(r=>r.call_id)).toEqual(['r1','s1']);
    store.close();
  });

  it('keeps one stable sequence for interleaved roles of the same challenge',() => {
    const {store}=fixture();
    const scope=(role:string,i:number)=>({run:'A',challenge:'X',session:role,call:`${role}-${i}`,message:`${role}-m${i}`,role});
    for(let i=0;i<5;i++)for(const role of ROLES) {store.start(scope(role,i) as never,'workspace.read',{path:`work/${i}`});}
    for(let i=0;i<5;i++)for(const role of [...ROLES].reverse())store.finish(scope(role,i) as never,'completed',{n:i});
    const rows=store.allRecords('A','X');
    expect(rows.map(r=>r.sequence)).toEqual(Array.from({length:20},(_,i)=>i+1));
    expect(new Set(rows.map(r=>r.step_id)).size).toBe(20);
    expect(rows.slice(0,4).map(r=>r.role)).toEqual([...ROLES]);
    store.close();
  });

  it('projects a session\'s own last six terminal steps while the index covers every role',async()=>{
    const {store,service}=fixture();
    const seed=(role:string,n:number)=>{for(let i=0;i<n;i++){const s={run:'A',challenge:'X',session:role,call:`${role}-${i}`,message:`${role}-m${i}`,role};store.start(s as never,'workspace.read',{path:`work/${role}/${i}`});store.finish(s as never,'completed',{i});}};
    seed('domain-solver',3);seed('engineer',9);seed('recon',2);
    const view=investigationView(store,'A','X',{tail:true,session:'domain-solver'} as never);
    expect(view.all.map(e=>e.role)).toContain('engineer');
    expect(view.all).toHaveLength(14);
    expect(view.recent.map((s:any)=>s.session_id)).toEqual(['domain-solver','domain-solver','domain-solver']);
    const prepared=await service.handle('engineer','context.prepare',{messageID:'u1',placement:'chat.message'}) as any;
    const payload=JSON.parse(prepared.text.slice('[CTF investigation context]\n'.length));
    expect(payload.recent).toHaveLength(6);
    expect(new Set(payload.recent.map((s:any)=>s.session_id))).toEqual(new Set(['engineer']));
    expect(payload.index.coverage.total).toBe(14);
    expect(payload.index.entries.map((e:any)=>e.role)).toEqual([...Array(3).fill('domain-solver'),...Array(9).fill('engineer'),'recon','recon']);
    await expect(service.handle('verifier','context.prepare',{messageID:'u1',placement:'chat.message'})).resolves.toEqual({});
    store.close();
  });

  it('puts the recording role on every step-list line',() => {
    const {store}=fixture();
    for(const role of ROLES){const s={run:'A',challenge:'X',session:role,call:role,message:role,role};store.start(s as never,'workspace.read',{path:`work/${role}`});store.finish(s as never,'completed',{ok:true});}
    const sources=store.allRecords('A','X').map(r=>({ref:`recon:${r.id}`,content:r}));
    const prepared=prepareEpisodeInput({outcome:'unsolved',outcome_ref:[],end_reason:'x',input:{sources}} as never);
    const lines=prepared.step_list.lines.map(l=>l.split('|'));
    expect(lines.map(l=>l[1])).toEqual(sources.map(s=>s.ref));
    expect(lines.map(l=>l[2])).toEqual([...ROLES]);
    store.close();
  });
});
