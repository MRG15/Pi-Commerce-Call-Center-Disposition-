import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';

const yes = (v:any) => typeof v === 'string' && ['yes','y','true','1'].includes(v.trim().toLowerCase());

export async function GET(_: Request, ctx: {params: Promise<{id:string}>}) {
  if (!await currentAgent()) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const {id}=await ctx.params;
  const customerId=decodeURIComponent(id).trim();
  const sql=db();
  const customers=await sql`SELECT * FROM customers WHERE customer_id=${customerId} LIMIT 1`;
  const calls=await sql`
    SELECT
      c.id,c.customer_id,c.attempt_number,c.call_date,c.call_seq,c.event_time,
      c.agent_id,c.agent_name_raw,c.source_type,c.source_sheet,c.source_row,c.source_call_num,c.source_key,
      c.status_raw,c.status_normalized,c.what_happened,c.remark,
      c.l0_id,c.l1_id,c.l2_id,c.l0_label_snapshot,c.l1_label_snapshot,c.l2_label_snapshot,
      c.facebook_page_status,c.whatsapp_handoff,c.call_duration_seconds,c.callback_at,
      c.is_legacy,c.is_conversion_authoritative,c.created_at,
      a.name AS agent_name,
      COALESCE(c.l0_label_snapshot,c.status_raw) AS outcome_primary
    FROM calls c LEFT JOIN agents a ON a.id=c.agent_id
    WHERE c.customer_id=${customerId}
    ORDER BY c.call_date,c.call_seq,c.attempt_number
  `;
  const flagRows=await sql`SELECT * FROM customer_legacy_flags WHERE customer_id=${customerId} ORDER BY source_sheet,source_row`;
  if (!customers[0] && calls.length===0 && flagRows.length===0) return NextResponse.json({found:false, customer:{customer_id:customerId}, summary:{totalAttempts:0,firstCallDate:null,lastCallDate:null,lastAgent:null,latestOutcome:'New customer'}, calls:[], activeFlags:{}, legacyFlagSources:[]});

  const c=customers[0] || {customer_id:customerId};
  const activeFlags = {
    callOverWA:flagRows.some(r=>yes(r.call_over_wa)),
    entryPointIssue:flagRows.some(r=>yes(r.entry_point_issue)),
    insightsIssue:flagRows.some(r=>yes(r.insights_issue)),
    fbLinkingIssue:flagRows.some(r=>yes(r.fb_linking_issue)),
    adsCreativeIssue:flagRows.some(r=>yes(r.ads_creative_issue)),
    paymentIssue:flagRows.some(r=>yes(r.payment_issue)),
    wantsVisit:flagRows.some(r=>yes(r.wants_visit)),
    wantsSampleOverWA:flagRows.some(r=>yes(r.wants_sample_over_wa)),
    fbPageLinkingPending:flagRows.some(r=>yes(r.fb_page_linking_pending)),
  };
  const summary={
    totalAttempts:calls.length,
    firstCallDate:calls[0]?.call_date ?? null,
    lastCallDate:calls.at(-1)?.call_date ?? null,
    lastAgent:calls.at(-1)?.agent_name ?? calls.at(-1)?.agent_name_raw ?? null,
    latestOutcome:calls.at(-1)?.l0_label_snapshot ?? calls.at(-1)?.status_raw ?? calls.at(-1)?.remark ?? 'No outcome recorded',
  };
  return NextResponse.json({found:true,customer:c,summary,calls,activeFlags,legacyFlagSources:flagRows});
}
