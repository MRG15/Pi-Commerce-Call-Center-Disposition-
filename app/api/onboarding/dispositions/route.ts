import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,isWorkspaceAdmin } from '@/lib/workspace-access';

export async function GET(){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'onboarding')) return NextResponse.json({error:'Onboarding access required'},{status:403});
  const sql=db();
  const rows=await sql`SELECT id,code,label,level,parent_id,sort_order FROM onboarding_disposition_nodes WHERE active=TRUE ORDER BY level,sort_order,label`;
  // Post-live outcomes (Another Ad Live, Creative Updated) are logged in the CSM workspace.
  const csmOnly=new Set(['OB_ANOTHER_AD_LIVE','OB_CREATIVE_UPDATED']);
  // Refunded (no contact) is for onboarding admins only.
  const admin=isWorkspaceAdmin(user,'onboarding');
  const nodes=rows.filter((n:any)=>!csmOnly.has(n.code)&&(admin||n.code!=='OB_REFUND_PROCESSED'));
  return NextResponse.json({nodes});
}
