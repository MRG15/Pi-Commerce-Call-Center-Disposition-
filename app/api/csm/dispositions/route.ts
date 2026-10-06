import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { CSM_L0_CODES,csmRole } from '@/lib/csm';

// Post-live outcomes a CSM can log, with their L1 / L2 options.
export async function GET(){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!csmRole(user)) return NextResponse.json({error:'CSM access required'},{status:403});
  const sql=db();
  const rows=await sql`
    WITH RECURSIVE tree AS (
      SELECT id,code,label,level,parent_id,sort_order FROM onboarding_disposition_nodes WHERE active=TRUE AND level=0 AND code=ANY(${CSM_L0_CODES})
      UNION ALL
      SELECT n.id,n.code,n.label,n.level,n.parent_id,n.sort_order FROM onboarding_disposition_nodes n JOIN tree t ON n.parent_id=t.id WHERE n.active=TRUE
    )
    SELECT * FROM tree ORDER BY level,sort_order,label
  `;
  return NextResponse.json({nodes:rows});
}
