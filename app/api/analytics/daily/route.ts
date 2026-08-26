import { NextResponse } from 'next/server';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';
import { connectionBucket } from '@/lib/status';
import { classifyCall, hasBucket } from '@/lib/analytics-classification';

function pct(n:number,d:number){return d?Math.round(n*1000/d)/10:0;}

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
           c.l0_label_snapshot,c.l1_label_snapshot,c.l2_label_snapshot,c.call_date,c.whatsapp_handoff,
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

  const count=(bucket:any)=>rows.filter((r:any)=>hasBucket(r,bucket)).length;
  const callbackRequested=count('CALLBACK');
  const interested=count('INTERESTED');
  const paymentDone=count('PAYMENT_DONE');
  const visitsRequested=count('VISIT_REQUESTED');
  const paymentIssues=count('PAYMENT_ISSUE');
  const technicalIssues=count('TECHNICAL_ISSUE');
  const whatsappHandoffs=count('WHATSAPP_HANDOFF');
  const fbLinkingIssues=count('FB_LINKING_ISSUE');

  const freshRows=rows.filter((r:any)=>!r.had_prior_call);
  const repeatRows=rows.filter((r:any)=>r.had_prior_call);
  const freshCustomers=freshRows.length;
  const repeatCustomers=repeatRows.length;
  const freshDisp=new Map<string,number>(), repeatDisp=new Map<string,number>();
  const add=(m:Map<string,number>,k:string)=>m.set(k,(m.get(k)||0)+1);
  const outcome=(r:any)=>r.l0_label_snapshot || r.status_raw || 'No status recorded';
  for(const r of freshRows) add(freshDisp,outcome(r));
  for(const r of repeatRows) add(repeatDisp,outcome(r));
  const toSplit=(m:Map<string,number>,den:number)=>[...m.entries()].sort((a,b)=>b[1]-a[1]).map(([outcome,count])=>({outcome,count,percent:pct(count,den)}));

  const agentMap=new Map<string,{attempts:number,unique:Set<string>,connected:number,interested:number,paymentDone:number,callbacks:number,paymentIssues:number,technicalIssues:number,whatsappHandoffs:number}>();
  for(const r of rows){
    const k=r.agent_name||'Unknown';
    const x=agentMap.get(k)||{attempts:0,unique:new Set<string>(),connected:0,interested:0,paymentDone:0,callbacks:0,paymentIssues:0,technicalIssues:0,whatsappHandoffs:0};
    x.attempts++; x.unique.add(r.customer_id);
    if(connectionBucket(r.l0_label_snapshot||r.status_raw)==='connected')x.connected++;
    const buckets=classifyCall(r);
    if(buckets.has('INTERESTED'))x.interested++;
    if(buckets.has('PAYMENT_DONE'))x.paymentDone++;
    if(buckets.has('CALLBACK'))x.callbacks++;
    if(buckets.has('PAYMENT_ISSUE'))x.paymentIssues++;
    if(buckets.has('TECHNICAL_ISSUE'))x.technicalIssues++;
    if(buckets.has('WHATSAPP_HANDOFF'))x.whatsappHandoffs++;
    agentMap.set(k,x);
  }
  const agentPerformance=[...agentMap.entries()].map(([name,x])=>({
    name,attempts:x.attempts,unique:x.unique.size,connected:x.connected,connectRate:pct(x.connected,x.attempts),
    interested:x.interested,paymentDone:x.paymentDone,callbacks:x.callbacks,paymentIssues:x.paymentIssues,
    technicalIssues:x.technicalIssues,whatsappHandoffs:x.whatsappHandoffs
  })).sort((a,b)=>b.attempts-a.attempts);

  return NextResponse.json({
    from,to,totalAttempts,uniqueAttempted,freshCustomers,repeatCustomers,
    connected,notConnected,unknownConnection,
    connectRateKnownDenominator:(connected+notConnected)?pct(connected,connected+notConnected):null,
    callbackRequested,callbackRate:pct(callbackRequested,totalAttempts),
    interested,interestedRate:pct(interested,totalAttempts),
    paymentDone,paymentRate:pct(paymentDone,totalAttempts),
    visitsRequested,paymentIssues,technicalIssues,whatsappHandoffs,fbLinkingIssues,
    freshDispositionSplit:toSplit(freshDisp,freshCustomers),
    repeatDispositionSplit:toSplit(repeatDisp,repeatCustomers),
    agentPerformance,
    definitions:{
      fresh:'A fresh call is the customer\'s first-ever recorded interaction.',
      repeat:'Every later call for that customer is repeat, including another call on the same day.',
      dispositionSplit:'Fresh/repeat splits use the actual taxonomy/status on each call. Remarks are never used as dispositions.',
      connectRate:'Conservative: known connected/not-connected outcomes only. Unknown legacy outcomes are excluded.',
      semanticBuckets:'Quick Answers classifies approved disposition/status labels across L0, L1 or L2; it never scans free-text remarks.',
      visitsRequested:'Only date-attributable call dispositions are counted; legacy customer-level flags are not assigned to a guessed call date.'
    }
  });
}
