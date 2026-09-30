'use client';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';

const sellerOptions=[['','No Access'],['agent','Agent'],['admin','Admin']];
const onboardingOptions=[['','No Access'],['agent','Agent'],['customer_success','Customer Success'],['admin','Admin']];
export default function AccessPage(){
 const router=useRouter(); const [me,setMe]=useState<any>(null); const [agents,setAgents]=useState<any[]>([]); const [manage,setManage]=useState<any>(null); const [msg,setMsg]=useState('');
 const [name,setName]=useState(''),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[seller,setSeller]=useState(''),[onboarding,setOnboarding]=useState(''),[superAdmin,setSuperAdmin]=useState(false);
 async function load(){const r=await fetch('/api/admin/access',{cache:'no-store'});if(!r.ok)return;const j=await r.json();setAgents(j.agents||[]);setManage(j.manage);}
 useEffect(()=>{(async()=>{const r=await fetch('/api/auth/access');if(!r.ok){router.replace('/login');return;}const u=(await r.json()).user;setMe(u);await load();})();},[]);
 async function create(){setMsg('');const r=await fetch('/api/admin/access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,username,password,sellerAccess:seller||null,onboardingAccess:onboarding||null,isSuperAdmin:superAdmin})});const j=await r.json();if(!r.ok){setMsg(j.error||'Could not create user');return;}setName('');setUsername('');setPassword('');setSeller('');setOnboarding('');setSuperAdmin(false);setMsg('User created.');await load();}
 async function patch(id:string,field:string,value:any){setMsg('');const r=await fetch('/api/admin/access',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id,[field]:value})});const j=await r.json();if(!r.ok){setMsg(j.error||'Could not update access');return;}await load();}
 if(!me||!manage)return <div className="center">Loading…</div>;
 return <div className="app-shell"><header><div><strong>Pi Commerce</strong><span> · Access</span></div><div className="header-actions">{me.access?.seller&&<a href="/">Seller Workspace</a>}{me.access?.onboarding&&<a href="/onboarding">Onboarding Workspace</a>}<span className="badge">{me.name}</span></div></header><main>
 <section className="card"><div className="section-label">Create User</div><div className="form-grid"><label>Name<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Username<input value={username} onChange={e=>setUsername(e.target.value.toLowerCase())}/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label>{manage.seller&&<label>Seller Workspace<select value={seller} onChange={e=>setSeller(e.target.value)}>{sellerOptions.map(([v,l])=><option value={v} key={l}>{l}</option>)}</select></label>}{manage.onboarding&&<label>Onboarding Workspace<select value={onboarding} onChange={e=>setOnboarding(e.target.value)}>{onboardingOptions.map(([v,l])=><option value={v} key={l}>{l}</option>)}</select></label>}{manage.global&&<label className="toggle-label"><span>Super Admin</span><input type="checkbox" checked={superAdmin} onChange={e=>setSuperAdmin(e.target.checked)}/></label>}</div><button className="primary" onClick={create} disabled={!name||!username||password.length<8}>Create User</button>{msg&&<div className="note">{msg}</div>}</section>
 <section className="card"><div className="section-label">Users & Workspace Access</div><div className="access-list">{agents.map(a=><div className="access-row" key={a.id}><div className="access-person"><b>{a.name}</b><span>{a.username} · {a.active?'Active':'Inactive'}</span></div>{manage.seller&&<label>Seller<select value={a.seller_access||''} onChange={e=>patch(a.id,'sellerAccess',e.target.value||null)}>{sellerOptions.map(([v,l])=><option value={v} key={l}>{l}</option>)}</select></label>}{manage.onboarding&&<label>Onboarding<select value={a.onboarding_access||''} onChange={e=>patch(a.id,'onboardingAccess',e.target.value||null)}>{onboardingOptions.map(([v,l])=><option value={v} key={l}>{l}</option>)}</select></label>}{manage.global&&<label className="mini-check">Super Admin<input type="checkbox" checked={Boolean(a.is_super_admin)} onChange={e=>patch(a.id,'isSuperAdmin',e.target.checked)}/></label>}<button onClick={()=>patch(a.id,'active',!a.active)}>{a.active?'Deactivate':'Activate'}</button></div>)}</div></section>
 {manage.seller&&<SellerTeams/>}
 </main></div>;
}

