import assert from 'node:assert/strict';
import {
  ladderPay,weeklyPay,onboarderCasePay,topUpPay,planOn,countSales,countedSales,sellerIncentives,sellerRevenueIncentives,onboarderIncentives,mondayOf,revenueSlabPay,
  SELLER_REVENUE_PLANS,
  SELLER_DAILY_PLANS,SELLER_WEEKLY_PLANS,ONBOARDER_PLANS,BACKFILLED_TOP_UPS,
} from '../lib/incentives';

const launch=planOn(SELLER_DAILY_PLANS,'2026-08-10')!;
const uplift=planOn(SELLER_DAILY_PLANS,'2026-08-24')!;
const weekly=planOn(SELLER_WEEKLY_PLANS,'2026-09-07')!;
const ob=planOn(ONBOARDER_PLANS,'2026-09-01')!;

assert.equal(launch.name,'Launch'); assert.equal(planOn(SELLER_DAILY_PLANS,'2026-08-23')!.name,'Launch');
assert.equal(uplift.name,'Uplift'); assert.equal(planOn(SELLER_DAILY_PLANS,'2026-08-05'),null);
assert.equal(planOn(SELLER_WEEKLY_PLANS,'2026-08-31'),null);
assert.equal(planOn(ONBOARDER_PLANS,'2026-08-31'),null); assert.equal(planOn(SELLER_WEEKLY_PLANS,'2026-09-07')!.from,'2026-09-07');
// No onboarder incentive before 1 Sep, even at 5+ cases.
assert.equal(onboarderIncentives(Array.from({length:6},()=>({date:'2026-08-31',person:'Ashish'})),[],'2026-08-31','2026-08-31').length,0);

// Seller daily validation cases.
assert.equal(ladderPay(launch,1),0); assert.equal(ladderPay(launch,2),150);
assert.equal(ladderPay(launch,6),400); assert.equal(ladderPay(launch,10),800); assert.equal(ladderPay(launch,11),950);
assert.equal(ladderPay(uplift,6),600); assert.equal(ladderPay(uplift,10),1200); assert.equal(ladderPay(uplift,4),350); assert.equal(ladderPay(uplift,7),750);

// Weekly slabs: 1,200 at 12, 2,000 at 18, nothing per extra sale.
assert.equal(weeklyPay(weekly,11),0); assert.equal(weeklyPay(weekly,12),1200); assert.equal(weeklyPay(weekly,15),1200);
assert.equal(weeklyPay(weekly,17),1200); assert.equal(weeklyPay(weekly,18),2000); assert.equal(weeklyPay(weekly,25),2000);

// Onboarder cases and per-instance top-ups.
assert.equal(onboarderCasePay(ob,4),0); assert.equal(onboarderCasePay(ob,5),200); assert.equal(onboarderCasePay(ob,6),250);
assert.equal(onboarderCasePay(ob,8),350); assert.equal(onboarderCasePay(ob,10),450); assert.equal(onboarderCasePay(ob,12),550);
assert.equal(topUpPay(ob,999),0); assert.equal(topUpPay(ob,700),0); assert.equal(topUpPay(ob,1000),50); assert.equal(topUpPay(ob,3000),150);
assert.equal(topUpPay(ob,5000),250); assert.equal(topUpPay(ob,5100),510); assert.equal(topUpPay(ob,7000),700); assert.equal(topUpPay(ob,2000),100);
// 7,000 and 2,000 on the same day are priced separately, not as 9,000.
const obDay=onboarderIncentives([],[{date:'2026-09-22',person:'Ashish',amount:7000,customerId:'1'},{date:'2026-09-22',person:'Ashish',amount:2000,customerId:'2'}],'2026-09-22','2026-09-22');
assert.equal(obDay[0].topUpPay,800);
// Cases ladder uses the day's total even when cases come from separate entries (Ashish, 8 Sep).
const ashish=onboarderIncentives(Array.from({length:6},()=>({date:'2026-09-08',person:'Ashish'})),[],'2026-09-08','2026-09-08');
assert.equal(ashish[0].casePay,250);
// Non-roster people earn nothing.
assert.equal(onboarderIncentives([{date:'2026-09-08',person:'Deep'}],[],'2026-09-08','2026-09-08').length,0);

