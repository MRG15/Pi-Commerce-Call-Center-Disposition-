import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess } from '@/lib/workspace-access';

export async function GET(){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'onboarding')) return NextResponse.json({error:'Onboarding access required'},{status:403});
  const sql=db();
  const nodes=await sql`SELECT id,code,label,level,parent_id,sort_order FROM onboarding_disposition_nodes WHERE active=TRUE ORDER BY level,sort_order,label`;
  return NextResponse.json({nodes});
}
