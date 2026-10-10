import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { todayIst } from '@/lib/plans';
import { TEAMS,TEAM_WORKSPACE,applyDueTeamChanges,type Team } from '@/lib/teams';

// Teams view in Manage Access: who is on Sales / Onboarding / CSM, from which date, whether they
// earn that team's incentive, plus the Sales structure (BDE / SBDE / TL), onboarding rotation and
// CSM allocation share. Every membership or role change is dated (today or later, never earlier).

const SALES_ROLES=['BDE','SBDE','TL'];
const canManage=(user:any,team:Team)=>isWorkspaceAdmin(user,TEAM_WORKSPACE[team]);

export async function GET(){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const manage=Object.fromEntries(TEAMS.map(t=>[t,canManage(user,t)]));
  if(!TEAMS.some(t=>manage[t])) return NextResponse.json({error:'Admin access required'},{status:403});
  const sql=db(); const today=todayIst();
  const changes=await sql`
    SELECT t.agent_id,t.team,t.effective_from::text AS effective_from,t.member,t.incentive
    FROM team_changes t ORDER BY t.effective_from,t.id
  `;
  const roles=await sql`
    SELECT r.agent_id,r.role,r.team_lead_id,l.name AS team_lead_name,r.effective_from::text AS effective_from
    FROM seller_roles r LEFT JOIN agents l ON l.id=r.team_lead_id ORDER BY r.effective_from
  `;
  const people=await sql`SELECT id,name FROM agents WHERE active=TRUE ORDER BY name`;
  const rotation=await sql`SELECT agent_id FROM onboarding_roster`;
  const weights=await sql`SELECT agent_id,weight FROM csm_weights`;
  const inRotation=new Set(rotation.map((r:any)=>String(r.agent_id)));
  const weightOf=new Map(weights.map((w:any)=>[String(w.agent_id),Number(w.weight)]));
  const members:any={sales:[],onboarding:[],csm:[]};
  for(const p of people){
    const id=String(p.id);
    for(const team of TEAMS){
      const mine=changes.filter((c:any)=>String(c.agent_id)===id&&c.team===team);
      if(!mine.length) continue;
      const now=[...mine].reverse().find((c:any)=>c.effective_from<=today);
      const next=mine.find((c:any)=>c.effective_from>today);
      // "Since": start of the current unbroken membership.
      let since=null;
      if(now?.member){ since=now.effective_from; for(const c of [...mine].reverse()){ if(c.effective_from>today) continue; if(!c.member) break; since=c.effective_from; } }
      if(!now?.member&&!next?.member) continue;
      const row:any={id,name:p.name,member:Boolean(now?.member),since,incentive:Boolean(now?.incentive??next?.incentive),
        upcoming:next?{date:next.effective_from,member:next.member,incentive:next.incentive}:null};
      if(team==='sales'){
        const mineR=roles.filter((r:any)=>String(r.agent_id)===id);
        const r=[...mineR].reverse().find((x:any)=>x.effective_from<=today);
        const nr=mineR.find((x:any)=>x.effective_from>today);
        row.role=r&&r.role!=='NONE'?r.role:null; row.teamLeadId=r?.team_lead_id?String(r.team_lead_id):null; row.teamLead=r?.team_lead_name||null;
        if(nr) row.upcomingRole={date:nr.effective_from,role:nr.role,teamLead:nr.team_lead_name||null};
      }
      if(team==='onboarding') row.rotation=inRotation.has(id);
      if(team==='csm') row.share=weightOf.get(id)??0;
      members[team].push(row);
    }
  }
  return NextResponse.json({today,manage,members,people:people.map((p:any)=>({id:String(p.id),name:p.name}))});
}

