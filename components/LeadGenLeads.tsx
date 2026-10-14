'use client';
import { useCallback,useEffect,useRef,useState } from 'react';

// Lead Gen Ads (Seller workspace): Meta lead-form leads assigned to this seller (all leads for
// Seller Admins). Refreshes every 30 seconds while the window is in use and on returning to it,
// so new leads appear without reloading the page.
const fmt=(t?:string)=>t?new Date(t).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}):'—';

export function useLeadGen(){
 const [state,setState]=useState<any>({visible:false,admin:false,leads:[]});
 const ver=useRef('');
 // Checks a tiny fingerprint first and re-downloads the leads only when something changed.
 const load=useCallback(async(force?:any)=>{if(document.visibilityState!=='visible')return;try{
  if(force!==true){const v=await fetch('/api/leadgen/leads?version=1',{cache:'no-store'});if(v.ok){const {v:nv}=await v.json();if(nv&&nv===ver.current)return;ver.current=nv;}}
  const r=await fetch('/api/leadgen/leads',{cache:'no-store'});if(r.ok)setState(await r.json());}catch{}},[]);
 useEffect(()=>{
  load(); const t=setInterval(()=>{if(document.hasFocus())load();},30000);
  document.addEventListener('visibilitychange',load); window.addEventListener('focus',load);
  return()=>{clearInterval(t);document.removeEventListener('visibilitychange',load);window.removeEventListener('focus',load);};
 },[load]);
 const fresh=(state.leads||[]).filter((l:any)=>!l.calls&&(!state.admin||l.assigned_to)).length;
 return {...state,fresh,reload:()=>load(true)};
}

function Tags({l}:{l:any}){
 return <>{l.already_called&&<span className="lg-tag called">Already called</span>}
  {l.is_repeat&&<span className="lg-tag repeat">Repeat submission</span>}
  {l.submissions>1&&<span className="lg-tag">{l.submissions} submissions</span>}
  {l.customer_id?<span className="lg-tag">Cust ID {l.customer_id}</span>:<span className="lg-tag muted">No Cust ID yet</span>}</>;
}

export function LeadInfo({lead}:{lead:any}){
 return <section className="card lg-info"><div className="section-label">Lead Gen Ads lead</div>
  <div className="merchant-grid"><div><span>Name</span><b>{lead.name||'—'}</b></div><div><span>Phone</span><b>{lead.phone}</b></div>
   <div><span>Submitted</span><b>{fmt(lead.submitted_at)}</b></div><div><span>Ad</span><b>{[lead.ad_name,lead.campaign_name].filter(Boolean).join(' · ')||'—'}</b></div></div>
  <div className="lg-tags"><Tags l={lead}/></div>
 </section>;
}

type Tab='new'|'called'|'all';
export default function LeadGenLeads({data,onOpen}:{data:any;onOpen:(l:any)=>void}){
 const [tab,setTab]=useState<Tab>('new'),[who,setWho]=useState(''),[q,setQ]=useState('');
 const leads:any[]=data.leads||[];
 const people=Array.from(new Map(leads.filter(l=>l.assigned_to).map(l=>[l.assigned_to,l.assigned_name||'—'])).entries());
 const inScope=leads.filter(l=>!who||(who==='none'?!l.assigned_to:l.assigned_to===who));
 const counts={new:inScope.filter(l=>!l.calls).length,called:inScope.filter(l=>l.calls>0).length,all:inScope.length};
 const qq=q.trim().toLowerCase(),qd=q.replace(/\D/g,'');
 const shown=inScope.filter(l=>(tab==='all'||(tab==='new'?!l.calls:l.calls>0))
  &&(!qq||String(l.name||'').toLowerCase().includes(qq)||String(l.customer_id||'').includes(qq)||(qd.length>=4&&String(l.phone).includes(qd))));
 return <section className="card">
  <div className="leads-head"><div className="section-label">Lead Gen Ads</div><span className="note">{data.admin?'All leads':'Your leads'} · updates on its own</span></div>
  <div className="queue-tabs">{([['new','New'],['called','Called'],['all','All']] as [Tab,string][]).map(([k,l])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}><b>{counts[k]}</b><span>{l}</span></button>)}</div>
  <div className="search-row padtop">
   {data.admin&&<select value={who} onChange={e=>setWho(e.target.value)}><option value="">Everyone</option><option value="none">Unassigned</option>{people.map(([id,n])=><option key={id} value={id}>{n}</option>)}</select>}
   <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search name, phone or Cust ID"/>
  </div>
  {!data.inRoster&&!data.admin&&<div className="note">You're not getting new Lead Gen leads right now; the leads already with you stay here.</div>}
  {shown.length===0?<div className="empty">No leads here.</div>:<div className="case-list">{shown.map(l=><button key={l.id} onClick={()=>onOpen(l)}>
   <div><strong>{l.name||l.phone}</strong>
    <span>{l.phone} · {fmt(l.submitted_at)}{l.ad_name?` · ${l.ad_name}`:''}{data.admin?` · ${l.assigned_name||'Unassigned'}`:''}</span>
    <span>{l.calls?`${l.calls} call${l.calls>1?'s':''} · last: ${[l.last_l0,l.last_l1].filter(Boolean).join(' → ')} (${fmt(l.last_at)}${l.last_by?`, ${l.last_by}`:''})`:'Not called yet'}{l.next_callback&&new Date(l.next_callback).getTime()>Date.now()?` · callback ${fmt(l.next_callback)}`:''}</span>
   </div>
   <div className="lg-tags"><Tags l={l}/></div>
  </button>)}</div>}
 </section>;
}
