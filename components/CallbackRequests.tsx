'use client';
import { useEffect,useState } from 'react';

// "Req Call Back": merchants who tapped "Request a callback" in a WhatsApp message, or whom the
// onboarding voice AI handed off (VOICE_AI_HANDOFF), or who asked for a callback on a Paytm workflow page
// (PAYTM_CALLBACK, tagged with the page they asked from).
// The hook keeps the list fresh while the workspace is open (every 15 seconds while the window is in use,
// on returning to it, and right after a disposition is saved); a request clears once a new disposition is logged for the merchant.
const TEMPLATE_LABEL:Record<string,string>={SELLER_NOT_CONNECTED:'Not connected nudge',ONB_NOT_CONNECTED:'Not connected nudge',T1_RENEW:'Renewal nudge',
  T2_ENDED_FREE:'Ads ended',T3_ENDED_TOPUP:'Ads ended · top-up',T4_ENDING_FREE:'Ads ending',T5_ENDING_TOPUP:'Ads ending · top-up',VOICE_AI_HANDOFF:'Voice AI handoff',WB_OPTICAL:'Win-back testimonial',WB_SPA:'Win-back testimonial',WB_GENERIC:'Win-back testimonial',PAYTM_CALLBACK:'Paytm callback request',REFUND_NOTICE:'Refund WhatsApp · wants ad setup'};
const STAGE_LABEL:Record<string,string>={settings:'Settings page',connect_facebook:'Connect Facebook',subscribe:'Subscribe page',buy_credits:'Buy credits',other:'Other page'};
const human=(v:string)=>v.replace(/_/g,' ').replace(/^\w/,c=>c.toUpperCase());
export const stageLabel=(v?:string|null)=>v?(STAGE_LABEL[v]||human(v)):'';
export const isPaytmRequest=(r:any)=>r.template==='PAYTM_CALLBACK';
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
   <strong>{r.merchant_name||(r.customer_id?`Customer ${r.customer_id}`:r.phone)}{isPaytmRequest(r)&&r.stage&&<em className="req-cb-tag">📍 {stageLabel(r.stage)}</em>}{r.repeat&&<em className="req-cb-tag repeat">Repeat submission</em>}</strong>
   <span>{r.customer_id?`Cust ID ${r.customer_id}`:`${r.template==='VOICE_AI_HANDOFF'||isPaytmRequest(r)?'Unmatched':'Lead'} · ${r.phone||''}`}{(r.template==='VOICE_AI_HANDOFF'||isPaytmRequest(r))&&r.customer_id&&'case_id' in r&&!r.case_id?' · no onboarding case':''} · {TEMPLATE_LABEL[r.template]||r.template}{r.reason?` · ${isPaytmRequest(r)?human(r.reason):r.reason}`:''} · {ago(r.clicked_at)}{showOwner&&r.owner?` · ${r.owner}`:''}{r.click_count>1?` · tapped ${r.click_count}×`:''}</span>
  </button>)}</div>}
 </section>;
}

// New Paytm callback requests: a small pill at the top ("New callback request · N · View") that opens the
// list; the Req Call Back tab glows (reqCbGlow) while any are open.
export const reqCbGlow=(rows:any[])=>rows.some(isPaytmRequest)?'reqcb-glow':'';
export function NewCallbackPill({rows,onOpen,onView}:{rows:any[];onOpen:(r:any)=>void;onView:()=>void}){
 const [open,setOpen]=useState(false);
 const list=rows.filter(isPaytmRequest);
 if(!list.length) return null;
 return <div className="stale-alert cb-alert">
  <button className="stale-pill" onClick={()=>setOpen(!open)} aria-expanded={open}>
   <span className="stale-dot"/>New callback request · {list.length}<b>View {open?'▴':'▾'}</b>
  </button>
  {open&&<div className="stale-list">{list.slice(0,20).map(r=><button key={r.id} onClick={()=>{setOpen(false);onOpen(r);}}>
   <b>{r.customer_id||r.phone}</b><span>{r.merchant_name||'—'}{r.stage?` · ${stageLabel(r.stage)}`:''}{r.repeat?' · Repeat':''}</span><em>{ago(r.clicked_at)}</em>
  </button>)}{list.length>20&&<button onClick={()=>{setOpen(false);onView();}}><span>See all {list.length} in Req Call Back</span></button>}</div>}
 </div>;
}
