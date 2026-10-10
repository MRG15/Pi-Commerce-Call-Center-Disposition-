// Incentive plans and payout rules. Everything here is date-effective:
// a new plan or rule is added as a NEW entry with its own start date. Never edit
// an old entry, or days that were already paid would be re-priced.

import { saleRevenue } from './plans';
import { roleOn, type SellerRoleRow, type SellerRole } from './seller-roles';

export type DailyLadderPlan = { from:string; to?:string; name:string; unlock:number; unlockPay:number; bands:{upTo:number|null; rate:number}[] };
export type WeeklyPlan = { from:string; to?:string; name:string; slabs:{at:number; pay:number}[] };
export type OnboarderPlan = { from:string; to?:string; name:string; unlock:number; unlockPay:number; perCase:number; topUpMin:number; topUpCeiling:number; rateUpToCeiling:number; rateAboveCeiling:number; paysRenewals?:boolean };
export type RevenueSlab = { at:number; pay:number };
export type SellerRevenuePlan = { from:string; to?:string; name:string; slabs:Record<'BDE'|'SBDE'|'TL',RevenueSlab[]>; tlShareOfBde:number };
export type SaleCountingRule = { from:string; rule:'unique_per_day'|'first_payment_ever' };
export type Membership = { name:string; from:string; to?:string };

// Seller daily plans. Launch 6–23 Aug 2026, Uplift 24 Aug – 30 Sep 2026. Replaced by the
// weekly revenue plan from 1 Oct 2026.
export const SELLER_DAILY_PLANS:DailyLadderPlan[] = [
  { from:'2026-08-06', name:'Launch', unlock:2, unlockPay:150, bands:[{upTo:5,rate:50},{upTo:10,rate:100},{upTo:null,rate:150}] },
  { from:'2026-08-24', to:'2026-09-30', name:'Uplift', unlock:2, unlockPay:150, bands:[{upTo:5,rate:100},{upTo:10,rate:150},{upTo:null,rate:200}] },
];

// Seller weekly bonus (Mon–Sun), on top of the daily incentive. Chosen by the week's Monday.
// Slabs are not additive: 12–17 sales pay ₹1,200, 18+ pay ₹2,000. It ended on 30 Sep 2026:
// for the week of 28 Sep only sales up to 30 Sep count, still credited on Sunday 4 Oct.
export const SELLER_WEEKLY_PLANS:WeeklyPlan[] = [
  { from:'2026-09-07', to:'2026-09-30', name:'Weekly bonus', slabs:[{at:12,pay:1200},{at:18,pay:2000}] },
];

// Seller weekly revenue plan from 1 Oct 2026 (Thu): weeks run Mon–Sun, the first one 1–4 Oct.
// Slabs are cumulative: reaching each threshold adds its payout. A TL earns SBDE slabs on their
// own revenue plus half of what each of their BDEs earns that week.
export const SELLER_REVENUE_PLANS:SellerRevenuePlan[] = [
  { from:'2026-10-01', name:'Weekly revenue', tlShareOfBde:0.5, slabs:{
    BDE:[{at:30000,pay:2000},{at:50000,pay:3000},{at:100000,pay:5000}],
    SBDE:[{at:40000,pay:3000},{at:80000,pay:5000},{at:140000,pay:6000}],
    TL:[{at:40000,pay:3000},{at:80000,pay:5000},{at:140000,pay:6000}],
  } },
];

// Onboarder / CSM plan from 1 Sep 2026: Ads Live cases (daily ladder) + per-instance top-ups.
// Each top-up is priced on its own: below ₹1,000 earns nothing, up to ₹5,000 earns 5%,
// above ₹5,000 earns 10% of the whole amount. From 1 Oct 2026 each Subscription Renewed is
// priced the same way on its plan price (before Ads Live it belongs to the case owner, after
// Ads Live to whoever logged it).
export const ONBOARDER_PLANS:OnboarderPlan[] = [
  { from:'2026-09-01', to:'2026-09-30', name:'Ads Live + Top-up', unlock:5, unlockPay:200, perCase:50, topUpMin:1000, topUpCeiling:5000, rateUpToCeiling:0.05, rateAboveCeiling:0.10 },
  { from:'2026-10-01', name:'Ads Live + Top-up + Renewal', unlock:5, unlockPay:200, perCase:50, topUpMin:1000, topUpCeiling:5000, rateUpToCeiling:0.05, rateAboveCeiling:0.10, paysRenewals:true },
];

