'use client';
import { useEffect,useState } from 'react';

// Green "Req Call Back" pane: merchants who tapped "Request a callback" in a WhatsApp message.
// Refreshes every 30 seconds; a request clears once a new disposition is logged for the merchant.
const TEMPLATE_LABEL:Record<string,string>={SELLER_NOT_CONNECTED:'Not connected nudge',ONB_NOT_CONNECTED:'Not connected nudge',T1_RENEW:'Renewal nudge',
  T2_ENDED_FREE:'Ads ended',T3_ENDED_TOPUP:'Ads ended · top-up',T4_ENDING_FREE:'Ads ending',T5_ENDING_TOPUP:'Ads ending · top-up'};
const ago=(t:string)=>{const m=Math.max(0,Math.round((Date.now()-new Date(t).getTime())/60000));return m<60?`${m}m ago`:m<1440?`${Math.round(m/60)}h ago`:`${Math.round(m/1440)}d ago`;};

export default function CallbackRequests({workspace,onOpen,showOwner}:{workspace:'seller'|'onboarding'|'csm';onOpen:(r:any)=>void;showOwner?:boolean}){
 const [rows,setRows]=useState<any[]>([]);
 useEffect(()=>{
  let live=true;
  const load=async()=>{if(document.visibilityState!=='visible')return;const r=await fetch('/api/callback-requests?workspace='+workspace,{cache:'no-store'});if(r.ok&&live)setRows((await r.json()).requests||[]);};
  load(); const t=setInterval(load,30000); document.addEventListener('visibilitychange',load);
  return()=>{live=false;clearInterval(t);document.removeEventListener('visibilitychange',load);};
 },[workspace]);
 if(!rows.length) return null;
 return <section className="card req-cb"><div className="req-cb-head"><span className="req-cb-dot"/>Req Call Back <b>{rows.length}</b></div>
  <div className="req-cb-list">{rows.map(r=><button key={r.id} onClick={()=>onOpen(r)}>
   <strong>{r.merchant_name||`Customer ${r.customer_id}`}</strong>
   <span>Cust ID {r.customer_id} · {TEMPLATE_LABEL[r.template]||r.template} · {ago(r.clicked_at)}{showOwner&&r.owner?` · ${r.owner}`:''}{r.click_count>1?` · tapped ${r.click_count}×`:''}</span>
  </button>)}</div>
 </section>;
}
