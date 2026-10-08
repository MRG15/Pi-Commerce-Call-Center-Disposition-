import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { csmMerchants,csmRole,latestCompleteRun,sortQueue } from '@/lib/csm';

// The CSM queues. Agents see the merchants assigned to them; admins see everyone's.
export async function GET(){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const role=csmRole(user);
  if(!role) return NextResponse.json({error:'CSM access required'},{status:403});
  const sql=db();
  const run=await latestCompleteRun(sql);
  const csms=await sql`
    SELECT a.id,a.name,wa.access_level,COALESCE(w.weight,0) AS weight
    FROM agents a JOIN workspace_access wa ON wa.agent_id=a.id AND wa.workspace='csm'
    LEFT JOIN csm_weights w ON w.agent_id=a.id
    WHERE a.active=TRUE ORDER BY a.name
  `;
  if(!run) return NextResponse.json({role,me:{id:user.id,name:user.name},run:null,merchants:[],csms});
  let merchants=sortQueue(await csmMerchants(sql,run.id));
  // Agents see their own merchants; every CSM sees Onboarding Lost (context, not allocated).
  if(role==='agent') merchants=merchants.filter((m:any)=>m.queue==='onb_lost'||String(m.assigned_to)===String(user.id));
  return NextResponse.json({role,me:{id:user.id,name:user.name},run,merchants,csms});
}
