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
  if(ws==='seller'){
    if(!canAccess(user,'seller')) return NextResponse.json({error:'Seller access required'},{status:403});
    const all=isWorkspaceAdmin(user,'seller');
    const rows=await sql`
      SELECT m.id,m.customer_id,m.lead_id,m.phone,m.template,m.clicked_at,m.click_count,COALESCE(mi.merchant_name,c.merchant_name,lg.name,m.variables->>'business_name') AS merchant_name,a.name AS owner,
        m.variables->>'stage' AS stage,m.variables->>'reason' AS reason,m.variables->>'repeat' AS repeat
      FROM wa_messages m LEFT JOIN merchant_information mi ON mi.customer_id=m.customer_id LEFT JOIN customers c ON c.customer_id=m.customer_id
      LEFT JOIN leadgen_leads lg ON lg.id=m.lead_id LEFT JOIN agents a ON a.id=m.agent_id
      WHERE m.workspace='seller' AND m.clicked_at IS NOT NULL AND m.resolved_at IS NULL AND (${all} OR m.agent_id=${user.id}::uuid)
      ORDER BY m.clicked_at DESC LIMIT 100
    `;
    return NextResponse.json({requests:rows});
  }
  if(ws==='onboarding'){
    if(!canAccess(user,'onboarding')) return NextResponse.json({error:'Onboarding access required'},{status:403});
    const all=isWorkspaceAdmin(user,'onboarding');
    const rows=await sql`
      SELECT m.id,m.customer_id,m.phone,m.template,m.clicked_at,m.click_count,oc.id AS case_id,COALESCE(mi.merchant_name,cu.merchant_name,m.variables->>'business_name') AS merchant_name,a.name AS owner,
        m.variables->>'reason' AS reason,m.variables->>'stage' AS stage,m.variables->>'repeat' AS repeat
      FROM wa_messages m
      -- Voice AI handoffs and Paytm callback requests with no matching case still show (to admins) as unmatched.
      LEFT JOIN LATERAL (SELECT id,assigned_to FROM onboarding_cases WHERE customer_id=m.customer_id ORDER BY created_at LIMIT 1) oc ON TRUE
      LEFT JOIN merchant_information mi ON mi.customer_id=m.customer_id LEFT JOIN customers cu ON cu.customer_id=m.customer_id
      LEFT JOIN agents a ON a.id=CASE WHEN m.template='PAYTM_CALLBACK' THEN m.agent_id ELSE oc.assigned_to END
      WHERE m.workspace='onboarding' AND m.clicked_at IS NOT NULL AND m.resolved_at IS NULL AND (oc.id IS NOT NULL OR m.template IN ('VOICE_AI_HANDOFF','PAYTM_CALLBACK'))
        -- Paytm callback requests go to the person picked at sync time (case owner / last caller / rotation).
        AND (${all} OR (CASE WHEN m.template='PAYTM_CALLBACK' THEN m.agent_id ELSE oc.assigned_to END)=${user.id}::uuid)
      ORDER BY m.clicked_at DESC LIMIT 100
    `;
    return NextResponse.json({requests:rows});
  }
  if(ws==='csm'){
    const role=csmRole(user);
    if(!role) return NextResponse.json({error:'CSM access required'},{status:403});
    const all=role==='admin';
    const rows=await sql`
      SELECT m.id,m.customer_id,m.phone,m.template,m.clicked_at,m.click_count,COALESCE(mi.merchant_name,cu.merchant_name,m.variables->>'business_name') AS merchant_name,a.name AS owner,
        m.variables->>'stage' AS stage,m.variables->>'reason' AS reason,m.variables->>'repeat' AS repeat
      FROM wa_messages m LEFT JOIN csm_assignments ca ON ca.customer_id=m.customer_id
      LEFT JOIN merchant_information mi ON mi.customer_id=m.customer_id LEFT JOIN customers cu ON cu.customer_id=m.customer_id
      LEFT JOIN agents a ON a.id=CASE WHEN m.template='PAYTM_CALLBACK' THEN m.agent_id ELSE ca.agent_id END
      WHERE m.workspace='csm' AND m.clicked_at IS NOT NULL AND m.resolved_at IS NULL
        AND (${all} OR (CASE WHEN m.template='PAYTM_CALLBACK' THEN m.agent_id ELSE ca.agent_id END)=${user.id}::uuid)
      ORDER BY m.clicked_at DESC LIMIT 100
    `;
    return NextResponse.json({requests:rows});
  }
  return NextResponse.json({error:'Unknown workspace'},{status:400});
}
