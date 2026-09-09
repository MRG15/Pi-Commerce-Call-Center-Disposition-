import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,isWorkspaceAdmin } from '@/lib/workspace-access';

export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!isWorkspaceAdmin(user,'onboarding')) return NextResponse.json({error:'Onboarding admin access required'},{status:403});
  const u=new URL(req.url); const from=u.searchParams.get('from'); const to=u.searchParams.get('to');
  if(!from||!to) return NextResponse.json({error:'from and to are required'},{status:400});
  const sql=db();
  const summary=await sql`
    SELECT
      COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS cases_received,
      COUNT(*) FILTER (WHERE current_status='open')::int AS open_cases,
      COUNT(*) FILTER (WHERE ads_live_at IS NOT NULL AND (ads_live_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS ads_live,
      COUNT(*) FILTER (WHERE current_status='lost' AND (closed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS lost,
      ROUND(AVG(EXTRACT(EPOCH FROM (ads_live_at-COALESCE(sale_date::timestamptz,created_at)))/86400.0) FILTER (WHERE ads_live_at IS NOT NULL),1) AS avg_days_to_live,
      COUNT(*) FILTER (WHERE current_status='open' AND (COALESCE(last_activity_at,created_at) AT TIME ZONE 'Asia/Kolkata')::date <= ((now() AT TIME ZONE 'Asia/Kolkata')::date-3))::int AS ageing_cases
    FROM onboarding_cases
  `;
  const events=await sql`
    SELECT
      COUNT(*) FILTER (WHERE source_type IN ('new_event','historical_import') AND (event_time AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS touches,
      COUNT(*) FILTER (WHERE source_type IN ('new_event','historical_import') AND (event_time AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date AND l0_label_snapshot<>'Not Connected')::int AS connected,
      COUNT(*) FILTER (WHERE source_type='new_event' AND l0_code='OB_SUBS_RENEWED' AND event_date BETWEEN ${from}::date AND ${to}::date)::int AS subscriptions_renewed,
      COALESCE(SUM(top_up_amount_inr) FILTER (WHERE source_type='new_event' AND event_date BETWEEN ${from}::date AND ${to}::date),0)::numeric AS top_up_amount
    FROM onboarding_events
  `;
  const tech=await sql`
    SELECT
      COUNT(*) FILTER (WHERE status='open')::int AS technical_open,
      COUNT(*) FILTER (WHERE status='resolved' AND (resolved_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS technical_resolved
    FROM technical_cases
  `;
  const agents=await sql`
    SELECT a.id,a.name,
      COUNT(DISTINCT c.id) FILTER (WHERE (c.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS assigned,
      COUNT(DISTINCT c.id) FILTER (WHERE c.current_status='open')::int AS open,
      COUNT(DISTINCT c.id) FILTER (WHERE c.ads_live_at IS NOT NULL AND (c.ads_live_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS ads_live,
      COUNT(DISTINCT t.id) FILTER (WHERE t.status='open')::int AS tech_open,
      COUNT(DISTINCT t.id) FILTER (WHERE t.status='resolved' AND (t.resolved_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS tech_resolved,
      COUNT(DISTINCT e.id) FILTER (WHERE e.source_type IN ('new_event','historical_import') AND (e.event_time AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date)::int AS touches,
      COUNT(DISTINCT e.id) FILTER (WHERE e.source_type='new_event' AND e.l0_code='OB_SUBS_RENEWED' AND e.event_date BETWEEN ${from}::date AND ${to}::date)::int AS subscriptions_renewed,
      COALESCE(SUM(e.top_up_amount_inr) FILTER (WHERE e.source_type='new_event' AND e.event_date BETWEEN ${from}::date AND ${to}::date),0)::numeric AS top_up_amount,
      ROUND(AVG(EXTRACT(EPOCH FROM (c.ads_live_at-COALESCE(c.sale_date::timestamptz,c.created_at)))/86400.0) FILTER (WHERE c.ads_live_at IS NOT NULL),1) AS avg_tat
    FROM agents a
    JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='onboarding'
    LEFT JOIN onboarding_cases c ON c.assigned_to=a.id
    LEFT JOIN onboarding_events e ON e.agent_id=a.id
    LEFT JOIN technical_cases t ON t.assigned_to=a.id
    WHERE a.active=TRUE
    GROUP BY a.id,a.name ORDER BY ads_live DESC,a.name
  `;
  const s:any=summary[0]||{}; const received=Number(s.cases_received||0); const ads=Number(s.ads_live||0);
  return NextResponse.json({...s,...(events[0]||{}),...(tech[0]||{}),ads_live_rate:received?Math.round(ads*1000/received)/10:0,agentPerformance:agents});
}
