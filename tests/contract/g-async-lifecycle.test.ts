import {it,expect,afterEach} from 'vitest';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';import{createHash}from'node:crypto';import{tmpdir}from'node:os';import{join}from'node:path';
import{ControlService}from'../../apps/launcher/src/control-service.js';
const clean:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const f of clean.splice(0).reverse())await f();});
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'g-async-'));clean.push(()=>rm(dir,{recursive:true,force:true}));const materials=join(dir,'X/materials');await mkdir(materials,{recursive:true});const identities:Record<string,unknown>={a:{parentID:'root',agent:'recon'},late:{parentID:'root',agent:'recon'}};const c=new ControlService({client:{session:{get:async({sessionID}:{sessionID:string})=>({data:identities[sessionID]}),messages:async()=>({data:[{info:{id:'user-1',role:'user'},parts:[{type:'tool',tool:'task',callID:'dispatch-1',state:{metadata:{sessionId:'a'}}}]}]}),children:async()=>({data:[]}),abort:async()=>({data:true})}}as never,budget:{maxModelCalls:20,maxObservableTokens:1000},expiresAt:Date.now()+60000,workdir:join(dir,'opencode'),skillRoot:dir,challenges:[{id:'X',title:null,target:null,materialsDir:materials,materials:[],reachability:null}]});c.bindRoot('root');clean.push(()=>c.stopAll('cleanup'));await c.handle('root','tool.execute',{tool:'challenge.assign',args:{role:'recon',challenge:'X'}});await c.handle('root','tool.before',{tool:'task',callID:'dispatch-1',args:{subagent_type:'recon',background:true}});return c;}
it('parent next admission preserves starting async dispatch and delayed child binding',async()=>{const c=await fixture();await c.handle('root','model.call',{});await expect(c.handle('a','chat.message',{agent:'recon'})).resolves.toEqual({bound:true});expect(c.bindings.get('a')?.dispatchCallID).toBe('dispatch-1');});
it('early task after with trusted child metadata keeps exact child pending across admission',async()=>{const c=await fixture();await c.handle('root','tool.after',{tool:'task',callID:'dispatch-1',metadata:{sessionId:'a',background:true}});await c.handle('root','model.call',{});await expect(c.handle('late','chat.message',{agent:'recon'})).rejects.toThrow('unbound session');await expect(c.handle('a','chat.message',{agent:'recon'})).resolves.toEqual({bound:true});});
it('unknown dispatch outcome cannot free pending and rematch a late child',async()=>{const c=await fixture();await c.handle('root','tool.after',{tool:'task',callID:'dispatch-1',metadata:{}});await c.handle('root','model.call',{});await expect(c.handle('root','tool.execute',{tool:'challenge.assign',args:{role:'recon',challenge:'X'}})).rejects.toThrow('dispatch');});
it('default job.run returns terminal without wait/completion modes',async()=>{const c=await fixture();await c.handle('a','chat.message',{agent:'recon'});const result=await c.handle('a','tool.execute',{tool:'job.run',callID:'job-default',args:{argv:[process.execPath,'-e',"setTimeout(()=>console.log('done'),5500)"],timeout_ms:7000}});expect(result).toMatchObject({state:'exited',exitCode:0});},10000);
it('host execution tags distinguish generations; duplicate/late notifications never wake twice',async()=>{
 const c=await fixture();
 const approval=await c.handle('root','tool.before',{tool:'task',callID:'dispatch-2',args:{subagent_type:'recon',task_id:'a',background:true}}).catch(()=>null) as any;
 // Fresh dispatch's host tag is recorded independently of model text and exported for audit.
 const exec=(c as any).executionSnapshot?.()[0];expect(exec?.ref).toBeTypeOf('string');
 await c.handle('a','chat.message',{agent:'recon'});
 const event={agent:'coordinator',messageID:'notice-1',parts:[{type:'text',synthetic:true,text:`<task id="a" state="completed">\n<summary>Background task completed: [ctf:${exec.ref}]</summary>\n<task_result>A_DONE</task_result>\n</task>`}]};
 await expect(c.handle('root','chat.message',event)).resolves.toMatchObject({bound:true});
 await expect(c.handle('root','chat.message',{...event,messageID:'notice-duplicate'})).rejects.toThrow('duplicate completion');
 const next=await c.handle('root','tool.before',{tool:'task',callID:'resume-1',args:{subagent_type:'recon',task_id:'a',background:true}}) as any;expect(next.taskDescription).not.toContain(exec.ref);
 await expect(c.handle('root','chat.message',{...event,messageID:'notice-late'})).rejects.toThrow('duplicate completion');
 expect((c as any).executionSnapshot().filter((e:any)=>e.state==='running')).toHaveLength(1);
});
it('outstanding unbound dispatch prevents idle completion; stopped notifications cannot restart the run',async()=>{const c=await fixture();expect(c.hasOutstandingWork({root:{type:'idle'}})).toBe(true);await c.stopAll('budget');const admitted=c.admitted;await expect(c.handle('root','chat.message',{agent:'coordinator',parts:[]})).rejects.toThrow('run stopped');expect(c.admitted).toBe(admitted);});
it('trusted startup error releases only its call; late child cannot consume a later same-role dispatch',async()=>{
 const c=await fixture();await c.handle('root','task.event',{callID:'dispatch-1',state:'error',error:'fixture creation failed'});
 await c.handle('root','tool.execute',{tool:'challenge.assign',args:{role:'recon',challenge:'X'}});await c.handle('root','tool.before',{tool:'task',callID:'dispatch-2',args:{subagent_type:'recon',background:true}});
 await expect(c.handle('late','chat.message',{agent:'recon'})).rejects.toThrow('unbound session');expect(c.bindings.has('late')).toBe(false);expect(c.executionSnapshot()[0]?.state).toBe('failed');
});
it('parent can stop a trusted early child reference before its first hook; delayed hook stays denied',async()=>{
 const c=await fixture();await c.handle('root','tool.after',{tool:'task',callID:'dispatch-1',metadata:{sessionId:'a',background:true}});
 await c.handle('root','tool.before',{tool:'ctf_task_stop',callID:'stop-early',args:{task_id:'a'}});
 await c.handle('root','tool.execute',{tool:'task.stop',callID:'stop-early',args:{task_id:'a'}});
 await expect(c.handle('a','model.call',{agent:'recon'})).rejects.toThrow('session revoked');expect(c.admitted).toBe(0);
});
it('global stop reuses confirmed/unknown child stop instead of issuing another SDK abort',async()=>{
 const c=await fixture();await c.handle('a','chat.message',{agent:'recon'});await c.handle('root','tool.execute',{tool:'task.stop',args:{task_id:'a'}});await c.stopAll('global');expect(c.audit.filter(r=>r.sessionID==='a'&&r.op==='aborted')).toHaveLength(1);
});
it('completion wake is queued then re-admitted; budget rejection keeps result and usage incomplete',async()=>{
 const c=await fixture();await c.handle('a','chat.message',{agent:'recon'});const e=c.executionSnapshot()[0]!;const notice={messageID:'completion-budget',parts:[{type:'text',synthetic:true,text:`<task id="a" state="completed">\n<summary>Background task completed: [ctf:${e.ref}]</summary>\n<task_result>retained</task_result>\n</task>`}]};
 await c.handle('root','chat.message',notice);(c as any).options.budget.maxModelCalls=0;await expect(c.handle('root','model.call',{messageID:'completion-budget'})).rejects.toThrow('budget');expect(c.admitted).toBe(0);expect(c.executionSnapshot()[0]).toMatchObject({state:'completed',delivery:'suppressed',result:expect.stringContaining('retained')});expect(c.usageSnapshot().total.incomplete).toBe(true);
});

