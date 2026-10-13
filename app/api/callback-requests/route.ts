import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { csmRole } from '@/lib/csm';

// Open "Request a callback" clicks for a workspace's Req Call Back pane.
//   seller      — the seller who logged the disposition that sent the message
//   onboarding  — the onboarder who owns the merchant's case now
//   csm         — the merchant's assigned CSM
// Workspace admins see every open request in their workspace.
export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const ws=new URL(req.url).searchParams.get('workspace')||'';
  const sql=db();
  const ok=await sql`SELECT to_regclass('public.wa_messages') IS NOT NULL AS ok`;
  if(!ok[0]?.ok) return NextResponse.json({requests:[]});
  if(ws==='seller'){
    if(!canAccess(user,'seller')) return NextResponse.json({error:'Seller access required'},{status:403});
    const all=isWorkspaceAdmin(user,'seller');
    const rows=await sql`
      SELECT m.id,m.customer_id,m.template,m.clicked_at,m.click_count,COALESCE(mi.merchant_name,c.merchant_name) AS merchant_name,a.name AS owner
      FROM wa_messages m LEFT JOIN merchant_information mi ON mi.customer_id=m.customer_id LEFT JOIN customers c ON c.customer_id=m.customer_id LEFT JOIN agents a ON a.id=m.agent_id
      WHERE m.workspace='seller' AND m.clicked_at IS NOT NULL AND m.resolved_at IS NULL AND (${all} OR m.agent_id=${user.id}::uuid)
      ORDER BY m.clicked_at DESC LIMIT 100
    `;
    return NextResponse.json({requests:rows});
  }
  if(ws==='onboarding'){
    if(!canAccess(user,'onboarding')) return NextResponse.json({error:'Onboarding access required'},{status:403});
    const all=isWorkspaceAdmin(user,'onboarding');
    const rows=await sql`
      SELECT m.id,m.customer_id,m.template,m.clicked_at,m.click_count,oc.id AS case_id,COALESCE(mi.merchant_name,cu.merchant_name) AS merchant_name,a.name AS owner
      FROM wa_messages m
      JOIN LATERAL (SELECT id,assigned_to FROM onboarding_cases WHERE customer_id=m.customer_id ORDER BY created_at LIMIT 1) oc ON TRUE
      LEFT JOIN merchant_information mi ON mi.customer_id=m.customer_id LEFT JOIN customers cu ON cu.customer_id=m.customer_id LEFT JOIN agents a ON a.id=oc.assigned_to
      WHERE m.workspace='onboarding' AND m.clicked_at IS NOT NULL AND m.resolved_at IS NULL AND (${all} OR oc.assigned_to=${user.id}::uuid)
      ORDER BY m.clicked_at DESC LIMIT 100
    `;
    return NextResponse.json({requests:rows});
  }
  if(ws==='csm'){
    const role=csmRole(user);
    if(!role) return NextResponse.json({error:'CSM access required'},{status:403});
    const all=role==='admin';
    const rows=await sql`
      SELECT m.id,m.customer_id,m.template,m.clicked_at,m.click_count,COALESCE(mi.merchant_name,cu.merchant_name) AS merchant_name,a.name AS owner
      FROM wa_messages m LEFT JOIN csm_assignments ca ON ca.customer_id=m.customer_id
      LEFT JOIN merchant_information mi ON mi.customer_id=m.customer_id LEFT JOIN customers cu ON cu.customer_id=m.customer_id LEFT JOIN agents a ON a.id=ca.agent_id
      WHERE m.workspace='csm' AND m.clicked_at IS NOT NULL AND m.resolved_at IS NULL AND (${all} OR ca.agent_id=${user.id}::uuid)
      ORDER BY m.clicked_at DESC LIMIT 100
    `;
    return NextResponse.json({requests:rows});
  }
  return NextResponse.json({error:'Unknown workspace'},{status:400});
}
