'use client';
import { useEffect,useState } from 'react';

// Onboarding admins: a small pill at the top — "No action in past 10 min · N · Reassign now" — that opens
// a floating list of today's new cases nobody has called within 10 minutes of being assigned. Click a
// Cust ID to open the case and reassign it; a reassigned case comes back after another 10 minutes
// without a call. Refreshes every minute while the window is in use.
export default function StaleCasesAlert({onOpen}:{onOpen:(caseId:string)=>void}){
 const [rows,setRows]=useState<any[]>([]); const [open,setOpen]=useState(false);
 useEffect(()=>{
  let live=true;
  const load=async()=>{if(document.visibilityState!=='visible')return;try{const r=await fetch('/api/onboarding/stale-new-cases',{cache:'no-store'});if(r.ok&&live)setRows((await r.json()).cases||[]);}catch{}};
  load(); const t=setInterval(()=>{if(document.hasFocus())load();},120000); document.addEventListener('visibilitychange',load);
  return()=>{live=false;clearInterval(t);document.removeEventListener('visibilitychange',load);};
 },[]);
 if(!rows.length) return null;
 const mins=(t:string)=>Math.max(0,Math.round((Date.now()-new Date(t).getTime())/60000));
 return <div className="stale-alert">
  <button className="stale-pill" onClick={()=>setOpen(!open)} aria-expanded={open}>
   <span className="stale-dot"/>No action in past 10 min · {rows.length}<b>Reassign now {open?'▴':'▾'}</b>
  </button>
  {open&&<div className="stale-list">{rows.map(r=><button key={r.id} onClick={()=>{setOpen(false);onOpen(r.id);}}>
   <b>{r.customer_id}</b><span>{r.merchant_name||'—'}{r.owner?` · ${r.owner}`:''}</span><em>{mins(r.assigned_at)}m</em>
  </button>)}</div>}
 </div>;
}
