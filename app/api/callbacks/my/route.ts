import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(){
  const agent=await currentAgent();
  if(!agent) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const sql=db();
  const rows=await sql`
    SELECT
      c.id,c.customer_id,c.attempt_number,c.callback_at,c.remark,
      c.l0_label_snapshot,c.l1_label_snapshot,c.l2_label_snapshot,
      CASE
        WHEN c.callback_at < now() THEN 'overdue'
        WHEN (c.callback_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'today'
        WHEN (c.callback_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date + 1 THEN 'tomorrow'
        ELSE 'upcoming'
      END AS bucket
    FROM calls c
    WHERE c.agent_id=${String(agent.id)}::uuid
      AND c.callback_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM calls later
        WHERE later.customer_id=c.customer_id
          AND later.attempt_number>c.attempt_number
          AND later.event_time IS NOT NULL
      )
    ORDER BY c.callback_at ASC
  `;
  const grouped:any={overdue:[],today:[],tomorrow:[],upcoming:[]};
  for(const r of rows){
    const b=String(r.bucket||'upcoming');
    (grouped[b]||grouped.upcoming).push(r);
  }
  return NextResponse.json({callbacks:grouped});
}