it('stop after natural completion reports original terminal without revoking or rewriting first reply',async()=>{const c=await fixture();await c.handle('a','chat.message',{agent:'recon'});const e=c.executionSnapshot()[0]!;await c.handle('root','chat.message',{messageID:'done',parts:[{type:'text',synthetic:true,text:`<task id="a" state="completed">\n<summary>Background task completed: [ctf:${e.ref}]</summary>\n<task_result>done</task_result>\n</task>`}]});await expect(c.handle('root','tool.execute',{tool:'task.stop',args:{task_id:'a'}})).resolves.toMatchObject({state:'completed',sessionAbort:'not_required'});expect(c.bindings.get('a')?.state).toBe('active');});
it('initial task reply is immutable and another child cannot overwrite its execution mapping',async()=>{const c=await fixture();await c.handle('root','tool.after',{tool:'task',callID:'dispatch-1',metadata:{sessionId:'a'},output:'original-running'});await expect(c.handle('root','tool.after',{tool:'task',callID:'dispatch-1',metadata:{sessionId:'late'},output:'different'})).rejects.toThrow('completion correlation');expect(c.executionSnapshot()[0]).toMatchObject({childID:'a',initialOutput:'original-running'});});
it('host revoke still revokes a naturally completed child session',async()=>{const c=await fixture();await c.handle('a','chat.message',{agent:'recon'});const e=c.executionSnapshot()[0]!;await c.handle('root','chat.message',{parts:[{type:'text',synthetic:true,text:`<task id="a" state="completed">\n<summary>Background task completed: [ctf:${e.ref}]</summary>\n<task_result>done</task_result>\n</task>`}]});await c.revoke('a');await expect(c.handle('a','model.call',{agent:'recon'})).rejects.toThrow('session revoked');expect(c.executionSnapshot()[0]?.state).toBe('completed');});

// The production change under test is freezing each background user and reading only its reply.
const childMessage=(finish='stop',text='done',extra:any={})=>({info:{id:'reply-1',sessionID:'a',role:'assistant',parentID:'source-1',finish,time:{completed:1},...extra},parts:[{type:'text',text}]});
async function resultFixture(){const c=await fixture();await c.handle('a','chat.message',{agent:'recon',messageID:'source-1'});let messages:any[]=[{info:{id:'source-1',sessionID:'a',role:'user'}},childMessage()];let reads=0;let read:()=>Promise<any>=async()=>({data:messages});(c as any).options.client.session.messages=async({sessionID}:any)=>{if(sessionID==='a'){reads++;return read();}return {data:[]};};return {c,set:(m:any[])=>{messages=m;},setRead:(r:()=>Promise<any>)=>{read=r;},reads:()=>reads};}
function completion(c:ControlService,index=0,messageID='notice'){const e=c.executionSnapshot()[index]!;return {messageID,parts:[{type:'text',synthetic:true,text:`<task id="${e.childID}" state="completed">\n<summary>Background task completed: [ctf:${e.ref}]</summary>\n<task_result>envelope</task_result>\n</task>`}]};}

