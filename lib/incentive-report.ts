// The incentive report for [from,to]: the per-person totals and ledgers shown on the Incentives
// tab, plus every line behind them (raw dump). Used by the Incentives tab and its downloads, so
// the numbers are always the same.
import {
  countSales,countedSales,sellerIncentives,sellerRevenueIncentives,sellerPlanDailyIncentives,onboarderIncentives,mondayOf,BACKFILLED_TOP_UPS,SELLER_PLAN_DAILY_PLANS,
  SELLER_DAILY_PLANS,SELLER_WEEKLY_PLANS,SELLER_REVENUE_PLANS,ONBOARDER_PLANS,SALE_COUNTING_RULES,SELLER_ROSTER,ONBOARDER_ROSTER,isMember,planOn,topUpPay,
} from '@/lib/incentives';
import { loadSellerRoles } from '@/lib/seller-roles';
import { loadTeamChanges,earnsOn,teamStateOn } from '@/lib/teams';

const round=(n:number)=>Math.round(n*100)/100;

export async function buildIncentiveReport(sql:any,from:string,to:string){

  // All Payment done / Enrolled via WhatsApp calls up to `to`: the first-payment rule needs full history.
  const calls=await sql`
    SELECT COALESCE(c.customer_id,'lead:'||c.lead_id::text) AS customer_id,c.call_date::text AS date,c.call_seq,c.attempt_number,COALESCE(a.name,c.agent_name_raw,'Unknown') AS person,c.plan_amount_inr::float8 AS plan_amount,c.plan_code
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
    SELECT (c.ads_live_at AT TIME ZONE 'Asia/Kolkata')::date::text AS date,a.name AS person,c.customer_id
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
    UNION ALL
    -- Plan Upgraded in Onboarding / CSM: the upgrade value is priced like a top-up for whoever logged it.
    SELECT e.event_date::text,COALESCE(a.name,e.agent_name_raw,'Unknown'),e.upgrade_value_inr::float8,e.customer_id
    FROM onboarding_events e LEFT JOIN agents a ON a.id=e.agent_id
    WHERE e.l0_code='OB_PLAN_UPGRADED' AND e.upgrade_value_inr>0
      AND e.event_date BETWEEN ${from}::date AND ${to}::date
  `;
  // Plan Upgraded in the Seller workspace: a sale of the new plan for the daily plan incentive,
  // and the upgrade value as revenue for the weekly revenue incentive.
  const sellerUpgrades=await sql`
    SELECT c.customer_id,c.call_date::text AS date,COALESCE(a.name,c.agent_name_raw,'Unknown') AS person,c.plan_code,c.upgrade_value_inr::float8 AS value
    FROM calls c LEFT JOIN agents a ON a.id=c.agent_id
    WHERE c.upgrade_from_plan IS NOT NULL AND c.call_date BETWEEN ${mondayOf(from!)}::date AND ${to}::date
  `;

  const paymentCalls=calls.map((c:any)=>({customerId:String(c.customer_id),date:c.date,seq:Number(c.call_seq),attempt:Number(c.attempt_number),person:c.person,planAmount:c.plan_amount==null?null:Number(c.plan_amount),planCode:c.plan_code||null}));
  const upgradeSales=sellerUpgrades.map((u:any)=>({customerId:String(u.customer_id),date:u.date,person:u.person,revenue:Number(u.value||0),plan:u.plan_code}));
  const sellerSales=[...countedSales(paymentCalls).filter(s=>s.date>=mondayOf(from!)),...upgradeSales];
  const saleDays=countSales(paymentCalls,renewals.map((r:any)=>({date:r.date,person:r.logged_by}))).filter(s=>s.date>=mondayOf(from!));
  const seller=sellerIncentives(saleDays,from!,to!);
  const revenueWeeks=sellerRevenueIncentives(sellerSales,roles,from!,to!,earnsSales);
  const planDaily=sellerPlanDailyIncentives(sellerSales,roles,from!,to!,earnsSales);
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
  // Daily plan incentive (from 1 Oct) is shown under Seller Daily; its sales are already counted via the weekly rows.
  for(const r of planDaily){person(r.person).sellerDaily+=r.pay;}
  for(const r of revenueWeeks){const p=person(r.person);p.sales+=r.sales;p.revenue+=r.revenue;p.revenuePay+=r.slabPay;p.teamShare+=r.teamShare;}
  for(const r of onboarder){const p=person(r.person);p.adsLiveCases+=r.cases;p.casePay+=r.casePay;p.topUps+=r.topUps;p.topUpValue+=r.topUpValue;p.topUpPay+=r.topUpPay;p.renewals+=r.renewals;p.renewalValue+=r.renewalValue;p.renewalPay+=r.renewalPay;}
  const summary=[...people.values()].map(p=>({...p,topUpPay:round(p.topUpPay),renewalPay:round(p.renewalPay),teamShare:round(p.teamShare),total:round(p.sellerDaily+p.weeklyBonus+p.revenuePay+p.teamShare+p.casePay+p.topUpPay+p.renewalPay)}))
    .sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name));
  const sum=(k:string)=>round(summary.reduce((s,p)=>s+Number(p[k]||0),0));

  // Raw dump: every line behind the totals. Lines that carry an incentive (daily / weekly rows,
  // each top-up and renewal) add up to each person's total; sale and case lines are the detail
  // those rows count (no incentive of their own).
  type Raw={section:string;date:string;weekEnd?:string;person:string;customer?:string;detail?:string;count?:number|null;amount?:number|null;incentive?:number|null};
  const raw:Raw[]=[];
  const PLAN=(p?:string|null)=>p?p[0].toUpperCase()+p.slice(1):'';
  for(const c of sellerSales) if(c.date>=from&&c.date<=to) raw.push({section:'Seller sale',date:c.date,person:c.person,customer:c.customerId.startsWith('lead:')?'Lead (no Cust ID yet)':c.customerId,detail:PLAN(c.plan),amount:round(c.revenue)});
  for(const d of seller.daily) raw.push({section:'Seller daily incentive (to 30 Sep)',date:d.date,person:d.person,detail:d.plan,count:d.sales,incentive:d.pay});
  for(const d of planDaily) raw.push({section:'Seller daily plan incentive (from 1 Oct)',date:d.date,person:d.person,detail:`Silver ${d.silver} · Gold ${d.gold} · Platinum ${d.platinum}`,count:d.silver+d.gold+d.platinum,incentive:d.pay});
  for(const w of seller.weekly) raw.push({section:'Seller weekly bonus (to 30 Sep)',date:w.weekStart,weekEnd:w.weekEnd,person:w.person,detail:w.plan,count:w.sales,incentive:w.pay});
  for(const w of revenueWeeks) raw.push({section:'Seller weekly revenue incentive (from 1 Oct)',date:w.activeFrom,weekEnd:w.activeTo,person:w.person,detail:`${w.role}${w.teamLead?' · TL '+w.teamLead:''} · slabs ₹${w.slabPay} + TL team share ₹${w.teamShare}`,count:w.sales,amount:round(w.revenue),incentive:round(w.slabPay+w.teamShare)});
  for(const c of adsLive) raw.push({section:'Ads live case',date:c.date,person:c.person,customer:String(c.customer_id||'')});
  for(const o of onboarder) if(o.cases>0) raw.push({section:'Ads live daily incentive',date:o.date,person:o.person,detail:o.plan,count:o.cases,incentive:o.casePay});
  const eligibleOb=(p:string,d:string)=>earnsOnboarding?earnsOnboarding(p,d):isMember(ONBOARDER_ROSTER,p,d);
  for(const t of [...topUps.map((x:any)=>({date:x.date,person:x.person,amount:Number(x.amount),customerId:String(x.customer_id||''),note:''})),...BACKFILLED_TOP_UPS]){
    const plan=planOn(ONBOARDER_PLANS,t.date);
    if(t.date<from||t.date>to||!plan) continue;
    const ok=eligibleOb(t.person,t.date);
    raw.push({section:'Top-up',date:t.date,person:t.person,customer:t.customerId||t.note||'',detail:ok?'':'Not eligible that day',amount:t.amount,incentive:ok?topUpPay(plan,t.amount):0});
  }
  for(const t of renewals){
    const plan=planOn(ONBOARDER_PLANS,t.date);
    if(t.date<from||t.date>to||!plan?.paysRenewals) continue;
    const ok=eligibleOb(t.credited_to,t.date);
    raw.push({section:'Subscription renewal',date:t.date,person:t.credited_to,customer:String(t.customer_id||''),detail:ok?'':'Not eligible that day',amount:Number(t.plan_amount||0),incentive:ok?topUpPay(plan,Number(t.plan_amount||0)):0});
  }
  raw.sort((a,b)=>a.person.localeCompare(b.person)||a.section.localeCompare(b.section)||a.date.localeCompare(b.date));
  // Each person's team on the last day of the period (Sales / Onboarding / CSM).
  const teamOf=(name:string)=>(['sales','onboarding','csm'] as const).find(t=>teamStateOn(teams,name,t,to)?.member)||'';
  for(const p of summary as any[]) p.team=teamOf(p.name);

  return {
    from,to,raw,
    totals:{payout:sum('total'),sellerDaily:sum('sellerDaily'),weeklyBonus:sum('weeklyBonus'),revenue:sum('revenue'),revenuePay:round(sum('revenuePay')+sum('teamShare')),casePay:sum('casePay'),topUpPay:sum('topUpPay'),renewals:sum('renewals'),renewalValue:sum('renewalValue'),renewalPay:sum('renewalPay'),sales:sum('sales'),adsLiveCases:sum('adsLiveCases'),topUps:sum('topUps'),topUpValue:sum('topUpValue')},
    people:summary,
    sellerDaily:seller.daily.filter(r=>r.sales>0),
    sellerWeekly:seller.weekly,
    sellerRevenueWeekly:revenueWeeks,
    sellerPlanDaily:planDaily,
    onboarderDaily:onboarder,
    plans:{sellerDaily:SELLER_DAILY_PLANS,sellerPlanDaily:SELLER_PLAN_DAILY_PLANS,sellerWeekly:SELLER_WEEKLY_PLANS,sellerRevenue:SELLER_REVENUE_PLANS,roles,onboarder:ONBOARDER_PLANS,saleCounting:SALE_COUNTING_RULES,sellerRoster:SELLER_ROSTER,onboarderRoster:ONBOARDER_ROSTER},
  }
}
