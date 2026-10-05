'use client';
import { useEffect,useMemo,useState } from 'react';
import { PLANS } from '@/lib/plans';

type Node={id:string;code:string;label:string;level:number;parent_id:string|null};
function ymd(d:Date){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function shift(days:number){const d=new Date();d.setDate(d.getDate()+days);return d;}
function fmtTime(v:any){if(!v)return '—';return new Date(v).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});}
// Summary boxes. Warm = Callback — pre-pitch (L0) + Callback — mid-pitch (L1 under Interested);
// mid-pitch callbacks count only in Warm, so the three boxes never overlap.
type Bucket=''|'interested'|'not_interested'|'warm';
function bucketOf(r:any):Bucket{
  if(r.l0_label_snapshot==='Callback — pre-pitch'||r.l1_label_snapshot==='Callback — mid-pitch')return 'warm';
  if(r.l0_label_snapshot==='Interested')return 'interested';
  if(r.l0_label_snapshot==='Not Interested')return 'not_interested';
  return '';
}
const BUCKETS:[Exclude<Bucket,''>,string,string][]=[['interested','Interested','All Interested outcomes, incl. Payment done'],['not_interested','Not Interested','All Not Interested outcomes'],['warm','Warm','Callback — pre-pitch + Callback — mid-pitch']];
function disposition(r:any){return [r.l0_label_snapshot,r.l1_label_snapshot,r.l2_label_snapshot].filter(Boolean).join(' → ')||'—';}