// Non-secret structures mapped from C design §1.1: Critic has one tool step then
// length/zero text; Verifier has six tool steps (one tool error) then stop/text.
function ordinaryChain(userID='source-1',finish='stop',text='report',steps=1,stepFinish='tool-calls'):any[] {
 const toolSteps=Array.from({length:steps},(_,i)=>({
  info:{id:`step-${i}`,sessionID:'a',role:'assistant',parentID:userID,finish:stepFinish,time:{created:i*10+1,completed:i*10+9}},
  parts:[{id:`tool-${i}`,sessionID:'a',messageID:`step-${i}`,type:'tool',tool:'read',callID:`read-${i}`,
   state:{status:i===2?'error':'completed',input:{filePath:'materials/public.txt'},output:'read',error:i===2?'experiment failed':undefined,title:'read',time:{start:i*10+2,end:i*10+8}}}]
 }));
 return [{info:{id:userID,sessionID:'a',role:'user'}},...toolSteps,
  childMessage(finish,text,{id:'terminal',parentID:userID,time:{created:steps*10+1,completed:steps*10+9}})];
}
it.each([
 ['Critic','length','',1,'incomplete',0],
 ['Verifier','stop','report',6,'complete',6],
] as const)('C original %s structure reaches background parent facts',async(_,finish,text,steps,completeness,textChars)=>{
 const f=await resultFixture();f.set(ordinaryChain('source-1',finish,text,steps));
 const response=await f.c.handle('root','chat.message',completion(f.c));
 expect(response).toMatchObject({completionDisplays:[{completeness,reason:finish,finish,textChars}]});
 expect(f.c.executionSnapshot()[0]).toMatchObject({state:'completed',resultFacts:{assistantMessageID:'terminal',completeness,reason:finish,finish,textChars}});
});
it.each([
 ['Critic','length','',1,'incomplete',0],
 ['Verifier','stop','report',6,'complete',6],
] as const)('C original %s structure reaches synchronous parent facts',async(_,finish,text,steps,completeness,textChars)=>{
 const f=await syncFixture();f.set(ordinaryChain('sync-user',finish,text,steps));
 expect(await f.after()).toMatchObject({syncDisplay:{callID:'sync-1',completeness,reason:finish,finish,textChars}});
});
it.each([
 ['partial length',childMessage('length','PARTIAL'),'incomplete','length'],
 ['empty length',childMessage('length',''),'incomplete','length'],
 ['empty stop',childMessage('stop','  '),'incomplete','missing_text'],
 ['complete stop',childMessage(),'complete','stop'],
 ['error',childMessage('stop','done',{error:{name:'Failure'}}),'incomplete','error'],
 ['unfinished',childMessage('stop','done',{time:{}}),'unknown','not_completed'],
 ['unknown finish',childMessage('other'),'unknown','unknown_finish'],
] as const)('background result classifies %s independently of envelope',async(_,reply,status,reason)=>{const f=await resultFixture();f.set([{info:{id:'source-1',role:'user',sessionID:'a'}},reply]);await f.c.handle('root','chat.message',completion(f.c));expect(f.c.executionSnapshot()[0]).toMatchObject({state:'completed',source:{status:'associated',userMessageID:'source-1'},resultFacts:{assistantMessageID:'reply-1',finish:reply.info.finish,completeness:status,reason}});expect(f.reads()).toBe(1);});
it('same child resume freezes a new source despite old binding call ID; old notice cannot overwrite it',async()=>{const f=await resultFixture();f.set([{info:{id:'source-1',role:'user',sessionID:'a'}},childMessage('length','PARTIAL')]);const first=completion(f.c);await f.c.handle('root','chat.message',first);await f.c.handle('root','tool.before',{tool:'task',callID:'resume',args:{subagent_type:'recon',task_id:'a',background:true}});await f.c.handle('a','chat.message',{agent:'recon',messageID:'source-2'});f.set([{info:{id:'source-1',role:'user',sessionID:'a'}},childMessage('length','PARTIAL'),{info:{id:'source-2',role:'user',sessionID:'a'}},childMessage('stop','done',{id:'reply-2',parentID:'source-2'})]);await f.c.handle('root','chat.message',completion(f.c,1,'notice-2'));await expect(f.c.handle('root','chat.message',first)).rejects.toThrow('duplicate completion');expect(f.c.bindings.get('a')?.dispatchCallID).toBe('dispatch-1');expect(f.c.executionSnapshot()).toMatchObject([{source:{userMessageID:'source-1'},resultFacts:{completeness:'incomplete',finish:'length'}},{source:{userMessageID:'source-2'},resultFacts:{assistantMessageID:'reply-2',completeness:'complete'}}]);expect(f.reads()).toBe(2);});
it('conflicting hook source stays conflict after repeats and result reading',async()=>{const f=await resultFixture();await f.c.handle('a','chat.message',{agent:'recon',messageID:'other'});await f.c.handle('a','chat.message',{agent:'recon',messageID:'source-1'});await f.c.handle('root','chat.message',completion(f.c));expect(f.c.executionSnapshot()[0]).toMatchObject({source:{status:'conflict'},resultFacts:{completeness:'unknown',reason:'source_conflict'}});expect(f.reads()).toBe(0);});
it.each(['missing_user','wrong_parent','duplicate_conflict','multiple_assistants','missing_id','wrong_session','sdk_missing','sdk_error'])('ambiguous or missing SDK result remains unknown: %s',async(kind)=>{const f=await resultFixture();const user={info:{id:'source-1',role:'user',sessionID:'a'}};let ms:any[]=[user,childMessage()];if(kind==='missing_user')ms=[childMessage()];if(kind==='wrong_parent')ms=[user,childMessage('stop','done',{parentID:'other'})];if(kind==='duplicate_conflict')ms.push(childMessage('length','done'));if(kind==='multiple_assistants')ms.push(childMessage('stop','done',{id:'reply-2'}));if(kind==='missing_id')ms=[user,childMessage('stop','done',{id:undefined})];if(kind==='wrong_session')ms=[user,childMessage('stop','done',{sessionID:'other'})];f.set(ms);if(kind==='sdk_missing')f.setRead(async()=>({}));if(kind==='sdk_error')f.setRead(async()=>{throw new Error('offline');});await f.c.handle('root','chat.message',completion(f.c));expect(f.c.executionSnapshot()[0]).toMatchObject({resultFacts:{completeness:'unknown'}});});
it('identical repeated messages and hooks are idempotent; snapshot metadata cannot mutate state',async()=>{const f=await resultFixture();await f.c.handle('a','chat.message',{agent:'recon',messageID:'source-1'});const u={info:{id:'source-1',role:'user',sessionID:'a'}};f.set([u,u,childMessage(),childMessage()]);await f.c.handle('root','chat.message',completion(f.c));const e:any=f.c.executionSnapshot()[0];expect(e.resultFacts.completeness).toBe('complete');e.source.status='conflict';e.resultFacts.completeness='unknown';expect(f.c.executionSnapshot()[0]).toMatchObject({source:{status:'associated'},resultFacts:{completeness:'complete'}});});
it('missing hook ID is unknown and sync resume never reclaims the old execution',async()=>{const c=await fixture();await c.handle('a','chat.message',{agent:'recon'});await c.handle('root','chat.message',completion(c));expect(c.executionSnapshot()[0]).toMatchObject({resultFacts:{completeness:'unknown',reason:'missing_source'}});await c.handle('root','tool.before',{tool:'task',callID:'sync',args:{subagent_type:'recon',task_id:'a',background:false}});await c.handle('a','chat.message',{agent:'recon',messageID:'sync-user'});expect(c.executionSnapshot()).toHaveLength(2);expect((c.executionSnapshot()[0] as any).source.userMessageID).toBeNull();expect(c.executionSnapshot()[0]).toMatchObject({mode:'background',state:'completed'});expect(c.executionSnapshot()[1]).toMatchObject({mode:'sync',state:'running',childID:'a',source:{status:'associated',userMessageID:'sync-user'}});});
it('SDK wait holds no state lock and stop suppresses its pending wake',async()=>{const f=await resultFixture();let release!:(x:any)=>void;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);f.setRead(()=>{entered();return new Promise(r=>release=r);});const notice=f.c.handle('root','chat.message',completion(f.c));const denied=expect(notice).rejects.toThrow('run stopped');await started;await f.c.stopAll('budget');expect(f.c.executionSnapshot()[0]?.delivery).toBe('suppressed');release({data:[{info:{id:'source-1',role:'user',sessionID:'a'}},childMessage()]});await denied;expect(f.c.admitted).toBe(0);expect(f.c.executionSnapshot()[0]).toMatchObject({delivery:'suppressed',resultFacts:{completeness:'unknown',reason:'stopped'}});});
it.each([{parentID:'other'},{role:'user'},{sessionID:'other'}])('same reply ID cannot conceal contradictory identity outside selected parent: %j',async(extra)=>{const f=await resultFixture();f.set([{info:{id:'source-1',role:'user',sessionID:'a'}},childMessage(),childMessage('stop','done',extra)]);await f.c.handle('root','chat.message',completion(f.c));expect(f.c.executionSnapshot()[0]).toMatchObject({resultFacts:{completeness:'unknown',reason:'message_conflict'}});});
it('multiple active candidates and mismatched binding identity remain persistently conflicted',async()=>{for(const kind of ['multiple','parent','role']){const f=await resultFixture();const e=f.c.executionSnapshot()[0]!;if(kind==='multiple')(f.c as any).executions.set('extra',{...structuredClone(e),ref:'extra'});else (f.c.bindings.get('a') as any)[kind==='parent'?'parentID':'role']='different';await f.c.handle('a','chat.message',{messageID:'source-1'});if(kind==='multiple')(f.c as any).executions.delete('extra');else (f.c.bindings.get('a') as any)[kind==='parent'?'parentID':'role']=kind==='parent'?'root':'recon';await f.c.handle('a','chat.message',{messageID:'source-1'});await f.c.handle('root','chat.message',completion(f.c));expect(f.c.executionSnapshot()[0]).toMatchObject({source:{status:'conflict'},resultFacts:{completeness:'unknown',reason:'source_conflict'}});}});
it('same prompt on different children never shares source or reply facts',async()=>{const f=await resultFixture();await f.c.handle('root','tool.before',{tool:'task',callID:'other-role',args:{subagent_type:'intake',background:true,prompt:'same'}});await f.c.handle('root','tool.after',{tool:'task',callID:'other-role',metadata:{sessionId:'b'}});(f.c as any).options.client.session.get=async()=>({data:{parentID:'root',agent:'intake'}});await f.c.handle('b','chat.message',{agent:'intake',messageID:'source-b'});const original=(f.c as any).options.client.session.messages;(f.c as any).options.client.session.messages=async(args:any)=>args.sessionID==='b'?{data:[{info:{id:'source-b',sessionID:'b',role:'user'}},childMessage('stop','B',{id:'reply-b',sessionID:'b',parentID:'source-b'})]}:original(args);await f.c.handle('root','chat.message',completion(f.c,1,'notice-b'));await f.c.handle('root','chat.message',completion(f.c));expect(f.c.executionSnapshot()).toMatchObject([{source:{userMessageID:'source-1'},resultFacts:{assistantMessageID:'reply-1',textChars:4}},{source:{userMessageID:'source-b'},resultFacts:{assistantMessageID:'reply-b',textChars:1}}]);});
it('host revoke during result SDK wait rejects the pending parent hook without changing natural terminal state',async()=>{const f=await resultFixture();let release!:(x:any)=>void;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);f.setRead(()=>{entered();return new Promise(r=>release=r);});const notice=f.c.handle('root','chat.message',completion(f.c)).then(value=>({value}),error=>({error}));await started;await f.c.revoke('a');release({data:[{info:{id:'source-1',role:'user',sessionID:'a'}},childMessage()]});expect(await notice).toMatchObject({error:expect.any(Error)});expect(f.c.executionSnapshot()[0]).toMatchObject({state:'completed',delivery:'suppressed',resultFacts:{completeness:'unknown',reason:'stopped'}});});
it('duplicate notice during pending SDK read cannot read or deliver twice',async()=>{const f=await resultFixture();let release!:(x:any)=>void;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);f.setRead(()=>{entered();return new Promise(r=>release=r);});const first=f.c.handle('root','chat.message',completion(f.c));await started;await expect(f.c.handle('root','chat.message',completion(f.c,0,'duplicate'))).rejects.toThrow('duplicate completion');expect(f.reads()).toBe(1);release({data:[{info:{id:'source-1',role:'user',sessionID:'a'}},childMessage()]});await first;expect(f.c.audit.filter(a=>a.op==='task.result')).toHaveLength(1);});
it('untrusted notice parent or child cannot start a result SDK read',async()=>{const f=await resultFixture();await expect(f.c.handle('other','chat.message',completion(f.c))).rejects.toThrow('completion correlation');const notice=completion(f.c);notice.parts[0]!.text=notice.parts[0]!.text.replace('id="a"','id="other"');await expect(f.c.handle('root','chat.message',notice)).rejects.toThrow('completion correlation');expect(f.reads()).toBe(0);expect(f.c.executionSnapshot()[0]?.state).toBe('running');});

