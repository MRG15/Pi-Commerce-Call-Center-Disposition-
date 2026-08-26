import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';
import { connectionBucket, normalizeStatus } from '@/lib/status';

function pct(n:number,d:number){return d?Math.round(n*1000/d)/10:0;}
function isCallback(r:any){
  const parts=[r.l0_label_snapshot,r.l1_label_snapshot,r.l2_label_snapshot,r.status_raw].filter(Boolean).map((v:string)=>normalizeStatus(v));
  return parts.some((v:string|null)=>v?.includes('callback')||v==='call back');
}
function isInterested(r:any){
  const l0=normalizeStatus(r.l0_label_snapshot);
  const raw=normalizeStatus(r.status_raw);
  return l0==='interested' || !!raw && (raw.includes('interested') || raw==='cx on process');
}
function isPaymentDone(r:any){
  return [r.l1_label_snapshot,r.l2_label_snapshot,r.status_raw].filter(Boolean).some((v:string)=>normalizeStatus(v)==='payment done');
}
function isVisitRequested(r:any){
  return [r.l1_label_snapshot,r.l2_label_snapshot].filter(Boolean).some((v:string)=>normalizeStatus(v)?.includes('field visit'));
}

export async function GET(req: Request) {
  const agent=await currentAgent();
  if (!agent) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if (agent.role !== 'admin') return NextResponse.json({error:'Admin access required'},{status:403});

  const url=new URL(req.url);
  const today=new Date().toISOString().slice(0,10);
  const from=url.searchParams.get('from') || url.searchParams.get('date') || today;
  const to=url.searchParams.get('to') || url.searchParams.get('date') || from;
  const sql=db();

  const rows=await sql`
    SELECT c.customer_id,c.attempt_number,c.call_seq,c.source_type,c.status_raw,c.remark,
           c.l0_label_snapshot,c.l1_label_snapshot,c.l2_label_snapshot,c.call_date,
           COALESCE(a.name,c.agent_name_raw,'Unknown') AS agent_name,
           EXISTS (
             SELECT 1 FROM calls p
             WHERE p.customer_id=c.customer_id
               AND (p.call_date < c.call_date OR (p.call_date=c.call_date AND (p.call_seq < c.call_seq OR (p.call_seq=c.call_seq AND p.attempt_number<c.attempt_number))))
           ) AS had_prior_call
    FROM calls c
    LEFT JOIN agents a ON a.id=c.agent_id
    WHERE c.call_date BETWEEN ${from}::date AND ${to}::date
      AND c.is_conversion_authoritative=TRUE
    ORDER BY c.customer_id,c.call_date,c.call_seq,c.attempt_number
  `;

  const totalAttempts=rows.length;
  const uniqueAttempted=new Set(rows.map((r:any)=>r.customer_id)).size;
  const connected=rows.filter((r:any)=>connectionBucket(r.l0_label_snapshot||r.status_raw)==='connected').length;
  const notConnected=rows.filter((r:any)=>connectionBucket(r.l0_label_snapshot||r.status_raw)==='not_connected').length;
  const unknownConnection=totalAttempts-connected-notConnected;
  const callbackRequested=rows.filter(isCallback).length;
  const interested=rows.filter(isInterested).length;
  const paymentDone=rows.filter(isPaymentDone).length;
  const visitsRequested=rows.filter(isVisitRequested).length;

  const byCustomer=new Map<string,any[]>();
  for (const r of rows) { const a=byCustomer.get(r.customer_id)||[]; a.push(r); byCustomer.set(r.customer_id,a); }
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
  const toSplit=(m:Map<string,number>,den:number)=>[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([outcome,count])=>({outcome,count,percent:pct(count,den)}));

  const agentMap=new Map<string,{attempts:number,unique:Set<string>,connected:number,interested:number,paymentDone:number,callbacks:number}>();
  for(const r of rows){
    const k=r.agent_name||'Unknown'; const x=agentMap.get(k)||{attempts:0,unique:new Set<string>(),connected:0,interested:0,paymentDone:0,callbacks:0};
    x.attempts++; x.unique.add(r.customer_id);
    if(connectionBucket(r.l0_label_snapshot||r.status_raw)==='connected')x.connected++;
    if(isInterested(r))x.interested++;
    if(isPaymentDone(r))x.paymentDone++;
    if(isCallback(r))x.callbacks++;
    agentMap.set(k,x);
  }
  const agentPerformance=[...agentMap.entries()].map(([name,x])=>({name,attempts:x.attempts,unique:x.unique.size,connected:x.connected,connectRate:pct(x.connected,x.attempts),interested:x.interested,paymentDone:x.paymentDone,callbacks:x.callbacks})).sort((a,b)=>b.attempts-a.attempts);

  return NextResponse.json({
    from,to,totalAttempts,uniqueAttempted,freshCustomers,repeatCustomers,
    connected,notConnected,unknownConnection,
    connectRateKnownDenominator:(connected+notConnected)?pct(connected,connected+notConnected):null,
    callbackRequested,callbackRate:pct(callbackRequested,totalAttempts),
    interested,interestedRate:pct(interested,totalAttempts),
    paymentDone,paymentRate:pct(paymentDone,totalAttempts),
    visitsRequested,
    freshDispositionSplit:toSplit(freshDisp,freshCustomers),
    repeatDispositionSplit:toSplit(repeatDisp,repeatCustomers),
    agentPerformance,
    definitions:{
      fresh:'A customer whose first-ever recorded interaction occurs in the selected period.',
      repeat:'A customer with at least one recorded interaction before their first interaction in the selected period.',
      dispositionSplit:'For unique-customer splits, the latest interaction in the selected period is used.',
      connectRate:'Conservative: known connected/not-connected outcomes only. Unknown legacy outcomes are excluded.',
      visitsRequested:'Only new-taxonomy calls with the assisted support / field visit disposition; legacy customer-level visit flags are not date-attributed.'
    }
  });
}