export default function DisposedLeads({nodes,me,onOpen}:{nodes:Node[];me:any;onOpen:(customerId:string)=>void}){
  const today=ymd(new Date());
  const [from,setFrom]=useState(ymd(shift(-6))),[to,setTo]=useState(today);
  const [agentId,setAgentId]=useState(String(me.id)),[agents,setAgents]=useState<any[]>([]);
  const [l0,setL0]=useState(''),[l1,setL1]=useState(''),[l2,setL2]=useState('');
  const [mode,setMode]=useState<'latest'|'all'>('latest'),[search,setSearch]=useState(''),[bucket,setBucket]=useState<Bucket>('');
  const [rows,setRows]=useState<any[]>([]),[truncated,setTruncated]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [adding,setAdding]=useState(false),[newId,setNewId]=useState(''),[newName,setNewName]=useState(''),[newPhone,setNewPhone]=useState('');
  const [addMsg,setAddMsg]=useState(''),[existingId,setExistingId]=useState(''),[saving,setSaving]=useState(false);

  const l0s=nodes.filter(n=>n.level===0);
  const l1s=nodes.filter(n=>n.level===1&&n.parent_id===l0);
  const l2s=nodes.filter(n=>n.level===2&&n.parent_id===l1);

  // Disposition filters run in the browser so the summary boxes always count the whole range.
  async function load(f=from,t=to,opts:{agentId?:string;mode?:string}={}){
    const qs=new URLSearchParams({from:f,to:t,agentId:opts.agentId??agentId,mode:opts.mode??mode});
    setFrom(f);setTo(t);setLoading(true);setError('');
    const r=await fetch('/api/leads?'+qs.toString(),{cache:'no-store'});
    const j=await r.json();
    setLoading(false);
    if(!r.ok){setError(j.error||'Could not load leads');return;}
    setRows(j.rows||[]);setAgents(j.agents||[]);setTruncated(Boolean(j.truncated));
  }
  useEffect(()=>{load();},[]);

  function preset(kind:'today'|'yesterday'|'7d'|'month'){
    const now=new Date();
    if(kind==='today')return load(today,today);
    if(kind==='yesterday'){const y=ymd(shift(-1));return load(y,y);}
    if(kind==='7d')return load(ymd(shift(-6)),today);
    return load(ymd(new Date(now.getFullYear(),now.getMonth(),1)),today);
  }

  const counts=useMemo(()=>{const c:any={interested:0,not_interested:0,warm:0};for(const r of rows){const b=bucketOf(r);if(b)c[b]++;}return c;},[rows]);
  const shown=useMemo(()=>{
    const q=search.trim().toLowerCase(),qd=q.replace(/\D/g,'');
    return rows.filter(r=>(!bucket||bucketOf(r)===bucket)
      &&(!l0||r.l0_id===l0)&&(!l1||r.l1_id===l1)&&(!l2||r.l2_id===l2)
      &&(!q||String(r.customer_id).includes(q)||String(r.name||'').toLowerCase().includes(q)||(qd.length>=4&&String(r.phone||'').replace(/\D/g,'').includes(qd))));
  },[rows,search,bucket,l0,l1,l2]);
  const multiAgent=agents.length>1;

  async function addLead(){
    setSaving(true);setAddMsg('');setExistingId('');
    const r=await fetch('/api/leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customerId:newId.trim(),name:newName,phone:newPhone})});
    const j=await r.json();
    setSaving(false);
    if(!r.ok){setAddMsg(j.error||'Could not add lead');if(j.existingCustomerId)setExistingId(String(j.existingCustomerId));return;}
    const id=String(j.customerId);
    setNewId('');setNewName('');setNewPhone('');setAdding(false);
    onOpen(id);
  }

  return <>
    <section className="card">
      <div className="leads-head"><div className="section-label">Disposed Leads</div><button className="primary" onClick={()=>{setAdding(!adding);setAddMsg('');setExistingId('');}}>{adding?'Close':'+ Add New Lead'}</button></div>
      {adding&&<div className="add-lead">
        <div className="form-grid">
          <label>Customer ID *<input value={newId} onChange={e=>setNewId(e.target.value.replace(/\D/g,''))} placeholder="Paytm customer ID"/></label>
          <label>Name<input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Optional"/></label>
          <label>Phone number<input value={newPhone} onChange={e=>setNewPhone(e.target.value)} placeholder="Optional"/></label>
        </div>
        <button className="primary" onClick={addLead} disabled={saving||!newId.trim()}>{saving?'Adding…':'Add Lead & Open'}</button>
        {addMsg&&<div className="error padtop">{addMsg} {existingId&&<button className="linkish" onClick={()=>onOpen(existingId)}>Open customer {existingId}</button>}</div>}
        <div className="note">If the customer ID or phone number is already in the system, you'll be taken to that customer instead. New leads are tagged External.</div>
      </div>}
      <div className="preset-row padtop"><button onClick={()=>preset('today')}>Today</button><button onClick={()=>preset('yesterday')}>Yesterday</button><button onClick={()=>preset('7d')}>Last 7 Days</button><button onClick={()=>preset('month')}>This Month</button></div>
      <div className="range-row">
        <label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        {multiAgent&&<label>Agent<select value={agentId} onChange={e=>{setAgentId(e.target.value);load(from,to,{agentId:e.target.value});}}>
          <option value="all">All {agents.length} agents</option>
          {agents.map(a=><option key={a.id} value={a.id}>{a.id===String(me.id)?`${a.name} (me)`:a.name}</option>)}
        </select></label>}
        <button className="primary" onClick={()=>load(from,to)} disabled={loading}>{loading?'Loading…':'Apply'}</button>
      </div>
      <div className="kpis bucket-tiles">{BUCKETS.map(([key,label,hint])=><button key={key} type="button" className={bucket===key?'active':''} title={hint} onClick={()=>{setBucket(bucket===key?'':key);setL0('');setL1('');setL2('');}}><b>{counts[key]}</b><span>{label}</span></button>)}</div>
      <div className="form-grid padtop">
        <label>Disposition (L0)<select value={l0} onChange={e=>{setL0(e.target.value);setL1('');setL2('');setBucket('');}}>
          <option value="">All dispositions</option>{l0s.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}
        </select></label>
        {l0&&l1s.length>0&&<label>L1 (optional)<select value={l1} onChange={e=>{setL1(e.target.value);setL2('');}}>
          <option value="">Any</option>{l1s.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}
        </select></label>}
        {l1&&l2s.length>0&&<label>L2 (optional)<select value={l2} onChange={e=>setL2(e.target.value)}>
          <option value="">Any</option>{l2s.map(n=><option key={n.id} value={n.id}>{n.label}</option>)}
        </select></label>}
        <label>Show<select value={mode} onChange={e=>{const m=e.target.value as 'latest'|'all';setMode(m);load(from,to,{mode:m});}}>
          <option value="latest">Latest disposition per lead</option><option value="all">Every call</option>
        </select></label>
        <label className="wide">Search<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, phone or customer ID"/></label>
      </div>
      {error&&<div className="error padtop">{error}</div>}
      <div className="note">{bucket?`Showing ${BUCKETS.find(b=>b[0]===bucket)![1]} · click the box again to clear · `:''}{shown.length} {mode==='latest'?'lead':'call'}{shown.length===1?'':'s'}{mode==='latest'?' · each lead shows its latest disposition in this date range, so the filter shows which bucket it is in now':''}{truncated?' · showing the latest 2,000 only; narrow the dates':''}</div>
    </section>
    <section className="card">
      {shown.length===0?<div className="empty">{loading?'Loading…':'No disposed leads for these filters.'}</div>:
      <div className="table-scroll"><table className="split leads-table"><thead><tr><th>Disposed</th><th>Customer ID</th><th>Name</th><th>Phone</th><th>Disposition</th><th>Plan</th><th>Remark</th><th>Callback</th>{multiAgent&&<th>Agent</th>}{mode==='latest'&&<th>Calls</th>}</tr></thead>
        <tbody>{shown.map(r=><tr key={r.id} className="clickable" onClick={()=>onOpen(String(r.customer_id))} title="Open on Home">
          <td>{fmtTime(r.event_time)}</td>
          <td>{r.customer_id}{r.external&&<span className="tag-external">External</span>}</td>
          <td>{r.name||'—'}</td>
          <td>{r.phone||'—'}</td>
          <td className="disp-cell">{disposition(r)}</td>
          <td>{r.plan_code?(PLANS as any)[r.plan_code]?.label||r.plan_code:'—'}</td>
          <td className="remark-cell">{r.remark||'—'}</td>
          <td>{r.callback_at?fmtTime(r.callback_at):'—'}</td>
          {multiAgent&&<td>{r.agent_name||'—'}</td>}
          {mode==='latest'&&<td>{r.calls_in_range}</td>}
        </tr>)}</tbody></table></div>}
    </section>
  </>;
}