// Sale counting: unique per day up to 20 Sep, first-ever from 21 Sep; renewals always +1.
const sales=countSales([
  {customerId:'A',date:'2026-08-18',seq:1,attempt:1,person:'Sheena'},
  {customerId:'A',date:'2026-08-18',seq:2,attempt:2,person:'Sheena'},
  {customerId:'B',date:'2026-08-20',seq:1,attempt:1,person:'Sheena'},
  {customerId:'B',date:'2026-08-21',seq:1,attempt:2,person:'Sheena'},
  {customerId:'C',date:'2026-09-19',seq:1,attempt:1,person:'Umesh'},
  {customerId:'C',date:'2026-09-21',seq:1,attempt:2,person:'Umesh'},
  {customerId:'D',date:'2026-09-22',seq:1,attempt:1,person:'Umesh'},
],[{date:'2026-09-22',person:'Kunal'},{date:'2026-09-22',person:'Kunal'}]);
const get=(d:string,p:string)=>sales.find(s=>s.date===d&&s.person===p)?.sales||0;
assert.equal(get('2026-08-18','Sheena'),1); assert.equal(get('2026-08-20','Sheena'),1); assert.equal(get('2026-08-21','Sheena'),1);
assert.equal(get('2026-09-19','Umesh'),1); assert.equal(get('2026-09-21','Umesh'),0); assert.equal(get('2026-09-22','Umesh'),1);
assert.equal(get('2026-09-22','Kunal'),2);

// Weekly bonus lands on the Sunday and needs the whole Mon–Sun week.
assert.equal(mondayOf('2026-09-20'),'2026-09-14'); assert.equal(mondayOf('2026-09-14'),'2026-09-14');
const week=[3,0,2,7,2,1,0].map((n,i)=>({date:`2026-09-${14+i}`,person:'Sheena',sales:n})).filter(s=>s.sales);
assert.equal(sellerIncentives(week,'2026-09-20','2026-09-20').weekly[0].pay,1200);
assert.equal(sellerIncentives(week,'2026-09-14','2026-09-19').weekly.length,0);
// Ashish left the seller plan after August.
assert.equal(sellerIncentives([{date:'2026-09-01',person:'Ashish',sales:3}],'2026-09-01','2026-09-01').daily.length,0);

// Excel-only top-ups before 10 Sep: Ashish ₹725, Dhruv's ₹600 is below the ₹1,000 minimum.
const backfill=onboarderIncentives([],BACKFILLED_TOP_UPS,'2026-09-01','2026-09-30');
assert.equal(backfill.filter(r=>r.person==='Ashish').reduce((s,r)=>s+r.topUpPay,0),725);
assert.equal(backfill.filter(r=>r.person==='Dhruv').reduce((s,r)=>s+r.topUpPay,0),0);
assert.equal(onboarderIncentives([],BACKFILLED_TOP_UPS,'2026-09-10','2026-09-30').length,0);

// ---- From 1 Oct 2026 ----
// Old seller plans stop on 30 Sep; the onboarder plan gains renewals.
assert.equal(planOn(SELLER_DAILY_PLANS,'2026-09-30')!.name,'Uplift'); assert.equal(planOn(SELLER_DAILY_PLANS,'2026-10-01'),null);
assert.equal(planOn(SELLER_REVENUE_PLANS,'2026-09-30'),null); assert.equal(planOn(SELLER_REVENUE_PLANS,'2026-10-01')!.name,'Weekly revenue');
assert.equal(planOn(ONBOARDER_PLANS,'2026-09-30')!.paysRenewals,undefined); assert.equal(planOn(ONBOARDER_PLANS,'2026-10-01')!.paysRenewals,true);

