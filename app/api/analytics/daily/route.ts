import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { connectionBucket } from '@/lib/status';
import { classifyCall, hasBucket } from '@/lib/analytics-classification';
import { currentUserAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { saleRevenue } from '@/lib/plans';
import { loadSellerRoles,roleOn } from '@/lib/seller-roles';

function pct(n:number,d:number){return d?Math.round(n*1000/d)/10:0;}

export async function GET(req: Request) {
  const agent:any=await currentUserAccess();
  if (!agent) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if (!isWorkspaceAdmin(agent,'seller')) return NextResponse.json({error:'Seller Admin access required'},{status:403});

  const url=new URL(req.url);
  const today=new Date().toISOString().slice(0,10);
  const from=url.searchParams.get('from') || url.searchParams.get('date') || today;
  const to=url.searchParams.get('to') || url.searchParams.get('date') || from;
  const sql=db();

  const rows=await sql`
    SELECT c.customer_id,c.attempt_number,c.call_seq,c.source_type,c.status_raw,c.remark,
           c.l0_label_snapshot,c.l1_label_snapshot,c.l2_label_snapshot,c.call_date,c.call_date::text AS call_day,c.plan_amount_inr,c.whatsapp_handoff,
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

  let renewalRows:any[]=[];
  try{
    renewalRows=await sql`
      -- A renewal before Ads Live belongs to the case owner; after Ads Live, or on a CSM call, to whoever logged it.
      SELECT e.customer_id,e.event_date::text AS event_day,e.plan_amount_inr,
        CASE WHEN e.source_type<>'customer_success_followup' AND (oc.ads_live_at IS NULL OR e.event_time<oc.ads_live_at) THEN COALESCE(o.name,a.name,e.agent_name_raw,'Unknown')
             ELSE COALESCE(a.name,e.agent_name_raw,'Unknown') END AS agent_name
      FROM onboarding_events e
      JOIN onboarding_cases oc ON oc.id=e.onboarding_case_id
      LEFT JOIN agents o ON o.id=oc.assigned_to
      LEFT JOIN agents a ON a.id=e.agent_id
      WHERE e.l0_code='OB_SUBS_RENEWED'
        AND e.event_date BETWEEN ${from}::date AND ${to}::date
        AND e.source_type IN ('new_event','customer_success_followup')
    `;
  }catch{}

  const totalAttempts=rows.length;
  const uniqueAttempted=new Set(rows.map((r:any)=>r.customer_id)).size;
  const connected=rows.filter((r:any)=>connectionBucket(r.l0_label_snapshot||r.status_raw)==='connected').length;
  const notConnected=rows.filter((r:any)=>connectionBucket(r.l0_label_snapshot||r.status_raw)==='not_connected').length;
  const unknownConnection=totalAttempts-connected-notConnected;
  const count=(bucket:any)=>rows.filter((r:any)=>hasBucket(r,bucket)).length;
  const callbackRequested=count('CALLBACK');
  const interested=count('INTERESTED');
  const paymentDone=count('PAYMENT_DONE')+renewalRows.length;
  // Revenue: ₹799 per sale up to 30 Sep 2026; from 1 Oct the ex-GST price of the plan sold.
  const saleRev=(r:any)=>hasBucket(r,'PAYMENT_DONE')?saleRevenue(r.call_day,r.plan_amount_inr):0;
  const renewalRev=(r:any)=>saleRevenue(r.event_day,r.plan_amount_inr);
  const revenue=rows.reduce((t:number,r:any)=>t+saleRev(r),0)+renewalRows.reduce((t:number,r:any)=>t+renewalRev(r),0);
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

  const agentMap=new Map<string,{attempts:number,unique:Set<string>,connected:number,interested:number,paymentDone:number,revenue:number,callbacks:number,paymentIssues:number,technicalIssues:number,whatsappHandoffs:number}>();
  for(const r of rows){
    const k=r.agent_name||'Unknown';
    const x=agentMap.get(k)||{attempts:0,unique:new Set<string>(),connected:0,interested:0,paymentDone:0,revenue:0,callbacks:0,paymentIssues:0,technicalIssues:0,whatsappHandoffs:0};
    x.attempts++; x.unique.add(r.customer_id);
    if(connectionBucket(r.l0_label_snapshot||r.status_raw)==='connected')x.connected++;
    const buckets=classifyCall(r);
    if(buckets.has('INTERESTED'))x.interested++;
    if(buckets.has('PAYMENT_DONE')){x.paymentDone++;x.revenue+=saleRev(r);}
    if(buckets.has('CALLBACK'))x.callbacks++;
    if(buckets.has('PAYMENT_ISSUE'))x.paymentIssues++;
    if(buckets.has('TECHNICAL_ISSUE'))x.technicalIssues++;
    if(buckets.has('WHATSAPP_HANDOFF'))x.whatsappHandoffs++;
    agentMap.set(k,x);
  }
  for(const r of renewalRows){
    const k=r.agent_name||'Unknown';
    const x=agentMap.get(k)||{attempts:0,unique:new Set<string>(),connected:0,interested:0,paymentDone:0,revenue:0,callbacks:0,paymentIssues:0,technicalIssues:0,whatsappHandoffs:0};
    x.paymentDone++;
    x.revenue+=renewalRev(r);
    agentMap.set(k,x);
  }
  const agentPerformance=[...agentMap.entries()].map(([name,x])=>({
    name,attempts:x.attempts,unique:x.unique.size,connected:x.connected,connectRate:pct(x.connected,x.attempts),
    interested:x.interested,paymentDone:x.paymentDone,revenue:x.revenue,callbacks:x.callbacks,paymentIssues:x.paymentIssues,
    technicalIssues:x.technicalIssues,whatsappHandoffs:x.whatsappHandoffs
  })).sort((a,b)=>b.attempts-a.attempts||b.paymentDone-a.paymentDone);

  // Team revenue: each sale goes to the Team Lead of the seller's team on the sale date
  // (the TL's own sales and their BDEs' sales).
  const roles=await loadSellerRoles(sql);
  const teams=new Map<string,{team:string,members:Set<string>,paymentDone:number,revenue:number}>();
  const addTeam=(person:string,day:string,amount:number)=>{
    const r=roleOn(roles,person,day);
    const lead=r?.role==='TL'?person:r?.role==='BDE'?r.teamLead:null;
    if(!lead) return;
    const t=teams.get(lead)||{team:lead,members:new Set<string>(),paymentDone:0,revenue:0};
    t.members.add(person);t.paymentDone++;t.revenue+=amount;teams.set(lead,t);
  };
  for(const r of rows) if(hasBucket(r,'PAYMENT_DONE')) addTeam(r.agent_name||'Unknown',r.call_day,saleRev(r));
  for(const r of renewalRows) addTeam(r.agent_name||'Unknown',r.event_day,renewalRev(r));
  const teamPerformance=[...teams.values()].map(t=>({team:t.team,members:[...t.members].sort(),paymentDone:t.paymentDone,revenue:t.revenue})).sort((a,b)=>b.revenue-a.revenue);

  return NextResponse.json({
    from,to,totalAttempts,uniqueAttempted,freshCustomers,repeatCustomers,
    connected,notConnected,unknownConnection,
    connectRateKnownDenominator:(connected+notConnected)?pct(connected,connected+notConnected):null,
    callbackRequested,callbackRate:pct(callbackRequested,totalAttempts),
    interested,interestedRate:pct(interested,totalAttempts),
    paymentDone,revenue,teamPerformance,paymentRate:pct(paymentDone,totalAttempts+renewalRows.length),
    onboardingSubscriptionRenewals:renewalRows.length,
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
      revenue:'Ex-GST. ₹799 per sale up to 30 Sep 2026; from 1 Oct 2026 the price of the plan sold (Silver ₹1,999, Gold ₹4,999, Platinum ₹9,999). Renewals before Ads Live count for the case owner, after Ads Live for whoever logged them.',
      subscriptionRenewal:'Only the explicit Subscription Renewed outcome from Onboarding or post-live Customer Success is added to Seller Payment Done. No other onboarding activity affects Seller analytics.',
      visitsRequested:'Only date-attributable call dispositions are counted; legacy customer-level flags are not assigned to a guessed call date.'
    }
  });
}
