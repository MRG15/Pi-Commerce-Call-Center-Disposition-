'use client';
import { useEffect,useState } from 'react';

// "Req Call Back": merchants who tapped "Request a callback" in a WhatsApp message.
// The hook keeps the list fresh while the workspace is open (every 15 seconds while the window is in use,
// on returning to it, and right after a disposition is saved); a request clears once a new disposition is logged for the merchant.
const TEMPLATE_LABEL:Record<string,string>={SELLER_NOT_CONNECTED:'Not connected nudge',ONB_NOT_CONNECTED:'Not connected nudge',T1_RENEW:'Renewal nudge',
  T2_ENDED_FREE:'Ads ended',T3_ENDED_TOPUP:'Ads ended · top-up',T4_ENDING_FREE:'Ads ending',T5_ENDING_TOPUP:'Ads ending · top-up'};
const ago=(t:string)=>{const m=Math.max(0,Math.round((Date.now()-new Date(t).getTime())/60000));return m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`;};

export function useCallbackRequests(workspace:'seller'|'onboarding'|'csm'){
 const [rows,setRows]=useState<any[]>([]);
 useEffect(()=>{
  let live=true;
  const load=async()=>{if(document.visibilityState!=='visible')return;try{const r=await fetch('/api/callback-requests?workspace='+workspace,{cache:'no-store'});if(r.ok&&live)setRows((await r.json()).requests||[]);}catch{}};
  load(); const t=setInterval(()=>{if(document.hasFocus())load();},15000); document.addEventListener('visibilitychange',load); window.addEventListener('focus',load); window.addEventListener('reqcb:refresh',load);
  return()=>{live=false;clearInterval(t);document.removeEventListener('visibilitychange',load);window.removeEventListener('focus',load);window.removeEventListener('reqcb:refresh',load);};
 },[workspace]);
 return rows;
}

// Call after saving a disposition so the pane drops a request the save just cleared.
export const refreshCallbackRequests=()=>{try{window.dispatchEvent(new Event('reqcb:refresh'));}catch{}};

export default function CallbackRequestList({rows,onOpen,showOwner,title=true}:{rows:any[];onOpen:(r:any)=>void;showOwner?:boolean;title?:boolean}){
 return <section className="card req-cb">{title&&<div className="section-label">Req Call Back</div>}
  {rows.length===0?<div className="empty">No callback requests right now. Merchants who tap "Request a callback" in a WhatsApp message show up here.</div>
  :<div className="req-cb-list">{rows.map(r=><button key={r.id} onClick={()=>onOpen(r)}>
   <strong>{r.merchant_name||(r.customer_id?`Customer ${r.customer_id}`:r.phone)}</strong>
   <span>{r.customer_id?`Cust ID ${r.customer_id}`:`Lead · ${r.phone||''}`} · {TEMPLATE_LABEL[r.template]||r.template} · {ago(r.clicked_at)}{showOwner&&r.owner?` · ${r.owner}`:''}{r.click_count>1?` · tapped ${r.click_count}×`:''}</span>
  </button>)}</div>}
 </section>;
}
