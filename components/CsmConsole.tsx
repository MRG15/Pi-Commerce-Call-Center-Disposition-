'use client';
import { useEffect,useMemo,useState } from 'react';
import { useRouter } from 'next/navigation';
import { PLANS,plansRequiredOn,todayIst } from '@/lib/plans';

type Node={id:string;code:string;label:string;level:number;parent_id:string|null};
type View='queues'|'callbacks'|'metrics'|'notes'|'allocation';
type Tab='ending'|'ended'|'cx'|'closed'|'onb_lost'|'all';
type CxSub=''|'cancelled'|'lapsed';
type SortBy='default'|'impressions'|'spend'|'credits';

function fmt(v:any){if(!v)return '—';return new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});}
function fmtDay(v:any){if(!v)return '—';const d=new Date(String(v).slice(0,10)+'T00:00:00');return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'});}
function money(v:any){const n=Number(v);return Number.isFinite(n)?new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n):'—';}
function num(v:any){const n=Number(v);return v===null||v===undefined||!Number.isFinite(n)?'—':n.toLocaleString('en-IN');}
function daysSince(v:any){if(!v)return null;return Math.floor((Date.now()-new Date(v).getTime())/86400000);}
function daysTo(day:any){if(!day)return null;const t=new Date(String(day).slice(0,10)+'T00:00:00+05:30').getTime();return Math.ceil((t-Date.now())/86400000);}
function disp(l0?:string,l1?:string,l2?:string){return [l0,l1,l2].filter(Boolean).join(' → ');}
const TABS:[Tab,string][]=[['ending','Ads About to End'],['ended','Ads Ended'],['cx','Cancelled / Expired'],['closed','Closed (NI / Refund)'],['onb_lost','Onboarding Lost'],['all','All']];
const QUEUE_LABEL:any={ending:'Ads About to End',ended:'Ads Ended',cancelled:'Cancelled, subscription still active',lapsed:'Expired / Cancelled, not renewed',closed:'Closed (NI / Refund)',onb_lost:'Onboarding Lost',untagged:'Calls before buckets (untagged)'};
const SORTS:[SortBy,string][]=[['default','Default order'],['impressions','Impressions'],['spend','Spend'],['credits','Credits']];
const SOURCE_LABEL:any={customer_success_followup:'CSM',new_event:'Onboarding',historical_import:'Imported',assignment:'Assignment',system:'System'};

