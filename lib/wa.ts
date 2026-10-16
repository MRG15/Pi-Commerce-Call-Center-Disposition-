// WhatsApp nudges through the Pi Commerce platform and the "Request a callback" link.
// Every message is logged in wa_messages with a unique token; the template's URL button points
// to /cb/<token>. Merchants a CSM or onboarding marked Not Interested / Refund get nothing.
import { randomBytes } from 'crypto';
import { currentPlanOf } from './plan-upgrade';
import { planLabel } from './plans';

export type WaTemplate='SELLER_NOT_CONNECTED'|'ONB_NOT_CONNECTED'|'T1_RENEW'|'T2_ENDED_FREE'|'T3_ENDED_TOPUP'|'T4_ENDING_FREE'|'T5_ENDING_TOPUP';
export type WaWorkspace='seller'|'onboarding'|'csm';
export const SELLER_WA_L0=['l0_voicemail','l0_disconnected','l0_not_connected'];
// Credits a plan starts with, for onboarding messages sent before Sub Raw has the merchant.
export const PLAN_START_CREDITS:Record<string,number>={silver:2000,gold:5500,platinum:11000};

export const fmtDate=(d:any)=>{if(!d)return '';const t=new Date(String(d).slice(0,10)+'T00:00:00');return isNaN(t.getTime())?'':t.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});};
export const fmtMoney=(n:any)=>n==null||n===''?'':'₹'+Math.round(Number(n)).toLocaleString('en-IN');
export const fmtCount=(n:any)=>n==null||n===''?'':Math.round(Number(n)).toLocaleString('en-IN');
const newToken=()=>randomBytes(12).toString('base64url');

export async function merchantContact(sql:any,customerId:string){
  const rows=await sql`
    SELECT COALESCE(NULLIF(mi.merchant_name,''),NULLIF(c.merchant_name,''),s.merchant_name) AS name,
           COALESCE(NULLIF(mi.phone_number,''),NULLIF(c.phone,''),s.phone_number) AS phone
    FROM (SELECT ${customerId}::text AS customer_id) k
    LEFT JOIN merchant_information mi ON mi.customer_id=k.customer_id
    LEFT JOIN customers c ON c.customer_id=k.customer_id
    LEFT JOIN LATERAL (SELECT merchant_name,phone_number FROM merchant_subscriptions WHERE customer_id=k.customer_id ORDER BY sync_run_id DESC LIMIT 1) s ON TRUE
  `;
  return {name:rows[0]?.name||'',phone:rows[0]?.phone||''};
}

// Not Interested / Refund: onboarding case Lost, or a CSM has ever marked the merchant Not Interested /
// Refund Requested (whatever was logged after it). These merchants get no WhatsApp at all.
export async function waSuppressed(sql:any,customerId:string){
  const rows=await sql`
    SELECT EXISTS(SELECT 1 FROM onboarding_cases WHERE customer_id=${customerId} AND current_status='lost')
        OR EXISTS(SELECT 1 FROM onboarding_events WHERE customer_id=${customerId} AND source_type='customer_success_followup'
                  AND l0_code IN ('OB_NOT_INTERESTED','OB_REFUND_REQUESTED')) AS suppressed
  `;
  return Boolean(rows[0]?.suppressed);
}

type QueueInput={template:WaTemplate;workspace:WaWorkspace;customerId:string|null;leadId?:string|null;phone?:string|null;agentId?:string|null;sourceRef?:string|null;dedupeKey?:string|null;variables:Record<string,string>;status?:'queued'|'baseline'|'skipped';note?:string};
export async function queueWa(sql:any,m:QueueInput){
  const token=newToken();
  const rows=await sql`
    INSERT INTO wa_messages(token,template,workspace,customer_id,lead_id,phone,agent_id,source_ref,dedupe_key,variables,status,status_note)
    VALUES(${token},${m.template},${m.workspace},${m.customerId},${m.leadId||null},${m.phone||null},${m.agentId||null},${m.sourceRef||null},${m.dedupeKey||null},
      ${sql.json({...m.variables,callback_token:token})},${m.status||'queued'},${m.note||null})
    -- A message that failed to send is retried the next time its rule runs.
    ON CONFLICT (dedupe_key) DO UPDATE SET token=EXCLUDED.token,phone=EXCLUDED.phone,variables=EXCLUDED.variables,status='queued',status_note=NULL,source_ref=EXCLUDED.source_ref
      WHERE wa_messages.status='failed'
    RETURNING id
  `;
  return rows[0]?.id?Number(rows[0].id):null;
}

