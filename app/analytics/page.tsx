'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Analytics(){
  const router=useRouter();
  const today=new Date().toISOString().slice(0,10);
  const [from,setFrom]=useState(today),[to,setTo]=useState(today),[data,setData]=useState<any>(null),[agent,setAgent]=useState<any>(null),[loading,setLoading]=useState(false);
  useEffect(()=>{(async()=>{const m=await fetch('/api/auth/me');if(!m.ok){router.replace('/login');return;}const a=(await m.json()).agent;setAgent(a);if(a.role!=='admin'){router.replace('/');return;}load(today,today);})();},[]);
  async function load(f:string,t:string){setLoading(true);const r=await fetch(`/api/analytics/daily?from=${f}&to=${t}`);if(r.ok)setData(await r.json());setLoading(false);}
  if(!agent)return <div className="center">Loading…</div>;
  return <div className="app-shell"><header><div><strong>Pi Commerce</strong><span> · Analytics</span></div><div className="header-actions"><a href="/">Agent Console</a><a href="/admin/agents">Manage Agents</a><span className="badge">{agent.name}</span></div></header><main>
    <section className="card"><div className="section-label">Performance Snapshot</div><div className="range-row"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button className="primary" onClick={()=>load(from,to)} disabled={loading}>{loading?'Loading…':'Apply'}</button><a className="primary" href={`/api/export/dispositions?from=${from}&to=${to}`}>Download Disposition CSV</a></div>{data&&<><div className="kpis analytics-kpis"><K n={data.totalAttempts} l="Total Attempts"/><K n={data.uniqueAttempted} l="Unique Attempted"/><K n={data.freshCustomers} l="Fresh"/><K n={data.repeatCustomers} l="Repeat"/><K n={data.connected} l="Connected"/><K n={data.notConnected} l="Not Connected"/><K n={data.connectRateKnownDenominator==null?'—':data.connectRateKnownDenominator+'%'} l="Connect Rate"/><K n={data.callbackRequested} l={`Callbacks (${data.callbackRate}%)`}/><K n={data.interested} l={`Interested (${data.interestedRate}%)`}/><K n={data.paymentDone} l={`Payment Done (${data.paymentRate}%)`}/><K n={data.visitsRequested} l="Visits Requested*"/></div><div className="note">* Visit metric uses only new-taxonomy calls because legacy visit flags were not reliably tied to a specific call date.</div></>}</section>
    {data&&<><div className="two-col"><section className="card"><div className="section-label">Fresh customers — latest outcome</div><Split rows={data.freshDispositionSplit}/></section><section className="card"><div className="section-label">Repeat customers — latest outcome</div><Split rows={data.repeatDispositionSplit}/></section></div>
    <section className="card"><div className="section-label">Agent Performance</div><table className="split"><thead><tr><th>Agent</th><th>Attempts</th><th>Unique</th><th>Connected</th><th>Connect %</th><th>Interested</th><th>Callbacks</th><th>Payments</th></tr></thead><tbody>{data.agentPerformance.map((r:any)=><tr key={r.name}><td>{r.name}</td><td>{r.attempts}</td><td>{r.unique}</td><td>{r.connected}</td><td>{r.connectRate}%</td><td>{r.interested}</td><td>{r.callbacks}</td><td>{r.paymentDone}</td></tr>)}</tbody></table></section></>}
  </main></div>
}
function K({n,l}:{n:any,l:string}){return <div><b>{n}</b><span>{l}</span></div>}
function Split({rows}:{rows:any[]}){return rows.length?<table className="split"><thead><tr><th>Outcome</th><th>#</th><th>%</th></tr></thead><tbody>{rows.map(r=><tr key={r.outcome}><td>{r.outcome}</td><td>{r.count}</td><td>{r.percent}%</td></tr>)}</tbody></table>:<div className="empty">No calls for this period.</div>}
