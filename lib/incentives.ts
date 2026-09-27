// Incentive plans and payout rules. Everything here is date-effective:
// a new plan or rule is added as a NEW entry with its own start date. Never edit
// an old entry, or days that were already paid would be re-priced.

export type DailyLadderPlan = { from:string; name:string; unlock:number; unlockPay:number; bands:{upTo:number|null; rate:number}[] };
export type WeeklyPlan = { from:string; name:string; slabs:{at:number; pay:number}[] };
export type OnboarderPlan = { from:string; name:string; unlock:number; unlockPay:number; perCase:number; topUpMin:number; topUpCeiling:number; rateUpToCeiling:number; rateAboveCeiling:number };
export type SaleCountingRule = { from:string; rule:'unique_per_day'|'first_payment_ever' };
export type Membership = { name:string; from:string; to?:string };

// Seller daily plans. Launch 6–23 Aug 2026, Uplift from 24 Aug 2026.
export const SELLER_DAILY_PLANS:DailyLadderPlan[] = [
  { from:'2026-08-06', name:'Launch', unlock:2, unlockPay:150, bands:[{upTo:5,rate:50},{upTo:10,rate:100},{upTo:null,rate:150}] },
  { from:'2026-08-24', name:'Uplift', unlock:2, unlockPay:150, bands:[{upTo:5,rate:100},{upTo:10,rate:150},{upTo:null,rate:200}] },
];

// Seller weekly bonus (Mon–Sun), on top of the daily incentive. Chosen by the week's Monday.
// Slabs are not additive: 12–17 sales pay ₹1,200, 18+ pay ₹2,000.
export const SELLER_WEEKLY_PLANS:WeeklyPlan[] = [
  { from:'2026-09-07', name:'Weekly bonus', slabs:[{at:12,pay:1200},{at:18,pay:2000}] },
];

// Onboarder plan from 1 Sep 2026: Ads Live cases (daily ladder) + per-instance top-ups.
// Each top-up is priced on its own: below ₹1,000 earns nothing, up to ₹5,000 earns 5%,
// above ₹5,000 earns 10% of the whole amount.
export const ONBOARDER_PLANS:OnboarderPlan[] = [
  { from:'2026-09-01', name:'Ads Live + Top-up', unlock:5, unlockPay:200, perCase:50, topUpMin:1000, topUpCeiling:5000, rateUpToCeiling:0.05, rateAboveCeiling:0.10 },
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

export const ONBOARDER_ROSTER:Membership[] = [
  { name:'Ashish', from:'2026-09-01' },
  { name:'Dhruv', from:'2026-09-01' },
  { name:'Priyanshi', from:'2026-09-01' },
  { name:'Kunal', from:'2026-09-01' },
  { name:'Abhishek', from:'2026-09-01' },
];

export function planOn<T extends {from:string}>(plans:T[],date:string):T|null{
  let hit:T|null=null;
  for(const p of plans) if(p.from<=date && (!hit||p.from>=hit.from)) hit=p;
  return hit;
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

export type PaymentDoneCall = { customerId:string; date:string; seq:number; attempt:number; person:string };
export type Renewal = { date:string; person:string };
export type SaleDay = { date:string; person:string; sales:number };

// Turns raw Payment done calls + renewals into counted sales per person per day.
export function countSales(calls:PaymentDoneCall[],renewals:Renewal[]):SaleDay[]{
  const sorted=[...calls].sort((a,b)=>a.date.localeCompare(b.date)||a.seq-b.seq||a.attempt-b.attempt);
  const everPaid=new Set<string>(), paidOnDay=new Set<string>();
  const byDay=new Map<string,SaleDay>();
  const add=(date:string,person:string)=>{const k=`${date}|${person}`;const r=byDay.get(k)||{date,person,sales:0};r.sales++;byDay.set(k,r);};
  for(const c of sorted){
    const rule=planOn(SALE_COUNTING_RULES,c.date)?.rule;
    const dayKey=`${c.customerId}|${c.date}`;
    const counts=rule==='unique_per_day'?!paidOnDay.has(dayKey):rule==='first_payment_ever'?!everPaid.has(c.customerId):false;
    everPaid.add(c.customerId); paidOnDay.add(dayKey);
    if(counts) add(c.date,c.person);
  }
  for(const r of renewals) add(r.date,r.person);
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
    if(!plan) continue;
    const k=`${weekStart}|${s.person}`;
    const w=weeks.get(k)||{weekStart,weekEnd,person:s.person,sales:0,plan:plan.name,pay:0};
    w.sales+=s.sales; weeks.set(k,w);
  }
  const weekly=[...weeks.values()].map(w=>({...w,pay:weeklyPay(planOn(SELLER_WEEKLY_PLANS,w.weekStart)!,w.sales)}));
  daily.sort((a,b)=>a.date.localeCompare(b.date)||a.person.localeCompare(b.person));
  weekly.sort((a,b)=>a.weekStart.localeCompare(b.weekStart)||a.person.localeCompare(b.person));
  return {daily,weekly};
}

export type AdsLiveCase = { date:string; person:string };
export type TopUp = { date:string; person:string; amount:number; customerId:string };
export type OnboarderLedgerRow = { date:string; person:string; cases:number; casePay:number; topUps:number; topUpValue:number; topUpPay:number; plan:string; pay:number };

export function onboarderIncentives(cases:AdsLiveCase[],topUps:TopUp[],from:string,to:string){
  const rows=new Map<string,OnboarderLedgerRow>();
  const row=(date:string,person:string)=>{const k=`${date}|${person}`;const r=rows.get(k)||{date,person,cases:0,casePay:0,topUps:0,topUpValue:0,topUpPay:0,plan:planOn(ONBOARDER_PLANS,date)?.name||'—',pay:0};rows.set(k,r);return r;};
  for(const c of cases){
    if(c.date<from||c.date>to||!isMember(ONBOARDER_ROSTER,c.person,c.date)||!planOn(ONBOARDER_PLANS,c.date)) continue;
    row(c.date,c.person).cases++;
  }
  for(const t of topUps){
    const plan=planOn(ONBOARDER_PLANS,t.date);
    if(t.date<from||t.date>to||!plan||!isMember(ONBOARDER_ROSTER,t.person,t.date)) continue;
    const r=row(t.date,t.person); r.topUps++; r.topUpValue+=t.amount; r.topUpPay+=topUpPay(plan,t.amount);
  }
  const out=[...rows.values()].map(r=>{const plan=planOn(ONBOARDER_PLANS,r.date);const casePay=plan?onboarderCasePay(plan,r.cases):0;return {...r,casePay,topUpPay:Math.round(r.topUpPay*100)/100,pay:Math.round((casePay+r.topUpPay)*100)/100};});
  out.sort((a,b)=>a.date.localeCompare(b.date)||a.person.localeCompare(b.person));
  return out;
}
