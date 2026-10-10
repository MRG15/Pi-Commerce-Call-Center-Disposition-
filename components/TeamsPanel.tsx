'use client';
import { useEffect,useState } from 'react';

// Teams view in Manage Access: Sales / Onboarding / CSM members, dated moves, incentive on/off,
// Sales structure, onboarding rotation and CSM allocation share.
type Team='sales'|'onboarding'|'csm';
const TEAM_LABEL:Record<Team,string>={sales:'Sales',onboarding:'Onboarding',csm:'CSM'};
const ROLE_LABEL:any={BDE:'BDE',SBDE:'SBDE',TL:'Team Lead'};
const fmt=(d?:string|null)=>d?new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'';

export default function TeamsPanel(){
 const [data,setData]=useState<any>(null),[team,setTeam]=useState<Team>('sales'),[msg,setMsg]=useState(''),[edit,setEdit]=useState<string>('');
 async function load(){const r=await fetch('/api/admin/teams',{cache:'no-store'});if(!r.ok)return;const j=await r.json();setData(j);setTeam(t=>j.manage[t]?t:(['sales','onboarding','csm'] as Team[]).find(x=>j.manage[x])||t);}
 useEffect(()=>{load();},[]);
 async function send(body:any){setMsg('');const r=await fetch('/api/admin/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({team,...body})});const j=await r.json().catch(()=>({}));if(!r.ok){setMsg(j.error||'Could not save');return false;}setEdit('');await load();return true;}
 if(!data)return null;
 const teams=(['sales','onboarding','csm'] as Team[]).filter(t=>data.manage[t]);
 const list:any[]=data.members[team]||[];
 const leads=data.members.sales.filter((m:any)=>m.role==='TL');
 // Sales: each Team Lead followed by their BDEs, then SBDEs, then anyone without a role.
 let rows=list;
 if(team==='sales'){
  const tl=list.filter(m=>m.role==='TL'), out:any[]=[];
  for(const l of tl){out.push(l);out.push(...list.filter(m=>m.role==='BDE'&&m.teamLeadId===l.id).map(m=>({...m,nested:true})));}
  rows=[...out,...list.filter(m=>m.role==='BDE'&&!tl.some(l=>l.id===m.teamLeadId)),...list.filter(m=>m.role==='SBDE'),...list.filter(m=>!m.role)];
 }
 const memberIds=new Set(list.map(m=>m.id));
 return <section className="card teams">
  <div className="teams-head"><div className="section-label">Teams</div>
   <div className="seg">{teams.map(t=><button key={t} className={team===t?'active':''} onClick={()=>{setTeam(t);setEdit('');setMsg('');}}>{TEAM_LABEL[t]} <span>{(data.members[t]||[]).filter((m:any)=>m.member).length}</span></button>)}</div>
   <button className="team-add" onClick={()=>setEdit(edit==='+add'?'':'+add')}>+ Add person</button></div>
  {edit==='+add'&&<Editor mode="add" team={team} today={data.today} people={data.people.filter((p:any)=>!memberIds.has(p.id))} leads={leads} onSave={send} onCancel={()=>setEdit('')}/>}
  {msg&&<div className="error">{msg}</div>}
  {rows.length===0?<div className="empty">No one on this team yet.</div>:<div className="team-list">{rows.map(m=><div key={m.id}>
   <div className={`team-row${m.nested?' nested':''}${m.member?'':' pending'}`}>
    <div className="team-who"><b>{m.name}</b>
     <span>{team==='sales'&&m.role?<>{ROLE_LABEL[m.role]}{m.role==='BDE'&&m.teamLead?` · ${m.teamLead}`:''} · </>:null}{m.member?`since ${fmt(m.since)}`:`joins ${fmt(m.upcoming?.date)}`}
      {m.upcoming&&m.member&&<em>{m.upcoming.member?` · incentive ${m.upcoming.incentive?'on':'off'} from ${fmt(m.upcoming.date)}`:` · leaves ${fmt(m.upcoming.date)}`}</em>}
      {m.upcomingRole&&<em> · {m.upcomingRole.role==='NONE'?'no role':ROLE_LABEL[m.upcomingRole.role]} from {fmt(m.upcomingRole.date)}</em>}</span></div>
    <div className="team-ctl">
     {team==='onboarding'&&m.member&&<label className="sw" title="Gets new cases in the rotation"><input type="checkbox" checked={m.rotation} onChange={e=>send({action:'rotation',agentId:m.id,on:e.target.checked})}/><span>New cases</span></label>}
     {team==='csm'&&m.member&&<label className="share" title="Share of new CSM merchants">Share<input type="number" min={0} max={100} defaultValue={m.share} onBlur={e=>{const v=Number(e.target.value);if(v!==m.share)send({action:'share',agentId:m.id,share:v});}}/>%</label>}
     {m.member&&<label className="sw" title="Earns this team's incentive (from today)"><input type="checkbox" checked={m.incentive} onChange={e=>send({action:'incentive',agentId:m.id,incentive:e.target.checked})}/><span>Incentive</span></label>}
     <button className="team-more" onClick={()=>setEdit(edit===m.id?'':m.id)}>{edit===m.id?'Close':'Change'}</button>
    </div>
   </div>
   {edit===m.id&&<Editor mode="change" team={team} today={data.today} member={m} leads={leads.filter((l:any)=>l.id!==m.id)} teams={(['sales','onboarding','csm'] as Team[]).filter(t=>t!==team&&data.manage[t])} onSave={send} onCancel={()=>setEdit('')}/>}
  </div>)}</div>}
  <div className="note">Changes start on the date you pick (today or later) and never alter earlier days. Moving someone opens the new team's workspace and incentive from that date, and closes the old ones; what they earned before stays.</div>
 </section>;
}

function Editor(p:any){
 const {mode,team,today,member,leads,teams=[],people=[]}=p;
 const actions:[string,string][]=mode==='add'?[['join','Add']]:[...(team==='sales'?[['role','Change role'] as [string,string]]:[]),...(teams.length?[['move','Move to team'] as [string,string]]:[]),['leave','Remove from team']];
 const [action,setAction]=useState(actions[0][0]),[agentId,setAgentId]=useState(member?.id||''),[toTeam,setToTeam]=useState<Team>(teams[0]||'sales'),[role,setRole]=useState('BDE'),[lead,setLead]=useState(''),[from,setFrom]=useState(today),[incentive,setIncentive]=useState(true),[busy,setBusy]=useState(false);
 const salesTarget=(action==='join'&&team==='sales')||action==='role'||(action==='move'&&toTeam==='sales');
 const ready=agentId&&from&&(!salesTarget||(role&&(role!=='BDE'||lead)));
 async function save(){setBusy(true);await p.onSave({action,agentId,toTeam,role:salesTarget?role:undefined,teamLeadId:salesTarget&&role==='BDE'?lead:undefined,from,incentive});setBusy(false);}
 return <div className="team-edit">
  {mode==='add'?<select value={agentId} onChange={e=>setAgentId(e.target.value)}><option value="">Person</option>{people.map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
   :<select value={action} onChange={e=>setAction(e.target.value)}>{actions.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
  {action==='move'&&<select value={toTeam} onChange={e=>setToTeam(e.target.value as Team)}>{teams.map((t:Team)=><option key={t} value={t}>{TEAM_LABEL[t]}</option>)}</select>}
  {salesTarget&&<select value={role} onChange={e=>setRole(e.target.value)}>{Object.entries(ROLE_LABEL).map(([v,l]:any)=><option key={v} value={v}>{l}</option>)}</select>}
  {salesTarget&&role==='BDE'&&<select value={lead} onChange={e=>setLead(e.target.value)}><option value="">Reports to</option>{leads.map((l:any)=><option key={l.id} value={l.id}>{l.name}</option>)}</select>}
  <label className="from">From<input type="date" min={today} value={from} onChange={e=>setFrom(e.target.value)}/></label>
  {(action==='join'||action==='move')&&<label className="sw"><input type="checkbox" checked={incentive} onChange={e=>setIncentive(e.target.checked)}/><span>Incentive</span></label>}
  <button className="primary" disabled={!ready||busy} onClick={save}>{busy?'Saving…':'Save'}</button><button className="team-more" onClick={p.onCancel}>Cancel</button>
 </div>;
}
