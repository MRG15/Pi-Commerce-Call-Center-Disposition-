import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { pickOnboarder } from '@/lib/onboarding';

export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'onboarding')) return NextResponse.json({error:'Onboarding access required'},{status:403});
  const url=new URL(req.url);
  const scope=url.searchParams.get('scope')||'open';
  const sql=db();
  const all=isWorkspaceAdmin(user,'onboarding');
  const cases=await sql`
    SELECT c.id,c.customer_id,c.source_type,c.sale_date,c.assigned_to,c.assigned_at,c.current_l0,c.current_l1,c.current_l2,
      c.current_status,c.next_callback_at,c.last_activity_at,c.ads_live_at,c.closed_at,c.created_at,c.updated_at,
      a.name AS assigned_name,
      m.merchant_name,m.phone_number,m.category,m.sub_category,
      GREATEST(0,((now() AT TIME ZONE 'Asia/Kolkata')::date-COALESCE(c.sale_date,(c.created_at AT TIME ZONE 'Asia/Kolkata')::date)))::int AS days_since_sale,
      CASE WHEN c.last_activity_at IS NULL THEN NULL ELSE GREATEST(0,((now() AT TIME ZONE 'Asia/Kolkata')::date-(c.last_activity_at AT TIME ZONE 'Asia/Kolkata')::date))::int END AS days_since_last_activity,
      (SELECT COUNT(*)::int FROM onboarding_events e WHERE e.onboarding_case_id=c.id AND e.source_type IN ('new_event','historical_import')) AS touches,
      EXISTS(SELECT 1 FROM technical_cases t WHERE t.onboarding_case_id=c.id AND t.status='open') AS has_open_technical
    FROM onboarding_cases c
    LEFT JOIN agents a ON a.id=c.assigned_to
    LEFT JOIN merchant_information m ON m.customer_id=c.customer_id AND m.active=TRUE
    WHERE (${all} OR c.assigned_to=${user.id}::uuid)
      AND (${scope}='all' OR c.current_status='open')
    ORDER BY
      CASE WHEN c.current_status='open' AND c.next_callback_at IS NOT NULL AND c.next_callback_at < now() THEN 0 ELSE 1 END,
      CASE WHEN c.current_status='open' AND c.last_activity_at IS NULL THEN 0 ELSE 1 END,
      COALESCE(c.last_activity_at,c.created_at) ASC
  `;
  return NextResponse.json({cases,canManage:all});
}

export async function POST(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!isWorkspaceAdmin(user,'onboarding')) return NextResponse.json({error:'Onboarding admin access required'},{status:403});
  const body=await req.json();
  const customerId=String(body.customerId||'').trim();
  if(!/^\d+$/.test(customerId)) return NextResponse.json({error:'A numeric customer ID is required.'},{status:400});
  const sql=db();
  const existing=await sql`SELECT id,assigned_to,current_status FROM onboarding_cases WHERE customer_id=${customerId} AND current_status='open' LIMIT 1`;
  if(existing[0]) return NextResponse.json({error:'This merchant already has an open onboarding case.',caseId:existing[0].id},{status:409});
  const assignee:any=await pickOnboarder(body.assignedTo?String(body.assignedTo):null);
  if(!assignee) return NextResponse.json({error:'No active onboarder is available. Give at least one user Onboarding Agent/Admin access.'},{status:400});
  await sql`INSERT INTO customers(customer_id) VALUES(${customerId}) ON CONFLICT (customer_id) DO NOTHING`;
  const saleDate=body.saleDate?String(body.saleDate):null;
  if(saleDate){
    const todayIst=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(saleDate>todayIst) return NextResponse.json({error:'Date of Sale cannot be in the future.'},{status:400});
  }
  const rows=await sql`
    INSERT INTO onboarding_cases(customer_id,source_type,sale_date,assigned_to,assigned_at,created_by,last_activity_at)
    VALUES(${customerId},'manual_admin',${saleDate}::date,${assignee.id}::uuid,now(),${user.id}::uuid,now())
    RETURNING id
  `;
  const caseId=rows[0].id;
  await sql`
    INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_id,agent_name_raw,source_type,l0_code,l0_label_snapshot,remark)
    VALUES(${caseId}::uuid,${customerId},1,${user.id}::uuid,${user.name},'assignment','SYSTEM_ASSIGNED','Assigned',${`Assigned to ${assignee.name}`})
  `;
  return NextResponse.json({ok:true,caseId,assignedTo:assignee},{status:201});
}
