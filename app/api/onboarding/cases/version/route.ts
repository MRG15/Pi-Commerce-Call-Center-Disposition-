import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,canManageAllOnboardingCases } from '@/lib/workspace-access';

// A tiny fingerprint of the cases a user can see. The Onboarding workspace polls this and only
// re-downloads the full case list when it changes (a new case, a logged disposition, a reassignment,
// a sync, a technical case opened/resolved, or a new day).
export async function GET(){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'onboarding')) return NextResponse.json({error:'Onboarding access required'},{status:403});
  const all=canManageAllOnboardingCases(user);
  const rows=await db()`
    SELECT concat_ws('|',(now() AT TIME ZONE 'Asia/Kolkata')::date,count(*),max(c.updated_at),max(c.last_activity_at),max(c.sub_synced_at),max(c.closed_at),
      (SELECT concat_ws(':',count(*),max(t.opened_at),max(t.resolved_at)) FROM technical_cases t)) AS v
    FROM onboarding_cases c WHERE ${all} OR c.assigned_to=${user.id}::uuid
  `;
  return NextResponse.json({v:String(rows[0]?.v||'')});
}