it('R2 prepared input consumes exact same-parent registered notices; active work still blocks idle',async()=>{
 const c=await fixture();await c.handle('a','chat.message',{agent:'recon'});const first=c.executionSnapshot()[0]!;
 const notice={messageID:'notice-one',parts:[{type:'text',synthetic:true,text:`<task id="a" state="completed">\n<summary>Background task completed: [ctf:${first.ref}]</summary>\n<task_result>done</task_result>\n</task>`}]};
 await c.handle('root','chat.message',notice);
 await c.handle('a','model.call',{requestMessageIDs:['notice-one']});expect(c.executionSnapshot()[0]?.delivery).toBe('queued');
 await c.handle('root','model.call',{requestMessageIDs:['missing','wrong-parent']});expect(c.executionSnapshot()[0]?.delivery).toBe('queued');
 await c.handle('root','tool.before',{tool:'task',callID:'active',args:{subagent_type:'intake',background:true}});
 await c.handle('root','model.call',{requestMessageIDs:['notice-one','notice-one','missing']});expect(c.executionSnapshot()[0]?.delivery).toBe('consumed');expect(c.hasOutstandingWork({root:{type:'idle'}})).toBe(true);
 const n=c.audit.filter(r=>r.op==='task.delivered').length;await c.handle('root','model.call',{requestMessageIDs:['notice-one']});expect(c.audit.filter(r=>r.op==='task.delivered')).toHaveLength(n);
 await c.stopAll('budget');await expect(c.handle('root','model.call',{requestMessageIDs:['notice-one']})).rejects.toThrow('run stopped');
});

async function syncFixture(){const f=await resultFixture();await f.c.handle('root','chat.message',completion(f.c));await f.c.handle('root','tool.before',{tool:'task',callID:'sync-1',args:{subagent_type:'recon',task_id:'a',background:false}});await f.c.handle('a','chat.message',{agent:'recon',messageID:'sync-user'});f.set([{info:{id:'sync-user',role:'user',sessionID:'a'}},{info:{id:'sync-reply',sessionID:'a',role:'assistant',parentID:'sync-user',finish:'stop',time:{completed:1}},parts:[{type:'text',text:'done'}]}]);return {...f,after:(md:any={parentSessionId:'root',sessionId:'a'},output='<task id="a" state="completed">\n<task_result>report</task_result>\n</task>')=>f.c.handle('root','tool.after',{tool:'task',callID:'sync-1',metadata:md,output})};}
it('R4 sync facts preserve old ref and repeated before/after are idempotent',async()=>{const f=await syncFixture();const old=f.c.executionSnapshot()[0]!;await f.c.handle('root','tool.before',{tool:'task',callID:'sync-1',args:{subagent_type:'recon',task_id:'a',background:false}});const n=f.reads();expect(await f.after()).toMatchObject({syncDisplay:{callID:'sync-1',completeness:'complete',textChars:4}});expect(await f.after()).toEqual({ok:true});expect(f.reads()).toBe(n+1);expect(f.c.executionSnapshot()).toHaveLength(2);expect(f.c.executionSnapshot()[0]).toEqual(old);expect(f.c.executionSnapshot()[1]).toMatchObject({mode:'sync',state:'completed'});});
it('R4 different sync user is persistent unknown and cannot consume queued background',async()=>{const f=await syncFixture();await f.c.handle('a','chat.message',{agent:'recon',messageID:'other'});await f.c.handle('root','tool.before',{tool:'task',callID:'sync-1',args:{subagent_type:'recon',task_id:'a',background:false}});await f.c.handle('a','chat.message',{agent:'recon',messageID:'sync-user'});const n=f.reads();expect(await f.after()).toMatchObject({syncDisplay:{completeness:'unknown',reason:'source_conflict',textChars:null}});expect(f.reads()).toBe(n);expect(f.c.executionSnapshot()[0]?.delivery).toBe('queued');});
it('R4 wrong sync metadata refuses SDK read and leaves background queued',async()=>{const f=await syncFixture();const n=f.reads();expect(await f.after({parentSessionId:'other',sessionId:'a'})).toMatchObject({syncDisplay:{completeness:'unknown',reason:'binding_identity'}});expect(f.reads()).toBe(n);expect(f.c.executionSnapshot()[0]?.delivery).toBe('queued');});
it('R4 incomplete second assistant remains ambiguous',async()=>{const f=await syncFixture();f.set([{info:{id:'sync-user',role:'user',sessionID:'a'}},{info:{id:'one',role:'assistant',sessionID:'a',parentID:'sync-user',finish:'stop',time:{completed:1}},parts:[{type:'text',text:'done'}]},{info:{id:'two',role:'assistant',sessionID:'a',parentID:'sync-user',time:{created:2}},parts:[]}]);expect(await f.after()).toMatchObject({syncDisplay:{completeness:'unknown',reason:'multiple_assistants'}});});
it('R4 SDK error remains scoped to sync call',async()=>{const f=await syncFixture();f.setRead(async()=>{throw Error('offline')});expect(await f.after()).toMatchObject({syncDisplay:{completeness:'unknown',reason:'sdk_error'}});expect(f.c.executionSnapshot()[0]?.delivery).toBe('queued');});
it.each(['stop','conflict'])('R4 SDK await rechecks %s before display',async(mode)=>{const f=await syncFixture();let entered!:()=>void,release!:(v:any)=>void;const started=new Promise<void>(r=>entered=r);f.setRead(()=>{entered();return new Promise(r=>release=r)});const pending=f.after();await started;if(mode==='stop')await f.c.stopAll('deadline');else await f.c.handle('a','chat.message',{agent:'recon',messageID:'changed'});release({data:[{info:{id:'sync-user',role:'user',sessionID:'a'}},{info:{id:'one',role:'assistant',sessionID:'a',parentID:'sync-user',finish:'stop',time:{completed:1}},parts:[{type:'text',text:'done'}]}]});if(mode==='stop')expect(await pending).toEqual({ok:true});else expect(await pending).toMatchObject({syncDisplay:{completeness:'unknown',reason:'source_conflict'}});});
it('R4 simultaneous sync call makes prior conflict persistent',async()=>{const f=await syncFixture();await expect(f.c.handle('root','tool.before',{tool:'task',callID:'sync-2',args:{subagent_type:'recon',task_id:'a',background:false}})).rejects.toThrow('sync active call');expect(await f.after()).toMatchObject({syncDisplay:{reason:'source_conflict'}});});

