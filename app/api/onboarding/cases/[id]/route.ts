import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { pickOnboarder,nextOnboardingAttempt } from '@/lib/onboarding';

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'onboarding')) return NextResponse.json({error:'Onboarding access required'},{status:403});
  const {id}=await params; const sql=db();
  const rows=await sql`
    SELECT c.*,a.name AS assigned_name,m.merchant_name,m.phone_number,m.category,m.sub_category
    FROM onboarding_cases c
    LEFT JOIN agents a ON a.id=c.assigned_to
    LEFT JOIN merchant_information m ON m.customer_id=c.customer_id AND m.active=TRUE
    WHERE c.id=${id}::uuid LIMIT 1
  `;
  const c:any=rows[0];
  if(!c) return NextResponse.json({error:'Case not found'},{status:404});
  if(!isWorkspaceAdmin(user,'onboarding') && c.assigned_to!==user.id) return NextResponse.json({error:'This case is assigned to another onboarder.'},{status:403});
  const events=await sql`
    SELECT e.*,a.name AS agent_name
    FROM onboarding_events e LEFT JOIN agents a ON a.id=e.agent_id
    WHERE e.onboarding_case_id=${id}::uuid ORDER BY e.attempt_number ASC
  `;
  const technicalCases=await sql`
    SELECT t.*,a.name AS assigned_name,o.name AS opened_by_name,r.name AS resolved_by_name
    FROM technical_cases t
    LEFT JOIN agents a ON a.id=t.assigned_to
    LEFT JOIN agents o ON o.id=t.opened_by
    LEFT JOIN agents r ON r.id=t.resolved_by
    WHERE t.onboarding_case_id=${id}::uuid ORDER BY t.opened_at DESC
  `;
  return NextResponse.json({case:c,events,technicalCases,canManage:isWorkspaceAdmin(user,'onboarding')});
}

export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!isWorkspaceAdmin(user,'onboarding')) return NextResponse.json({error:'Onboarding admin access required'},{status:403});
  const {id}=await params; const body=await req.json(); const sql=db();
  const current=await sql`SELECT customer_id FROM onboarding_cases WHERE id=${id}::uuid LIMIT 1`;
  if(!current[0]) return NextResponse.json({error:'Case not found'},{status:404});
  if(body.assignedTo!==undefined){
    const assignee:any=await pickOnboarder(body.assignedTo?String(body.assignedTo):null);
    if(!assignee) return NextResponse.json({error:'Selected onboarder is not active.'},{status:400});
    await sql`UPDATE onboarding_cases SET assigned_to=${assignee.id}::uuid,assigned_at=now(),updated_at=now() WHERE id=${id}::uuid`;
    const attempt=await nextOnboardingAttempt(id);
    await sql`
      INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_id,agent_name_raw,source_type,l0_code,l0_label_snapshot,remark)
      VALUES(${id}::uuid,${current[0].customer_id},${attempt},${user.id}::uuid,${user.name},'assignment','SYSTEM_REASSIGNED','Reassigned',${`Reassigned to ${assignee.name}`})
    `;
    return NextResponse.json({ok:true,assignedTo:assignee});
  }
  return NextResponse.json({error:'No supported update supplied.'},{status:400});
}