// How seller Payment done calls turn into sales. Up to 20 Sep 2026 the Excel counted a customer
// once per day. From 21 Sep 2026 a customer counts only on their first-ever Payment done.
// Subscription Renewed always counts as +1 for the person who logged it.
export const SALE_COUNTING_RULES:SaleCountingRule[] = [
  { from:'2026-08-06', rule:'unique_per_day' },
  { from:'2026-09-21', rule:'first_payment_ever' },
];

// Who is on which plan, by exact agent name. Moving someone off a plan means setting `to`;
// never delete a row, so their earlier record stays intact.
export const SELLER_ROSTER:Membership[] = [
  { name:'Umesh', from:'2026-08-06' },
  { name:'Sheena', from:'2026-08-06' },
  { name:'Ashish', from:'2026-08-06', to:'2026-08-31' },
  { name:'Abhishek', from:'2026-08-06' },
  { name:'Kunal', from:'2026-08-06' },
  { name:'Deepak', from:'2026-08-06' },
  { name:'Rajdeep', from:'2026-08-06' },
  { name:'Jay', from:'2026-08-06' },
];

// Onboarder / CSM incentive eligibility now comes from team membership by date (team_changes,
// managed in Manage Access → Teams). This list is only the fallback when that table is absent.
export const ONBOARDER_ROSTER:Membership[] = [
  { name:'Ashish', from:'2026-09-01' },
  { name:'Dhruv', from:'2026-09-01' },
  { name:'Priyanshi', from:'2026-09-01' },
  { name:'Kunal', from:'2026-09-01' },
  { name:'Abhishek', from:'2026-09-01' },
];

export function planOn<T extends {from:string; to?:string}>(plans:T[],date:string):T|null{
  let hit:T|null=null;
  for(const p of plans) if(p.from<=date && (!hit||p.from>=hit.from)) hit=p;
  return hit&&(!hit.to||date<=hit.to)?hit:null;
}

// Cumulative slabs: every threshold reached adds its payout.
export function revenueSlabPay(slabs:RevenueSlab[],revenue:number){
  return slabs.reduce((t,s)=>revenue>=s.at?t+s.pay:t,0);
}

export function isMember(roster:Membership[],name:string,date:string){
  return roster.some(m=>m.name===name && m.from<=date && (!m.to||date<=m.to));
}

export function ladderPay(plan:DailyLadderPlan,n:number){
  if(n<plan.unlock) return 0;
  let pay=plan.unlockPay, floor=plan.unlock;
  for(const b of plan.bands){
    const ceil=b.upTo??Infinity;
    pay+=Math.max(0,Math.min(n,ceil)-floor)*b.rate;
    floor=Math.max(floor,ceil);
    if(n<=floor) break;
  }
  return pay;
}

export function weeklyPay(plan:WeeklyPlan,n:number){
  let pay=0;
  for(const s of plan.slabs) if(n>=s.at) pay=Math.max(pay,s.pay);
  return pay;
}

export function onboarderCasePay(plan:OnboarderPlan,n:number){
  return n<plan.unlock?0:plan.unlockPay+(n-plan.unlock)*plan.perCase;
}

export function topUpPay(plan:OnboarderPlan,amount:number){
  if(!(amount>=plan.topUpMin)) return 0;
  const rate=amount>plan.topUpCeiling?plan.rateAboveCeiling:plan.rateUpToCeiling;
  return Math.round(amount*rate*100)/100;
}

export function addDays(date:string,days:number){
  const d=new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}

export function mondayOf(date:string){
  const dow=new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date,-((dow+6)%7));
}

export type PaymentDoneCall = { customerId:string; date:string; seq:number; attempt:number; person:string; planAmount?:number|null };
export type Renewal = { date:string; person:string };
export type SaleDay = { date:string; person:string; sales:number };
export type CountedSale = { customerId:string; date:string; person:string; revenue:number };

