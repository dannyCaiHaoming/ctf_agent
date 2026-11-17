"""Offline decision-point check (fixed decision-point diagnosis design, section 3.1).

Usage: python3 -I tests/manual/decision-point-check.py <runs.txt> <out.json>
runs.txt: one line per run: <name> <evidence-dir> <experience.sqlite>.
Reads control-audit, context.presented, task dispatch inputs, child messages and slotted workbook decisions; writes
counts only. Message and entry text are used for keyword booleans and id parsing, never written out.
"""
import json, sys, re, glob, sqlite3
HEDGE=re.compile(r'可能|或許|未確認|未确认|未證實|未证实|待驗證|待验证|假設|假设|unknown|未知|尚未|不能推出|不足以|也可能|或者|並列|并列|替代|另一')
ASSERT=re.compile(r'唯一|確認為|确认为|證實|证实|必然|確定|确定')
IDREF=re.compile(r'(?:id|ID|Id|#|問題|问题|條目|条目|entry)\s*[:：#=]?\s*\[?\s*((?:\d{1,4}\s*[、,，/和与與及]?\s*)+)')
def ids_in(t): return {int(n) for g in IDREF.findall(t) for n in __import__('re').findall(r'\d{1,4}',g)}
def load(ev, db):
    A=json.load(open(ev+'/control-audit.json')); o=A[0]['at']-A[0]['t']
    em=lambda ms: round((ms-o)/60000,2)          # epoch ms -> run minute
    am=lambda t: round(t/60000,2)                # audit t -> run minute
    c=sqlite3.connect(db); E={}
    for rid,role,sess,ca,nj in c.execute("select id,role,session_id,created_at,note_json from recon_turns where kind='decision' and note_json is not null"):
        n=json.loads(nj)
        if not isinstance(n.get('slot'),str): continue
        E[rid]=dict(id=rid,role=role,sess=sess,t=em(ca),slot=n['slot'],status=n.get('status'),sup=n.get('supersedes') if isinstance(n.get('supersedes'),int) else None,refs=list(n.get('evidence_refs') or []),text=str(n.get('text','')))
    msgs={}
    for f in glob.glob(ev+'/messages-*.json'):
        m=json.load(open(f))
        if m: msgs[m[0]['info']['sessionID']]=m
    disp=[]
    for s,m in msgs.items():
        if m[0]['info'].get('agent')!='coordinator': continue
        for mm in m:
            for p in mm['parts']:
                if p.get('type')=='tool' and p.get('tool')=='task':
                    st=p['state']; inp=st.get('input') or {}
                    disp.append(dict(t=em((st.get('time') or {}).get('start',o)),role=inp.get('subagent_type'),resume=bool(inp.get('task_id')),child=(st.get('metadata') or {}).get('sessionId'),prompt=inp.get('prompt','') or ''))
    src=sorted((x['t'],x['sessionID'],x['role']) for x in A if x['op']=='task.source')
    comp=sorted((x['t'],x['detail'].get('childID')) for x in A if x['op']=='task.completion')
    rounds=[]
    for t,s,role in src:
        if role!='domain-solver': continue
        end=next((ct for ct,ch in comp if ch==s and ct>=t),None)
        rounds.append(dict(sess=s,start=am(t),end=am(end) if end is not None else None))
    if not rounds:
        sd=sorted((x for x in disp if x['role']=='domain-solver' and x['child']),key=lambda x:x['t'])
        for k,x in enumerate(sd):
            m=msgs.get(x['child']) or []
            ts=[em(mm['info']['time']['created']) for mm in m if mm['info'].get('role')=='assistant' and em(mm['info']['time']['created'])>=x['t']]
            nxt=[y['t'] for y in sd[k+1:] if y['child']==x['child']]
            end=min([max(ts)] + nxt) if ts else (nxt[0] if nxt else None)
            rounds.append(dict(sess=x['child'],start=x['t'],end=end,fallback=True))
    skills=[(am(x['t']),x['sessionID'],x['role']) for x in A if x['op']=='tool.before' and (x['detail'] or {}).get('tool')=='skill']
    pres=[(am(x['t']),x['sessionID'],x['role'],(x['detail'] or {}).get('workbook') or {}) for x in A if x['op']=='context.presented']
    return dict(E=E,disp=disp,rounds=rounds,skills=skills,pres=pres,msgs=msgs,em=em)

