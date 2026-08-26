import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';

function csvCell(v: unknown) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const agent = await currentAgent();
  if (!agent) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  if (agent.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });

  const url = new URL(req.url);
  const from = url.searchParams.get('from') || new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') || from;
  const sql = db();
  const rows = await sql`
    SELECT
      c.customer_id,
      c.call_date,
      c.attempt_number,
      c.call_seq,
      COALESCE(a.name, c.agent_name_raw, 'Unknown agent') AS agent_name,
      c.source_type,
      c.status_raw,
      c.what_happened,
      c.remark,
      c.l0_label_snapshot,
      c.l1_label_snapshot,
      c.l2_label_snapshot,
      c.facebook_page_status,
      c.whatsapp_handoff,
      c.call_duration_seconds,
      c.is_legacy,
      c.source_sheet,
      c.source_row,
      c.source_call_num,
      c.event_time
    FROM calls c
    LEFT JOIN agents a ON a.id = c.agent_id
    WHERE c.call_date BETWEEN ${from}::date AND ${to}::date
      AND c.is_conversion_authoritative = TRUE
    ORDER BY c.call_date, c.customer_id, c.call_seq, c.attempt_number
  `;

  const headers = [
    'customer_id','call_date','attempt_number','call_seq','agent_name','source_type',
    'status_raw','what_happened','remark','l0','l1','l2','facebook_page_status',
    'whatsapp_handoff','call_duration_seconds','is_legacy','source_sheet','source_row',
    'source_call_num','event_time'
  ];
  const body = [headers.join(','), ...rows.map((r:any) => [
    r.customer_id,
    r.call_date instanceof Date ? r.call_date.toISOString().slice(0,10) : String(r.call_date).slice(0,10),
    r.attempt_number,r.call_seq,r.agent_name,r.source_type,r.status_raw,r.what_happened,r.remark,
    r.l0_label_snapshot,r.l1_label_snapshot,r.l2_label_snapshot,r.facebook_page_status,
    r.whatsapp_handoff,r.call_duration_seconds,r.is_legacy,r.source_sheet,r.source_row,
    r.source_call_num,r.event_time instanceof Date ? r.event_time.toISOString() : r.event_time
  ].map(csvCell).join(','))].join('\n');

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="pi-commerce-dispositions-${from}-to-${to}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
