import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { todayIst } from '@/lib/plans';

// "Not contacted in 10 minutes" pop-up for onboarding admins: today's new real-time cases (from CT or a
// seller's Send to Onboarding) with no disposition by their current owner 10+ minutes after being
// assigned. Only 9 AM–7 PM IST; a case assigned before 9 AM counts from 9 AM. Reassigning a case
// restarts its clock; it drops off once anyone logs a disposition.
export async function GET(){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!(user.isSuperAdmin||user.access?.onboarding==='admin')) return NextResponse.json({cases:[]});
  const ist=new Date(Date.now()+330*60000);
  const mins=ist.getUTCHours()*60+ist.getUTCMinutes();
  if(mins<9*60+10||mins>=19*60) return NextResponse.json({cases:[]});
  const today=todayIst();
  const rows=await db()`
    SELECT c.id,c.customer_id,a.name AS owner,c.assigned_at,COALESCE(NULLIF(mi.merchant_name,''),cu.merchant_name) AS merchant_name
    FROM onboarding_cases c
    LEFT JOIN agents a ON a.id=c.assigned_to
    LEFT JOIN merchant_information mi ON mi.customer_id=c.customer_id
    LEFT JOIN customers cu ON cu.customer_id=c.customer_id
    WHERE c.current_status='open' AND c.assigned_to IS NOT NULL
      AND (c.created_by_ct OR c.source_type='seller_handoff')
      AND (c.created_at AT TIME ZONE 'Asia/Kolkata')::date=${today}::date
      AND GREATEST(c.assigned_at,(${today}::date+time '09:00') AT TIME ZONE 'Asia/Kolkata')<=now()-interval '10 minutes'
      AND NOT EXISTS (SELECT 1 FROM onboarding_events e WHERE e.onboarding_case_id=c.id AND e.source_type='new_event' AND e.created_at>=c.assigned_at)
    ORDER BY c.assigned_at LIMIT 50
  `;
  return NextResponse.json({cases:rows});
}