def active_at(E,t):
    sup={e['sup'] for e in E.values() if e['sup'] is not None and e['t']<=t}
    return {i:e for i,e in E.items() if e['t']<=t and i not in sup}

def handback(msgs,em,sess,start,end):
    m=msgs.get(sess) or []
    last=None
    for mm in m:
        if mm['info'].get('role')!='assistant': continue
        tc=em(mm['info']['time']['created'])
        if tc<start-0.01 or (end is not None and tc>end+0.01): continue
        for p in mm['parts']:
            if p.get('type')=='text' and p.get('text','').strip(): last=p['text']
    return last

def analyze(name,ev,db):
    d=load(ev,db); E=d['E']; R={'run':name}
    # --- upgrades: hypotheses superseding a hypotheses entry
    up={'to_supported':{'new_refs':0,'same_or_subset':0,'no_refs':0},'to_refuted_or_closed':0,'reworded_open':0,'total':0}
    for e in E.values():
        if e['sup'] is None or e['sup'] not in E: continue
        old=E[e['sup']]
        if old['slot']!='hypotheses': continue
        up['total']+=1
        if e['slot']=='hypotheses' and e['status']=='supported' and old['status']!='supported':
            new=set(e['refs'])-set(old['refs'])
            k='no_refs' if not e['refs'] else ('new_refs' if new else 'same_or_subset')
            up['to_supported'][k]+=1
        elif e['slot']=='refuted' or e['status'] in ('refuted','supported'):
            up['to_refuted_or_closed']+=1 if e['status']!='supported' else 0
        else: up['reworded_open']+=1
    R['hypothesis_updates']=up
    sup_assert=sum(1 for e in E.values() if e['slot']=='hypotheses' and e['status']=='supported' and ASSERT.search(e['text']))
    R['supported_with_assertive_wording']=sup_assert
    # --- Solver rounds
    rs=[]; prev=None
    disp_by_child={}
    for x in d['disp']:
        if x['role']=='domain-solver': disp_by_child.setdefault(x['child'],[]).append(x)
    for i,r in enumerate(d['rounds']):
        s,st,en=r['sess'],r['start'],r['end']
        dl=[x for x in disp_by_child.get(s,[]) if abs(x['t']-st)<0.3]
        dx=dl[0] if dl else None
        written=[e for e in E.values() if e['sess']==s and e['t']>=st-0.01 and (en is None or e['t']<=en+0.01)]
        hb=handback(d['msgs'],d['em'],s,st,en) or ''
        own_open_end=[e for e in active_at(E,en if en is not None else 1e9).values() if e['role']=='domain-solver' and e['slot']=='hypotheses' and e['status'] in (None,'open')]
        wrote_hyp=[e for e in written if e['slot']=='hypotheses']
        act_start=active_at(E,st)
        q_open=[i for i,e in act_start.items() if e['slot']=='questions' and e['status'] in (None,'open')]
        cited=ids_in(dx['prompt']) if dx else set()
        # presentation at round start
        p0=next(((t,wb) for t,ss,role,wb in d['pres'] if ss==s and t>=st-0.01 and wb),None)
        inc=set(p0[1].get('included_ids') or []) if p0 else set()
        omi=set(p0[1].get('omitted_ids') or []) if p0 else set()
        rel_open={i for i,e in act_start.items() if e['slot'] in('questions','hypotheses') and e['status'] in (None,'open','supported')}
        rounds_skill=[k for k in d['skills'] if k[1]==s and k[0]>=st-0.01 and (en is None or k[0]<=en+0.01)]
        prev_skill = prev is not None and any(k[1]==prev['sess'] and k[0]<=prev['end'] for k in d['skills']) if prev else False
        rec=dict(i=i,new_session=(prev is None or s!=prev['sess']) if i>0 else True,first=(i==0),
                 resume=bool(dx and dx['resume']),dispatch_found=bool(dx),
                 dispatch_cites_open_question=bool(cited & set(q_open)),dispatch_cites_any_entry=bool(cited & set(act_start)),
                 presented=bool(p0),present_sent=(p0[1].get('sent') if p0 else None),
                 relevant_active=len(rel_open),relevant_included=len(rel_open & inc) if p0 and p0[1].get('sent')=='full' else None,relevant_omitted=len(rel_open & omi),
                 cited_included=(all(c in inc for c in cited & set(act_start)) if p0 and p0[1].get('sent')=='full' and cited & set(act_start) else None),
                 written=len(written),own_supersedes=sum(1 for e in written if e['sup'] is not None and E.get(e['sup'],{}).get('role')=='domain-solver'),
                 supersedes_prev_round=sum(1 for e in written if e['sup'] is not None and prev is not None and E.get(e['sup'],{}).get('sess')==prev['sess'] and E[e['sup']]['t']<=prev['end']+0.01) if prev else 0,
                 handback=bool(hb),hb_hedge=bool(HEDGE.search(hb)),hb_assert=bool(ASSERT.search(hb)),hb_cites_ids=bool(IDREF.search(hb)),
                 hyp_written=len(wrote_hyp),hyp_written_hedge=any(HEDGE.search(e['text']) for e in wrote_hyp),
                 own_open_hyp_end=len(own_open_end),
                 skill_loads=len(rounds_skill),prev_round_loaded_skill=prev_skill)
        rs.append(rec); prev=dict(sess=s,end=en if en is not None else 1e9)
    R['solver_rounds']=rs
    # --- coordinator view: active hypotheses that carry refs (not shown to coordinator by implementation)
    endE=active_at(E,1e9)
    R['active_hyp_end']=sum(1 for e in endE.values() if e['slot']=='hypotheses')
    R['active_hyp_with_refs_end']=sum(1 for e in endE.values() if e['slot']=='hypotheses' and e['refs'])
    R['entries_total']=len(E)
    R['coord_view_omitted_any']=sum(1 for t,s,role,wb in d['pres'] if role=='coordinator' and (wb.get('omitted_ids') or wb.get('truncated_ids') or wb.get('failed_ids')))
    R['solver_view_omitted_any']=sum(1 for t,s,role,wb in d['pres'] if role=='domain-solver' and wb.get('omitted_ids'))
    R['skill_loads_by_role']={}
    for t,s,role in d['skills']: R['skill_loads_by_role'][role]=R['skill_loads_by_role'].get(role,0)+1
    return R
