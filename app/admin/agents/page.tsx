'use client';
import { useEffect,useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AgentsPage(){
  const router=useRouter(); const [me,setMe]=useState<any>(null); const [agents,setAgents]=useState<any[]>([]); const [name,setName]=useState(''); const [username,setUsername]=useState(''); const [password,setPassword]=useState(''); const [role,setRole]=useState('agent'); const [msg,setMsg]=useState('');
  async function load(){const r=await fetch('/api/admin/agents');if(r.ok)setAgents((await r.json()).agents)}
  useEffect(()=>{(async()=>{const m=await fetch('/api/auth/me');if(!m.ok){router.replace('/login');return;}const a=(await m.json()).agent;if(a.role!=='admin'){router.replace('/');return;}setMe(a);await load();})();},[]);
  async function create(){setMsg('');const r=await fetch('/api/admin/agents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,username,password,role})});const j=await r.json();if(!r.ok){setMsg(j.error||'Could not create');return;}setName('');setUsername('');setPassword('');setRole('agent');setMsg('Agent created.');await load();}
  async function toggle(a:any){await fetch('/api/admin/agents',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:a.id,active:!a.active})});await load();}
  async function reset(a:any){const p=prompt(`Enter a new password for ${a.name} (min 8 chars)`);if(!p)return;const r=await fetch('/api/admin/agents',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:a.id,password:p})});const j=await r.json();alert(r.ok?'Password updated.':j.error||'Could not update password');}
  if(!me)return <div className="center">Loading…</div>;
  return <div className="app-shell"><header><div><strong>Pi Commerce</strong><span> · Manage Agents</span></div><div className="header-actions"><a href="/">Agent Console</a><a href="/analytics">Analytics</a><span className="badge">{me.name}</span></div></header><main>
    <section className="card"><div className="section-label">Create Agent</div><div className="form-grid"><label>Name<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Username<input value={username} onChange={e=>setUsername(e.target.value.toLowerCase())}/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label><label>Role<select value={role} onChange={e=>setRole(e.target.value)}><option value="agent">Agent</option><option value="admin">Admin</option></select></label></div><button className="primary" onClick={create} disabled={!name||!username||password.length<8}>Create Agent</button>{msg&&<div className="note">{msg}</div>}</section>
    <section className="card"><div className="section-label">Existing Agents</div><table className="split"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{agents.map(a=><tr key={a.id}><td>{a.name}</td><td>{a.username}</td><td>{a.role}</td><td>{a.active?'Active':'Inactive'}</td><td><button onClick={()=>reset(a)}>Reset password</button> <button onClick={()=>toggle(a)}>{a.active?'Deactivate':'Activate'}</button></td></tr>)}</tbody></table></section>
  </main></div>
}
