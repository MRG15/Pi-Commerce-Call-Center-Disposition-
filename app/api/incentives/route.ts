import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import {
  countSales,sellerIncentives,onboarderIncentives,mondayOf,BACKFILLED_TOP_UPS,
  SELLER_DAILY_PLANS,SELLER_WEEKLY_PLANS,ONBOARDER_PLANS,SALE_COUNTING_RULES,SELLER_ROSTER,ONBOARDER_ROSTER,
} from '@/lib/incentives';

const isDate=(v:string|null)=>Boolean(v&&/^\d{4}-\d{2}-\d{2}$/.test(v));
const round=(n:number)=>Math.round(n*100)/100;

export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!user.isSuperAdmin) return NextResponse.json({error:'Super Admin access required'},{status:403});
  const u=new URL(req.url); const from=u.searchParams.get('from'); const to=u.searchParams.get('to');
  if(!isDate(from)||!isDate(to)||from!>to!) return NextResponse.json({error:'from and to are required (YYYY-MM-DD, from ≤ to)'},{status:400});
  const sql=db();

  // All Payment done / Enrolled via WhatsApp calls up to `to`: the first-payment rule needs full history.
  const calls=await sql`
    SELECT c.customer_id,c.call_date::text AS date,c.call_seq,c.attempt_number,COALESCE(a.name,c.agent_name_raw,'Unknown') AS person
    FROM calls c LEFT JOIN agents a ON a.id=c.agent_id
    WHERE c.call_date<=${to}::date
      AND (
        (c.source_type='new_call' AND (c.l1_label_snapshot='Payment done' OR c.l2_label_snapshot='Enrolled via WhatsApp'))
        OR (c.source_type<>'new_call' AND lower(trim(c.status_raw))='payment done')
      )
  `;
  const renewals=await sql`
    SELECT e.event_date::text AS date,COALESCE(a.name,e.agent_name_raw,'Unknown') AS person
    FROM onboarding_events e LEFT JOIN agents a ON a.id=e.agent_id
    WHERE e.l0_code='OB_SUBS_RENEWED' AND e.event_date<=${to}::date
  `;
  // Ads Live cases credited to the case's assignee; externally-live (Sub Raw) cases never count.
  const adsLive=await sql`
    SELECT (c.ads_live_at AT TIME ZONE 'Asia/Kolkata')::date::text AS date,a.name AS person
    FROM onboarding_cases c JOIN agents a ON a.id=c.assigned_to
    WHERE c.ads_live_at IS NOT NULL
      AND (c.ads_live_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${from}::date AND ${to}::date
      AND NOT EXISTS (SELECT 1 FROM onboarding_events x WHERE x.onboarding_case_id=c.id AND x.l0_code='SYSTEM_EXTERNAL_ADS_LIVE')
  `;
  // Top-ups credited to whoever logged them: amount entered on Ads Live, or an Additional Top-up.
  const topUps=await sql`
    SELECT e.event_date::text AS date,COALESCE(a.name,e.agent_name_raw,'Unknown') AS person,e.top_up_amount_inr::float8 AS amount,e.customer_id
    FROM onboarding_events e LEFT JOIN agents a ON a.id=e.agent_id
    WHERE e.l0_code IN ('OB_ADS_LIVE','OB_ADDITIONAL_TOPUP')
      AND e.top_up_amount_inr>0
      AND e.event_date BETWEEN ${from}::date AND ${to}::date
  `;

  const saleDays=countSales(
    calls.map((c:any)=>({customerId:String(c.customer_id),date:c.date,seq:Number(c.call_seq),attempt:Number(c.attempt_number),person:c.person})),
    renewals.map((r:any)=>({date:r.date,person:r.person})),
  ).filter(s=>s.date>=mondayOf(from!));
  const seller=sellerIncentives(saleDays,from!,to!);
  const onboarder=onboarderIncentives(
    adsLive.map((c:any)=>({date:c.date,person:c.person})),
    [...topUps.map((t:any)=>({date:t.date,person:t.person,amount:Number(t.amount),customerId:String(t.customer_id)})),...BACKFILLED_TOP_UPS],
    from!,to!,
  );

  const people=new Map<string,any>();
  const person=(name:string)=>{const p=people.get(name)||{name,sales:0,sellerDaily:0,weeklyBonus:0,adsLiveCases:0,casePay:0,topUps:0,topUpValue:0,topUpPay:0,total:0};people.set(name,p);return p;};
  for(const r of seller.daily){const p=person(r.person);p.sales+=r.sales;p.sellerDaily+=r.pay;}
  for(const r of seller.weekly){if(r.pay>0)person(r.person).weeklyBonus+=r.pay;}
  for(const r of onboarder){const p=person(r.person);p.adsLiveCases+=r.cases;p.casePay+=r.casePay;p.topUps+=r.topUps;p.topUpValue+=r.topUpValue;p.topUpPay+=r.topUpPay;}
  const summary=[...people.values()].map(p=>({...p,topUpPay:round(p.topUpPay),total:round(p.sellerDaily+p.weeklyBonus+p.casePay+p.topUpPay)}))
    .sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  const sum=(k:string)=>round(summary.reduce((s,p)=>s+Number(p[k]||0),0));

  return NextResponse.json({
    from,to,
    totals:{payout:sum('total'),sellerDaily:sum('sellerDaily'),weeklyBonus:sum('weeklyBonus'),casePay:sum('casePay'),topUpPay:sum('topUpPay'),sales:sum('sales'),adsLiveCases:sum('adsLiveCases'),topUps:sum('topUps'),topUpValue:sum('topUpValue')},
    people:summary,
    sellerDaily:seller.daily.filter(r=>r.sales>0),
    sellerWeekly:seller.weekly,
    onboarderDaily:onboarder,
    plans:{sellerDaily:SELLER_DAILY_PLANS,sellerWeekly:SELLER_WEEKLY_PLANS,onboarder:ONBOARDER_PLANS,saleCounting:SALE_COUNTING_RULES,sellerRoster:SELLER_ROSTER,onboarderRoster:ONBOARDER_ROSTER},
  });
}
