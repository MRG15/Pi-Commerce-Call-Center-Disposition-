import assert from 'node:assert/strict';
import {
  ladderPay,weeklyPay,onboarderCasePay,topUpPay,planOn,countSales,sellerIncentives,onboarderIncentives,mondayOf,
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

console.log('All incentive checks passed.');