export default function CsmConsole(){
  const router=useRouter();
  const [user,setUser]=useState<any>(null),[data,setData]=useState<any>(null),[nodes,setNodes]=useState<Node[]>([]);
  const [view,setView]=useState<View>('queues'),[tab,setTab]=useState<Tab>('ending'),[search,setSearch]=useState(''),[csmFilter,setCsmFilter]=useState('');
  const [cxSub,setCxSub]=useState<CxSub>(''),[sortBy,setSortBy]=useState<SortBy>('default');
  const [selected,setSelected]=useState<any>(null),[detailLoading,setDetailLoading]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);

  async function loadMerchants(){
    const r=await fetch('/api/csm/merchants',{cache:'no-store'});const j=await r.json();
    if(!r.ok){setError(j.error||'Could not load merchants');return;}
    setData(j);
  }
  useEffect(()=>{(async()=>{
    const a=await fetch('/api/auth/access',{cache:'no-store'});if(!a.ok){router.replace('/login');return;}
    const u=(await a.json()).user;if(!u.isSuperAdmin&&!u.access?.csm){router.replace('/');return;}
    setUser(u);
    const [d]=await Promise.all([fetch('/api/csm/dispositions',{cache:'no-store'}),loadMerchants()]);
    if(d.ok)setNodes((await d.json()).nodes||[]);
    setLoading(false);
  })();},[]);

  async function openMerchant(id:string){
    setDetailLoading(true);setError('');
    const r=await fetch('/api/csm/merchants/'+encodeURIComponent(id),{cache:'no-store'});const j=await r.json();
    setDetailLoading(false);
    if(!r.ok){setError(j.error||'Could not open merchant');return;}
    setSelected(j);
  }
  async function logout(){await fetch('/api/auth/logout',{method:'POST'});router.replace('/login');}

  const admin=data?.role==='admin';
  const merchants:any[]=data?.merchants||[];
  // Onboarding Lost is shared context for every CSM, so the CSM filter never hides it.
  const pool=useMemo(()=>merchants.filter(m=>!csmFilter||m.queue==='onb_lost'||(csmFilter==='none'?!m.assigned_to:String(m.assigned_to)===csmFilter)),[merchants,csmFilter]);
  const tabOf=(m:any):Tab=>m.closed?'closed':(m.queue==='cancelled'||m.queue==='lapsed')?'cx':m.queue;
  const counts=useMemo(()=>{const c:any={ending:0,ended:0,cx:0,closed:0,onb_lost:0,cancelled:0,lapsed:0,all:pool.length};for(const m of pool){c[tabOf(m)]++;if(!m.closed&&(m.queue==='cancelled'||m.queue==='lapsed'))c[m.queue]++;}return c;},[pool]);
  const shown=useMemo(()=>{
    const q=search.trim().toLowerCase(),qd=q.replace(/\D/g,'');
    const rows=pool.filter(m=>(tab==='all'||tabOf(m)===tab)&&(tab!=='cx'||!cxSub||m.queue===cxSub)&&(!q||String(m.customer_id).includes(q)||String(m.merchant_name||'').toLowerCase().includes(q)||(qd.length>=4&&String(m.phone_number||'').replace(/\D/g,'').includes(qd))));
    if(sortBy==='default')return rows;
    return [...rows].sort((a,b)=>(Number(b[sortBy])||0)-(Number(a[sortBy])||0));
  },[pool,tab,cxSub,search,sortBy]);
  const callbacks=useMemo(()=>pool.filter(m=>m.next_callback&&!m.closed).sort((a,b)=>new Date(a.next_callback).getTime()-new Date(b.next_callback).getTime()),[pool]);
  const dueCallbacks=callbacks.filter(m=>new Date(m.next_callback).getTime()<=new Date(todayIst()+'T23:59:59+05:30').getTime()).length;

  if(loading||!user)return <div className="center">Loading CSM workspace…</div>;
  const nav:[View,string][]=[['queues','Queues'],['callbacks',`Callbacks${dueCallbacks?` (${dueCallbacks})`:''}`],['metrics','Daily Metrics'],...(admin?[['notes','Pitch Notes'],['allocation','Allocation']] as [View,string][]:[])];

  return <div className="app-shell">
    <header><div><strong>Pi Commerce</strong><span> · CSM Workspace</span></div><div className="header-actions">
      {(user.isSuperAdmin||user.access?.seller)&&<a href="/">Seller Workspace</a>}
      {(user.isSuperAdmin||user.access?.onboarding)&&<a href="/onboarding">Onboarding Workspace</a>}
      {user.isSuperAdmin&&<a href="/admin/access">Manage Access</a>}
      <span className="badge">{user.name}{admin?' · CSM Admin':''}</span><button className="linkbtn" onClick={logout}>Logout</button>
    </div></header>
    <div className="seller-shell">
      <nav className="side-nav">{nav.map(([k,l])=><button key={k} className={view===k?'active':''} onClick={()=>setView(k)}>{l}</button>)}</nav>
      <main className="leads-main">
        {error&&<div className="error card">{error}</div>}
        {!data?.run&&<div className="card empty">No SMB Daily Tracker data yet. The queues fill after the first daily sync (Sub Raw + AdsRun Raw) completes.</div>}
        {data?.run&&view!=='notes'&&view!=='allocation'&&<div className="note csm-sync-note">Data as of {fmt(data.run.finished_at)} · {num(data.run.subs_rows)} subscriptions · {num(data.run.ads_rows)} ads</div>}
        {(view==='queues'||view==='callbacks')&&<section className="card">
          {view==='queues'&&<div className="queue-tabs csm-tabs">{TABS.map(([k,l])=><button key={k} className={tab===k?'active':''} onClick={()=>{setTab(k);setCxSub('');}}><b>{counts[k]}</b><span>{l}</span></button>)}</div>}
          {view==='queues'&&tab==='cx'&&<div className="preset-row csm-sub padtop">{([['','All',counts.cx],['cancelled','Cancelled, subscription still active',counts.cancelled],['lapsed','Expired / Cancelled, not renewed',counts.lapsed]] as [CxSub,string,number][]).map(([k,l,n])=><button key={k||'all'} className={cxSub===k?'active':''} onClick={()=>setCxSub(k)}>{l} ({n})</button>)}</div>}
          {view==='queues'&&tab==='onb_lost'&&<div className="note">Merchants onboarding closed as Not Interested / Refund. Shown so you can see why they are not in your calling queues (usually Meta was never linked). Lowest priority; call only if you choose to.</div>}
          <div className="search-row padtop">
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search merchant, customer ID or phone"/>
            {view==='queues'&&<select className="csm-filter" value={sortBy} onChange={e=>setSortBy(e.target.value as SortBy)}>{SORTS.map(([k,l])=><option key={k} value={k}>{k==='default'?l:`Sort: ${l}`}</option>)}</select>}
            {admin&&<select className="csm-filter" value={csmFilter} onChange={e=>setCsmFilter(e.target.value)}><option value="">All CSMs</option>{(data?.csms||[]).map((c:any)=><option key={c.id} value={c.id}>{c.name}</option>)}<option value="none">Unassigned</option></select>}
          </div>
        </section>}
        {(view==='queues'||view==='callbacks')&&<div className="onboarding-grid">
          <section className="card">
            <div className="section-label">{view==='callbacks'?'Callbacks':tab==='cx'&&cxSub?QUEUE_LABEL[cxSub]:TABS.find(t=>t[0]===tab)?.[1]}</div>
            <MerchantList rows={view==='callbacks'?callbacks.filter(m=>{const q=search.trim().toLowerCase();return !q||String(m.customer_id).includes(q)||String(m.merchant_name||'').toLowerCase().includes(q);}):shown} selectedId={selected?.customerId} onOpen={openMerchant} admin={admin} callbacks={view==='callbacks'}/>
          </section>
          <section className="card case-detail">
            <div className="section-label">Merchant</div>
            {detailLoading?<div className="empty">Loading…</div>:!selected?<div className="empty">Open a merchant to see their ads, pitch notes and call history.</div>:
              <MerchantDetail data={selected} nodes={nodes} admin={admin} csms={data?.csms||[]} row={merchants.find(m=>String(m.customer_id)===String(selected.customerId))}
                onSaved={async()=>{await loadMerchants();await openMerchant(selected.customerId);}}/>}
          </section>
        </div>}
        {view==='metrics'&&<Metrics admin={admin} csms={data?.csms||[]} onOpenBucket={(b:string)=>{setView('queues');setCxSub(b==='cancelled'||b==='lapsed'?b:'');setTab(b==='cancelled'||b==='lapsed'?'cx':(TABS.some(t=>t[0]===b)?b as Tab:'all'));}}/>}
        {view==='notes'&&admin&&<PitchNotes onSaved={loadMerchants}/>}
        {view==='allocation'&&admin&&<Allocation data={data} reload={loadMerchants}/>}
      </main>
    </div>
  </div>;
}

