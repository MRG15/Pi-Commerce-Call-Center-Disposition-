import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { csmMerchants,csmRole,latestCompleteRun } from '@/lib/csm';
import { todayIst } from '@/lib/plans';

// Daily CSM productivity (from CSM call events) and queue coverage. CSM Admins see everyone;
// a CSM sees their own numbers.
export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const role=csmRole(user);
  if(!role) return NextResponse.json({error:'CSM access required'},{status:403});
  const url=new URL(req.url);
  const today=todayIst();
  const iso=(v:string|null,d:string)=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:d;
  const to=iso(url.searchParams.get('to'),today);
  const from=iso(url.searchParams.get('from'),new Date(new Date(to+'T00:00:00Z').getTime()-6*86400000).toISOString().slice(0,10));
  const only=role==='agent'?String(user.id):null;
  const sql=db();
  const daily=await sql`
    SELECT (e.event_time AT TIME ZONE 'Asia/Kolkata')::date::text AS day,e.agent_id,COALESCE(a.name,e.agent_name_raw) AS name,
      count(DISTINCT e.customer_id)::int AS merchants,
      count(*)::int AS calls,
      count(*) FILTER (WHERE e.l0_code<>'OB_NOT_CONNECTED')::int AS connected,
      count(*) FILTER (WHERE e.l1_code='OB_CALLBACK')::int AS callbacks,
      count(*) FILTER (WHERE e.l0_code='OB_ADDITIONAL_TOPUP')::int AS topups,
      COALESCE(sum(e.top_up_amount_inr) FILTER (WHERE e.l0_code='OB_ADDITIONAL_TOPUP'),0)::float8 AS topup_amount,
      count(*) FILTER (WHERE e.l0_code='OB_SUBS_RENEWED')::int AS renewals,
      COALESCE(sum(e.plan_amount_inr) FILTER (WHERE e.l0_code='OB_SUBS_RENEWED'),0)::float8 AS renewal_amount,
      count(*) FILTER (WHERE e.l0_code='OB_ANOTHER_AD_LIVE')::int AS another_ad,
      count(*) FILTER (WHERE e.l0_code='OB_CREATIVE_UPDATED')::int AS creative,
      count(*) FILTER (WHERE e.l0_code IN ('OB_NOT_INTERESTED','OB_REFUND_REQUESTED'))::int AS lost
    FROM onboarding_events e LEFT JOIN agents a ON a.id=e.agent_id
    WHERE e.source_type='customer_success_followup'
      AND (e.event_time AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
      AND (${only}::uuid IS NULL OR e.agent_id=${only}::uuid)
    GROUP BY 1,2,3 ORDER BY 1 DESC,3
  `;
  // Coverage: of the merchants in each queue now, how many were called in the last 7 days.
  const run=await latestCompleteRun(sql);
  let coverage:any[]=[];
  if(run){
    const rows=await csmMerchants(sql,run.id);
    const since=Date.now()-7*86400000;
    const groups=new Map<string,any>();
    for(const m of rows as any[]){
      if(only&&String(m.assigned_to)!==only) continue;
      const q=m.closed?'closed':m.queue;
      const key=`${m.assigned_name||'Unassigned'}|${q}`;
      const g=groups.get(key)||{csm:m.assigned_name||'Unassigned',queue:q,total:0,touched7d:0,neverCalled:0};
      g.total++;
      if(m.last_outreach&&new Date(m.last_outreach).getTime()>=since) g.touched7d++;
      if(!m.last_outreach) g.neverCalled++;
      groups.set(key,g);
    }
    coverage=[...groups.values()].sort((a,b)=>a.csm.localeCompare(b.csm)||a.queue.localeCompare(b.queue));
  }
  return NextResponse.json({from,to,daily,coverage,run});
}