it('R4 failed background notice receives facts and exact prepared ID consumption',async()=>{const f=await resultFixture();const n=completion(f.c);n.parts[0]!.text=n.parts[0]!.text.replace('state="completed"','state="error"').replace('Background task completed:','Background task failed:');expect(await f.c.handle('root','chat.message',n)).toMatchObject({completionDisplays:[{ref:f.c.executionSnapshot()[0]!.ref}]});await f.c.handle('root','model.call',{requestMessageIDs:[n.messageID]});expect(f.c.executionSnapshot()[0]).toMatchObject({state:'failed',delivery:'consumed'});});

it('R4 conflicting duplicate call is denied before new native dispatch and prior conflict persists',async()=>{const f=await syncFixture();await expect(f.c.handle('root','tool.before',{tool:'task',callID:'sync-1',args:{subagent_type:'unknown',task_id:'foreign',background:false}})).rejects.toThrow('sync call conflict');expect(await f.after()).toMatchObject({syncDisplay:{completeness:'unknown',reason:'source_conflict'}});expect(f.c.executionSnapshot()).toHaveLength(2);});

it('R4 trusted native error terminates only sync call and permits a new call',async()=>{const f=await syncFixture();await f.c.handle('root','task.event',{callID:'sync-1',state:'error'});expect(await f.after()).toEqual({ok:true});await expect(f.c.handle('root','tool.before',{tool:'task',callID:'sync-2',args:{subagent_type:'recon',task_id:'a',background:false}})).resolves.toEqual({allowed:true,taskBackground:false});expect(f.c.executionSnapshot()[0]?.delivery).toBe('queued');expect(f.c.audit.filter(a=>a.op==='sync.failed')).toHaveLength(1);});

it('R4 terminal sync before replay is denied while after replay has no side effect',async()=>{const f=await syncFixture();await f.after();await expect(f.c.handle('root','tool.before',{tool:'task',callID:'sync-1',args:{subagent_type:'recon',task_id:'a',background:false}})).rejects.toThrow('sync call terminal');expect(await f.after()).toEqual({ok:true});expect(f.c.audit.filter(a=>a.op==='sync.result')).toHaveLength(1);});

it('R4 first synchronous call error before binding releases only its pending role',async()=>{const c=await fixture();await c.handle('root','tool.before',{tool:'task',callID:'sync-first',args:{subagent_type:'intake',background:false}});await c.handle('root','task.event',{callID:'sync-first',state:'error'});await expect(c.handle('root','tool.before',{tool:'task',callID:'sync-next',args:{subagent_type:'intake',background:false}})).resolves.toEqual({allowed:true,taskBackground:false});await c.handle('root','task.event',{callID:'sync-first',state:'error'});await expect(c.handle('root','tool.before',{tool:'task',callID:'sync-third',args:{subagent_type:'intake',background:false}})).rejects.toMatchObject({message:'denied: dispatch',detail:'pending dispatch exists for role'});expect(c.executionSnapshot()[0]?.state).toBe('starting');});

it('sync call cannot change to background mode under the same identity',async()=>{
 const f=await syncFixture();
 await expect(f.c.handle('root','tool.before',{tool:'task',callID:'sync-1',args:{subagent_type:'recon',task_id:'a',background:true}})).rejects.toThrow('sync call conflict');
 expect(f.c.executionSnapshot()).toHaveLength(2);
 expect(await f.after()).toMatchObject({syncDisplay:{completeness:'unknown',reason:'source_conflict'}});
});
it('sync source is audited without text or error payload',async()=>{
 const f=await syncFixture();
 expect(f.c.audit.filter(a=>a.op==='sync.source')).toContainEqual(expect.objectContaining({detail:expect.objectContaining({callID:'sync-1',source:expect.objectContaining({userMessageID:'sync-user'})})}));
});
it('sync SDK return rechecks binding role before releasing facts',async()=>{
 const f=await syncFixture();let entered!:()=>void,release!:(v:any)=>void;const started=new Promise<void>(r=>entered=r);
 f.setRead(()=>{entered();return new Promise(r=>release=r)});const pending=f.after();await started;
 (f.c.bindings.get('a') as any).role='intake';release({data:[]});
 expect(await pending).toMatchObject({syncDisplay:{completeness:'unknown',reason:'binding_identity'}});
});
it('sync same-ID contradictory assistant remains unknown',async()=>{
 const f=await syncFixture();const reply={info:{id:'reply',sessionID:'a',role:'assistant',parentID:'sync-user',finish:'stop',time:{completed:1}},parts:[{type:'text',text:'done'}]};
 f.set([{info:{id:'sync-user',role:'user',sessionID:'a'}},reply,{...reply,info:{...reply.info,parentID:'foreign'}}]);
 expect(await f.after()).toMatchObject({syncDisplay:{completeness:'unknown',reason:'message_conflict'}});
});
it('active synchronous resume remains outstanding after every queued notice is consumed',async()=>{
 const f=await syncFixture();await f.c.handle('root','model.call',{requestMessageIDs:['notice']});
 expect(f.c.executionSnapshot()[0]?.delivery).toBe('consumed');
 expect(f.c.hasOutstandingWork({root:{type:'idle'},a:{type:'idle'}})).toBe(true);
 await f.after();expect(f.c.hasOutstandingWork({root:{type:'idle'},a:{type:'idle'}})).toBe(false);
});
it('admission message ID alone cannot consume a notice without a prepared context snapshot',async()=>{
 const f=await resultFixture();await f.c.handle('root','chat.message',completion(f.c));
 await f.c.handle('root','model.call',{messageID:'notice'});expect(f.c.executionSnapshot()[0]?.delivery).toBe('queued');
});

