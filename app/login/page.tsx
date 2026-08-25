'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login(){
  const [username,setUsername]=useState(''); const [password,setPassword]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false); const router=useRouter();
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError(''); const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})}); const j=await r.json(); setBusy(false); if(!r.ok){setError(j.error||'Login failed');return;} router.push('/'); router.refresh();}
  return <div className="login-wrap"><form className="login-card" onSubmit={submit}><div className="brand">Pi Commerce</div><div className="sub">Disposition Platform · Agent Login</div><label>Username</label><input value={username} onChange={e=>setUsername(e.target.value)} autoFocus/><label>Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)}/><button disabled={busy}>{busy?'Signing in…':'Login'}</button>{error&&<div className="error">{error}</div>}</form></div>
}