// Pi Commerce WhatsApp send API. Each portal template maps to the platform template name, the
// order of its body variables ({{1}}, {{2}}, …) and the index of its "Request a callback" URL
// button, if it has one. A template without an entry here is not sent (its messages stay queued).
const WA_API_URL=process.env.PI_WA_URL||'https://pi-commerce-bff.paytm.com/api/pi-commerce/v1/messages/whatsapp/send';
const WA_FROM=process.env.PI_WA_FROM||'+918796553043';
export const WA_TEMPLATES:Partial<Record<WaTemplate,{name:string;body:string[];callbackButton?:string;headerImage?:string}>>={
  SELLER_NOT_CONNECTED:{name:'sellerworkspace_not_connected_fv',body:['merchant_name'],callbackButton:'0'},
  ONB_NOT_CONNECTED:{name:'onboarding_not_connected_fv',body:['merchant_name','plan_name','purchase_date','expiry_date','credits'],callbackButton:'0'},
  // CSM templates: Renew / Top-up link first, Request Callback second (button 1).
  T1_RENEW:{name:'tone_renew_test_nocl',body:['merchant_name','impressions'],callbackButton:'1'},
  T2_ENDED_FREE:{name:'ttwo_ended_free_test',body:['merchant_name','impressions','credits'],callbackButton:'1'},
  T3_ENDED_TOPUP:{name:'tthree_ended_topup_test',body:['merchant_name','impressions','credits'],callbackButton:'1'},
  T4_ENDING_FREE:{name:'tfour_ending_free_nocl',body:['merchant_name','ad_end_date','credits'],callbackButton:'1'},
  T5_ENDING_TOPUP:{name:'tfive_ending_topup_test',body:['merchant_name','ad_end_date','credits'],callbackButton:'1'},
};
// Test stage for CSM templates: while a template has testers here it goes only to them (once each,
// with sample merchant details) and no merchant gets it. Remove its entry to send to merchants.
// Their taps are logged against TEST_CUSTOMER (Madhav's test merchant) in the CSM Req Call Back pane.
// Testers used so far (Madhav, Nausheen, Aman): set e.g. {T2_ENDED_FREE:WA_TESTERS} to test a new template.
export const WA_TESTERS=[{name:'Madhav',phone:'+918383059253'},{name:'Nausheen',phone:'+918686024333'},{name:'Aman',phone:'+919910468198'}];
export const CSM_WA_TESTERS:Partial<Record<WaTemplate,{name:string;phone:string}[]>>={};
const TEST_CUSTOMER='518726118';
const TEST_VARIABLES:Record<string,string>={impressions:'12,450',credits:'₹2,500',ad_end_date:fmtDate(new Date(Date.now()+86400000).toISOString())};
const csmLive=(t:WaTemplate)=>waReady(t)&&!CSM_WA_TESTERS[t];
export const waReady=(t:WaTemplate)=>{const x=WA_TEMPLATES[t];return Boolean(process.env.PI_WA_API_KEY&&x&&(x.headerImage===undefined||x.headerImage));};
// Test mode: when PI_WA_TEST_CUSTOMERS is set (comma-separated customer IDs), only those merchants
// get messages; everyone else is skipped.
const testCustomers=()=>(process.env.PI_WA_TEST_CUSTOMERS||'').split(',').map(x=>x.trim()).filter(Boolean);
// "9876543210" / "919876543210" / "+91 98765 43210" → "+919876543210".
export function waPhone(raw:any){
  const d=String(raw||'').replace(/\D/g,'');
  if(d.length===10) return '+91'+d;
  if(d.length===12&&d.startsWith('91')) return '+'+d;
  if(d.length===11&&d.startsWith('0')) return '+91'+d.slice(1);
  return d.length>=10?'+'+d:'';
}