function MerchantList({rows,selectedId,onOpen,admin,callbacks}:{rows:any[];selectedId?:string;onOpen:(id:string)=>void;admin:boolean;callbacks:boolean}){
  if(!rows.length)return <div className="empty">{callbacks?'No callbacks scheduled.':'No merchants in this queue.'}</div>;
  return <div className="case-list">{rows.map(m=>{
    const left=m.queue==='ending'?daysTo(m.end_date):null; const since=daysSince(m.last_outreach);
    const overdue=m.next_callback&&new Date(m.next_callback).getTime()<Date.now();
    return <button key={m.customer_id} onClick={()=>onOpen(String(m.customer_id))} className={String(selectedId)===String(m.customer_id)?'selected':''}>
      <div><strong>{m.merchant_name||`Customer ${m.customer_id}`}</strong>
        <span>Cust ID {m.customer_id}{admin&&m.queue!=='onb_lost'?` · ${m.assigned_name||'Unassigned'}`:''}{m.sub_status!=='ACTIVE'?` · ${m.sub_status}`:''}</span>
        {m.pitch&&<span className="csm-pitch">Pitch: {m.pitch}</span>}
      </div>
      <div className="case-tags">
        {callbacks&&<em className={overdue?'tag-warn':''}>Callback {fmt(m.next_callback)}</em>}
        {m.queue==='ending'&&<em className={left!==null&&left<=2?'tag-warn':''}>Ends {fmtDay(m.end_date)}{left!==null?` (${left<=0?'today':left+'d'})`:''}</em>}
        {m.queue==='ended'&&m.end_date&&<em>Ended {fmtDay(m.end_date)}</em>}
        {m.queue==='cancelled'&&<em className="tag-warn">Cancelled {fmtDay(m.cancelled_at)}, sub still active</em>}
        {m.queue==='lapsed'&&<em className="tag-warn">{m.renewal_due?`Renewal due ${fmtDay(m.renewal_due)}${daysSince(m.renewal_due)!==null&&daysSince(m.renewal_due)!>=0?` (${daysSince(m.renewal_due)}d ago)`:''}`:'Renewal date not in sheet'}</em>}
        {m.queue==='onb_lost'&&<><em className="tag-warn">Lost {fmtDay(m.lost_at)}</em>{m.lost_reason&&<em>{m.lost_reason}</em>}{m.onboarding_owner&&<em>Onboarder {m.onboarding_owner}</em>}</>}
        {m.credits!=null&&<em>Credits {money(m.credits)}</em>}
        {m.queue!=='onb_lost'&&<><em>{num(m.impressions)} impr.</em><em>Spend {money(m.spend)}</em><em>{num(m.clicks)} clicks</em></>}
        <em>{m.last_outreach?`Called ${since===0?'today':since+'d ago'}`:'Never called'}</em>
        {m.last_l0&&<em>{m.last_l0}</em>}
        {m.topups>0&&<em>Top-ups {money(m.topup_total)}</em>}
        {m.renewals>0&&<em>Renewed{m.last_renewal_plan?` · ${(PLANS as any)[m.last_renewal_plan]?.label||m.last_renewal_plan}`:''}</em>}
      </div>
    </button>;})}</div>;
}