// Old weekly bonus for the week of 28 Sep counts only 28–30 Sep and is credited on Sunday 4 Oct.
const straddle=[{date:'2026-09-28',person:'Sheena',sales:5},{date:'2026-09-29',person:'Sheena',sales:4},{date:'2026-09-30',person:'Sheena',sales:3},{date:'2026-10-01',person:'Sheena',sales:6}];
const straddleOut=sellerIncentives(straddle,'2026-09-28','2026-10-04');
assert.equal(straddleOut.weekly[0].sales,12); assert.equal(straddleOut.weekly[0].pay,1200);
assert.equal(straddleOut.daily.some(r=>r.date==='2026-10-01'),false);
assert.equal(sellerIncentives([{date:'2026-09-28',person:'Sheena',sales:11},{date:'2026-10-01',person:'Sheena',sales:3}],'2026-09-28','2026-10-04').weekly[0].pay,0);

// Cumulative revenue slabs.
const rp=planOn(SELLER_REVENUE_PLANS,'2026-10-01')!;
assert.equal(revenueSlabPay(rp.slabs.BDE,29999),0); assert.equal(revenueSlabPay(rp.slabs.BDE,30000),2000);
assert.equal(revenueSlabPay(rp.slabs.BDE,50000),5000); assert.equal(revenueSlabPay(rp.slabs.BDE,100000),10000);
assert.equal(revenueSlabPay(rp.slabs.SBDE,39999),0); assert.equal(revenueSlabPay(rp.slabs.SBDE,40000),3000);
assert.equal(revenueSlabPay(rp.slabs.SBDE,80000),8000); assert.equal(revenueSlabPay(rp.slabs.SBDE,140000),14000);

// Revenue per counted sale: ₹799 up to 30 Sep, the plan price from 1 Oct.
const cs=countedSales([
  {customerId:'A',date:'2026-09-30',seq:1,attempt:1,person:'Umesh',planAmount:null},
  {customerId:'B',date:'2026-10-01',seq:1,attempt:1,person:'Umesh',planAmount:4999},
  {customerId:'B',date:'2026-10-02',seq:1,attempt:2,person:'Umesh',planAmount:9999},
]);
assert.deepEqual(cs.map(c=>c.revenue),[799,4999]);

// Weekly revenue with roles: TL own SBDE slabs + half of each BDE payout. First week is 1–4 Oct.
const roles=[
  {person:'Sheena',role:'TL' as const,teamLead:null,effectiveFrom:'2026-10-01'},
  {person:'Jay',role:'SBDE' as const,teamLead:null,effectiveFrom:'2026-10-01'},
  {person:'Neha',role:'BDE' as const,teamLead:'Sheena',effectiveFrom:'2026-10-01'},
  {person:'Neha',role:'SBDE' as const,teamLead:null,effectiveFrom:'2026-10-07'},
];
const sale=(date:string,person:string,revenue:number)=>({customerId:date+person+revenue,date,person,revenue});
const wk=sellerRevenueIncentives([
  sale('2026-09-29','Sheena',50000),
  sale('2026-10-01','Sheena',45000),sale('2026-10-02','Neha',30000),sale('2026-10-04','Neha',30000),
  sale('2026-10-03','Jay',85000),
  sale('2026-10-08','Neha',30000),
],roles,'2026-10-01','2026-10-11');
const w=(week:string,p:string)=>wk.find(r=>r.weekStart===week&&r.person===p)!;
assert.equal(w('2026-09-28','Sheena').revenue,45000); assert.equal(w('2026-09-28','Sheena').slabPay,3000);
assert.equal(w('2026-09-28','Neha').slabPay,5000); assert.equal(w('2026-09-28','Sheena').teamShare,2500); assert.equal(w('2026-09-28','Sheena').pay,5500);
assert.equal(w('2026-09-28','Jay').pay,8000);
// Neha becomes SBDE on Wed 7 Oct: from that day her sales count as an SBDE. Her ₹30k on 8 Oct
// is priced on SBDE slabs (below ₹40k, so ₹0) and no longer earns Sheena a team share.
const nehaWk=wk.filter(r=>r.weekStart==='2026-10-05'&&r.person==='Neha');
assert.equal(nehaWk.length,1); assert.equal(nehaWk[0].role,'SBDE'); assert.equal(nehaWk[0].activeFrom,'2026-10-07');
assert.equal(nehaWk[0].revenue,30000); assert.equal(nehaWk[0].slabPay,0);
assert.equal(wk.find(r=>r.weekStart==='2026-10-05'&&r.person==='Sheena'),undefined);

