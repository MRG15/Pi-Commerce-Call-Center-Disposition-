import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(){
  const agent=await currentAgent();
  if(!agent) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const sql=db();
  const rows=await sql`
    SELECT
      c.id,c.customer_id,c.lead_id,c.phone,COALESCE(l.name,NULL) AS lead_name,c.attempt_number,c.callback_at,c.remark,
      c.l0_label_snapshot,c.l1_label_snapshot,c.l2_label_snapshot,
      CASE
        WHEN c.callback_at < now() THEN 'overdue'
        WHEN (c.callback_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'today'
        WHEN (c.callback_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date + 1 THEN 'tomorrow'
        ELSE 'upcoming'
      END AS bucket
    FROM calls c LEFT JOIN leadgen_leads l ON l.id=c.lead_id
    WHERE c.agent_id=${String(agent.id)}::uuid
      AND c.callback_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM calls later
        WHERE ((c.customer_id IS NOT NULL AND later.customer_id=c.customer_id)
            OR (c.customer_id IS NULL AND later.customer_id IS NULL AND later.lead_id=c.lead_id))
          AND later.attempt_number>c.attempt_number
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
