import { NextResponse,after } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { csmMerchants,csmRole,latestCompleteRun,sortQueue } from '@/lib/csm';
import { ensureCsmWaRun } from '@/lib/wa';

// The CSM queues. Agents see the merchants assigned to them; admins see everyone's.
export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const role=csmRole(user);
  if(!role) return NextResponse.json({error:'CSM access required'},{status:403});
  const sql=db();
  // ?version=1: a tiny fingerprint (sync run, assignments, notes, follow-ups, cases) so the open
  // screen only re-downloads the merchant list (~0.8 MB) when something changed.
  if(new URL(req.url).searchParams.get('version')){
    const v=await sql`
      SELECT concat_ws('|',
        (SELECT max(id) FROM csm_sync_runs WHERE status='complete'),
        (SELECT count(*)||':'||COALESCE(max(assigned_at)::text,'') FROM csm_assignments),
        (SELECT max(id) FROM csm_notes),
        (SELECT count(*)||':'||COALESCE(max(event_time)::text,'') FROM onboarding_events),
        (SELECT count(*)||':'||COALESCE(max(closed_at)::text,'') FROM onboarding_cases)) AS v
    `;
    return NextResponse.json({v:String(v[0]?.v||'')});
  }
  const run=await latestCompleteRun(sql);
  // CSM WhatsApp templates that went live since the last sync run on today's snapshot (once).
  after(async()=>{try{await ensureCsmWaRun(sql);}catch(e){console.error('csm whatsapp error',e);}});
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