def _unused():
    out=[]
    for line in open(sys.argv[1]):
        name,ev,db=line.split()
        out.append(analyze(name,ev,db))
    json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
    print('runs',len(out))

def carry_over(d):
    E=d['E']; rs=d['rounds']; g={}
    for k in range(1,len(rs)):
        p,c=rs[k-1],rs[k]
        if p['end'] is None or c['end'] is None: continue
        key='resume' if c['sess']==p['sess'] else 'new'
        x=g.setdefault(key,dict(pairs=0,pairs_with_prev_open=0,prev_open=0,prev_open_superseded_next=0,pairs_all_prev_open_untouched=0,next_new_unlinked_hyp_q=0))
        prev_open={i for i,e in active_at(E,p['end']).items() if e['sess']==p['sess'] and e['slot'] in('hypotheses','questions') and e['status'] in(None,'open') and e['t']>=p['start']-0.01}
        touched=prev_open-set(active_at(E,c['end']))
        neww=[e for e in E.values() if e['sess']==c['sess'] and c['start']-0.01<=e['t']<=c['end']+0.01 and e['slot'] in('hypotheses','questions') and e['sup'] is None]
        x['pairs']+=1; x['pairs_with_prev_open']+=bool(prev_open); x['prev_open']+=len(prev_open); x['prev_open_superseded_next']+=len(touched)
        x['pairs_all_prev_open_untouched']+=bool(prev_open) and not touched; x['next_new_unlinked_hyp_q']+=len(neww)
    return g

