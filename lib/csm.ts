// CSM workspace: merchants whose ads have gone live, worked by Customer Success Managers.
//
// A merchant is in the CSM workspace when, in the latest completed SMB Daily Tracker sync,
// they have run at least one ad (AdsRun Raw) and the onboarding team has not closed their
// case as lost (Not Interested / Refund Requested). Queues, as in the old Kunal tracker:
//   ending  — subscription ACTIVE and an ad running now (soonest end first, then clicks)
//   ended   — subscription ACTIVE, no ad running (most clicks first, then latest end)
//   lapsed  — subscription CANCELLED or EXPIRED (cancelled first, then most ads run)
// A merchant whose latest CSM disposition is Not Interested / Refund Requested moves to
// "closed" until a CSM logs something else.

export const CSM_L0_CODES = ['OB_IN_PROCESS','OB_NOT_CONNECTED','OB_ADDITIONAL_TOPUP','OB_ANOTHER_AD_LIVE','OB_CREATIVE_UPDATED','OB_SUBS_RENEWED','OB_NOT_INTERESTED','OB_REFUND_REQUESTED'];
export const CSM_CLOSING_CODES = ['OB_NOT_INTERESTED','OB_REFUND_REQUESTED'];
export type CsmQueue = 'ending'|'ended'|'lapsed';

export async function latestCompleteRun(sql:any):Promise<{id:number;finished_at:string;subs_rows:number;ads_rows:number}|null>{
  const ok=await sql`SELECT to_regclass('public.csm_sync_runs') IS NOT NULL AS ok`;
  if(!ok[0]?.ok) return null;
  const rows=await sql`SELECT id,finished_at,subs_rows,ads_rows FROM csm_sync_runs WHERE status='complete' ORDER BY id DESC LIMIT 1`;
  return rows[0]||null;
}

