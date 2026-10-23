'use client';
import { useEffect,useState } from 'react';

// Onboarding admins: floating "not contacted in 10 minutes" list of today's new cases. Click a Cust ID
// to open the case and reassign it. Refreshes every minute while the window is in use.
export default function StaleCasesAlert({onOpen}:{onOpen:(caseId:string)=>void}){
 const [rows,setRows]=useState<any[]>([]); const [open,setOpen]=useState(true);
 useEffect(()=>{
  let live=true;
  const load=async()=>{if(document.visibilityState!=='visible')return;try{const r=await fetch('/api/onboarding/stale-new-cases',{cache:'no-store'});if(r.ok&&live)setRows((await r.json()).cases||[]);}catch{}};
  load(); const t=setInterval(load,60000); document.addEventListener('visibilitychange',load);
  return()=>{live=false;clearInterval(t);document.removeEventListener('visibilitychange',load);};
 },[]);
 if(!rows.length) return null;
 const mins=(t:string)=>Math.max(0,Math.round((Date.now()-new Date(t).getTime())/60000));
 return <aside className="stale-alert">
  <button className="stale-head" onClick={()=>setOpen(!open)}><strong>Not contacted in 10 min · {rows.length}</strong><span>{open?'Hide':'Show'}</span></button>
  {open&&<><div className="stale-cta">Reassign now — open a case to move it</div>
   <div className="stale-list">{rows.map(r=><button key={r.id} onClick={()=>onOpen(r.id)}>
    <b>{r.customer_id}</b><span>{r.merchant_name||''}{r.owner?` · ${r.owner}`:''} · {mins(r.assigned_at)}m</span>
   </button>)}</div></>}
 </aside>;
}
