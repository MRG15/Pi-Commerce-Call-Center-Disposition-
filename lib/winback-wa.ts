// Win-back WhatsApp (testimonial) for merchants marked Not Interested / Refund Requested — an onboarding
// case closed as lost, or ever by a CSM (the Picom_dnd bucket). They get no other WhatsApp (waSuppressed).
// Template from the sub-category: optical / eye -> WB_OPTICAL; spa, salon, parlour, beautician -> WB_SPA;
// everyone else -> WB_GENERIC. Sent between 12 PM and 7 PM IST like the CSM reminders: the first message, then
// every second day — T+1, T+3, T+5, … — for as long as they stay in the bucket.
// Rollout: until app_settings.winback_wa_live is true, only the test merchant gets each template once.
import { queueWa,sendQueuedWa,merchantContact,waReady,type WaTemplate } from './wa';
import { todayIst } from './plans';

export const WB_TEMPLATES:WaTemplate[]=['WB_OPTICAL','WB_SPA','WB_GENERIC'];
const WB_SEND_HOUR_IST=12;
const WB_STOP_HOUR_IST=19; // nothing to merchants after 7 PM; what is left goes the next day
const PER_RUN=150; // per 5-minute trigger, so a big first day spreads over a few runs
const TEST_CUSTOMER='518726118';

export function winbackTemplate(subCategory:unknown):WaTemplate{
  const s=String(subCategory||'').toLowerCase();
  if(/optic|optician|eye/.test(s)) return 'WB_OPTICAL';
  if(/\bspa\b|salon|parlou?r|beautician/.test(s)) return 'WB_SPA';
  return 'WB_GENERIC';
}

// Same day pattern as the CSM reminders: day 0, then T+1, T+3, T+5, … (an even day sends the slot
// before it if a run was missed).
const slotFor=(days:number|null)=>days===null?0:days<1?null:days%2===1?days:days-1;

export async function runWinbackWa(sql:any){
  if(!WB_TEMPLATES.every(waReady)) return {skipped:'templates not ready'};
  const tests=await sendWinbackTests(sql);
  const hour=new Date(Date.now()+330*60000).getUTCHours();
  if(hour<WB_SEND_HOUR_IST||hour>=WB_STOP_HOUR_IST) return {tests,skipped:'outside 12 PM-7 PM'};
  const live=(await sql`SELECT value FROM app_settings WHERE key='winback_wa_live'`)[0]?.value===true;
  if(!live) return {tests,skipped:'not live'};
  const today=todayIst();
  const rows=await sql`
    WITH b AS (
      SELECT customer_id,bool_or(onb) AS onb FROM (
        SELECT customer_id,TRUE AS onb FROM onboarding_cases WHERE current_status='lost'
        UNION ALL
        SELECT customer_id,FALSE FROM onboarding_events
        WHERE source_type='customer_success_followup' AND l0_code IN ('OB_NOT_INTERESTED','OB_REFUND_REQUESTED')
      ) x WHERE customer_id ~ '^[0-9]+$' GROUP BY customer_id
    ),
    f AS (
      SELECT customer_id,min((created_at AT TIME ZONE 'Asia/Kolkata')::date) AS first_day FROM wa_messages
      WHERE template=ANY(${WB_TEMPLATES}) AND status='sent' AND dedupe_key NOT LIKE 'TEST|%' GROUP BY customer_id
    )
    SELECT b.customer_id,b.onb,mi.sub_category,(${today}::date-f.first_day)::int AS days
    FROM b LEFT JOIN f ON f.customer_id=b.customer_id LEFT JOIN merchant_information mi ON mi.customer_id=b.customer_id
  `;
  const due=rows.map((r:any)=>{const slot=slotFor(r.days===null?null:Number(r.days));return slot===null?null:{...r,key:`WB|${r.customer_id}|T+${slot}`};}).filter(Boolean) as any[];
  if(!due.length) return {due:0};
  const done=new Set((await sql`SELECT dedupe_key FROM wa_messages WHERE dedupe_key=ANY(${due.map(d=>d.key)}) AND status<>'failed'`).map((r:any)=>r.dedupe_key));
  const todo=due.filter(d=>!done.has(d.key)).slice(0,PER_RUN);
  const ids:number[]=[];
  for(const d of todo){
    const c=await merchantContact(sql,String(d.customer_id));
    const id=await queueWa(sql,{template:winbackTemplate(d.sub_category),workspace:d.onb?'onboarding':'csm',customerId:String(d.customer_id),
      phone:c.phone,sourceRef:'winback',dedupeKey:d.key,variables:{merchant_name:c.name||''}});
    if(id) ids.push(id);
  }
  await sendQueuedWa(sql,ids);
  return {due:due.length,queued:ids.length};
}

// Test stage: the test merchant gets each platform template once (optical and spa; generic reuses optical).
async function sendWinbackTests(sql:any){
  const c=await merchantContact(sql,TEST_CUSTOMER);
  const ids:number[]=[];
  for(const t of ['WB_OPTICAL','WB_SPA'] as WaTemplate[]){
    const id=await queueWa(sql,{template:t,workspace:'onboarding',customerId:TEST_CUSTOMER,phone:c.phone,sourceRef:'test:winback',
      dedupeKey:`TEST|${t}|${TEST_CUSTOMER}`,variables:{merchant_name:c.name||'Madhav'}});
    if(id) ids.push(id);
  }
  await sendQueuedWa(sql,ids);
  return ids.length;
}