// Every merchant in the CSM workspace with everything the queue and detail views need.
export async function csmMerchants(sql:any,runId:number){
  return sql`
    WITH subs AS (
      SELECT * FROM merchant_subscriptions WHERE sync_run_id=${runId}
    ), ads AS (
      SELECT customer_id,count(*)::int AS total_ads,
        count(*) FILTER (WHERE ad_status='ACTIVE')::int AS active_ads,
        count(*) FILTER (WHERE ad_status='COMPLETED')::int AS completed_ads,
        max(merchant_name) AS ad_merchant_name,max(phone_number) AS ad_phone
      FROM merchant_ads WHERE sync_run_id=${runId} GROUP BY customer_id
    ), cases AS (
      SELECT DISTINCT ON (customer_id) id,customer_id,current_status,assigned_to,ads_live_at
      FROM onboarding_cases ORDER BY customer_id,created_at
    ), base AS (
      SELECT s.customer_id,s.status AS sub_status,
        COALESCE(NULLIF(s.merchant_name,''),a.ad_merchant_name) AS merchant_name,
        COALESCE(NULLIF(s.phone_number,''),a.ad_phone) AS phone_number,
        s.category,s.sub_category,s.mcc,s.sub_first_date,
        a.total_ads,a.active_ads,a.completed_ads,
        c.id AS case_id,c.current_status AS case_status,owner.name AS onboarding_owner,
        CASE WHEN s.status IN ('CANCELLED','EXPIRED') THEN 'lapsed'
             WHEN a.active_ads>0 THEN 'ending'
             ELSE 'ended' END AS queue
      FROM subs s
      JOIN ads a ON a.customer_id=s.customer_id AND a.total_ads>0
      LEFT JOIN cases c ON c.customer_id=s.customer_id
      LEFT JOIN agents owner ON owner.id=c.assigned_to
      WHERE COALESCE(c.current_status,'')<>'lost'
    ), cs AS (
      SELECT e.customer_id,e.event_time,e.l0_code,e.l0_label_snapshot,e.l1_label_snapshot,e.l2_label_snapshot,e.remark,e.callback_at,e.agent_name_raw,
        row_number() OVER (PARTITION BY e.customer_id ORDER BY e.event_time DESC,e.attempt_number DESC) AS rn
      FROM onboarding_events e
      WHERE e.source_type='customer_success_followup' AND e.customer_id IN (SELECT customer_id FROM base)
    ), cs_agg AS (
      SELECT customer_id,max(event_time) AS last_outreach,
        max(event_time) FILTER (WHERE l0_code<>'OB_NOT_CONNECTED') AS last_connect,
        count(*)::int AS cs_calls
      FROM cs GROUP BY customer_id
    ), money AS (
      SELECT e.customer_id,
        count(*) FILTER (WHERE e.l0_code='OB_ADDITIONAL_TOPUP' AND e.top_up_amount_inr>0)::int AS topups,
        COALESCE(sum(e.top_up_amount_inr) FILTER (WHERE e.l0_code='OB_ADDITIONAL_TOPUP'),0)::float8 AS topup_total,
        count(*) FILTER (WHERE e.l0_code='OB_SUBS_RENEWED')::int AS renewals,
        (array_agg(e.plan_code ORDER BY e.event_time DESC) FILTER (WHERE e.l0_code='OB_SUBS_RENEWED'))[1] AS last_renewal_plan
      FROM onboarding_events e WHERE e.customer_id IN (SELECT customer_id FROM base)
      GROUP BY e.customer_id
    ), pitch AS (
      SELECT DISTINCT ON (customer_id) customer_id,note,note_date::text AS note_date,author_name
      FROM csm_notes WHERE kind='pitch' ORDER BY customer_id,note_date DESC,id DESC
    ), sheet_remark AS (
      SELECT DISTINCT ON (customer_id) customer_id,note,note_date::text AS note_date,author_name
      FROM csm_notes WHERE kind='sheet_remark' ORDER BY customer_id,note_date DESC,id DESC
    )
    SELECT b.*,
      sel.creative_name,sel.description,sel.ad_status,sel.budget::float8 AS budget,sel.start_date::text AS start_date,sel.end_date::text AS end_date,
      sel.impressions::float8 AS impressions,sel.clicks::float8 AS clicks,sel.ctr::float8 AS ctr,sel.reach::float8 AS reach,sel.spend::float8 AS spend,
      asg.agent_id AS assigned_to,ag.name AS assigned_name,
      p.note AS pitch,p.note_date AS pitch_date,p.author_name AS pitch_by,
      sr.note AS sheet_remark,sr.note_date AS sheet_remark_date,
      ca.last_outreach,ca.last_connect,COALESCE(ca.cs_calls,0) AS cs_calls,
      lc.l0_code AS last_l0_code,lc.l0_label_snapshot AS last_l0,lc.l1_label_snapshot AS last_l1,lc.l2_label_snapshot AS last_l2,
      lc.remark AS last_remark,lc.agent_name_raw AS last_by,lc.callback_at AS next_callback,
      COALESCE(lc.l0_code IN ('OB_NOT_INTERESTED','OB_REFUND_REQUESTED'),FALSE) AS closed,
      COALESCE(m.topups,0) AS topups,COALESCE(m.topup_total,0) AS topup_total,COALESCE(m.renewals,0) AS renewals,m.last_renewal_plan
    FROM base b
    LEFT JOIN LATERAL (
      SELECT * FROM merchant_ads x WHERE x.sync_run_id=${runId} AND x.customer_id=b.customer_id
      ORDER BY
        CASE WHEN b.queue='ending' AND x.ad_status='ACTIVE' THEN 0 WHEN b.queue='ended' AND x.ad_status='COMPLETED' THEN 0 WHEN b.queue='lapsed' THEN 0 ELSE 1 END,
        CASE WHEN b.queue='ending' THEN x.end_date END ASC NULLS LAST,
        CASE WHEN b.queue='lapsed' THEN x.end_date END DESC NULLS LAST,
        x.clicks DESC NULLS LAST,
        x.end_date DESC NULLS LAST,
        x.source_row
      LIMIT 1
    ) sel ON TRUE
    LEFT JOIN csm_assignments asg ON asg.customer_id=b.customer_id
    LEFT JOIN agents ag ON ag.id=asg.agent_id
    LEFT JOIN pitch p ON p.customer_id=b.customer_id
    LEFT JOIN sheet_remark sr ON sr.customer_id=b.customer_id
    LEFT JOIN cs_agg ca ON ca.customer_id=b.customer_id
    LEFT JOIN cs lc ON lc.customer_id=b.customer_id AND lc.rn=1
    LEFT JOIN money m ON m.customer_id=b.customer_id
  `;
}