// The Payment done calls that count as sales, each with its revenue (₹799 up to 30 Sep 2026,
// the plan price from 1 Oct 2026).
export function countedSales(calls:PaymentDoneCall[]):CountedSale[]{
  const sorted=[...calls].sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq||a.attempt-b.attempt);
  const everPaid=new Set<string>(), paidOnDay=new Set<string>();
  const out:CountedSale[]=[];
  for(const c of sorted){
    const rule=planOn(SALE_COUNTING_RULES,c.date)?.rule;
    const dayKey=`${c.customerId}|${c.date}`;
    const counts=rule==='unique_per_day'?!paidOnDay.has(dayKey):rule==='first_payment_ever'?!everPaid.has(c.customerId):false;
    everPaid.add(c.customerId); paidOnDay.add(dayKey);
    if(counts) out.push({customerId:c.customerId,date:c.date,person:c.person,revenue:saleRevenue(c.date,c.planAmount)});
  }
  return out;
}

// Counted sales per person per day for the count-based seller plans (up to 30 Sep 2026).
// Renewals counted as seller sales only while those plans ran; from 1 Oct they are paid
// under the onboarder / CSM plan instead.
export function countSales(calls:PaymentDoneCall[],renewals:Renewal[]):SaleDay[]{
  const byDay=new Map<string,SaleDay>();
  const add=(date:string,person:string)=>{const k=`${date}|${person}`;const r=byDay.get(k)||{date,person,sales:0};r.sales++;byDay.set(k,r);};
  for(const c of countedSales(calls)) add(c.date,c.person);
  for(const r of renewals) if(planOn(SELLER_DAILY_PLANS,r.date)) add(r.date,r.person);
  return [...byDay.values()];
}

export type SellerLedgerRow = { date:string; person:string; sales:number; plan:string; pay:number };
export type WeeklyLedgerRow = { weekStart:string; weekEnd:string; person:string; sales:number; plan:string; pay:number };

// Daily incentives dated in [from,to] and weekly bonuses whose Sunday falls in [from,to].
// saleDays must cover at least the Monday of `from`'s week through `to`.
export function sellerIncentives(saleDays:SaleDay[],from:string,to:string){
  const eligible=saleDays.filter(s=>isMember(SELLER_ROSTER,s.person,s.date));
  const daily:SellerLedgerRow[]=[];
  for(const s of eligible){
    if(s.date<from||s.date>to) continue;
    const plan=planOn(SELLER_DAILY_PLANS,s.date);
    daily.push({date:s.date,person:s.person,sales:s.sales,plan:plan?.name||'—',pay:plan?ladderPay(plan,s.sales):0});
  }
  const weeks=new Map<string,WeeklyLedgerRow>();
  for(const s of eligible){
    const weekStart=mondayOf(s.date), weekEnd=addDays(weekStart,6);
    if(weekEnd<from||weekEnd>to) continue;
    const plan=planOn(SELLER_WEEKLY_PLANS,weekStart);
    if(!plan||(plan.to&&s.date>plan.to)) continue;
    const k=`${weekStart}|${s.person}`;
    const w=weeks.get(k)||{weekStart,weekEnd,person:s.person,sales:0,plan:plan.name,pay:0};
    w.sales+=s.sales; weeks.set(k,w);
  }
  const weekly=[...weeks.values()].map(w=>({...w,pay:weeklyPay(planOn(SELLER_WEEKLY_PLANS,w.weekStart)!,w.sales)}));
  daily.splice(0,daily.length,...daily.filter(r=>planOn(SELLER_DAILY_PLANS,r.date)));
  daily.sort((a,b)=>a.date.localeCompare(b.date)||a.person.localeCompare(b.person));
  weekly.sort((a,b)=>a.weekStart.localeCompare(b.weekStart)||a.person.localeCompare(b.person));
  return {daily,weekly};
}

export type RevenueWeekRow = { weekStart:string; weekEnd:string; person:string; role:SellerRole; teamLead:string|null; activeFrom:string; activeTo:string; revenue:number; sales:number; plan:string; slabPay:number; teamShare:number; pay:number };