export async function POST(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const b=await req.json().catch(()=>({}));
  const action=String(b.action||''); const agentId=String(b.agentId||''); const today=todayIst();
  const date=String(b.from||today);
  const team=String(b.team||'') as Team; const toTeam=String(b.toTeam||'') as Team;
  if(!agentId) return NextResponse.json({error:'Choose a person.'},{status:400});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({error:'Invalid date.'},{status:400});
  if(date<today) return NextResponse.json({error:'The date cannot be in the past; earlier days are never changed.'},{status:400});
  const teamsTouched=[team,toTeam].filter(t=>TEAMS.includes(t));
  if(!teamsTouched.length) return NextResponse.json({error:'Choose a team.'},{status:400});
  for(const t of teamsTouched) if(!canManage(user,t)) return NextResponse.json({error:`Admin access to ${t==='sales'?'Sales':t==='csm'?'CSM':'Onboarding'} is required.`},{status:403});
  const sql=db();
  const role=String(b.role||''); const teamLeadId=b.teamLeadId?String(b.teamLeadId):null;

  const salesRole=async(tx:any,r:string,lead:string|null)=>{
    if(r!=='NONE'&&!SALES_ROLES.includes(r)) throw new Error('ROLE');
    if(r==='BDE'){
      if(!lead) throw new Error('LEAD');
      if(lead===agentId) throw new Error('SELF_LEAD');
      const l=await tx`SELECT role FROM seller_roles WHERE agent_id=${lead}::uuid AND effective_from<=${date}::date ORDER BY effective_from DESC LIMIT 1`;
      if(l[0]?.role!=='TL') throw new Error('NOT_TL');
    }
    await tx`
      INSERT INTO seller_roles(agent_id,role,team_lead_id,effective_from,created_by)
      VALUES(${agentId}::uuid,${r},${r==='BDE'?lead:null},${date}::date,${user.id}::uuid)
      ON CONFLICT (agent_id,effective_from) DO UPDATE SET role=EXCLUDED.role,team_lead_id=EXCLUDED.team_lead_id,created_by=EXCLUDED.created_by,created_at=now()
    `;
  };
  const change=async(tx:any,t:Team,member:boolean,incentive:boolean)=>{
    await tx`
      INSERT INTO team_changes(agent_id,team,effective_from,member,incentive,created_by)
      VALUES(${agentId}::uuid,${t},${date}::date,${member},${incentive},${user.id}::uuid)
      ON CONFLICT (agent_id,team,effective_from) DO UPDATE SET member=EXCLUDED.member,incentive=EXCLUDED.incentive,applied_at=NULL,created_by=EXCLUDED.created_by,created_at=now()
    `;
  };
  const incentiveOn=b.incentive===undefined?true:Boolean(b.incentive);

  try{
    await sql.begin(async(tx:any)=>{
      if(action==='join'){
        if(team==='sales') await salesRole(tx,role,teamLeadId);
        await change(tx,team,true,incentiveOn);
      }else if(action==='leave'){
        if(team==='sales') await salesRole(tx,'NONE',null);
        await change(tx,team,false,false);
      }else if(action==='move'){
        if(!TEAMS.includes(toTeam)||toTeam===team) throw new Error('TEAM');
        if(team==='sales') await salesRole(tx,'NONE',null);
        await change(tx,team,false,false);
        if(toTeam==='sales') await salesRole(tx,role,teamLeadId);
        await change(tx,toTeam,true,incentiveOn);
      }else if(action==='incentive'){
        await change(tx,team,true,Boolean(b.incentive));
      }else if(action==='role'){
        if(team!=='sales') throw new Error('TEAM');
        await salesRole(tx,role,teamLeadId);
      }else if(action==='rotation'){
        if(team!=='onboarding') throw new Error('TEAM');
        if(b.on) await tx`INSERT INTO onboarding_roster(agent_id) VALUES(${agentId}::uuid) ON CONFLICT (agent_id) DO NOTHING`;
        else await tx`DELETE FROM onboarding_roster WHERE agent_id=${agentId}::uuid`;
      }else if(action==='share'){
        if(team!=='csm') throw new Error('TEAM');
        const w=Math.round(Number(b.share));
        if(!Number.isFinite(w)||w<0||w>100) throw new Error('SHARE');
        await tx`
          INSERT INTO csm_weights(agent_id,weight,updated_by,updated_at) VALUES(${agentId}::uuid,${w},${user.id}::uuid,now())
          ON CONFLICT (agent_id) DO UPDATE SET weight=EXCLUDED.weight,updated_by=EXCLUDED.updated_by,updated_at=now()
        `;
      }else throw new Error('ACTION');
    });
  }catch(e:any){
    const map:any={ROLE:'Choose BDE, SBDE or Team Lead.',LEAD:'Choose the Team Lead this BDE reports to.',SELF_LEAD:'A BDE cannot report to themselves.',
      NOT_TL:'The selected Team Lead is not a Team Lead on that date.',TEAM:'Invalid team for this change.',SHARE:'Share must be between 0 and 100.',ACTION:'Unknown action.'};
    const m=map[String(e?.message||'')]; if(m) return NextResponse.json({error:m},{status:400});
    console.error('teams change error',e);
    return NextResponse.json({error:'Could not save the change.'},{status:500});
  }
  // Changes dated today take effect straight away.
  if(date===today) await applyDueTeamChanges(sql,true);
  return NextResponse.json({ok:true});
}