// Role applies from the day it changes. Ravi is a CSM (no seller role) until Fri 9 Oct and an
// SBDE from Sat 10 Oct: his Sat–Sun ₹40k earns the SBDE ₹40k slab; Thursday's sale earns nothing.
// Meera is a BDE under Sheena Mon–Fri and an SBDE from Saturday: each part is priced on its own.
const roles2=[...roles,
  {person:'Ravi',role:'SBDE' as const,teamLead:null,effectiveFrom:'2026-10-10'},
  {person:'Meera',role:'BDE' as const,teamLead:'Sheena',effectiveFrom:'2026-10-05'},
  {person:'Meera',role:'SBDE' as const,teamLead:null,effectiveFrom:'2026-10-10'},
];
const wk2=sellerRevenueIncentives([
  sale('2026-10-08','Ravi',20000),sale('2026-10-10','Ravi',25000),sale('2026-10-11','Ravi',15000),
  sale('2026-10-06','Meera',35000),sale('2026-10-10','Meera',45000),
],roles2,'2026-10-05','2026-10-11');
const ravi=wk2.filter(r=>r.person==='Ravi');
assert.equal(ravi.length,1); assert.equal(ravi[0].role,'SBDE'); assert.equal(ravi[0].revenue,40000);
assert.equal(ravi[0].activeFrom,'2026-10-10'); assert.equal(ravi[0].activeTo,'2026-10-11'); assert.equal(ravi[0].pay,3000);
const meeraBde=wk2.find(r=>r.person==='Meera'&&r.role==='BDE')!, meeraSbde=wk2.find(r=>r.person==='Meera'&&r.role==='SBDE')!;
assert.equal(meeraBde.revenue,35000); assert.equal(meeraBde.slabPay,2000); assert.equal(meeraBde.activeTo,'2026-10-09');
assert.equal(meeraSbde.revenue,45000); assert.equal(meeraSbde.slabPay,3000); assert.equal(meeraSbde.activeFrom,'2026-10-10');
// Sheena (TL, no own sales that week) still earns half of Meera's BDE-days payout.
const sheena2=wk2.find(r=>r.person==='Sheena')!;
assert.equal(sheena2.teamShare,1000); assert.equal(sheena2.pay,1000);
// A week whose Sunday is outside the range is not paid.
assert.equal(sellerRevenueIncentives([sale('2026-10-01','Jay',90000)],roles,'2026-10-01','2026-10-03').length,0);

// Renewals from 1 Oct: priced one by one like top-ups; before 1 Oct they earn onboarders nothing.
const ren=onboarderIncentives([],[{date:'2026-10-02',person:'Kunal',amount:5000,customerId:'X'}],'2026-09-30','2026-10-02',[
  {date:'2026-09-30',person:'Kunal',amount:1999,customerId:'Y'},
  {date:'2026-10-02',person:'Kunal',amount:1999,customerId:'X'},
  {date:'2026-10-02',person:'Dhruv',amount:9999,customerId:'Z'},
]);
const rk=ren.find(r=>r.person==='Kunal'&&r.date==='2026-10-02')!;
assert.equal(rk.renewalPay,99.95); assert.equal(rk.topUpPay,250); assert.equal(rk.pay,349.95);
assert.equal(ren.find(r=>r.person==='Dhruv')!.renewalPay,999.9);
assert.equal(ren.some(r=>r.date==='2026-09-30'),false);
// From 1 Oct renewals are no longer seller sales.
const sd2=countSales([],[{date:'2026-09-29',person:'Kunal'},{date:'2026-10-02',person:'Kunal'}]);
assert.equal(sd2.length,1); assert.equal(sd2[0].date,'2026-09-29');

console.log('All incentive checks passed.');