it('two completed synchronous resumes on the same child keep independent users and call facts',async()=>{
 const f=await syncFixture();
 expect(await f.after()).toMatchObject({syncDisplay:{callID:'sync-1',completeness:'complete',textChars:4}});
 const first=structuredClone(f.c.audit.find(a=>a.op==='sync.result'&&(a.detail as any).callID==='sync-1'));
 await f.c.handle('root','tool.before',{tool:'task',callID:'sync-2',args:{subagent_type:'recon',task_id:'a',background:false}});
 await f.c.handle('a','chat.message',{agent:'recon',messageID:'sync-user-2'});
 f.set([
  {info:{id:'sync-user',role:'user',sessionID:'a'}},
  {info:{id:'sync-reply',role:'assistant',sessionID:'a',parentID:'sync-user',finish:'stop',time:{completed:1}},parts:[{type:'text',text:'done'}]},
  {info:{id:'sync-user-2',role:'user',sessionID:'a'}},
  {info:{id:'sync-reply-2',role:'assistant',sessionID:'a',parentID:'sync-user-2',finish:'stop',time:{completed:2}},parts:[{type:'text',text:'second report'}]},
 ]);
 expect(await f.c.handle('root','tool.after',{tool:'task',callID:'sync-2',metadata:{parentSessionId:'root',sessionId:'a'},output:'<task id="a" state="completed">\n<task_result>second report</task_result>\n</task>'})).toMatchObject({syncDisplay:{callID:'sync-2',completeness:'complete',textChars:13}});
 const results=f.c.audit.filter(a=>a.op==='sync.result').map(a=>a.detail as any);
 expect(results).toMatchObject([
  {callID:'sync-1',source:{userMessageID:'sync-user'},facts:{assistantMessageID:'sync-reply',textChars:4}},
  {callID:'sync-2',source:{userMessageID:'sync-user-2'},facts:{assistantMessageID:'sync-reply-2',textChars:13}},
 ]);
 expect(f.c.audit.find(a=>a.op==='sync.result'&&(a.detail as any).callID==='sync-1')).toEqual(first);
 const reads=f.reads();expect(await f.after()).toEqual({ok:true});expect(f.reads()).toBe(reads);
 expect(f.c.executionSnapshot()).toHaveLength(3);expect(f.c.executionSnapshot().slice(1)).toMatchObject([{mode:'sync',state:'completed',source:{userMessageID:'sync-user'}},{mode:'sync',state:'completed',source:{userMessageID:'sync-user-2'}}]);expect(new Set(f.c.executionSnapshot().map(e=>e.ref)).size).toBe(3);expect(f.c.bindings.get('a')?.dispatchCallID).toBe('dispatch-1');
});


it.each(['tool-calls','stop'])('C settled %s tool step is intermediate even with body; duplicates and SDK order do not select terminal',async(finish)=>{
 const f=await resultFixture();const ms=ordinaryChain('source-1','stop','report',1,finish);
 ms[1]!.parts.push({type:'text',text:'intermediate body'} as any);
 f.set([ms[2],ms[1],ms[0],structuredClone(ms[1])]);
 expect(await f.c.handle('root','chat.message',completion(f.c))).toMatchObject({completionDisplays:[{completeness:'complete',reason:'stop',textChars:6}]});
 expect(f.c.executionSnapshot()[0]).toMatchObject({resultFacts:{assistantMessageID:'terminal'}});
});
it.each(['stop','length'])('C single %s message with settled tools is not a final report',async(finish)=>{
 const f=await resultFixture();const ms=ordinaryChain('source-1','stop','report',1,finish);ms.pop();
 ms[1]!.parts.push({type:'text',text:'looks final'} as any);f.set(ms);
 expect(await f.c.handle('root','chat.message',completion(f.c))).toMatchObject({completionDisplays:[{completeness:'unknown',textChars:null}]});
});
it.each([
 'two_terminals','unfinished_successor','step_after_terminal','missing_created','missing_completed','reversed_time',
 'pending','running','unknown_status','unknown_finish','providerExecuted','interrupted','assistant_error',
 'same_id_equal_length_text','same_id_tool_state','same_id_special_tool','same_id_created','foreign_identity',
])('C ordinary chain preserves unknown boundary: %s',async(kind)=>{
 const f=await resultFixture();const ms:any[]=ordinaryChain();const step=ms[1],terminal=ms[2];
 if(kind==='two_terminals')ms.push(childMessage('stop','other',{id:'terminal-2',time:{created:30,completed:39}}));
 if(kind==='unfinished_successor')ms.push(childMessage('stop','later',{id:'later',time:{created:30}}));
 if(kind==='step_after_terminal')step.info.time={created:30,completed:39};
 if(kind==='missing_created')delete terminal.info.time.created;
 if(kind==='missing_completed')delete step.info.time.completed;
 if(kind==='reversed_time')step.info.time={created:10,completed:9};
 if(['pending','running','unknown_status'].includes(kind))step.parts[0].state.status=kind;
 if(kind==='unknown_finish')step.info.finish='unknown';
 if(kind==='providerExecuted')step.parts[0].metadata={providerExecuted:true};
 if(kind==='interrupted'){step.parts[0].state.status='error';step.parts[0].state.metadata={interrupted:true};}
 if(kind==='assistant_error')step.info.error={name:'APIError'};
 if(kind==='same_id_equal_length_text')ms.push({...terminal,parts:[{type:'text',text:'REPORT'}]});
 if(kind==='same_id_tool_state'){const duplicate=structuredClone(step);duplicate.parts[0].state.status='running';ms.push(duplicate);}
 if(kind==='same_id_special_tool'){const duplicate=structuredClone(step);duplicate.parts[0].metadata={providerExecuted:true};ms.push(duplicate);}
 if(kind==='same_id_created'){const duplicate=structuredClone(terminal);duplicate.info.time.created=40;ms.push(duplicate);}
 if(kind==='foreign_identity')ms.push({...step,info:{...step.info,parentID:'another-user'}});
 f.set(ms);expect(await f.c.handle('root','chat.message',completion(f.c))).toMatchObject({completionDisplays:[{completeness:'unknown',textChars:null}]});
});
it.each([['length','partial','incomplete','length'],['stop','  ','incomplete','missing_text']] as const)('C ordinary chain preserves %s report meaning',async(finish,text,completeness,reason)=>{
 const f=await resultFixture();f.set(ordinaryChain('source-1',finish,text));
 expect(await f.c.handle('root','chat.message',completion(f.c))).toMatchObject({completionDisplays:[{completeness,reason,finish,textChars:text.length}]});
});
it.each([false,true])('C failed background keeps lifecycle independent from single or multi report (multi=%s)',async(multi)=>{
 const f=await resultFixture();if(multi)f.set(ordinaryChain());
 const n=completion(f.c);n.parts[0]!.text=n.parts[0]!.text.replace('state="completed"','state="error"').replace('Background task completed:','Background task failed:');
 await f.c.handle('root','chat.message',n);
 expect(f.c.executionSnapshot()[0]).toMatchObject({state:'failed',result:n.parts[0]!.text,resultFacts:{completeness:multi?'unknown':'complete'}});
});
it.each([
 [{parentSessionId:'root',sessionId:'a',background:true,jobId:'a'},'<task id="a" state="running">\n<task_result>waiting</task_result>\n</task>'],
 [{parentSessionId:'root',sessionId:'a'},'<task id="a" state="running">\n<task_result>waiting</task_result>\n</task>'],
 [{parentSessionId:'root',sessionId:'a'},'unrecognized native reply'],
 [{parentSessionId:'root',sessionId:'a'},'<task id="foreign" state="completed">\n<task_result>report</task_result>\n</task>'],
])('C noncompleted sync reply cannot publish SDK terminal (%j)',async(metadata,output)=>{
 const f=await syncFixture();const reads=f.reads();
 expect(await f.after(metadata,output)).toMatchObject({syncDisplay:{completeness:'unknown',textChars:null}});
 expect(f.reads()).toBe(reads);
});
it('C resumed multi chain cannot complete the previous frozen user or overwrite its facts',async()=>{
 const f=await resultFixture();const old:any[]=ordinaryChain('source-1','length','',1);f.set(old);
 await f.c.handle('root','chat.message',completion(f.c));const first=structuredClone(f.c.executionSnapshot()[0]);
 await f.c.handle('root','tool.before',{tool:'task',callID:'chain-resume',args:{subagent_type:'recon',task_id:'a',background:true}});
 await f.c.handle('a','chat.message',{agent:'recon',messageID:'source-2'});
 const next:any[]=ordinaryChain('source-2');for(const m of next.slice(1))m.info.id='next-'+m.info.id;
 f.set([...old,...next]);await f.c.handle('root','chat.message',completion(f.c,1,'resumed'));
 expect(f.c.executionSnapshot()[0]).toEqual(first);
 expect(f.c.executionSnapshot()[1]).toMatchObject({resultFacts:{userMessageID:'source-2',assistantMessageID:'next-terminal',completeness:'complete'}});
});