// Weekly revenue incentive (from 1 Oct 2026) for weeks whose Sunday falls in [from,to].
// Only sales dated on or after the plan start count, so the first week is 1–4 Oct 2026.
// A role applies from the day it changes: each sale counts under the role in force on its
// date, and each role held during the week is priced on its own slabs with the sales made
// under it (activeFrom–activeTo). Someone made SBDE on Saturday earns SBDE slabs on their
// Sat–Sun revenue; days before stay under their earlier role. Days with no role earn nothing.
// `sales` must cover at least the Monday of `from`'s week through `to`.
// `earns(person,date)` (optional) can switch the incentive off for someone on a day, e.g. a Sales
// team member marked not eligible; a sale on such a day counts for nothing.
export function sellerRevenueIncentives(sales:CountedSale[],roles:SellerRoleRow[],from:string,to:string,earns?:(person:string,date:string)=>boolean):RevenueWeekRow[]{
  type Seg={weekStart:string;weekEnd:string;plan:SellerRevenuePlan;person:string;role:SellerRole;teamLead:string|null;activeFrom:string;activeTo:string;revenue:number;sales:number};
  const segs=new Map<string,Seg>();
  const keyOf=(weekStart:string,person:string,role:string,teamLead:string|null)=>`${weekStart}|${person}|${role}|${teamLead||''}`;
  // Days of the week (from the plan start) on which `person` held this exact role and team.
  const windowOf=(weekStart:string,weekEnd:string,planFrom:string,person:string,role:SellerRole,teamLead:string|null)=>{
    let a='',b='';
    for(let d=weekStart<planFrom?planFrom:weekStart;d<=weekEnd;d=addDays(d,1)){
      const r=roleOn(roles,person,d);
      if(r&&r.role===role&&(r.teamLead||null)===teamLead){ if(!a)a=d; b=d; }
    }
    return {a,b};
  };
  const segOf=(weekStart:string,plan:SellerRevenuePlan,person:string,role:SellerRole,teamLead:string|null)=>{
    const k=keyOf(weekStart,person,role,teamLead);
    let g=segs.get(k);
    if(!g){
      const weekEnd=addDays(weekStart,6);
      const {a,b}=windowOf(weekStart,weekEnd,plan.from,person,role,teamLead);
      g={weekStart,weekEnd,plan,person,role,teamLead,activeFrom:a,activeTo:b,revenue:0,sales:0};
      segs.set(k,g);
    }
    return g;
  };
  for(const s of sales){
    const plan=planOn(SELLER_REVENUE_PLANS,s.date);
    if(!plan) continue;
    const weekStart=mondayOf(s.date), weekEnd=addDays(weekStart,6);
    if(weekEnd<from||weekEnd>to) continue;
    const r=roleOn(roles,s.person,s.date);
    if(!r) continue; // no seller role on the day of the sale
    if(earns&&!earns(s.person,s.date)) continue; // not eligible for the incentive that day
    const g=segOf(weekStart,plan,s.person,r.role,r.role==='BDE'?r.teamLead:null);
    g.revenue+=s.revenue; g.sales++;
  }
  const rows=new Map<string,RevenueWeekRow>();
  for(const [k,g] of segs){
    const slabPay=revenueSlabPay(g.plan.slabs[g.role as 'BDE'|'SBDE'|'TL'],g.revenue);
    rows.set(k,{weekStart:g.weekStart,weekEnd:g.weekEnd,person:g.person,role:g.role,teamLead:g.teamLead,activeFrom:g.activeFrom,activeTo:g.activeTo,revenue:g.revenue,sales:g.sales,plan:g.plan.name,slabPay,teamShare:0,pay:slabPay});
  }
  // Team Leads earn a share of each BDE payout made under them, even in a week with no own
  // sales, as long as they are a TL during the days that BDE worked under them.
  for(const r of [...rows.values()]){
    if(r.role!=='BDE'||!r.teamLead||!r.slabPay) continue;
    const leadRole=roleOn(roles,r.teamLead,r.activeTo);
    if(leadRole?.role!=='TL') continue;
    if(earns&&!earns(r.teamLead,r.activeTo)) continue;
    const plan=planOn(SELLER_REVENUE_PLANS,r.activeTo)!;
    const k=keyOf(r.weekStart,r.teamLead,'TL',null);
    let lead=rows.get(k);
    if(!lead){
      const g=segOf(r.weekStart,plan,r.teamLead,'TL',null);
      lead={weekStart:g.weekStart,weekEnd:g.weekEnd,person:g.person,role:'TL',teamLead:null,activeFrom:g.activeFrom,activeTo:g.activeTo,revenue:0,sales:0,plan:plan.name,slabPay:0,teamShare:0,pay:0};
      rows.set(k,lead);
    }
    const share=Math.round(r.slabPay*plan.tlShareOfBde*100)/100;
    lead.teamShare+=share; lead.pay+=share;
  }
  const out=[...rows.values()];
  out.sort((a,b)=>a.weekStart.localeCompare(b.weekStart)||b.pay-a.pay||a.person.localeCompare(b.person)||a.activeFrom.localeCompare(b.activeFrom));
  return out;
}

