import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { pickOnboarder } from '@/lib/onboarding';

async function handoffState(customerId:string,user:any){
  const sql=db();
  const calls=await sql`
    SELECT id,customer_id,call_date,event_time,agent_id,agent_name_raw,l0_label_snapshot,l1_label_snapshot,l2_label_snapshot
    FROM calls WHERE customer_id=${customerId}
    ORDER BY attempt_number DESC LIMIT 1
  `;
  const latest:any=calls[0]||null;
  const eligible=Boolean(latest && (latest.l1_label_snapshot==='Payment done' || latest.l2_label_snapshot==='Enrolled via WhatsApp'));
  const open=await sql`SELECT id,assigned_to,current_status FROM onboarding_cases WHERE customer_id=${customerId} AND current_status='open' LIMIT 1`;
  const permitted=Boolean(latest && (latest.agent_id===user.id || isWorkspaceAdmin(user,'seller')));
  return {latest,eligible,permitted,existingCase:open[0]||null};
}

export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'seller')) return NextResponse.json({error:'Seller access required'},{status:403});
  const customerId=new URL(req.url).searchParams.get('customerId')?.trim()||'';
  if(!customerId) return NextResponse.json({error:'Customer ID required'},{status:400});
  const state=await handoffState(customerId,user);
  return NextResponse.json(state);
}

export async function POST(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'seller')) return NextResponse.json({error:'Seller access required'},{status:403});
  const body=await req.json(); const customerId=String(body.customerId||'').trim();
  if(!customerId) return NextResponse.json({error:'Customer ID required'},{status:400});
  const state:any=await handoffState(customerId,user);
  if(state.existingCase) return NextResponse.json({error:'This merchant is already with the onboarding team.',caseId:state.existingCase.id},{status:409});
  if(!state.eligible) return NextResponse.json({error:'Only Payment done or Enrolled via WhatsApp cases can be sent to onboarding.'},{status:400});
  if(!state.permitted) return NextResponse.json({error:'Only the seller who logged the conversion or a Seller Admin can hand this case off.'},{status:403});
  const assignee:any=await pickOnboarder(null);
  if(!assignee) return NextResponse.json({error:'No active onboarder is available yet.'},{status:400});
  const sql=db(); const latest=state.latest;
  const disposition=[latest.l0_label_snapshot,latest.l1_label_snapshot,latest.l2_label_snapshot].filter(Boolean).join(' → ');
  const rows=await sql`
    INSERT INTO onboarding_cases(customer_id,source_type,source_seller_call_id,source_seller_agent_id,source_seller_disposition,sale_date,assigned_to,assigned_at,created_by,last_activity_at)
    VALUES(${customerId},'seller_handoff',${latest.id}::uuid,${latest.agent_id}::uuid,${disposition},${latest.call_date},${assignee.id}::uuid,now(),${user.id}::uuid,now())
    RETURNING id
  `;
  const caseId=rows[0].id;
  await sql`
    INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_id,agent_name_raw,source_type,l0_code,l0_label_snapshot,remark)
    VALUES(${caseId}::uuid,${customerId},1,${user.id}::uuid,${user.name},'assignment','SELLER_HANDOFF','Seller handoff',${`Converted by ${latest.agent_name_raw||user.name}; auto-assigned to ${assignee.name}`})
  `;
  return NextResponse.json({ok:true,caseId,assignedTo:assignee},{status:201});
}