// §8.3: a synchronous dispatch owns a trusted per-call execution, so its source role can publish like a background one.
// Only the OpenCode identity answers are scripted; files, publications and packages are the real host implementations.
async function deliveryFixture(){
 const dir=await mkdtemp(join(tmpdir(),'g-sync-id-'));clean.push(()=>rm(dir,{recursive:true,force:true}));
 const materials=join(dir,'X/materials');await mkdir(materials,{recursive:true});
 const native=new Map<string,string>(),user=new Map<string,string>();
 const client={session:{
  get:async({sessionID}:{sessionID:string})=>({data:{id:sessionID,parentID:'root',agent:sessionID.replace(/-\d+$/,'')}}),children:async()=>({data:[]}),abort:async()=>({data:true}),
  messages:async({sessionID}:{sessionID:string})=>({data:sessionID==='root'?[{info:{id:'root-user',sessionID:'root',role:'user'},parts:[...native].map(([callID,sessionId])=>({type:'tool',tool:'task',callID,state:{metadata:{sessionId}}}))}]
   :[{info:{id:user.get(sessionID),sessionID,role:'user'}},{info:{id:'reply-'+user.get(sessionID),sessionID,role:'assistant',parentID:user.get(sessionID),finish:'stop',time:{completed:1}},parts:[{type:'text',text:'done'}]}]})}};
 const c=new ControlService({runId:'sync-id',client:client as never,budget:{maxModelCalls:50,maxObservableTokens:100000},expiresAt:Date.now()+60000,workdir:join(dir,'opencode'),skillRoot:dir,challenges:[{id:'X',title:null,target:null,materialsDir:materials,materials:[],reachability:null}]});
 c.bindRoot('root');clean.push(()=>c.stopAll('cleanup'));
 let n=0;
 const exec=(sid:string,tool:string,args:object={})=>c.handle(sid,'tool.execute',{tool,args,callID:'p'+(++n)}) as Promise<any>;
 const assign=(role:string)=>c.handle('root','tool.execute',{tool:'challenge.assign',args:{role,challenge:'X'}});
 const call=async(role:string,sid:string,callID:string,args:object={})=>{
  native.set(callID,sid);const before=await c.handle('root','tool.before',{tool:'task',callID,args:{subagent_type:role,...args}});
  user.set(sid,'m-'+callID);await c.handle(sid,'chat.message',{agent:role,messageID:'m-'+callID});return before as any;
 };
 const finish=(sid:string,callID:string)=>c.handle('root','tool.after',{tool:'task',callID,metadata:{parentSessionId:'root',sessionId:sid},output:`<task id="${sid}" state="completed">\n<task_result>x</task_result>\n</task>`}) as Promise<any>;
 const notice=(callID:string)=>{const e=c.executionSnapshot().find(e=>e.callID===callID)!;return c.handle('root','chat.message',{agent:'coordinator',messageID:'n-'+callID,parts:[{type:'text',synthetic:true,text:`<task id="${e.childID}" state="completed">\n<summary>Background task completed: [ctf:${e.ref}]</summary>\n<task_result>x</task_result>\n</task>`}]});};
 const byCall=(callID:string)=>c.executionSnapshot().find(e=>e.callID===callID)!;
 const publish=async(sid:string,path:string,bytes:Buffer)=>{await exec(sid,'workspace.write',{path,content:bytes.toString('base64'),encoding:'base64'});return exec(sid,'artifact.publish',{source:'file',path});};
 return {dir,c,exec,assign,call,finish,notice,byCall,publish,publications:()=>c.publicationSnapshot()};
}
const OBSERVED=Buffer.from([0,255,13,10,0x66,0x6c,0x61,0x67]);

it('sync Recon and Engineer: first-tool identity, exact publish, package, settlement on native return (r6 chain)',async()=>{
 const f=await deliveryFixture();
 await f.assign('recon');await f.call('recon','recon-1','sync-recon',{background:false});
 const recon=f.byCall('sync-recon');
 expect(recon).toMatchObject({mode:'sync',state:'running',childID:'recon-1',role:'recon',challengeId:'X',run:'sync-id',parent:'root',delivered:true,source:{status:'associated',userMessageID:'m-sync-recon'}});
 const art=await f.publish('recon-1','work/observed.bin',OBSERVED);
 const record=f.publications().find(p=>p.ref===art.ref)!;
 expect(record.source).toMatchObject({kind:'file',run:'sync-id',challenge:'X',sessionID:'recon-1',execution:recon.ref,selectedExecution:recon.ref});
 const known=f.c.audit.filter(a=>a.op==='artifact.published');expect(known).toHaveLength(1);
 expect(await readFile(join(f.dir,'X/published',`${art.ref}.bin`))).toEqual(OBSERVED);
 expect(f.c.hasOutstandingWork({})).toBe(true);
 expect(await f.finish('recon-1','sync-recon')).toMatchObject({syncDisplay:{callID:'sync-recon',completeness:'complete'}});
 expect(f.byCall('sync-recon')).toMatchObject({state:'completed',delivered:true,resultFacts:{completeness:'complete'}});
 expect(f.c.hasOutstandingWork({})).toBe(false);
 await expect(f.exec('recon-1','artifact.publish',{source:'file',path:'work/observed.bin'})).rejects.toThrow('denied: artifact execution');

 await f.assign('engineer');await f.call('engineer','engineer-1','sync-eng',{background:false});
 const eng=f.byCall('sync-eng');expect(eng).toMatchObject({mode:'sync',state:'running',childID:'engineer-1',role:'engineer'});
 expect(await f.exec('engineer-1','workspace.read',{path:`published/${art.ref}.bin`})).toMatchObject({size:OBSERVED.length,sha256:createHash('sha256').update(OBSERVED).digest('hex')});
 const pkg=await f.exec('engineer-1','package.publish',{candidate:{ref:art.ref,start:4,end:8},files:[{kind:'artifact',ref:art.ref,path:'evidence/raw.bin',purpose:'evidence'}],extraction:'bytes [4,8)',premises:[]});
 expect((await f.exec('engineer-1','package.read',{version:pkg.version,component:'candidate'})).data).toBe(Buffer.from('flag').toString('base64'));
 expect(f.publications().find(p=>p.ref===pkg.version)!.source).toMatchObject({kind:'package',sessionID:'engineer-1',execution:eng.ref});
 expect(eng.ref).not.toBe(recon.ref);
 await f.finish('engineer-1','sync-eng');expect(f.byCall('sync-eng').state).toBe('completed');
 expect(f.publications().find(p=>p.ref===art.ref)!.source.selectedExecution).toBe(recon.ref);
});