export type AdsLiveCase = { date:string; person:string };
export type TopUp = { date:string; person:string; amount:number; customerId:string; note?:string };

// Top-ups made before onboarding updates were logged in the portal (10 Sep 2026). They were
// recorded only in the incentive Excel as each person's top-ups per day, without merchant IDs,
// so they live here instead of as onboarding events. Priced with the normal top-up rule.
export const BACKFILLED_TOP_UPS:TopUp[] = [
  { date:'2026-09-01', person:'Ashish', amount:1500, customerId:'', note:'Excel backfill' },
  { date:'2026-09-02', person:'Ashish', amount:1000, customerId:'', note:'Excel backfill' },
  { date:'2026-09-03', person:'Ashish', amount:1000, customerId:'', note:'Excel backfill' },
  { date:'2026-09-05', person:'Ashish', amount:1000, customerId:'', note:'Excel backfill' },
  { date:'2026-09-07', person:'Ashish', amount:1000, customerId:'', note:'Excel backfill' },
  { date:'2026-09-08', person:'Ashish', amount:4000, customerId:'', note:'Excel backfill' },
  { date:'2026-09-08', person:'Ashish', amount:5000, customerId:'', note:'Excel backfill' },
  { date:'2026-09-08', person:'Dhruv', amount:600, customerId:'', note:'Excel backfill' },
];
export type PaidRenewal = { date:string; person:string; amount:number; customerId:string };
export type OnboarderLedgerRow = { date:string; person:string; cases:number; casePay:number; topUps:number; topUpValue:number; topUpPay:number; renewals:number; renewalValue:number; renewalPay:number; plan:string; pay:number };

// `earns(person,date)` says who earns the onboarder / CSM incentive on a day (team membership
// with incentive on); without it the ONBOARDER_ROSTER list is used.
export function onboarderIncentives(cases:AdsLiveCase[],topUps:TopUp[],from:string,to:string,renewals:PaidRenewal[]=[],earns?:(person:string,date:string)=>boolean){
  const eligible=earns||((person:string,date:string)=>isMember(ONBOARDER_ROSTER,person,date));
  const rows=new Map<string,OnboarderLedgerRow>();
  const row=(date:string,person:string)=>{const k=`${date}|${person}`;const r=rows.get(k)||{date,person,cases:0,casePay:0,topUps:0,topUpValue:0,topUpPay:0,renewals:0,renewalValue:0,renewalPay:0,plan:planOn(ONBOARDER_PLANS,date)?.name||'—',pay:0};rows.set(k,r);return r;};
  for(const c of cases){
    if(c.date<from||c.date>to||!eligible(c.person,c.date)||!planOn(ONBOARDER_PLANS,c.date)) continue;
    row(c.date,c.person).cases++;
  }
  for(const t of topUps){
    const plan=planOn(ONBOARDER_PLANS,t.date);
    if(t.date<from||t.date>to||!plan||!eligible(t.person,t.date)) continue;
    const r=row(t.date,t.person); r.topUps++; r.topUpValue+=t.amount; r.topUpPay+=topUpPay(plan,t.amount);
  }
  for(const t of renewals){
    const plan=planOn(ONBOARDER_PLANS,t.date);
    if(t.date<from||t.date>to||!plan?.paysRenewals||!eligible(t.person,t.date)) continue;
    const r=row(t.date,t.person); r.renewals++; r.renewalValue+=t.amount; r.renewalPay+=topUpPay(plan,t.amount);
  }
  const out=[...rows.values()].map(r=>{const plan=planOn(ONBOARDER_PLANS,r.date);const casePay=plan?onboarderCasePay(plan,r.cases):0;return {...r,casePay,topUpPay:Math.round(r.topUpPay*100)/100,renewalPay:Math.round(r.renewalPay*100)/100,pay:Math.round((casePay+r.topUpPay+r.renewalPay)*100)/100};});
  out.sort((a,b)=>a.date.localeCompare(b.date)||a.person.localeCompare(b.person));
  return out;
}