function MerchantDetail({data,nodes,admin,csms,row,onSaved}:{data:any;nodes:Node[];admin:boolean;csms:any[];row:any;onSaved:()=>Promise<void>}){
  const [l0,setL0]=useState(''),[l1,setL1]=useState(''),[l2,setL2]=useState(''),[remark,setRemark]=useState(''),[cbDate,setCbDate]=useState(''),[cbTime,setCbTime]=useState('');
  const [topUp,setTopUp]=useState(''),[plan,setPlan]=useState(''),[saving,setSaving]=useState(false),[msg,setMsg]=useState(''),[err,setErr]=useState('');
  const [note,setNote]=useState('');
  useEffect(()=>{setL0('');setL1('');setL2('');setRemark('');setCbDate('');setCbTime('');setTopUp('');setPlan('');setMsg('');setErr('');setNote('');},[data.customerId]);
  const l0s=nodes.filter(n=>n.level===0); const l0n=nodes.find(n=>n.code===l0); const l1s=nodes.filter(n=>n.level===1&&n.parent_id===l0n?.id);
  const l1n=nodes.find(n=>n.code===l1); const l2s=nodes.filter(n=>n.level===2&&n.parent_id===l1n?.id);
  const topUpMode=l0==='OB_ADDITIONAL_TOPUP'; const planNeeded=l0==='OB_SUBS_RENEWED'; const planRequired=planNeeded&&plansRequiredOn(todayIst());
  const callbackRequired=l1==='OB_CALLBACK'; const callbackAvailable=!topUpMode&&!!l0;
  const s=data.subscription||{}; const m=data.merchant||{}; const c=data.case;
  const pitches=data.notes.filter((n:any)=>n.kind==='pitch'); const remarks=data.notes.filter((n:any)=>n.kind==='sheet_remark');
  const canLog=Boolean(c); const onbLost=c?.current_status==='lost';
  const invalid=!l0||(l1s.length>0&&!l1&&!topUpMode)||(l2s.length>0&&!l2)||(callbackRequired&&(!cbDate||!cbTime))||(topUpMode&&!(Number(topUp)>0))||(planRequired&&!plan);

  async function save(){
    if(callbackAvailable&&Boolean(cbDate)!==Boolean(cbTime)){setErr('Enter both callback date and time, or leave both blank.');return;}
    setSaving(true);setErr('');setMsg('');
    const r=await fetch('/api/csm/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerId:data.customerId,l0Code:l0,l1Code:l1||null,l2Code:l2||null,remark,
      callbackDate:callbackAvailable&&cbDate?cbDate:null,callbackTime:callbackAvailable&&cbTime?cbTime:null,topUpAmount:topUpMode?topUp:null,planCode:planNeeded&&plan?plan:null,
      bucket:row?(row.closed?'closed':row.queue):null})});
    const j=await r.json(); setSaving(false);
    if(!r.ok){setErr(j.error||'Could not save');return;}
    setMsg('Call logged.'); await onSaved();
  }
  async function addNote(){
    setSaving(true);setErr('');
    const r=await fetch('/api/csm/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerId:data.customerId,note})});
    const j=await r.json(); setSaving(false);
    if(!r.ok){setErr(j.error||'Could not save note');return;}
    setNote(''); await onSaved();
  }
  async function reassign(agentId:string){
    if(!agentId)return;
    const r=await fetch('/api/csm/assignments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'reassign',customerIds:[data.customerId],agentId})});
    const j=await r.json(); if(!r.ok){setErr(j.error||'Could not reassign');return;} await onSaved();
  }

  return <>
    <div className="summary-grid">
      <div><span>Merchant</span><b>{s.merchant_name||m.merchant_name||row?.merchant_name||'—'}</b></div>
      <div><span>Customer ID</span><b>{data.customerId}</b></div>
      <div><span>Phone</span><b>{s.phone_number||m.phone_number||row?.phone_number||'—'}</b></div>
      <div><span>Category</span><b>{[s.category||m.category,s.sub_category||m.sub_category].filter(Boolean).join(' / ')||'—'}</b></div>
      <div><span>Subscription</span><b>{s.status||'—'}{s.sub_first_date?` · since ${fmtDay(s.sub_first_date)}`:''}</b></div>
      <div><span>Queue</span><b>{row?QUEUE_LABEL[row.closed?'closed':row.queue]:'—'}</b></div>
      <div><span>Credits (wallet)</span><b>{s.credits!=null?money(s.credits):'—'}</b></div>
      <div><span>Renewal due / renewed</span><b>{s.renewal_due?fmtDay(s.renewal_due):'—'}{s.renewed_on?` · renewed ${fmtDay(s.renewed_on)}`:''}</b></div>
      <div><span>Cancelled on</span><b>{s.cancelled_on?fmtDay(s.cancelled_on):'—'}</b></div>
      {onbLost&&<div className="wide-cell"><span>Onboarding closed as</span><b>{disp(c.current_l0,c.current_l1,c.current_l2)||'Lost'}{c.owner?` · by ${c.owner}`:''}</b></div>}
      <div><span>CSM</span><b>{data.assignment?.name||'Unassigned'}</b></div>
      <div><span>Onboarded by</span><b>{c?.owner||'—'}{c?.ads_live_at?` · live ${fmtDay(c.ads_live_at)}`:''}</b></div>
      <div><span>Top-ups / Renewals</span><b>{row?`${money(row.topup_total)} (${row.topups}) · ${row.renewals} renewal${row.renewals===1?'':'s'}`:'—'}</b></div>
    </div>
    {admin&&<div className="form-grid padtop"><label>Reassign CSM<select value={data.assignment?.agent_id||''} onChange={e=>reassign(e.target.value)}><option value="">Select CSM</option>{csms.map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></div>}

    <div className="section-label subhead">What to pitch</div>
    {pitches.length===0&&remarks.length===0?<div className="empty">No pitch note yet.</div>:<div className="timeline">
      {pitches.map((n:any)=><div className="event followup" key={n.id}><div className="event-top"><b>{fmtDay(n.note_date)} · {n.author_name||'CSM Admin'}</b><span className="status">Pitch note</span></div><div className="remark">{n.note}</div></div>)}
      {remarks.map((n:any)=><div className="event" key={n.id}><div className="event-top"><b>{fmtDay(n.note_date)} · {n.author_name||'Tracker sheet'}</b><span className="status">Remark (old tracker)</span></div><div className="remark">{n.note}</div></div>)}
    </div>}
    {admin&&<div className="csm-note-add"><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Add a pitch note for this merchant"/><button className="primary" disabled={saving||!note.trim()} onClick={addNote}>Add Pitch Note</button></div>}

    <div className="section-label subhead">Ads ({data.ads.length})</div>
    {data.ads.length===0?<div className="empty">No ads in the latest sync.</div>:<div className="table-scroll"><table className="split leads-table csm-ads">
      <thead><tr><th>Creative</th><th>Status</th><th>Start</th><th>End</th><th>Budget</th><th>Spend</th><th>Impr.</th><th>Clicks</th><th>CTR</th><th>Reach</th></tr></thead>
      <tbody>{data.ads.map((a:any,i:number)=><tr key={i}><td className="remark-cell">{a.creative_name||'—'}{a.description&&<div className="note csm-ad-desc">{a.description}</div>}</td><td>{a.ad_status}</td><td>{fmtDay(a.start_date)}</td><td>{fmtDay(a.end_date)}</td><td>{money(a.budget)}</td><td>{money(a.spend)}</td><td>{num(a.impressions)}</td><td>{num(a.clicks)}</td><td>{a.ctr!=null?Number(a.ctr).toFixed(2)+'%':'—'}</td><td>{num(a.reach)}</td></tr>)}</tbody>
    </table></div>}

    <div className="section-label subhead">Log Call</div>
    {!c?<div className="empty">This merchant has no onboarding case in the portal, so calls can't be logged yet. Ask an onboarding admin to add the case.</div>:
     <>{onbLost&&<div className="note">Onboarding closed this merchant as Not Interested / Refund. Low priority; log a call only if you choose to call.</div>}
      <div className="form-grid">
        <label>Outcome<select value={l0} onChange={e=>{setL0(e.target.value);setL1('');setL2('');setCbDate('');setCbTime('');setTopUp('');setPlan('');}}><option value="">Select outcome</option>{l0s.map(n=><option key={n.id} value={n.code}>{n.label}</option>)}</select></label>
        {l1s.length>0&&<label>Reason<select value={l1} onChange={e=>{setL1(e.target.value);setL2('');}}><option value="">Select reason</option>{l1s.map(n=><option key={n.id} value={n.code}>{n.label}</option>)}</select></label>}
        {l2s.length>0&&<label>Detail<select value={l2} onChange={e=>setL2(e.target.value)}><option value="">Select</option>{l2s.map(n=><option key={n.id} value={n.code}>{n.label}</option>)}</select></label>}
        {topUpMode&&<label>Top-up Amount (₹) *<input type="number" min="1" step="1" value={topUp} onChange={e=>setTopUp(e.target.value)} placeholder="Required"/></label>}
        {planNeeded&&<label>Plan Renewed{planRequired?' *':''}<select value={plan} onChange={e=>setPlan(e.target.value)}><option value="">Select plan</option>{Object.entries(PLANS).map(([code,p])=><option key={code} value={code}>{p.label} · ₹{p.price.toLocaleString('en-IN')} + GST</option>)}</select></label>}
        {callbackAvailable&&<><label>Callback Date{callbackRequired?' *':' (optional)'}<input type="date" min={todayIst()} value={cbDate} onChange={e=>setCbDate(e.target.value)}/></label><label>Callback Time{callbackRequired?' *':' (optional)'}<input type="time" value={cbTime} onChange={e=>setCbTime(e.target.value)}/></label></>}
        <label className="wide">Remark<textarea value={remark} onChange={e=>setRemark(e.target.value)} placeholder="What the merchant said / next step"/></label>
      </div>
      <button className="primary" disabled={saving||invalid} onClick={save}>{saving?'Saving…':'Log Call'}</button>
    </>}
    {err&&<div className="error">{err}</div>}{msg&&<div className="note">{msg}</div>}

    <div className="section-label subhead">History</div>
    {data.events.length===0?<div className="empty">No calls yet.</div>:<div className="timeline">{data.events.map((e:any)=><div className={e.source_type==='customer_success_followup'?'event':'event csm-onb-event'} key={e.id}>
      <div className="event-top"><b>{fmt(e.event_time)} · {e.by_name||'System'} <span className="csm-src">{SOURCE_LABEL[e.source_type]||e.source_type}</span></b><span className="status">{disp(e.l0_label_snapshot,e.l1_label_snapshot,e.l2_label_snapshot)||'Update'}</span></div>
      {e.callback_at&&<div className="callback-history">Callback: <b>{fmt(e.callback_at)}</b></div>}
      {e.top_up!=null&&<div className="callback-history">Top-up: <b>{money(e.top_up)}</b></div>}
      {e.plan_code&&<div className="callback-history">Plan: <b>{(PLANS as any)[e.plan_code]?.label||e.plan_code}</b></div>}
      <div className={e.remark?'remark':'remark muted'}>{e.remark||'No remark logged'}</div>
    </div>)}</div>}
  </>;
}

function Metrics({admin,csms,onOpenBucket}:{admin:boolean;csms:any[];onOpenBucket:(b:string)=>void}){
  const today=todayIst();
  const minus=(n:number)=>new Date(new Date(today+'T00:00:00Z').getTime()-n*86400000).toISOString().slice(0,10);
  const [from,setFrom]=useState(minus(6)),[to,setTo]=useState(today),[res,setRes]=useState<any>(null),[loading,setLoading]=useState(false),[csm,setCsm]=useState('');
  async function load(f=from,t=to,who=csm){setFrom(f);setTo(t);setCsm(who);setLoading(true);const r=await fetch(`/api/csm/metrics?from=${f}&to=${t}${who?`&csm=${who}`:''}`,{cache:'no-store'});setLoading(false);if(r.ok)setRes(await r.json());}
  useEffect(()=>{load();},[]);
  const totals=useMemo(()=>{
    const by=new Map<string,any>();
    for(const d of res?.daily||[]){const k=d.name;const t=by.get(k)||{name:k,merchants:0,calls:0,connected:0,callbacks:0,topups:0,topup_amount:0,renewals:0,renewal_amount:0,another_ad:0,creative:0,lost:0};
      for(const f of ['merchants','calls','connected','callbacks','topups','topup_amount','renewals','renewal_amount','another_ad','creative','lost'])t[f]+=Number(d[f])||0; by.set(k,t);}
    return [...by.values()];
  },[res]);
  const cols:[string,string,(v:any)=>string][]=[['merchants','Merchants called',num],['calls','Calls',num],['connected','Connected',num],['callbacks','Callbacks set',num],['topups','Top-ups',num],['topup_amount','Top-up ₹',money],['renewals','Renewals',num],['renewal_amount','Renewal ₹',money],['another_ad','Another ad live',num],['creative','Creative updated',num],['lost','NI / Refund',num]];
  return <>
    <section className="card"><div className="section-label">Daily Metrics</div>
      <div className="preset-row"><button onClick={()=>load(today,today)}>Today</button><button onClick={()=>load(minus(1),minus(1))}>Yesterday</button><button onClick={()=>load(minus(6),today)}>Last 7 days</button><button onClick={()=>load(today.slice(0,8)+'01',today)}>This month</button></div>
      <div className="range-row"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>{admin&&<label>CSM<select value={csm} onChange={e=>load(from,to,e.target.value)}><option value="">All CSMs</option>{csms.filter((x:any)=>x.access_level==="agent"||Number(x.weight)>0).map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}<button className="primary" disabled={loading} onClick={()=>load()}>{loading?'Loading…':'Apply'}</button></div>
      <div className="note">Counts every CSM call logged in the range (IST). "Merchants called" in the totals adds up daily unique merchants.</div>
    </section>
    <section className="card"><div className="section-label">By bucket</div><div className="table-scroll"><table className="split leads-table">
      <thead><tr><th>Bucket</th><th>Merchants now</th><th>Never called</th><th>Merchants called</th><th>Calls</th><th>Didn't pick</th><th>Connected</th><th>Callbacks set</th><th>Top-ups</th><th>Top-up ₹</th><th>Renewals</th><th>NI / Refund</th></tr></thead>
      <tbody>{(res?.buckets||[]).length===0?<tr><td colSpan={12}>No data.</td></tr>:(res?.buckets||[]).map((b:any)=><tr key={b.bucket_key} className={b.bucket_key!=='untagged'?'clickable':''} onClick={()=>b.bucket_key!=='untagged'&&onOpenBucket(b.bucket_key)}>
        <td>{QUEUE_LABEL[b.bucket_key]||b.bucket_key}</td><td>{num(b.merchants)}</td><td>{num(b.neverCalled)}</td><td>{num(b.merchants_called)}</td><td>{num(b.calls)}</td><td>{num(b.not_connected)}</td><td>{num(b.connected)}</td><td>{num(b.callbacks)}</td><td>{num(b.topups)}</td><td>{money(b.topup_amount)}</td><td>{num(b.renewals)}</td><td>{num(b.lost)}</td></tr>)}</tbody></table></div>
      <div className="note">"Merchants now" and "Never called" are today's queues. The call columns count calls in the date range, by the bucket the merchant was in when called. Click a bucket to open it.</div></section>
    <section className="card"><div className="section-label">Totals by CSM</div><div className="table-scroll"><table className="split leads-table"><thead><tr><th>CSM</th>{cols.map(c=><th key={c[0]}>{c[1]}</th>)}</tr></thead>
      <tbody>{totals.length===0?<tr><td colSpan={cols.length+1}>No calls in this range.</td></tr>:totals.map(t=><tr key={t.name}><td>{t.name}</td>{cols.map(c=><td key={c[0]}>{c[2](t[c[0]])}</td>)}</tr>)}</tbody></table></div></section>
    <section className="card"><div className="section-label">Day by day</div><div className="table-scroll"><table className="split leads-table"><thead><tr><th>Day</th><th>CSM</th>{cols.map(c=><th key={c[0]}>{c[1]}</th>)}</tr></thead>
      <tbody>{(res?.daily||[]).map((d:any,i:number)=><tr key={i}><td>{fmtDay(d.day)}</td><td>{d.name}</td>{cols.map(c=><td key={c[0]}>{c[2](d[c[0]])}</td>)}</tr>)}</tbody></table></div></section>
    <section className="card"><div className="section-label">Queue coverage (today)</div><div className="table-scroll"><table className="split leads-table"><thead><tr><th>CSM</th><th>Queue</th><th>Merchants</th><th>Called in last 7 days</th><th>Coverage</th><th>Never called</th></tr></thead>
      <tbody>{(res?.coverage||[]).map((g:any,i:number)=><tr key={i}><td>{g.csm}</td><td>{QUEUE_LABEL[g.queue]||g.queue}</td><td>{g.total}</td><td>{g.touched7d}</td><td>{g.total?Math.round(g.touched7d*100/g.total)+'%':'—'}</td><td>{g.neverCalled}</td></tr>)}</tbody></table></div>
      {!admin&&<div className="note">Your merchants only.</div>}</section>
  </>;
}

function PitchNotes({onSaved}:{onSaved:()=>Promise<void>}){
  const [mode,setMode]=useState<'single'|'bulk'>('single'),[cid,setCid]=useState(''),[note,setNote]=useState(''),[bulk,setBulk]=useState(''),[date,setDate]=useState(todayIst());
  const [saving,setSaving]=useState(false),[msg,setMsg]=useState(''),[errs,setErrs]=useState<string[]>([]);
  async function save(){
    setSaving(true);setMsg('');setErrs([]);
    const body=mode==='single'?{customerId:cid.trim(),note,noteDate:date}:{bulk,note,noteDate:date};
    const r=await fetch('/api/csm/notes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const j=await r.json(); setSaving(false);
    if(!r.ok){setMsg(j.error||'Could not save');setErrs(j.errors||[]);return;}
    setMsg(`Saved ${j.saved} pitch note${j.saved===1?'':'s'}.`);setErrs(j.errors||[]);
    if(mode==='single'){setCid('');setNote('');}else{setBulk('');}
    await onSaved();
  }
  return <section className="card"><div className="section-label">Pitch Notes</div>
    <div className="workspace-switch"><button className={mode==='single'?'active':''} onClick={()=>setMode('single')}>One merchant</button><button className={mode==='bulk'?'active':''} onClick={()=>setMode('bulk')}>Paste a list</button></div>
    <div className="form-grid">
      {mode==='single'&&<label>Cust ID *<input value={cid} onChange={e=>setCid(e.target.value.replace(/\D/g,''))} placeholder="Customer ID"/></label>}
      <label>Note date<input type="date" max={todayIst()} value={date} onChange={e=>setDate(e.target.value)}/></label>
      {mode==='bulk'&&<label className="wide">Cust IDs and notes *<textarea className="csm-bulk" value={bulk} onChange={e=>setBulk(e.target.value)} placeholder={'One merchant per line. Paste two columns from a sheet (Cust ID, note):\n1234567890\tPitch Gold plan, CTR is good\n2345678901\tPush ₹2,000 top-up\n\nOr paste only Cust IDs and write one note below for all of them.'}/></label>}
      <label className="wide">{mode==='bulk'?'Note for lines without one (optional)':'Pitch note *'}<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="What should the CSM pitch?"/></label>
    </div>
    <button className="primary" disabled={saving||(mode==='single'?!cid||!note.trim():!bulk.trim())} onClick={save}>{saving?'Saving…':'Save Pitch Notes'}</button>
    {msg&&<div className="note">{msg}</div>}
    {errs.length>0&&<div className="error">Skipped {errs.length} line{errs.length===1?'':'s'}: {errs.slice(0,10).join(' · ')}{errs.length>10?' …':''}</div>}
    <div className="note">The newest note shows on the merchant in the CSM queue. Older notes stay in the merchant's history.</div>
  </section>;
}

function Allocation({data,reload}:{data:any;reload:()=>Promise<void>}){
  const csms:any[]=data?.csms||[];
  const [weights,setWeights]=useState<any>(()=>Object.fromEntries(csms.map(c=>[c.id,String(c.weight)])));
  const [ids,setIds]=useState(''),[to,setTo]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
  const counts=useMemo(()=>{const c:any={};for(const m of data?.merchants||[]){const k=m.assigned_to||'none';if(m.queue==='onb_lost')continue;c[k]=c[k]||{total:0,ending:0,ended:0,lapsed:0,closed:0};c[k].total++;c[k][m.closed?'closed':m.queue==='cancelled'?'lapsed':m.queue]++;}return c;},[data]);
  async function post(body:any){setBusy(true);setMsg('');const r=await fetch('/api/csm/assignments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();setBusy(false);if(!r.ok){setMsg(j.error||'Failed');return null;}await reload();return j;}
  const agents=csms.filter(c=>c.access_level==='agent'||Number(c.weight)>0);
  return <>
    <section className="card"><div className="section-label">Allocation</div>
      <table className="split"><thead><tr><th>CSM</th><th>Weight</th><th>Merchants</th><th>About to end</th><th>Ended</th><th>Cancelled / Expired</th><th>Closed</th></tr></thead>
        <tbody>{agents.map(c=>{const n=counts[c.id]||{};return <tr key={c.id}><td>{c.name}</td><td><input className="csm-weight" type="number" min="0" value={weights[c.id]??'0'} onChange={e=>setWeights({...weights,[c.id]:e.target.value})}/></td><td>{n.total||0}</td><td>{n.ending||0}</td><td>{n.ended||0}</td><td>{n.lapsed||0}</td><td>{n.closed||0}</td></tr>;})}
          {counts.none&&<tr><td>Unassigned</td><td>—</td><td>{counts.none.total}</td><td>{counts.none.ending}</td><td>{counts.none.ended}</td><td>{counts.none.lapsed}</td><td>{counts.none.closed}</td></tr>}</tbody></table>
      <div className="preset-row padtop">
        <button disabled={busy} onClick={async()=>{const j=await post({action:'weights',weights:Object.entries(weights).map(([agentId,weight])=>({agentId,weight}))});if(j)setMsg('Weights saved. They apply to new merchants.');}}>Save weights</button>
        <button disabled={busy} onClick={async()=>{const j=await post({action:'allocate'});if(j)setMsg(`Assigned ${j.assigned} unassigned merchant${j.assigned===1?'':'s'}.`);}}>Assign unassigned now</button>
      </div>
      <div className="note">New merchants from each daily sync go round robin by weight (50 / 50 = equal share). Merchants already assigned never move unless you move them below. Weight 0 = gets no new merchants.</div>
    </section>
    <section className="card"><div className="section-label">Move merchants</div>
      <div className="form-grid"><label className="wide">Cust IDs (one per line, or comma separated)<textarea value={ids} onChange={e=>setIds(e.target.value)}/></label>
        <label>Move to<select value={to} onChange={e=>setTo(e.target.value)}><option value="">Select CSM</option>{csms.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
      <button className="primary" disabled={busy||!to||!ids.trim()} onClick={async()=>{const list=ids.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);const j=await post({action:'reassign',customerIds:list,agentId:to});if(j){setMsg(`Moved ${j.moved} merchant${j.moved===1?'':'s'}.`);setIds('');}}}>Move</button>
    </section>
    {msg&&<div className="card note">{msg}</div>}
  </>;
}
