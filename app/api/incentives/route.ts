import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import {
  countSales,countedSales,sellerIncentives,sellerRevenueIncentives,onboarderIncentives,mondayOf,BACKFILLED_TOP_UPS,
  SELLER_DAILY_PLANS,SELLER_WEEKLY_PLANS,SELLER_REVENUE_PLANS,ONBOARDER_PLANS,SALE_COUNTING_RULES,SELLER_ROSTER,ONBOARDER_ROSTER,
} from '@/lib/incentives';
import { loadSellerRoles } from '@/lib/seller-roles';
import { loadTeamChanges,earnsOn,teamStateOn } from '@/lib/teams';

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
    SELECT c.customer_id,c.call_date::text AS date,c.call_seq,c.attempt_number,COALESCE(a.name,c.agent_name_raw,'Unknown') AS person,c.plan_amount_inr::float8 AS plan_amount
    FROM calls c LEFT JOIN agents a ON a.id=c.agent_id
    WHERE c.call_date<=${to}::date
      AND (
        (c.source_type='new_call' AND (c.l1_label_snapshot='Payment done' OR c.l2_label_snapshot='Enrolled via WhatsApp'))
        OR (c.source_type<>'new_call' AND lower(trim(c.status_raw))='payment done')
      )
  `;
  // Renewals: up to 30 Sep they were seller sales for whoever logged them; from 1 Oct they are paid
  // under the onboarder / CSM plan to the case owner before Ads Live, or whoever logged them after.
  const renewals=await sql`
    SELECT e.event_date::text AS date,e.customer_id,e.plan_amount_inr::float8 AS plan_amount,
      COALESCE(a.name,e.agent_name_raw,'Unknown') AS logged_by,
      CASE WHEN oc.ads_live_at IS NULL OR e.event_time<oc.ads_live_at THEN COALESCE(o.name,a.name,e.agent_name_raw,'Unknown')
           ELSE COALESCE(a.name,e.agent_name_raw,'Unknown') END AS credited_to
    FROM onboarding_events e
    JOIN onboarding_cases oc ON oc.id=e.onboarding_case_id
    LEFT JOIN agents o ON o.id=oc.assigned_to
    LEFT JOIN agents a ON a.id=e.agent_id
    WHERE e.l0_code='OB_SUBS_RENEWED' AND e.event_date<=${to}::date
  `;
  const roles=await loadSellerRoles(sql);
  const teams=await loadTeamChanges(sql);
  // Onboarding / CSM incentive: on either team that day with incentive on. Sales: a role is
  // needed (seller_roles); a Sales team member marked not eligible earns nothing that day.
  const earnsOnboarding=teams.length?(p:string,d:string)=>earnsOn(teams,['onboarding','csm'],p,d):undefined;
  const earnsSales=teams.length?(p:string,d:string)=>{const s=teamStateOn(teams,p,'sales',d);return !s||!s.member||s.incentive;}:undefined;
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

  const paymentCalls=calls.map((c:any)=>({customerId:String(c.customer_id),date:c.date,seq:Number(c.call_seq),attempt:Number(c.attempt_number),person:c.person,planAmount:c.plan_amount==null?null:Number(c.plan_amount)}));
  const saleDays=countSales(paymentCalls,renewals.map((r:any)=>({date:r.date,person:r.logged_by}))).filter(s=>s.date>=mondayOf(from!));
  const seller=sellerIncentives(saleDays,from!,to!);
  const revenueWeeks=sellerRevenueIncentives(countedSales(paymentCalls).filter(s=>s.date>=mondayOf(from!)),roles,from!,to!,earnsSales);
  const onboarder=onboarderIncentives(
    adsLive.map((c:any)=>({date:c.date,person:c.person})),
    [...topUps.map((t:any)=>({date:t.date,person:t.person,amount:Number(t.amount),customerId:String(t.customer_id)})),...BACKFILLED_TOP_UPS],
    from!,to!,
    renewals.map((r:any)=>({date:r.date,person:r.credited_to,amount:Number(r.plan_amount||0),customerId:String(r.customer_id)})),
    earnsOnboarding,
  );

  const people=new Map<string,any>();
  const person=(name:string)=>{const p=people.get(name)||{name,sales:0,sellerDaily:0,weeklyBonus:0,revenue:0,revenuePay:0,teamShare:0,adsLiveCases:0,casePay:0,topUps:0,topUpValue:0,topUpPay:0,renewals:0,renewalValue:0,renewalPay:0,total:0};people.set(name,p);return p;};
  for(const r of seller.daily){const p=person(r.person);p.sales+=r.sales;p.sellerDaily+=r.pay;}
  for(const r of seller.weekly){if(r.pay>0)person(r.person).weeklyBonus+=r.pay;}
  for(const r of revenueWeeks){const p=person(r.person);p.sales+=r.sales;p.revenue+=r.revenue;p.revenuePay+=r.slabPay;p.teamShare+=r.teamShare;}
  for(const r of onboarder){const p=person(r.person);p.adsLiveCases+=r.cases;p.casePay+=r.casePay;p.topUps+=r.topUps;p.topUpValue+=r.topUpValue;p.topUpPay+=r.topUpPay;p.renewals+=r.renewals;p.renewalValue+=r.renewalValue;p.renewalPay+=r.renewalPay;}
  const summary=[...people.values()].map(p=>({...p,topUpPay:round(p.topUpPay),renewalPay:round(p.renewalPay),teamShare:round(p.teamShare),total:round(p.sellerDaily+p.weeklyBonus+p.revenuePay+p.teamShare+p.casePay+p.topUpPay+p.renewalPay)}))
    .sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  const sum=(k:string)=>round(summary.reduce((s,p)=>s+Number(p[k]||0),0));

  return NextResponse.json({
    from,to,
    totals:{payout:sum('total'),sellerDaily:sum('sellerDaily'),weeklyBonus:sum('weeklyBonus'),revenue:sum('revenue'),revenuePay:round(sum('revenuePay')+sum('teamShare')),casePay:sum('casePay'),topUpPay:sum('topUpPay'),renewals:sum('renewals'),renewalValue:sum('renewalValue'),renewalPay:sum('renewalPay'),sales:sum('sales'),adsLiveCases:sum('adsLiveCases'),topUps:sum('topUps'),topUpValue:sum('topUpValue')},
    people:summary,
    sellerDaily:seller.daily.filter(r=>r.sales>0),
    sellerWeekly:seller.weekly,
    sellerRevenueWeekly:revenueWeeks,
    onboarderDaily:onboarder,
    plans:{sellerDaily:SELLER_DAILY_PLANS,sellerWeekly:SELLER_WEEKLY_PLANS,sellerRevenue:SELLER_REVENUE_PLANS,roles,onboarder:ONBOARDER_PLANS,saleCounting:SALE_COUNTING_RULES,sellerRoster:SELLER_ROSTER,onboarderRoster:ONBOARDER_ROSTER},
  });
}