if __name__=='__main__':
    import collections
    runs=[l.split() for l in open(sys.argv[1]) if l.strip()]
    R=[];C={}
    for name,ev,db in runs:
        R.append(analyze(name,ev,db))
        for k,v in carry_over(load(ev,db)).items():
            t=C.setdefault(k,collections.Counter()); t.update(v)
    rs=[x for r in R for x in r['solver_rounds']]
    full=[x for x in rs if x['present_sent'] in ('full',True)]
    ci=[x['cited_included'] for x in full if x['cited_included'] is not None]
    up=collections.Counter()
    for r in R:
        h=r['hypothesis_updates']; up['updates_of_hypotheses']+=h['total']; up['to_refuted_or_closed']+=h['to_refuted_or_closed']; up['reworded_open']+=h['reworded_open']
        for k,v in h['to_supported'].items(): up['to_supported_'+k]+=v
        up['supported_assertive_wording']+=r['supported_with_assertive_wording']; up['active_hypotheses_end']+=r['active_hyp_end']; up['active_hypotheses_with_refs_end']+=r['active_hyp_with_refs_end']
    def grp(sel): return dict(rounds=len(sel),written=sum(x['written'] for x in sel),own_supersedes=sum(x['own_supersedes'] for x in sel),rounds_superseding_prev=sum(1 for x in sel if x['supersedes_prev_round']),dispatch_cites_open_question=sum(x['dispatch_cites_open_question'] for x in sel),skill_loads=sum(x['skill_loads'] for x in sel),prev_round_loaded_skill=sum(x['prev_round_loaded_skill'] for x in sel))
    out=dict(
      rounds=dict(total=len(rs),first=sum(x['first'] for x in rs),resume=sum(x['resume'] for x in rs),new_after_first=sum((not x['first']) and not x['resume'] for x in rs)),
      presentation=dict(solver_rounds_full_view=len(full),open_or_supported_entries_active=sum(x['relevant_active'] for x in full),of_which_presented=sum((x['relevant_included'] if x['relevant_included'] is not None else x['relevant_active']) for x in full),solver_view_omission_events=sum(r['solver_view_omitted_any'] for r in R),dispatch_cited_ids_all_presented=ci.count(True),dispatch_cited_ids_checked=len(ci)),
      hypotheses=dict(up),
      handback=dict(with_text=sum(x['handback'] for x in rs),hedge_keyword=sum(x['hb_hedge'] for x in rs),assertive_keyword=sum(x['hb_assert'] for x in rs),cites_entry_ids=sum(x['hb_cites_ids'] for x in rs),rounds_writing_hypotheses=sum(1 for x in rs if x['hyp_written']),rounds_hypotheses_hedge_keyword=sum(1 for x in rs if x['hyp_written_hedge'])),
      by_dispatch=dict(first=grp([x for x in rs if x['first']]),resume=grp([x for x in rs if x['resume']]),new_after_first=grp([x for x in rs if not x['first'] and not x['resume']])),
      carry_over={k:dict(v) for k,v in C.items()},
      skill_loads_by_run={r['run']:r['skill_loads_by_role'] for r in R if r['skill_loads_by_role']},
      per_run=[dict(run=r['run'],solver_rounds=len(r['solver_rounds']),resume=sum(x['resume'] for x in r['solver_rounds']),new_after_first=sum((not x['first']) and not x['resume'] for x in r['solver_rounds']),entries=r['entries_total']) for r in R])
    json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
    print(json.dumps({k:v for k,v in out.items() if k not in('per_run',)},ensure_ascii=False))
