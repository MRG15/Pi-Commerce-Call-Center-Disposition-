import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess } from '@/lib/workspace-access';

export async function GET(){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'onboarding')) return NextResponse.json({error:'Onboarding access required'},{status:403});
  const sql=db();
  const rows=await sql`SELECT id,code,label,level,parent_id,sort_order FROM onboarding_disposition_nodes WHERE active=TRUE ORDER BY level,sort_order,label`;
  const customerSuccess=user.access?.onboarding==='customer_success';
  const customerSuccessOnly=new Set(['OB_ANOTHER_AD_LIVE','OB_CREATIVE_UPDATED']);
  const nodes=customerSuccess?rows:rows.filter((n:any)=>!customerSuccessOnly.has(n.code));
  return NextResponse.json({nodes});
}
