'use client';
import { useEffect,useState } from 'react';

// Plan Upgraded form field: shows the merchant's current plan and lets the agent pick a higher
// plan, with the upgrade value (new price minus current price). If the portal cannot tell the
// current plan, the agent picks it first.
export default function UpgradePicker({customerId,plan,onChange}:{customerId:string;plan:string;onChange:(plan:string,currentPlan:string|null)=>void}){
 const [info,setInfo]=useState<any>(null),[cur,setCur]=useState('');
 useEffect(()=>{setInfo(null);setCur('');onChange('',null);if(!customerId)return;(async()=>{const r=await fetch('/api/plan-upgrade?customerId='+encodeURIComponent(customerId),{cache:'no-store'});if(r.ok)setInfo(await r.json());})();},[customerId]);
 if(!info)return <label>Upgraded to *<select disabled><option>Loading current plan…</option></select></label>;
 const known=Boolean(info.current);
 const targets:any[]=known?info.targets:(cur?info.byCurrent?.[cur]?.targets||[]:[]);
 const inr=(n:number)=>'₹'+Math.round(n).toLocaleString('en-IN');
 return <>
  {known?<label>Current plan<input value={`${info.currentLabel} (${inr(info.currentPrice)})`} readOnly/></label>
   :<label>Current plan *<select value={cur} onChange={e=>{setCur(e.target.value);onChange('',e.target.value||null);}}><option value="">Select current plan</option>{Object.entries(info.byCurrent||{}).map(([k,v]:any)=><option key={k} value={k}>{v.label}</option>)}</select></label>}
  <label>Upgraded to *<select value={plan} disabled={!targets.length} onChange={e=>onChange(e.target.value,known?null:cur||null)}><option value="">{known&&!targets.length?'Already on the highest plan':'Select new plan'}</option>{targets.map(t=><option key={t.plan} value={t.plan}>{t.label} · upgrade value {inr(t.value)}</option>)}</select></label>
 </>;
}
