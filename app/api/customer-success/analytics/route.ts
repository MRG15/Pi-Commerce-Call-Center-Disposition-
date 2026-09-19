import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';

export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const allowed=Boolean(user.isSuperAdmin || user.access?.onboarding==='admin' || user.access?.onboarding==='customer_success');
  if(!allowed) return NextResponse.json({error:'Customer Success analytics access required'},{status:403});
  const u=new URL(req.url); const from=u.searchParams.get('from'); const to=u.searchParams.get('to');
  if(!from||!to) return NextResponse.json({error:'from and to are required'},{status:400});
  const sql=db();

  const summary=await sql`
    WITH post_live AS (
      SELECT e.*
      FROM onboarding_events e
      JOIN onboarding_cases c ON c.id=e.onboarding_case_id
      WHERE e.event_date BETWEEN ${from}::date AND ${to}::date
        AND c.ads_live_at IS NOT NULL
        AND (
          e.source_type='customer_success_followup'
          OR (e.l0_code='OB_ADDITIONAL_TOPUP' AND e.event_time>=c.ads_live_at)
        )
    )
    SELECT
      COUNT(*)::int AS touches,
      COUNT(DISTINCT customer_id)::int AS customers_touched,
      COUNT(*) FILTER (WHERE callback_at IS NOT NULL)::int AS callbacks_scheduled,
      COUNT(*) FILTER (WHERE l0_code='OB_ANOTHER_AD_LIVE')::int AS another_ads_live,
      COUNT(*) FILTER (WHERE l0_code='OB_CREATIVE_UPDATED')::int AS creatives_updated,
      COUNT(*) FILTER (WHERE l0_code='OB_ADDITIONAL_TOPUP')::int AS top_up_count,
      COALESCE(SUM(top_up_amount_inr) FILTER (WHERE l0_code='OB_ADDITIONAL_TOPUP'),0)::numeric AS top_up_amount,
      COUNT(*) FILTER (WHERE l0_code='OB_NOT_INTERESTED')::int AS not_interested,
      COUNT(*) FILTER (WHERE l0_code='OB_REFUND_REQUESTED')::int AS refund_requested,
      COUNT(*) FILTER (WHERE l0_code='OB_IN_PROCESS')::int AS in_process,
      COUNT(*) FILTER (WHERE l1_code='OB_MEET_ALIGNED')::int AS meetings_aligned,
      COUNT(*) FILTER (WHERE l1_code='OB_TECHNICAL')::int AS technical_issues
    FROM post_live
  `;

  const agents=await sql`
    WITH post_live AS (
      SELECT e.*
      FROM onboarding_events e
      JOIN onboarding_cases c ON c.id=e.onboarding_case_id
      WHERE e.event_date BETWEEN ${from}::date AND ${to}::date
        AND c.ads_live_at IS NOT NULL
        AND e.agent_id IS NOT NULL
        AND (
          e.source_type='customer_success_followup'
          OR (e.l0_code='OB_ADDITIONAL_TOPUP' AND e.event_time>=c.ads_live_at)
        )
    )
    SELECT a.id,a.name,
      COUNT(p.id)::int AS touches,
      COUNT(DISTINCT p.customer_id)::int AS customers_touched,
      COUNT(p.id) FILTER (WHERE p.callback_at IS NOT NULL)::int AS callbacks_scheduled,
      COUNT(p.id) FILTER (WHERE p.l0_code='OB_ANOTHER_AD_LIVE')::int AS another_ads_live,
      COUNT(p.id) FILTER (WHERE p.l0_code='OB_CREATIVE_UPDATED')::int AS creatives_updated,
      COUNT(p.id) FILTER (WHERE p.l0_code='OB_ADDITIONAL_TOPUP')::int AS top_up_count,
      COALESCE(SUM(p.top_up_amount_inr) FILTER (WHERE p.l0_code='OB_ADDITIONAL_TOPUP'),0)::numeric AS top_up_amount,
      COUNT(p.id) FILTER (WHERE p.l0_code='OB_NOT_INTERESTED')::int AS not_interested,
      COUNT(p.id) FILTER (WHERE p.l0_code='OB_REFUND_REQUESTED')::int AS refund_requested
    FROM post_live p
    JOIN agents a ON a.id=p.agent_id
    GROUP BY a.id,a.name
    ORDER BY touches DESC,a.name
  `;

  return NextResponse.json({...(summary[0]||{}),agentPerformance:agents});
}
