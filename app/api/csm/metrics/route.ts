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
  const csmParam=url.searchParams.get('csm');
  const agentFilter=only||(csmParam&&/^[0-9a-f-]{36}$/.test(csmParam)?csmParam:null);
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
      AND (${agentFilter}::uuid IS NULL OR e.agent_id=${agentFilter}::uuid)
    GROUP BY 1,2,3 ORDER BY 1 DESC,3
  `;
  // Calls in the range, one row each; grouped by bucket below.
  const bucketCalls=await sql`
    SELECT e.customer_id,e.csm_bucket,e.l0_code,e.l1_code,e.top_up_amount_inr::float8 AS top_up
    FROM onboarding_events e
    WHERE e.source_type='customer_success_followup'
      AND (e.event_time AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
      AND (${agentFilter}::uuid IS NULL OR e.agent_id=${agentFilter}::uuid)
  `;
  // Coverage: of the merchants in each queue now, how many were called in the last 7 days.
  const run=await latestCompleteRun(sql);
  let coverage:any[]=[];
  const bucketNow=new Map<string,any>();
  if(run){
    const rows=await csmMerchants(sql,run.id);
    const since=Date.now()-7*86400000;
    const groups=new Map<string,any>();
    for(const m of rows as any[]){
      const q0=m.closed?'closed':m.queue;
      if(!agentFilter||m.queue==='onb_lost'||String(m.assigned_to)===agentFilter){
        const nb=bucketNow.get(q0)||{bucket:q0,merchants:0,neverCalled:0};
        nb.merchants++; if(!m.last_outreach) nb.neverCalled++; bucketNow.set(q0,nb);
      }
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
  // Each call counts under the merchant's current bucket, so the numbers move with the merchant.
  // (The bucket at call time is stored too; it is only used if the merchant has left the queues.)
  const currentBucket=new Map<string,string>();
  if(run) for(const m of await csmMerchants(sql,run.id) as any[]) currentBucket.set(String(m.customer_id),m.closed?'closed':m.queue);
  const called=new Map<string,any>(); const seen=new Map<string,Set<string>>();
  for(const e of bucketCalls as any[]){
    const k=currentBucket.get(String(e.customer_id))||e.csm_bucket||'untagged';
    const g=called.get(k)||{merchants_called:0,calls:0,not_connected:0,connected:0,callbacks:0,topups:0,topup_amount:0,renewals:0,lost:0};
    const ids=seen.get(k)||new Set<string>(); if(!ids.has(e.customer_id)){ids.add(e.customer_id);g.merchants_called++;} seen.set(k,ids);
    g.calls++;
    if(e.l0_code==='OB_NOT_CONNECTED') g.not_connected++; else g.connected++;
    if(e.l1_code==='OB_CALLBACK') g.callbacks++;
    if(e.l0_code==='OB_ADDITIONAL_TOPUP'){g.topups++;g.topup_amount+=Number(e.top_up)||0;}
    if(e.l0_code==='OB_SUBS_RENEWED') g.renewals++;
    if(e.l0_code==='OB_NOT_INTERESTED'||e.l0_code==='OB_REFUND_REQUESTED') g.lost++;
    called.set(k,g);
  }
  const order=['ending','ended','cancelled','lapsed','closed','onb_lost','untagged'];
  const buckets=order.filter(k=>bucketNow.has(k)||called.has(k)).map(k=>({bucket:k,...(bucketNow.get(k)||{merchants:0,neverCalled:0}),
    ...(called.get(k)||{merchants_called:0,calls:0,not_connected:0,connected:0,callbacks:0,topups:0,topup_amount:0,renewals:0,lost:0}),bucket_key:k}));
  return NextResponse.json({from,to,daily,coverage,buckets,run});
}
