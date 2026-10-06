import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { allocateUnassigned,csmRole,latestCompleteRun } from '@/lib/csm';

// CSM Admin: move merchants between CSMs, set allocation weights, allocate unassigned now.
export async function POST(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(csmRole(user)!=='admin') return NextResponse.json({error:'CSM Admin access required'},{status:403});
  const body=await req.json().catch(()=>({}));
  const sql=db();
  const action=String(body.action||'');
  if(action==='reassign'){
    const ids=(Array.isArray(body.customerIds)?body.customerIds:[]).map((x:any)=>String(x).trim()).filter((x:string)=>/^\d+$/.test(x));
    const agentId=String(body.agentId||'');
    if(!ids.length||!agentId) return NextResponse.json({error:'Select merchants and a CSM.'},{status:400});
    const ok=await sql`SELECT 1 FROM workspace_access wa JOIN agents a ON a.id=wa.agent_id WHERE wa.agent_id=${agentId}::uuid AND wa.workspace='csm' AND a.active=TRUE`;
    if(!ok[0]) return NextResponse.json({error:'That person is not an active CSM.'},{status:400});
    await sql`
      INSERT INTO csm_assignments(customer_id,agent_id,method,assigned_by,assigned_at)
      SELECT x,${agentId}::uuid,'manual',${user.id}::uuid,now() FROM unnest(${ids}::text[]) AS x
      ON CONFLICT (customer_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,method='manual',assigned_by=EXCLUDED.assigned_by,assigned_at=now()
    `;
    return NextResponse.json({ok:true,moved:ids.length});
  }
  if(action==='weights'){
    const weights:any[]=Array.isArray(body.weights)?body.weights:[];
    const rows=weights.map(w=>({agent_id:String(w.agentId||''),weight:Math.max(0,Math.min(1000,Math.round(Number(w.weight)||0)))})).filter(w=>w.agent_id);
    if(!rows.length) return NextResponse.json({error:'No weights given.'},{status:400});
    await sql`
      INSERT INTO csm_weights(agent_id,weight,updated_by,updated_at)
      SELECT x.agent_id::uuid,x.weight,${user.id}::uuid,now() FROM jsonb_to_recordset(${sql.json(rows)}::jsonb) AS x(agent_id text,weight int)
      JOIN workspace_access wa ON wa.agent_id=x.agent_id::uuid AND wa.workspace='csm'
      ON CONFLICT (agent_id) DO UPDATE SET weight=EXCLUDED.weight,updated_by=EXCLUDED.updated_by,updated_at=now()
    `;
    return NextResponse.json({ok:true});
  }
  if(action==='allocate'){
    const run=await latestCompleteRun(sql);
    if(!run) return NextResponse.json({error:'No completed data sync yet.'},{status:409});
    const r=await allocateUnassigned(sql,run.id);
    return NextResponse.json({ok:true,assigned:r.assigned});
  }
  return NextResponse.json({error:'Unknown action'},{status:400});
}
