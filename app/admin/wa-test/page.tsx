'use client';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';

// Super Admin → WhatsApp test: send any configured template to test numbers with sample values.
const LABEL:Record<string,string>={SELLER_NOT_CONNECTED:'Seller · Not connected',ONB_NOT_CONNECTED:'Onboarding · Not connected',T1_RENEW:'CSM · T1 Renew',
  T2_ENDED_FREE:'CSM · T2 Ads ended (credits ≥ ₹1,000)',T3_ENDED_TOPUP:'CSM · T3 Ads ended (credits < ₹1,000)',T4_ENDING_FREE:'CSM · T4 Ads ending (credits ≥ ₹1,000)',T5_ENDING_TOPUP:'CSM · T5 Ads ending (credits < ₹1,000)'};
const fmt=(t?:string)=>t?new Date(t).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'—';

export default function WaTestPage(){
 const router=useRouter();
 const [data,setData]=useState<any>(null),[tpl,setTpl]=useState(''),[image,setImage]=useState(''),[list,setList]=useState('Nausheen, 8686024333\nAman, 9910468198\nMadhav, 8383059253'),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const r=await fetch('/api/admin/wa-test',{cache:'no-store'});if(r.status===401){router.replace('/login');return;}const j=await r.json();if(!r.ok){setMsg(j.error||'Not allowed');return;}setData(j);}
 useEffect(()=>{load();},[]);
 const t=data?.templates?.find((x:any)=>x.key===tpl);
 useEffect(()=>{setImage(t?.imageUrl||'');},[tpl]);
 async function send(){
  setBusy(true);setMsg('');
  const recipients=list.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const [a,b]=l.includes(',')?l.split(','):['',l];return {name:(a||'').trim(),phone:(b||'').trim()};});
  const r=await fetch('/api/admin/wa-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({template:tpl,imageUrl:image,recipients})});
  const j=await r.json();setBusy(false);setMsg(r.ok?`Sent ${j.count} test message(s). Status below.`:(j.error||'Could not send'));load();
 }
 return <div className="app-shell"><header><div><strong>Pi Commerce</strong><span> · WhatsApp test</span></div><div className="header-actions"><a href="/admin/access">Manage Access</a></div></header><main>
  {!data?<div className="card">{msg||'Loading…'}</div>:<>
  <section className="card"><div className="section-label">Send a test</div>
   <div className="form-grid">
    <label>Template<select value={tpl} onChange={e=>setTpl(e.target.value)}><option value="">Select</option>{data.templates.map((x:any)=><option key={x.key} value={x.key}>{LABEL[x.key]||x.key} · {x.name}</option>)}</select></label>
    {t?.image&&<label>Header image link *<input value={image} onChange={e=>setImage(e.target.value)} placeholder="https://…/image.jpg"/></label>}
   </div>
   <label className="padtop" style={{display:'block'}}>Recipients (one per line: name, phone)<textarea rows={4} value={list} onChange={e=>setList(e.target.value)}/></label>
   {t&&<div className="note">Sample values: {t.body.map((k:string,i:number)=>`{{${i+1}}} ${k==='merchant_name'?'the name above':k}`).join(' · ')}. "Request a callback" works as in production.</div>}
   <button className="primary" disabled={!tpl||busy||(t?.image&&!image)} onClick={send}>{busy?'Sending…':'Send test'}</button>
   {msg&&<div className="note">{msg}</div>}
  </section>
  <section className="card"><div className="section-label">CSM automatic rules (test merchants)</div>
   <div className="note">Runs the real CSM rules (T1–T5, exactly as after the daily sync) for the test merchants only: Nausheen, Aman and Madhav (Cust IDs 900000001–3). Each merchant gets a template once per cycle, like production.</div>
   <button className="primary" disabled={busy} onClick={async()=>{setBusy(true);setMsg('');const r=await fetch('/api/admin/wa-test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'csm-run'})});const j=await r.json();setBusy(false);setMsg(r.ok?`CSM rules ran: ${j.count} message(s) queued. Status below.`:(j.error||'Could not run'));load();}}>Run CSM rules for test merchants</button>
  </section>
  <section className="card"><div className="leads-head"><div className="section-label">Recent tests</div><button className="csv-btn" onClick={load}>Refresh</button></div>
   {data.rows.length===0?<div className="empty">No tests yet.</div>:<table className="split"><thead><tr><th>When</th><th>Template</th><th>To</th><th>Status</th><th>Callback tapped</th></tr></thead><tbody>
    {data.rows.map((r:any)=><tr key={r.id}><td>{fmt(r.created_at)}</td><td>{LABEL[r.template]||r.template}</td><td>{r.name||'—'} · {r.phone}</td><td title={r.status_note||''}>{r.status}{r.status!=='sent'&&r.status_note?` — ${String(r.status_note).slice(0,80)}`:''}</td><td>{r.clicked_at?`Yes · ${fmt(r.clicked_at)}`:'—'}</td></tr>)}
   </tbody></table>}
  </section></>}
 </main></div>;
}
