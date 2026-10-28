// A merchant's current plan, for Plan Upgraded. Taken as the higher of:
//   - the latest plan the portal has seen (seller sale, renewal, earlier upgrade, CleverTap
//     subscription payment); a seller sale before 1 Oct 2026 was the legacy ₹799 plan
//   - the plan in Sub Raw (refreshed daily)
// Plans only go up through an upgrade, so taking the higher one never over-credits.
import { PLAN_RANK,planFromName,isCurrentPlan,type CurrentPlan } from './plans';

export async function currentPlanOf(sql:any,customerId:string):Promise<{plan:CurrentPlan|null;source:string|null}>{
  const latest=await sql`
    SELECT plan,src FROM (
      SELECT CASE WHEN c.upgrade_from_plan IS NOT NULL OR c.plan_code IS NOT NULL THEN c.plan_code
                  WHEN c.call_date<'2026-10-01' THEN 'legacy' END AS plan,
             'seller' AS src,c.event_time AS at
      FROM calls c
      WHERE c.customer_id=${customerId}
        AND (c.upgrade_from_plan IS NOT NULL OR c.l1_label_snapshot='Payment done' OR c.l2_label_snapshot='Enrolled via WhatsApp')
      UNION ALL
      SELECT e.plan_code,'onboarding',e.event_time FROM onboarding_events e
      WHERE e.customer_id=${customerId} AND e.l0_code IN ('OB_SUBS_RENEWED','OB_PLAN_UPGRADED') AND e.plan_code IS NOT NULL
      UNION ALL
      SELECT p.plan,'clevertap',p.received_at FROM ct_payment_events p
      WHERE p.customer_id=${customerId} AND p.flow='subscribe' AND p.plan IN ('silver','gold','platinum')
    ) x WHERE plan IS NOT NULL ORDER BY at DESC NULLS LAST LIMIT 1
  `;
  const sub=await sql`SELECT sub_plan_name FROM onboarding_cases WHERE customer_id=${customerId} AND sub_plan_name IS NOT NULL ORDER BY created_at LIMIT 1`;
  const a=latest[0]&&isCurrentPlan(latest[0].plan)?{plan:latest[0].plan as CurrentPlan,source:String(latest[0].src)}:null;
  const subPlan=planFromName(sub[0]?.sub_plan_name);
  const b=subPlan?{plan:subPlan,source:'subraw'}:null;
  if(a&&b) return PLAN_RANK[a.plan]>=PLAN_RANK[b.plan]?a:b;
  return a||b||{plan:null,source:null};
}

// The merchant's subscription date: the onboarding case's sale date, else their first seller sale.
export async function subscriptionDateOf(sql:any,customerId:string):Promise<string|null>{
  const r=await sql`
    SELECT COALESCE(
      (SELECT min(sale_date)::text FROM onboarding_cases WHERE customer_id=${customerId}),
      (SELECT min(call_date)::text FROM calls WHERE customer_id=${customerId} AND (l1_label_snapshot='Payment done' OR l2_label_snapshot='Enrolled via WhatsApp'))
    ) AS d`;
  return r[0]?.d?String(r[0].d).slice(0,10):null;
}

// Validates a Plan Upgraded entry: the target must be higher than the merchant's current plan.
// `chosenCurrent` is only used when the portal cannot tell the current plan.
export async function resolveUpgrade(sql:any,customerId:string,target:unknown,chosenCurrent?:unknown){
  const { isPlanCode,upgradeTargets,upgradeValue,isRenewed,todayIst,PLANS }=await import('./plans');
  if(!isPlanCode(target)) throw new Error('UPGRADE_PLAN_REQUIRED');
  const cur=await currentPlanOf(sql,customerId);
  const from=cur.plan??(isCurrentPlan(chosenCurrent)?chosenCurrent:null);
  if(!from) throw new Error('UPGRADE_CURRENT_REQUIRED');
  if(!upgradeTargets(from).includes(target)) throw new Error('UPGRADE_NOT_HIGHER');
  const renewed=isRenewed(await subscriptionDateOf(sql,customerId),todayIst());
  return { from, to:target, value:upgradeValue(from,target,renewed), price:PLANS[target].price };
}

export const UPGRADE_ERRORS:Record<string,string>={
  UPGRADE_PLAN_REQUIRED:'Select the plan the merchant upgraded to.',
  UPGRADE_CURRENT_REQUIRED:"Select the merchant's current plan.",
  UPGRADE_NOT_HIGHER:'The new plan must be higher than the current plan.',
};
