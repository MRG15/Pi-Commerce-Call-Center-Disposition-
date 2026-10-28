import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { currentPlanOf,subscriptionDateOf } from '@/lib/plan-upgrade';
import { PLANS,planLabel,planPrice,upgradeTargets,upgradeValue,isRenewed,todayIst,type CurrentPlan } from '@/lib/plans';

// Current plan and allowed upgrades for a merchant, shown on the Plan Upgraded form.
export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!user.isSuperAdmin&&!user.access?.seller&&!user.access?.onboarding&&!user.access?.csm) return NextResponse.json({error:'Access required'},{status:403});
  const customerId=new URL(req.url).searchParams.get('customerId')?.trim()||'';
  if(!/^\d+$/.test(customerId)) return NextResponse.json({error:'Customer ID required'},{status:400});
  const cur=await currentPlanOf(db(),customerId);
  const renewed=isRenewed(await subscriptionDateOf(db(),customerId),todayIst());
  const options=(from:CurrentPlan)=>upgradeTargets(from).map(p=>({plan:p,label:PLANS[p].label,price:PLANS[p].price,value:upgradeValue(from,p,renewed)}));
  return NextResponse.json({
    current:cur.plan,currentLabel:cur.plan?planLabel(cur.plan):null,currentPrice:cur.plan?planPrice(cur.plan,renewed):null,source:cur.source,
    targets:cur.plan?options(cur.plan):[],
    // When the current plan is unknown the agent picks it; targets for each choice:
    byCurrent:cur.plan?null:Object.fromEntries((['legacy','silver','gold'] as CurrentPlan[]).map(f=>[f,{label:planLabel(f),targets:options(f)}])),
  });
}
