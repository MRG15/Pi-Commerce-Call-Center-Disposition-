'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function ymd(d:Date){const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;}
function shiftDays(base:Date,days:number){const d=new Date(base);d.setDate(d.getDate()+days);return d;}

export default function Analytics(){
  const router=useRouter();
  const now=new Date(); const today=ymd(now);
  const [from,setFrom]=useState(today),[to,setTo]=useState(today),[data,setData]=useState<any>(null),[agent,setAgent]=useState<any>(null),[loading,setLoading]=useState(false);
  useEffect(()=>{(async()=>{const m=await fetch('/api/auth/me');if(!m.ok){router.replace('/login');return;}const a=(await m.json()).agent;setAgent(a);if(a.role!=='admin'){router.replace('/');return;}load(today,today);})();},[]);
  async function load(f:string,t:string){setFrom(f);setTo(t);setLoading(true);const r=await fetch(`/api/analytics/daily?from=${f}&to=${t}`);if(r.ok)setData(await r.json());setLoading(false);}
  function preset(kind:'today'|'yesterday'|'7d'){
    const current=new Date();
    if(kind==='today') return load(ymd(current),ymd(current));
    if(kind==='yesterday'){const d=shiftDays(current,-1);return load(ymd(d),ymd(d));}
    return load(ymd(shiftDays(current,-6)),ymd(current));
  }
  if(!agent)return <div className="center">Loading…</div>;
  return <div className="app-shell"><header><div><strong>Pi Commerce</strong><span> · Analytics</span></div><div className="header-actions"><a href="/">Agent Console</a><a href="/admin/agents">Manage Agents</a><span className="badge">{agent.name}</span></div></header><main>
    <section className="card"><div className="section-label">Quick Answers</div><div className="preset-row"><button onClick={()=>preset('today')}>Today</button><button onClick={()=>preset('yesterday')}>Yesterday</button><button onClick={()=>preset('7d')}>Last 7 Days</button></div><div className="range-row"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button className="primary" onClick={()=>load(from,to)} disabled={loading}>{loading?'Loading…':'Apply'}</button><a className="primary" href={`/api/export/dispositions?from=${from}&to=${to}`}>Download Disposition CSV</a></div>{data&&<><div className="kpis analytics-kpis"><K n={data.totalAttempts} l="Total Calls"/><K n={data.uniqueAttempted} l="Unique Customers"/><K n={data.connected} l="Connected"/><K n={data.notConnected} l="Not Connected"/><K n={data.connectRateKnownDenominator==null?'—':data.connectRateKnownDenominator+'%'} l="Connect Rate"/><K n={data.interested} l="Interested"/><K n={data.callbackRequested} l="Callbacks"/><K n={data.paymentDone} l="Payment Done"/><K n={data.paymentIssues} l="Payment Issues"/><K n={data.technicalIssues} l="Technical Issues"/><K n={data.whatsappHandoffs} l="WhatsApp Handoffs"/><K n={data.fbLinkingIssues} l="FB Linking Issues"/><K n={data.visitsRequested} l="Visits Requested"/><K n={data.freshCustomers} l="Fresh"/><K n={data.repeatCustomers} l="Repeat"/></div><div className="note">Quick Answers uses approved disposition/status labels across L0, L1 and L2. It does not infer issues from free-text remarks.</div></>}</section>
    {data&&<><div className="two-col"><section className="card"><div className="section-label">Fresh customers — latest outcome</div><Split rows={data.freshDispositionSplit}/></section><section className="card"><div className="section-label">Repeat customers — latest outcome</div><Split rows={data.repeatDispositionSplit}/></section></div>
    <section className="card"><div className="section-label">Agent Performance</div><table className="split"><thead><tr><th>Agent</th><th>Attempts</th><th>Unique</th><th>Connected</th><th>Connect %</th><th>Interested</th><th>Callbacks</th><th>Payments</th><th>Payment Issues</th><th>Tech Issues</th><th>WA</th></tr></thead><tbody>{data.agentPerformance.map((r:any)=><tr key={r.name}><td>{r.name}</td><td>{r.attempts}</td><td>{r.unique}</td><td>{r.connected}</td><td>{r.connectRate}%</td><td>{r.interested}</td><td>{r.callbacks}</td><td>{r.paymentDone}</td><td>{r.paymentIssues}</td><td>{r.technicalIssues}</td><td>{r.whatsappHandoffs}</td></tr>)}</tbody></table></section></>}
  </main></div>
}
function K({n,l}:{n:any,l:string}){return <div><b>{n}</b><span>{l}</span></div>}
function Split({rows}:{rows:any[]}){return rows.length?<table className="split"><thead><tr><th>Outcome</th><th>#</th><th>%</th></tr></thead><tbody>{rows.map(r=><tr key={r.outcome}><td>{r.outcome}</td><td>{r.count}</td><td>{r.percent}%</td></tr>)}</tbody></table>:<div className="empty">No calls for this period.</div>}