const roleLabels:any={BDE:'BDE',SBDE:'SBDE',TL:'Team Lead',NONE:'Not on team plan'};
function SellerTeams(){
 const [data,setData]=useState<any>(null),[msg,setMsg]=useState(''),[agentId,setAgentId]=useState(''),[role,setRole]=useState('BDE'),[lead,setLead]=useState(''),[from,setFrom]=useState('');
 async function load(){const r=await fetch('/api/admin/seller-roles',{cache:'no-store'});if(!r.ok)return;const j=await r.json();setData(j);setFrom(f=>f||j.today);}
 useEffect(()=>{load();},[]);
 if(!data)return null;
 const today=data.today;
 const current=new Map<string,any>();
 for(const h of [...data.history].reverse()) if(h.effective_from<=today) current.set(h.agent_id,h);
 const leadOn=(date:string)=>{const m=new Map<string,any>();for(const h of [...data.history].reverse()) if(h.effective_from<=date) m.set(h.agent_id,h);return [...m.values()].filter((h:any)=>h.role==='TL');};
 const leads=leadOn(from||today);
 async function save(){setMsg('');const r=await fetch('/api/admin/seller-roles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({agentId,role,teamLeadId:role==='BDE'?lead:null,effectiveFrom:from})});const j=await r.json();if(!r.ok){setMsg(j.error||'Could not save');return;}setMsg('Saved.');setAgentId('');setLead('');await load();}
 return <section className="card"><div className="section-label">Seller Team Structure</div>
  <table className="split"><thead><tr><th>Seller</th><th>Role today</th><th>Team Lead</th><th>Since</th></tr></thead><tbody>{data.sellers.map((a:any)=>{const c=current.get(a.id);return <tr key={a.id}><td>{a.name}</td><td>{c?roleLabels[c.role]:'—'}</td><td>{c?.team_lead_name||'—'}</td><td>{c?.effective_from||'—'}</td></tr>;})}</tbody></table>
  <div className="form-grid padtop"><label>Seller<select value={agentId} onChange={e=>setAgentId(e.target.value)}><option value="">Select</option>{data.sellers.map((a:any)=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Role<select value={role} onChange={e=>setRole(e.target.value)}>{Object.entries(roleLabels).map(([v,l]:any)=><option key={v} value={v}>{l}</option>)}</select></label>{role==='BDE'&&<label>Reports to (Team Lead)<select value={lead} onChange={e=>setLead(e.target.value)}><option value="">Select</option>{leads.map((l:any)=><option key={l.agent_id} value={l.agent_id}>{l.name}</option>)}</select></label>}<label>Effective from<input type="date" min={today} value={from} onChange={e=>setFrom(e.target.value)}/></label></div>
  <button className="primary" onClick={save} disabled={!agentId||!from||(role==='BDE'&&!lead)}>Save Change</button>{msg&&<div className="note">{msg}</div>}
  <div className="note">A change applies from its effective date and never re-prices earlier weeks. Weekly incentives use each person's role and team as on the first day of that week, so a mid-week change applies from the next week.</div>
  {data.history.length>0&&<table className="split padtop"><thead><tr><th>Effective from</th><th>Seller</th><th>Role</th><th>Team Lead</th><th>Changed by</th></tr></thead><tbody>{data.history.map((h:any)=><tr key={h.id}><td>{h.effective_from}</td><td>{h.name}</td><td>{roleLabels[h.role]}</td><td>{h.team_lead_name||'—'}</td><td>{h.created_by_name||'—'}</td></tr>)}</tbody></table>}
 </section>;
}