// Sort order inside each queue, matching the old sheet.
export function sortQueue(rows:any[]){
  const t=(d:any)=>d?new Date(d).getTime():Number.MAX_SAFE_INTEGER;
  const qOrder:any={ending:0,ended:1,lapsed:2};
  return [...rows].sort((a,b)=>{
    if(a.queue!==b.queue) return qOrder[a.queue]-qOrder[b.queue];
    if(a.queue==='ending') return (t(a.end_date)-t(b.end_date))||((b.clicks||0)-(a.clicks||0));
    if(a.queue==='ended') return ((b.clicks||0)-(a.clicks||0))||(t(b.end_date)-t(a.end_date));
    if(a.sub_status!==b.sub_status) return a.sub_status==='CANCELLED'?-1:1;
    return (b.total_ads||0)-(a.total_ads||0);
  });
}

// Gives every unassigned merchant an owner, round robin by weight: each new merchant goes to
// the CSM whose share (assigned / weight) is lowest. Existing assignments never move.
export async function allocateUnassigned(sql:any,runId:number){
  const weights=await sql`
    SELECT w.agent_id,w.weight,a.name FROM csm_weights w JOIN agents a ON a.id=w.agent_id
    JOIN workspace_access wa ON wa.agent_id=a.id AND wa.workspace='csm'
    WHERE a.active=TRUE AND w.weight>0 ORDER BY a.name
  `;
  if(!weights.length) return {assigned:0};
  const counts=await sql`SELECT agent_id,count(*)::int AS n FROM csm_assignments GROUP BY agent_id`;
  const load=new Map<string,number>(); for(const c of counts) load.set(String(c.agent_id),c.n);
  const merchants=sortQueue(await csmMerchants(sql,runId)).filter((m:any)=>!m.assigned_to);
  const picks:{customer_id:string;agent_id:string}[]=[];
  for(const m of merchants){
    let best:any=null,bestScore=Infinity;
    for(const w of weights){
      const score=((load.get(String(w.agent_id))||0)+1)/Number(w.weight);
      if(score<bestScore){best=w;bestScore=score;}
    }
    load.set(String(best.agent_id),(load.get(String(best.agent_id))||0)+1);
    picks.push({customer_id:String(m.customer_id),agent_id:String(best.agent_id)});
  }
  if(picks.length){
    await sql`
      INSERT INTO csm_assignments(customer_id,agent_id,method)
      SELECT x.customer_id,x.agent_id::uuid,'auto' FROM jsonb_to_recordset(${sql.json(picks)}::jsonb) AS x(customer_id text,agent_id text)
      ON CONFLICT (customer_id) DO NOTHING
    `;
  }
  return {assigned:picks.length};
}

// 'admin' for CSM Admins and Super Admins, 'agent' for CSM agents, otherwise null.
export function csmRole(user:any):'admin'|'agent'|null{
  if(!user) return null;
  if(user.isSuperAdmin||user.access?.csm==='admin') return 'admin';
  if(user.access?.csm) return 'agent';
  return null;
}
