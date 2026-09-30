import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { todayIst } from '@/lib/plans';

const ROLES=['BDE','SBDE','TL','NONE'];

async function guard(){
  const user:any=await currentUserAccess();
  if(!user) return {res:NextResponse.json({error:'Unauthenticated'},{status:401})};
  if(!isWorkspaceAdmin(user,'seller')) return {res:NextResponse.json({error:'Seller Admin access required'},{status:403})};
  return {user};
}

export async function GET(){
  const g:any=await guard(); if(g.res) return g.res;
  const sql=db();
  const history=await sql`
    SELECT r.id,r.agent_id,a.name,r.role,r.team_lead_id,l.name AS team_lead_name,r.effective_from::text AS effective_from,c.name AS created_by_name,r.created_at
    FROM seller_roles r JOIN agents a ON a.id=r.agent_id LEFT JOIN agents l ON l.id=r.team_lead_id LEFT JOIN agents c ON c.id=r.created_by
    ORDER BY r.effective_from DESC,a.name
  `;
  const sellers=await sql`
    SELECT a.id,a.name FROM agents a JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='seller'
    WHERE a.active=TRUE ORDER BY a.name
  `;
  return NextResponse.json({history,sellers,today:todayIst()});
}

// Adds a role change from a date. Past dates are refused so earlier weeks are never re-priced.
export async function POST(req:Request){
  const g:any=await guard(); if(g.res) return g.res;
  const body=await req.json();
  const agentId=String(body.agentId||''); const role=String(body.role||''); const effectiveFrom=String(body.effectiveFrom||'');
  const teamLeadId=role==='BDE'&&body.teamLeadId?String(body.teamLeadId):null;
  if(!agentId||!ROLES.includes(role)||!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return NextResponse.json({error:'Person, role and effective date are required.'},{status:400});
  if(effectiveFrom<todayIst()) return NextResponse.json({error:'Effective date cannot be in the past; earlier weeks are never re-priced.'},{status:400});
  if(role==='BDE'&&!teamLeadId) return NextResponse.json({error:'Choose the Team Lead this BDE reports to.'},{status:400});
  if(teamLeadId===agentId) return NextResponse.json({error:'A BDE cannot report to themselves.'},{status:400});
  const sql=db();
  if(teamLeadId){
    const lead=await sql`
      SELECT role FROM seller_roles WHERE agent_id=${teamLeadId}::uuid AND effective_from<=${effectiveFrom}::date
      ORDER BY effective_from DESC LIMIT 1
    `;
    if(lead[0]?.role!=='TL') return NextResponse.json({error:'The selected Team Lead is not a TL on that date.'},{status:400});
  }
  await sql`
    INSERT INTO seller_roles(agent_id,role,team_lead_id,effective_from,created_by)
    VALUES(${agentId}::uuid,${role},${teamLeadId},${effectiveFrom}::date,${g.user.id}::uuid)
    ON CONFLICT (agent_id,effective_from) DO UPDATE
    SET role=EXCLUDED.role,team_lead_id=EXCLUDED.team_lead_id,created_by=EXCLUDED.created_by,created_at=now()
  `;
  return NextResponse.json({ok:true});
}
