import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,isWorkspaceAdmin } from '@/lib/workspace-access';

// Onboarding admins: "Remove Lost" on a Not Interested / Refund case the team is reviving. The case
// reopens for its existing owner ("Reopened: by admin"); the reason is kept on the timeline. From
// there it follows the normal flow (Ads Live, next-morning ad check, reopen if no ad ran).
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!isWorkspaceAdmin(user,'onboarding')) return NextResponse.json({error:'Only onboarding admins can remove Lost.'},{status:403});
  const {id}=await params;
  const body:any=await req.json().catch(()=>({}));
  const reason=String(body?.reason||'').trim();
  if(!reason) return NextResponse.json({error:'Enter the reason for removing Lost.'},{status:400});
  const sql=db();
  const done=await sql.begin(async(tx:any)=>{
    const upd=await tx`UPDATE onboarding_cases SET current_status='open',current_l0='Reopened by admin',current_l1=NULL,current_l2=NULL,
        closed_at=NULL,next_callback_at=now(),last_activity_at=now(),updated_at=now(),reopened_at=now(),reopen_reason='admin_removed_lost'
      WHERE id=${id}::uuid AND current_status='lost' RETURNING id,customer_id`;
    if(!upd[0]) return false;
    const n=(await tx`SELECT COALESCE(MAX(attempt_number),0)+1 AS n FROM onboarding_events WHERE onboarding_case_id=${id}::uuid`)[0].n;
    await tx`INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_id,agent_name_raw,source_type,l0_code,l0_label_snapshot,remark)
      VALUES(${id}::uuid,${upd[0].customer_id},${n},${user.id}::uuid,${user.name},'system','SYSTEM_LOST_REMOVED','Lost removed by admin',${reason})`;
    return true;
  });
  if(!done) return NextResponse.json({error:'This case is not marked Lost.'},{status:409});
  return NextResponse.json({ok:true});
}
