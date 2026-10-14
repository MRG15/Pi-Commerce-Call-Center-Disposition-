import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { csmRole,latestCompleteRun } from '@/lib/csm';

// One merchant: every ad in the latest sync, pitch notes, and the full call history
// (onboarding and CSM) so the CSM sees the whole story before calling.
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const role=csmRole(user);
  if(!role) return NextResponse.json({error:'CSM access required'},{status:403});
  const {id}=await params; const customerId=decodeURIComponent(id).trim();
  const sql=db();
  if(role==='agent'){
    const own=await sql`
      SELECT 1 FROM csm_assignments WHERE customer_id=${customerId} AND agent_id=${user.id}::uuid
      UNION ALL SELECT 1 FROM (SELECT current_status FROM onboarding_cases WHERE customer_id=${customerId} ORDER BY created_at LIMIT 1) c WHERE c.current_status='lost'
    `;
    if(!own[0]) return NextResponse.json({error:'This merchant is assigned to another CSM.'},{status:403});
  }
  const run=await latestCompleteRun(sql);
  const sub=run?await sql`SELECT *,wallet_balance::float8 AS credits,cancelled_at::text AS cancelled_on,expected_renewal_due_date::text AS renewal_due,renewal_date::text AS renewed_on FROM merchant_subscriptions WHERE sync_run_id=${run.id} AND customer_id=${customerId}`:[];
  const ads=run?await sql`
    SELECT ma.creative_name,ma.description,ma.ad_status,ma.budget::float8 AS budget,ma.start_date::text AS start_date,ma.end_date::text AS end_date,
      ma.impressions::float8 AS impressions,ma.clicks::float8 AS clicks,ma.ctr::float8 AS ctr,ma.reach::float8 AS reach,ma.spend::float8 AS spend,ma.onboarded_date::text AS onboarded_date,ma.mid,
      cv.conversions,cv.synced_at AS conversions_as_on
    FROM merchant_ads ma
    -- Conversions from the Ad performance analysis sheet, matched on Cust ID + ad (creative) name.
    LEFT JOIN LATERAL (
      SELECT sum(x.conversions)::float8 AS conversions,max(x.synced_at) AS synced_at FROM ad_conversions x
      WHERE x.customer_id=ma.customer_id AND lower(btrim(x.ad_name))=lower(btrim(ma.creative_name))
    ) cv ON TRUE
    WHERE ma.sync_run_id=${run.id} AND ma.customer_id=${customerId}
    ORDER BY (ma.ad_status='ACTIVE') DESC,ma.end_date DESC NULLS LAST
  `:[];
  const notes=await sql`SELECT id,kind,note,note_date::text AS note_date,author_name,source,created_at FROM csm_notes WHERE customer_id=${customerId} ORDER BY note_date DESC,id DESC`;
  const cases=await sql`
    SELECT c.id,c.current_status,c.current_l0,c.current_l1,c.current_l2,c.sale_date::text AS sale_date,c.ads_live_at,c.closed_at,a.name AS owner
    FROM onboarding_cases c LEFT JOIN agents a ON a.id=c.assigned_to WHERE c.customer_id=${customerId} ORDER BY c.created_at LIMIT 1
  `;
  const events=await sql`
    SELECT e.id,e.event_time,e.source_type,e.l0_code,e.l0_label_snapshot,e.l1_label_snapshot,e.l2_label_snapshot,e.remark,e.callback_at,
      e.top_up_amount_inr::float8 AS top_up,e.plan_code,e.upgrade_value_inr::float8 AS upgrade_value,COALESCE(a.name,e.agent_name_raw) AS by_name
    FROM onboarding_events e LEFT JOIN agents a ON a.id=e.agent_id
    WHERE e.customer_id=${customerId} ORDER BY e.event_time DESC,e.attempt_number DESC LIMIT 200
  `;
  const merchant=await sql`SELECT merchant_name,phone_number,category,sub_category FROM merchant_information WHERE customer_id=${customerId} AND active=TRUE LIMIT 1`;
  const assignment=await sql`SELECT s.agent_id,a.name,s.method,s.assigned_at FROM csm_assignments s JOIN agents a ON a.id=s.agent_id WHERE s.customer_id=${customerId}`;
  return NextResponse.json({customerId,subscription:sub[0]||null,merchant:merchant[0]||null,ads,notes,case:cases[0]||null,events,assignment:assignment[0]||null});
}
