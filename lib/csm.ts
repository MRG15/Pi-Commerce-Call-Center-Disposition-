// CSM workspace: merchants whose ads have gone live, worked by Customer Success Managers.
//
// Built from the latest completed SMB Daily Tracker sync (Sub Raw + AdsRun Raw). A merchant is
// in the CSM queues when their ads have run (rows in AdsRun Raw, or completed_ads_count > 0 in
// Sub Raw). Every merchant lands in exactly one queue, checked in this order:
//   onb_lost  — onboarding closed the case as Not Interested / Refund (shown for context, any ads)
//   cancelled — subscription still ACTIVE but the merchant has cancelled (cancelled_at set)
//   lapsed    — subscription CANCELLED or EXPIRED
//   ending    — subscription active, an ad running now
//   ended     — subscription active, no ad running
// A merchant whose latest CSM call is Not Interested / Refund moves to "closed" until a CSM
// logs something else.
// Merchants whose onboarding case the Sub Raw sync reopened (no ad ran, or the ad failed) stay
// with onboarding and are left out until the first ad is properly live.

export const CSM_L0_CODES = ['OB_IN_PROCESS','OB_NOT_CONNECTED','OB_ADDITIONAL_TOPUP','OB_ANOTHER_AD_LIVE','OB_CREATIVE_UPDATED','OB_SUBS_RENEWED','OB_NOT_INTERESTED','OB_REFUND_REQUESTED'];
export const CSM_CLOSING_CODES = ['OB_NOT_INTERESTED','OB_REFUND_REQUESTED'];
export type CsmQueue = 'ending'|'ended'|'cancelled'|'lapsed'|'onb_lost';
export const CSM_BUCKETS = ['ending','ended','cancelled','lapsed','closed','onb_lost'];

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
      SELECT DISTINCT ON (customer_id) id,customer_id,current_status,assigned_to,ads_live_at,closed_at,current_l0,current_l1,current_l2,reopen_reason
      FROM onboarding_cases ORDER BY customer_id,created_at
    ), base AS (
      SELECT s.customer_id,s.status AS sub_status,
        COALESCE(NULLIF(s.merchant_name,''),a.ad_merchant_name) AS merchant_name,
        COALESCE(NULLIF(s.phone_number,''),a.ad_phone) AS phone_number,
        s.category,s.sub_category,s.mcc,s.sub_first_date,
        s.cancelled_at::text AS cancelled_at,s.expected_renewal_due_date::text AS renewal_due,s.renewal_date::text AS renewal_date,
        s.completed_ads_count,s.wallet_balance::float8 AS credits,
        COALESCE(a.total_ads,0) AS total_ads,COALESCE(a.active_ads,0) AS active_ads,COALESCE(a.completed_ads,0) AS completed_ads,
        c.id AS case_id,c.current_status AS case_status,owner.name AS onboarding_owner,
        CASE WHEN c.current_status='lost' THEN concat_ws(' → ',c.current_l0,c.current_l1,c.current_l2) END AS lost_reason,
        CASE WHEN c.current_status='lost' THEN c.closed_at END AS lost_at,
        CASE WHEN c.current_status='lost' THEN 'onb_lost'
             WHEN upper(COALESCE(NULLIF(s.check_sub_status,''),s.status))='ACTIVE' AND s.cancelled_at IS NOT NULL THEN 'cancelled'
             WHEN s.status IN ('CANCELLED','EXPIRED') THEN 'lapsed'
             WHEN COALESCE(a.active_ads,0)>0 THEN 'ending'
             ELSE 'ended' END AS queue
      FROM subs s
      LEFT JOIN ads a ON a.customer_id=s.customer_id
      LEFT JOIN cases c ON c.customer_id=s.customer_id
      LEFT JOIN agents owner ON owner.id=c.assigned_to
      WHERE (c.current_status='lost' OR COALESCE(a.total_ads,0)>0 OR COALESCE(s.completed_ads_count,0)>0)
        -- Reopened by the onboarding sync (no ad ran / ad failed): onboarding owns them until the first ad is live.
        AND NOT (c.current_status='open' AND c.reopen_reason IS NOT NULL)
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
      (b.queue<>'onb_lost' AND COALESCE(lc.l0_code IN ('OB_NOT_INTERESTED','OB_REFUND_REQUESTED'),FALSE)) AS closed,
      COALESCE(m.topups,0) AS topups,COALESCE(m.topup_total,0) AS topup_total,COALESCE(m.renewals,0) AS renewals,m.last_renewal_plan
    FROM base b
    LEFT JOIN LATERAL (
      SELECT * FROM merchant_ads x WHERE x.sync_run_id=${runId} AND x.customer_id=b.customer_id
      ORDER BY
        CASE WHEN b.queue='ending' AND x.ad_status='ACTIVE' THEN 0 WHEN b.queue<>'ending' AND x.ad_status='COMPLETED' THEN 0 ELSE 1 END,
        CASE WHEN b.queue='ending' THEN x.end_date END ASC NULLS LAST,
        CASE WHEN b.queue<>'ending' THEN x.end_date END DESC NULLS LAST,
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

// Default order inside each queue. The CSM screen can re-sort by impressions, spend or credits.
//   cancelled — most credits first
//   lapsed    — most recently due for renewal first (yesterday, D-2, ...), then most credits
//   ending    — most impressions, then most spend
//   ended     — most credits, then most impressions
//   onb_lost  — most recently lost first
export function sortQueue(rows:any[]){
  const t=(d:any)=>d?new Date(d).getTime():0;
  const n=(v:any)=>Number(v)||0;
  const qOrder:any={ending:0,ended:1,cancelled:2,lapsed:3,onb_lost:4};
  return [...rows].sort((a,b)=>{
    if(a.queue!==b.queue) return qOrder[a.queue]-qOrder[b.queue];
    if(a.queue==='cancelled') return (n(b.credits)-n(a.credits))||(n(b.impressions)-n(a.impressions));
    if(a.queue==='lapsed') return (t(b.renewal_due)-t(a.renewal_due))||(n(b.credits)-n(a.credits));
    if(a.queue==='ending') return (n(b.impressions)-n(a.impressions))||(n(b.spend)-n(a.spend));
    if(a.queue==='ended') return (n(b.credits)-n(a.credits))||(n(b.impressions)-n(a.impressions));
    return t(b.lost_at)-t(a.lost_at);
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
  // Onboarding-lost merchants are shown to every CSM for context and are not allocated.
  const merchants=sortQueue(await csmMerchants(sql,runId)).filter((m:any)=>!m.assigned_to&&m.queue!=='onb_lost');
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