it('r3 kept: omitted background follows creation, explicit false is sync and delivers, every round has its own execution',async()=>{
 const f=await deliveryFixture();
 await f.assign('recon');expect(await f.call('recon','recon-1','bg-create',{background:true})).toMatchObject({taskBackground:true});
 const created=f.byCall('bg-create');expect(created).toMatchObject({mode:'background',state:'running'});
 const first=await f.publish('recon-1','work/a.bin',Buffer.from('bg-one'));await f.notice('bg-create');expect(f.byCall('bg-create').state).toBe('completed');
 expect(await f.call('recon','recon-1','omit-1',{task_id:'recon-1'})).toMatchObject({taskBackground:true});
 expect(f.byCall('omit-1')).toMatchObject({mode:'background',state:'running',childID:'recon-1'});await f.notice('omit-1');
 expect(await f.call('recon','recon-1','explicit-false',{task_id:'recon-1',background:false})).toMatchObject({taskBackground:false});
 const sync=f.byCall('explicit-false');expect(sync).toMatchObject({mode:'sync',state:'running',childID:'recon-1'});
 const second=await f.publish('recon-1','work/b.bin',Buffer.from('sync-two'));
 expect(f.publications().find(p=>p.ref===second.ref)!.source.selectedExecution).toBe(sync.ref);
 await f.finish('recon-1','explicit-false');expect(f.byCall('explicit-false').state).toBe('completed');
 expect(await f.call('recon','recon-1','omit-2',{task_id:'recon-1'})).toMatchObject({taskBackground:true});
 const third=await f.publish('recon-1','work/c.bin',Buffer.from('bg-three'));
 const refs=['bg-create','omit-1','explicit-false','omit-2'].map(id=>f.byCall(id).ref);expect(new Set(refs).size).toBe(4);
 expect(f.publications().find(p=>p.ref===third.ref)!.source.selectedExecution).toBe(f.byCall('omit-2').ref);
 expect(f.publications().find(p=>p.ref===first.ref)!.source).toMatchObject({execution:created.ref,selectedExecution:created.ref});
 expect(f.publications().find(p=>p.ref===second.ref)!.source.selectedExecution).toBe(sync.ref);
});

it('sync file provenance is bound to the round that wrote it; a later round keeps the old producer',async()=>{
 const f=await deliveryFixture();
 await f.assign('recon');await f.call('recon','recon-1','s1',{background:false});
 await f.exec('recon-1','workspace.write',{path:'work/keep.txt',content:'same bytes'});
 const one=await f.exec('recon-1','artifact.publish',{source:'file',path:'work/keep.txt'});await f.finish('recon-1','s1');
 await f.call('recon','recon-1','s2',{task_id:'recon-1',background:false});
 const two=await f.exec('recon-1','artifact.publish',{source:'file',path:'work/keep.txt'});
 const src=(r:string)=>f.publications().find(p=>p.ref===r)!.source;
 expect(src(one.ref)).toMatchObject({execution:f.byCall('s1').ref,selectedExecution:f.byCall('s1').ref});
 expect(src(two.ref)).toMatchObject({execution:f.byCall('s1').ref,selectedExecution:f.byCall('s2').ref});
});

it('sync settlement is exact: native error, wrong child, stop and cancellation never publish and never revive',async()=>{
 const f=await deliveryFixture();
 await f.assign('recon');await f.call('recon','recon-1','e1',{background:false});await f.exec('recon-1','workspace.write',{path:'work/x',content:'x'});
 await f.c.handle('root','task.event',{callID:'e1',state:'error',error:'native failure'});
 expect(f.byCall('e1').state).toBe('failed');
 await expect(f.exec('recon-1','artifact.publish',{source:'file',path:'work/x'})).rejects.toThrow('denied: artifact execution');
 expect(await f.finish('recon-1','e1')).toEqual({ok:true});expect(f.byCall('e1').state).toBe('failed'); // late native return cannot overwrite a known error
 // An ordinary error does not disable the session: the next call is a fresh execution that can publish.
 await f.call('recon','recon-1','e2',{task_id:'recon-1',background:false});expect(f.byCall('e2').state).toBe('running');
 await f.exec('recon-1','artifact.publish',{source:'file',path:'work/x'});
 // A native return that names another child is not trusted: the call ends failed and its identity is released.
 await f.finish('other','e2');expect(f.byCall('e2').state).toBe('failed');
 await f.call('recon','recon-1','e3',{task_id:'recon-1',background:false});expect(f.byCall('e3').state).toBe('running');
 await f.c.stopAll('deadline');expect(f.byCall('e3').state).toBe('cancelled');
});

it('sync dispatch keeps its other gates: one active round per child, no sync Verifier, Intake cannot publish, rounds are not reused',async()=>{
 const f=await deliveryFixture();
 await f.assign('recon');await f.call('recon','recon-1','a1',{background:false});
 await expect(f.c.handle('root','tool.before',{tool:'task',callID:'a2',args:{subagent_type:'recon',task_id:'recon-1',background:false}})).rejects.toThrow('sync active call');
 expect(f.c.executionSnapshot().filter(e=>e.state==='running')).toHaveLength(1);
 await f.finish('recon-1','a1');
 await expect(f.c.handle('root','tool.before',{tool:'task',callID:'a1',args:{subagent_type:'recon',task_id:'recon-1',background:false}})).rejects.toThrow('sync call terminal');
 await f.call('intake','intake-1','i1',{background:false});
 expect(f.byCall('i1')).toMatchObject({mode:'sync',state:'running',childID:'intake-1',role:'intake'});
 await expect(f.exec('intake-1','artifact.publish',{source:'file',path:'work/x'})).rejects.toThrow('denied: tool not permitted');
 await f.finish('intake-1','i1');expect(f.byCall('i1').state).toBe('completed');
 // A Verifier is admitted only in the background, whatever the call mode was written as.
 await f.assign('engineer');await f.call('engineer','engineer-1','g1',{background:false});
 const art=await f.publish('engineer-1','work/c.bin',Buffer.from('cand'));
 const pkg=await f.exec('engineer-1','package.publish',{candidate:{ref:art.ref,start:0,end:4},files:[],extraction:'all',premises:[]});await f.finish('engineer-1','g1');
 await f.c.handle('root','tool.execute',{tool:'challenge.assign',args:{role:'verifier',challenge:'X',version:pkg.version}});
 await expect(f.c.handle('root','tool.before',{tool:'task',callID:'v1',args:{subagent_type:'verifier',background:false}})).rejects.toThrow('denied: verification execution');
 expect(f.c.executionSnapshot().some(e=>e.role==='verifier')).toBe(false);
});

it('sync promotion (running envelope with background metadata) is not a terminal: the execution stays running and nothing completes it (Q5 gap, unresolved)',async()=>{
 const f=await deliveryFixture();
 await f.assign('recon');await f.call('recon','recon-1','p1',{background:false});
 await f.c.handle('root','tool.after',{tool:'task',callID:'p1',metadata:{parentSessionId:'root',sessionId:'recon-1',background:true},output:'<task id="recon-1" state="running">'});
 expect(f.byCall('p1')).toMatchObject({mode:'sync',state:'running'});
 await expect(f.c.handle('root','tool.before',{tool:'task',callID:'p2',args:{subagent_type:'recon',task_id:'recon-1',background:false}})).rejects.toThrow('denied: dispatch');
});
