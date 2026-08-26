import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';
import { connectionBucket } from '@/lib/status';

export async function GET(req: Request) {
  const agent=await currentAgent();
  if (!agent) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if (agent.role !== 'admin') return NextResponse.json({error:'Admin access required'},{status:403});
  const url=new URL(req.url);
  const date=url.searchParams.get('date') || new Date().toISOString().slice(0,10);
  const sql=db();
  const rows=await sql`
    SELECT c.customer_id,c.attempt_number,c.call_seq,c.source_type,c.status_raw,
           c.l0_label_snapshot,c.l1_label_snapshot,c.l2_label_snapshot,c.call_date,
           EXISTS (
             SELECT 1 FROM calls p
             WHERE p.customer_id=c.customer_id
               AND (p.call_date < c.call_date OR (p.call_date=c.call_date AND p.call_seq < c.call_seq))
           ) AS had_prior_call
    FROM calls c
    WHERE c.call_date=${date}::date AND c.is_conversion_authoritative=TRUE
    ORDER BY c.customer_id,c.call_seq,c.attempt_number
  `;

  const totalAttempts=rows.length;
  const uniqueAttempted=new Set(rows.map((r:any)=>r.customer_id)).size;
  const connected=rows.filter((r:any)=>connectionBucket(r.l0_label_snapshot||r.status_raw)==='connected').length;
  const notConnected=rows.filter((r:any)=>connectionBucket(r.l0_label_snapshot||r.status_raw)==='not_connected').length;
  const unknownConnection=totalAttempts-connected-notConnected;

  const byCustomer=new Map<string,any[]>();
  for (const r of rows) {
    const a=byCustomer.get(r.customer_id)||[]; a.push(r); byCustomer.set(r.customer_id,a);
  }
  let freshCustomers=0, repeatCustomers=0;
  const freshDisp=new Map<string,number>(), repeatDisp=new Map<string,number>();
  const add=(m:Map<string,number>,k:string)=>m.set(k,(m.get(k)||0)+1);
  for (const [,calls] of byCustomer) {
    const fresh=!calls[0].had_prior_call;
    const latest=calls[calls.length-1];
    const outcome=latest.l0_label_snapshot || latest.status_raw || latest.remark || 'No outcome recorded';
    if (fresh) { freshCustomers++; add(freshDisp,outcome); }
    else { repeatCustomers++; add(repeatDisp,outcome); }
  }
  const toSplit=(m:Map<string,number>,den:number)=>[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([outcome,count])=>({outcome,count,percent:den?Math.round(count*1000/den)/10:0}));

  return NextResponse.json({
    date,
    totalAttempts,uniqueAttempted,freshCustomers,repeatCustomers,
    connected,notConnected,unknownConnection,
    connectRateKnownDenominator:(connected+notConnected)?Math.round(connected*1000/(connected+notConnected))/10:null,
    freshDispositionSplit:toSplit(freshDisp,freshCustomers),
    repeatDispositionSplit:toSplit(repeatDisp,repeatCustomers),
    definitions:{
      fresh:'A customer whose first-ever recorded interaction occurs on this date.',
      repeat:'A customer with at least one recorded interaction before this date/call.',
      dispositionSplit:'For unique-customer splits, the latest interaction on the selected date is used.',
      connectRate:'Conservative default using known connected/not-connected outcomes only. Unknown legacy outcomes are excluded from the denominator.'
    }
  });
}