export async function sendQueuedWa(sql:any,ids:number[]){
  if(!ids.length) return;
  const rows=await sql`SELECT id,template,customer_id,phone,variables FROM wa_messages WHERE id=ANY(${ids}) AND status='queued'`;
  const test=testCustomers();
  for(const m of rows){
    const t=WA_TEMPLATES[m.template as WaTemplate];
    if(!t||!process.env.PI_WA_API_KEY){await sql`UPDATE wa_messages SET status_note='Waiting for platform template' WHERE id=${m.id}`;continue;}
    if(test.length&&!test.includes(String(m.customer_id))){await sql`UPDATE wa_messages SET status='skipped',status_note='Test mode: not a test merchant' WHERE id=${m.id}`;continue;}
    const to=waPhone(m.phone);
    if(!to){await sql`UPDATE wa_messages SET status='skipped',status_note='No phone number' WHERE id=${m.id}`;continue;}
    const v=m.variables||{};
    const body=Object.fromEntries(t.body.map((k,i)=>[String(i+1),String(v[k]??'')]));
    const media=String(v.header_media_url||t.headerImage||'');
    if(t.headerImage!==undefined&&!media){await sql`UPDATE wa_messages SET status_note='Waiting for header image link' WHERE id=${m.id}`;continue;}
    const payload={template_name:t.name,language:{code:'en_US',policy:'deterministic'},from:WA_FROM,default_country:'IN',
      recipients:[{to,variables:{...(media?{header:{media_url:media}}:{}),body,...(t.callbackButton!==undefined?{buttons:{[t.callbackButton]:{'1':String(v.callback_token||'')}}}:{})}}]};
    try{
      const res=await fetch(WA_API_URL,{method:'POST',headers:{'X-API-Key':process.env.PI_WA_API_KEY!,'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const text=(await res.text()).slice(0,500);
      if(res.ok) await sql`UPDATE wa_messages SET status='sent',sent_at=now(),phone=${to},attempts=attempts+1,status_note=${text} WHERE id=${m.id}`;
      else await sql`UPDATE wa_messages SET status='failed',attempts=attempts+1,status_note=${`HTTP ${res.status}: ${text}`} WHERE id=${m.id}`;
    }catch(e:any){
      await sql`UPDATE wa_messages SET status='failed',attempts=attempts+1,status_note=${String(e?.message||e).slice(0,500)} WHERE id=${m.id}`;
    }
  }
}

// Seller: Voicemail / Disconnected / Not Connected.
export async function triggerSellerWa(sql:any,customerId:string,agentId:string,callId:string){
  if(await waSuppressed(sql,customerId)) return;
  const c=await merchantContact(sql,customerId);
  const id=await queueWa(sql,{template:'SELLER_NOT_CONNECTED',workspace:'seller',customerId,phone:c.phone,agentId,sourceRef:`call:${callId}`,variables:{merchant_name:c.name}});
  if(id) await sendQueuedWa(sql,[id]);
}
// Seller: the same nudge for a Lead Gen lead that has no Cust ID yet (name and phone from the lead).
export async function triggerSellerLeadWa(sql:any,lead:{id:string;phone:string;name:string|null},agentId:string,callId:string){
  const id=await queueWa(sql,{template:'SELLER_NOT_CONNECTED',workspace:'seller',customerId:null,leadId:lead.id,phone:lead.phone,agentId,sourceRef:`call:${callId}`,variables:{merchant_name:lead.name||''}});
  if(id) await sendQueuedWa(sql,[id]);
}

// Onboarding: Not Connected. Plan / purchase date / expiry / credits from the case (Sub Raw),
// falling back to the plan sold and its starting credits for merchants Sub Raw has not seen yet.
export async function triggerOnboardingWa(sql:any,caseId:string,agentId:string,eventRef:string){
  const cs=await sql`SELECT customer_id,sale_date::text AS sale_date,sub_plan_name,sub_expiry_date::text AS expiry,sub_credits::float8 AS credits FROM onboarding_cases WHERE id=${caseId}::uuid`;
  const k=cs[0]; if(!k) return;
  if(await waSuppressed(sql,k.customer_id)) return;
  const c=await merchantContact(sql,k.customer_id);
  const cur=await currentPlanOf(sql,k.customer_id);
  const planName=k.sub_plan_name||(cur.plan?planLabel(cur.plan):'');
  const expiry=k.expiry||(k.sale_date?new Date(new Date(k.sale_date+'T00:00:00Z').getTime()+30*86400000).toISOString().slice(0,10):null);
  const credits=k.credits??(cur.plan&&cur.plan!=='legacy'?PLAN_START_CREDITS[cur.plan]:null);
  const id=await queueWa(sql,{template:'ONB_NOT_CONNECTED',workspace:'onboarding',customerId:k.customer_id,phone:c.phone,agentId,sourceRef:eventRef,
    variables:{merchant_name:c.name,plan_name:planName,purchase_date:fmtDate(k.sale_date),expiry_date:fmtDate(expiry),credits:fmtMoney(credits)}});
  if(id) await sendQueuedWa(sql,[id]);
}

// Onboarding Not Connected messages skipped for "No phone number" (a case CT created that day is
// called before the 2:30 AM merchant sync brings the merchant's phone): sent the next morning from
// 9 AM, once the phone is known, if the case is still open and its latest call is still Not
// Connected. One message per merchant. Runs from the 5-minute lead sync between 9 and 11 AM IST.
export async function retryOnboardingNoPhone(sql:any){
  const istHour=new Date(Date.now()+330*60000).getUTCHours();
  if(istHour<9||istHour>=11||!waReady('ONB_NOT_CONNECTED')) return 0;
  const rows=await sql`
    SELECT DISTINCT ON (w.customer_id) w.id,w.customer_id,w.variables,
      array_agg(w.id) OVER (PARTITION BY w.customer_id) AS all_ids
    FROM wa_messages w
    JOIN LATERAL (SELECT id,current_status FROM onboarding_cases WHERE customer_id=w.customer_id ORDER BY created_at LIMIT 1) c ON TRUE
    JOIN LATERAL (SELECT l0_code FROM onboarding_events e WHERE e.onboarding_case_id=c.id AND e.source_type='new_event'
                  ORDER BY e.event_time DESC,e.attempt_number DESC LIMIT 1) last ON TRUE
    WHERE w.workspace='onboarding' AND w.template='ONB_NOT_CONNECTED' AND w.status='skipped' AND w.status_note='No phone number'
      AND w.created_at>now()-interval '3 days'
      AND (w.created_at AT TIME ZONE 'Asia/Kolkata')::date<(now() AT TIME ZONE 'Asia/Kolkata')::date
      AND c.current_status='open' AND last.l0_code='OB_NOT_CONNECTED'
    ORDER BY w.customer_id,w.created_at DESC
  `;
  const ids:number[]=[];
  for(const r of rows){
    const c=await merchantContact(sql,String(r.customer_id));
    if(!waPhone(c.phone)) continue;
    const others=(r.all_ids||[]).map(Number).filter((x:number)=>x!==Number(r.id));
    if(others.length) await sql`UPDATE wa_messages SET status_note='No phone number (sent once the next morning)' WHERE id=ANY(${others})`;
    await sql`UPDATE wa_messages SET phone=${c.phone},variables=${sql.json({...(r.variables||{}),merchant_name:r.variables?.merchant_name||c.name})},
      status='queued',status_note='Phone from the night merchant sync; sent next morning' WHERE id=${r.id} AND status='skipped'`;
    ids.push(Number(r.id));
  }
  await sendQueuedWa(sql,ids);
  return ids.length;
}

// CSM, after each completed daily sync (latest snapshot `runId`), for merchants in the CSM panel:
//   T1_RENEW         Expired / Cancelled, not renewed (once per lapse)
//   T2/T3            ads ended (latest ad end date is today or yesterday), credits ≥ / < ₹1,000
//   T4/T5            ads end tomorrow, credits ≥ / < ₹1,000
// Day one (the first sync once the CSM templates are set) messages everyone who qualifies, ads that
// ended earlier included; after that only new entries. Once per merchant per template and cycle
// (lapse date / ad end date). Merchants marked Not Interested / Refund (CSM closed or onboarding
// lost) are left out. Nothing is recorded until the CSM templates are configured, so day one starts
// when sending actually can.
// CSM messages go out automatically for every template that is configured. Each snapshot is processed right after the daily sync, and again the first
// time the CSM workspace is opened after a template goes live mid-day (see ensureCsmWaRun).
export const CSM_AUTO_SEND=true;
export async function runCsmWaTriggers(sql:any,runId:number){
  if(!CSM_AUTO_SEND) return {queued:0,note:'CSM automatic sending is off'};
  const ready={T1:csmLive('T1_RENEW'),ENDED:csmLive('T2_ENDED_FREE')&&csmLive('T3_ENDED_TOPUP'),ENDING:csmLive('T4_ENDING_FREE')&&csmLive('T5_ENDING_TOPUP')};
  if(!ready.T1&&!ready.ENDED&&!ready.ENDING) return {queued:0,note:'CSM templates not configured'};
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
  const rows=await sql`
    WITH m AS (
      SELECT s.customer_id,s.status,s.cancelled_at,s.expected_renewal_due_date::text AS due,s.wallet_balance::float8 AS credits,
        COALESCE(NULLIF(s.merchant_name,''),a.name) AS name,COALESCE(NULLIF(s.phone_number,''),a.phone) AS phone,
        a.impressions,a.last_end::text AS last_end,a.active_ads,
        (c.current_status='lost') AS onb_lost,
        EXISTS(SELECT 1 FROM onboarding_events e WHERE e.customer_id=s.customer_id AND e.source_type='customer_success_followup'
          AND e.l0_code IN ('OB_NOT_INTERESTED','OB_REFUND_REQUESTED')) AS closed,
        (c.current_status='open' AND c.reopen_reason IS NOT NULL) AS reopened
      FROM merchant_subscriptions s
      LEFT JOIN (SELECT customer_id,sum(impressions)::float8 AS impressions,max(end_date) AS last_end,count(*) FILTER (WHERE ad_status='ACTIVE')::int AS active_ads,
                   max(merchant_name) AS name,max(phone_number) AS phone FROM merchant_ads WHERE sync_run_id=${runId} GROUP BY customer_id) a ON a.customer_id=s.customer_id
      LEFT JOIN LATERAL (SELECT current_status,reopen_reason FROM onboarding_cases WHERE customer_id=s.customer_id ORDER BY created_at LIMIT 1) c ON TRUE
      WHERE s.sync_run_id=${runId} AND (a.customer_id IS NOT NULL OR COALESCE(s.completed_ads_count,0)>0)
    )
    SELECT * FROM m WHERE NOT COALESCE(onb_lost,FALSE) AND NOT closed AND NOT COALESCE(reopened,FALSE)
  `;
  // Day one for a template pair = the first run after it goes live.
  const dayOne=(await sql`SELECT count(*)::int AS n FROM wa_messages WHERE template IN ('T2_ENDED_FREE','T3_ENDED_TOPUP') AND status<>'baseline' AND COALESCE(source_ref,'') NOT LIKE 'test:%'`)[0].n===0;
  const addDays=(d:string,n:number)=>new Date(new Date(d+'T00:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
  const ids:number[]=[];
  for(const r of rows){
    const base={workspace:'csm' as const,customerId:String(r.customer_id),phone:r.phone};
    if(r.status==='CANCELLED'||r.status==='EXPIRED'){
      if(!ready.T1) continue;
      // Once per lapse and platform template: a new T1 template also goes to merchants who got an earlier one.
      const cycle=String(r.due||r.cancelled_at||r.status);
      const id=await queueWa(sql,{...base,template:'T1_RENEW',dedupeKey:`T1_RENEW|${WA_TEMPLATES.T1_RENEW?.name}|${r.customer_id}|${cycle}`,sourceRef:`run:${runId}`,
        variables:{merchant_name:r.name||'',impressions:fmtCount(r.impressions??0)}});
      if(id) ids.push(id);
      continue;
    }
    if(!r.last_end) continue;
    const free=Number(r.credits||0)>=1000;
    if(r.last_end<=today&&(dayOne||r.last_end>=addDays(today,-1))){
      if(!ready.ENDED) continue;
      const t=free?'T2_ENDED_FREE':'T3_ENDED_TOPUP';
      const id=await queueWa(sql,{...base,template:t,dedupeKey:`ENDED|${r.customer_id}|${r.last_end}`,sourceRef:`run:${runId}`,
        variables:{merchant_name:r.name||'',impressions:fmtCount(r.impressions??0),credits:fmtMoney(r.credits??0)}});
      if(id) ids.push(id);
    }else if(r.last_end===addDays(today,1)&&r.active_ads>0){
      if(!ready.ENDING) continue;
      const t=free?'T4_ENDING_FREE':'T5_ENDING_TOPUP';
      const id=await queueWa(sql,{...base,template:t,dedupeKey:`ENDING|${r.customer_id}|${r.last_end}`,sourceRef:`run:${runId}`,
        variables:{merchant_name:r.name||'',ad_end_date:fmtDate(r.last_end),credits:fmtMoney(r.credits??0)}});
      if(id) ids.push(id);
    }
  }
  await sendQueuedWa(sql,ids);
  return {queued:ids.length};
}

// Runs the live CSM templates on the latest snapshot unless that snapshot was already processed with
// the same set of live templates. Adding a template later processes it again; the once-per-cycle
// keys stop anyone getting the same message twice.
export async function ensureCsmWaRun(sql:any){
  await sendCsmTests(sql);
  const live=(['T1_RENEW','T2_ENDED_FREE','T3_ENDED_TOPUP','T4_ENDING_FREE','T5_ENDING_TOPUP'] as WaTemplate[]).filter(csmLive).join(',');
  if(!CSM_AUTO_SEND||!live) return;
  const claim=await sql`
    UPDATE csm_sync_runs SET wa_templates=${live}
    WHERE id=(SELECT max(id) FROM csm_sync_runs WHERE status='complete') AND wa_templates IS DISTINCT FROM ${live}
    RETURNING id
  `;
  if(claim[0]) await runCsmWaTriggers(sql,Number(claim[0].id));
}

// A new disposition by the workspace clears that merchant's open callback requests there.
export async function resolveCallbackRequests(sql:any,workspace:WaWorkspace,customerId:string|null,leadId?:string|null){
  if(customerId) await sql`UPDATE wa_messages SET resolved_at=now() WHERE workspace=${workspace} AND customer_id=${customerId} AND clicked_at IS NOT NULL AND resolved_at IS NULL`;
  if(leadId) await sql`UPDATE wa_messages SET resolved_at=now() WHERE workspace=${workspace} AND lead_id=${leadId}::uuid AND clicked_at IS NOT NULL AND resolved_at IS NULL`;
}

// Sends each CSM template in its test stage to its testers, once per tester and platform template.
async function sendCsmTests(sql:any){
  const ids:number[]=[];
  for(const [t,testers] of Object.entries(CSM_WA_TESTERS) as [WaTemplate,{name:string;phone:string}[]][]){
    if(!waReady(t)) continue;
    for(const x of testers||[]){
      const id=await queueWa(sql,{template:t,workspace:'csm',customerId:TEST_CUSTOMER,phone:x.phone,sourceRef:`test:${x.name}`,
        dedupeKey:`TEST|${t}|${WA_TEMPLATES[t]!.name}|${x.phone}`,variables:{...TEST_VARIABLES,merchant_name:x.name}});
      if(id) ids.push(id);
    }
  }
  await sendQueuedWa(sql,ids);
}
