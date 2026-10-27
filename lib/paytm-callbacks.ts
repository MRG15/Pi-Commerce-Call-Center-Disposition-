// Paytm callback requests: merchants who asked for a callback on a Paytm workflow page (Merchant
// Callback Request sheet, "Callbacks" tab, synced every 3 hours by scripts/paytm-callback-sync.gs).
//   Team (from the sheet's status columns):
//     subscription_status "Not subscribed"                 -> Sales
//     subscribed and ad_live_status "Ad live/completed"    -> CSM
//     subscribed, ads created none live / no ads           -> Onboarding
//   Cust ID: the sheet's cust_id; when blank, matched from the MID (ads / CT) or the phone.
//   Owner: an inbound request has no owner, so it is round robin among that team's agents (fewest
//   Paytm requests today first). While the request is open, that person can open and log the merchant
//   even if someone else owns the case (paytmRequestHolder); the case owner does not change.
//   Repeats (as Lead Gen): a request within 24 hours of the merchant's last one, while
//   it is still open, is the same request (tapped N×). Otherwise it is a new request tagged "Repeat".
//   A request routed to Onboarding for a lost case reopens it (Reopened: callback requested); the
//   owner stays, and the round-robin holder can log it.
//   Only requests from the last 48 hours (the sheet's expiry) are brought in.
import { randomBytes } from 'crypto';

export const PAYTM_CALLBACK='PAYTM_CALLBACK';
const DAY=86400000;
const s=(v:unknown)=>{const t=String(v??'').trim();return t||null;};

export type PaytmCallbackRow={cust_id?:unknown;id?:unknown;mid?:unknown;business_name?:unknown;phone_number?:unknown;requested_at?:unknown;stage?:unknown;reason?:unknown;
  subscription_status?:unknown;ad_live_status?:unknown;onboarding_stage?:unknown};

export function callbackTeam(sub:unknown,ad:unknown):'seller'|'onboarding'|'csm'{
  if(/not\s*subscribed/i.test(String(sub||''))) return 'seller';
  return /live\s*\/\s*completed/i.test(String(ad||''))?'csm':'onboarding';
}

// "2026-10-26 2:18:13" in IST.
function istTime(v:unknown){
  const m=String(v??'').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(!m) return null;
  const d=new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2,'0')}:${m[5]}:${m[6]||'00'}+05:30`);
  return Number.isNaN(d.getTime())?null:d;
}
const phone10=(v:unknown)=>{const d=String(v??'').replace(/\.0$/,'').replace(/\D/g,'');return d.length>=10?d.slice(-10):null;};

async function customerFor(sql:any,custId:string|null,mid:string|null,phone:string|null){
  if(custId) return custId;
  if(mid){
    const a=await sql`SELECT customer_id FROM merchant_ads WHERE mid=${mid} AND customer_id IS NOT NULL LIMIT 1`;
    if(a[0]) return String(a[0].customer_id);
    const c=await sql`SELECT customer_id FROM ct_payment_events WHERE mid=${mid} AND customer_id IS NOT NULL ORDER BY received_at DESC LIMIT 1`;
    if(c[0]) return String(c[0].customer_id);
  }
  if(phone){
    const m=await sql`SELECT customer_id FROM merchant_information WHERE active=TRUE AND right(regexp_replace(COALESCE(phone_number,''),'[^0-9]','','g'),10)=${phone}
      ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`;
    if(m[0]) return String(m[0].customer_id);
  }
  return null;
}

// A team's agents today (team members with agent access), fewest Paytm callbacks today first.
async function teamRotation(sql:any,team:'sales'|'onboarding'|'csm'){
  const ws=team==='sales'?'seller':team;
  const rows=await sql`
    WITH m AS (
      SELECT DISTINCT ON (agent_id) agent_id,member FROM team_changes
      WHERE team=${team} AND effective_from<=(now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY agent_id,effective_from DESC,id DESC
    )
    SELECT a.id,a.name,
      (SELECT count(*)::int FROM wa_messages w WHERE w.template=${PAYTM_CALLBACK} AND w.agent_id=a.id
        AND (w.created_at AT TIME ZONE 'Asia/Kolkata')::date=(now() AT TIME ZONE 'Asia/Kolkata')::date) AS n,
      (SELECT max(w.created_at) FROM wa_messages w WHERE w.template=${PAYTM_CALLBACK} AND w.agent_id=a.id) AS last
    FROM m JOIN agents a ON a.id=m.agent_id AND a.active=TRUE
    JOIN workspace_access w ON w.agent_id=a.id AND w.workspace=${ws} AND w.access_level='agent'
    WHERE m.member
  `;
  return rows.map((r:any)=>({id:String(r.id),name:r.name,n:Number(r.n),last:r.last?new Date(r.last).getTime():0}));
}

export async function ingestPaytmCallbacks(sql:any,input:PaytmCallbackRow[]){
  const cutoff=Date.now()-2*DAY;
  const rows=input.map(r=>({id:s(r.id)?.replace(/\.0$/,'')||null,at:istTime(r.requested_at),r})).filter(x=>x.id&&x.at)
    .sort((a,b)=>a.at!.getTime()-b.at!.getTime());
  let created=0,merged=0,seen=0,old=0,reopened=0;
  const rotations:Record<string,any[]>={};
  const nextOf=async(team:'sales'|'onboarding'|'csm')=>{
    const list=rotations[team]??=await teamRotation(sql,team);
    const next=[...list].sort((a,b)=>(a.n-b.n)||(a.last-b.last)||a.name.localeCompare(b.name))[0];
    if(!next) return null;
    next.n++;next.last=Date.now();return next.id as string;
  };
  for(const x of rows){
    if(x.at!.getTime()<cutoff){old++;continue;}
    if((await sql`SELECT 1 FROM paytm_callback_ids WHERE request_id=${x.id}`)[0]){seen++;continue;}
    const r=x.r, mid=s(r.mid), phone=phone10(r.phone_number);
    const team=callbackTeam(r.subscription_status,r.ad_live_status);
    const custId=String(r.cust_id??'').trim().replace(/\.0$/,'');
    const customerId=await customerFor(sql,/^\d{5,}$/.test(custId)?custId:null,mid,phone);
    const at=x.at!.toISOString();
    const info={request_id:x.id,mid:mid||'',business_name:s(r.business_name)||'',stage:s(r.stage)||'',reason:s(r.reason)||'',
      subscription_status:s(r.subscription_status)||'',ad_live_status:s(r.ad_live_status)||'',onboarding_stage:s(r.onboarding_stage)||''};
    const who=customerId?sql`customer_id=${customerId}`:sql`customer_id IS NULL AND phone=${phone}`;
    const prev=(customerId||phone)?(await sql`
      SELECT id,resolved_at,COALESCE((variables->>'last_requested_at')::timestamptz,clicked_at) AS last FROM wa_messages
      WHERE template=${PAYTM_CALLBACK} AND ${who} ORDER BY clicked_at DESC LIMIT 1`)[0]:null;
    if(prev&&!prev.resolved_at&&Math.abs(x.at!.getTime()-new Date(prev.last).getTime())<DAY){
      await sql`UPDATE wa_messages SET click_count=click_count+1,
        variables=variables||${sql.json({...info,last_requested_at:at})} WHERE id=${prev.id}`;
      await sql`INSERT INTO paytm_callback_ids(request_id,wa_message_id) VALUES(${x.id},${prev.id}) ON CONFLICT DO NOTHING`;
      merged++;continue;
    }
    const agentId=await nextOf(team==='seller'?'sales':team);
    const repeat=Boolean(prev);
    const ins=await sql`
      INSERT INTO wa_messages(token,template,workspace,customer_id,phone,agent_id,source_ref,dedupe_key,variables,status,status_note,clicked_at,click_count)
      VALUES(${randomBytes(12).toString('base64url')},${PAYTM_CALLBACK},${team},${customerId},${phone},${agentId},${'paytm:'+x.id},${'PCB|'+x.id},
        ${sql.json({...info,last_requested_at:at,repeat:repeat?'1':''})},'skipped',
        ${customerId?'Paytm callback request (no WhatsApp sent)':'Paytm callback request (no WhatsApp sent); no Cust ID found for this MID / phone'},${at},1)
      ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`;
    if(ins[0]){
      // A repeat replaces the merchant's older open request in that team.
      if(prev&&!prev.resolved_at) await sql`UPDATE wa_messages SET resolved_at=now() WHERE id=${prev.id}`;
      await sql`INSERT INTO paytm_callback_ids(request_id,wa_message_id) VALUES(${x.id},${ins[0].id}) ON CONFLICT DO NOTHING`;
      created++;
      if(team==='onboarding'&&customerId&&await reopenLostCase(sql,customerId,x.id!,info.stage)) reopened++;
    }
  }
  return {created,merged,seen,old,reopened};
}

// The agent holds an open Paytm callback request for this merchant in this workspace.
export async function paytmRequestHolder(sql:any,workspace:'onboarding'|'csm',customerId:string,agentId:string){
  const r=await sql`SELECT 1 FROM wa_messages WHERE template=${PAYTM_CALLBACK} AND workspace=${workspace} AND customer_id=${customerId}
    AND agent_id=${agentId}::uuid AND resolved_at IS NULL LIMIT 1`;
  return Boolean(r[0]);
}

async function reopenLostCase(sql:any,customerId:string,requestId:string,stage:string){
  return sql.begin(async(tx:any)=>{
    const c=(await tx`SELECT id FROM onboarding_cases WHERE customer_id=${customerId} ORDER BY created_at DESC LIMIT 1 FOR UPDATE`)[0];
    if(!c) return false;
    const upd=await tx`UPDATE onboarding_cases SET current_status='open',current_l0='Callback Requested',current_l1=NULL,current_l2=NULL,
        closed_at=NULL,next_callback_at=now(),last_activity_at=now(),updated_at=now(),reopened_at=now(),reopen_reason='callback_requested'
      WHERE id=${c.id} AND current_status='lost' RETURNING id`;
    if(!upd[0]) return false;
    const n=(await tx`SELECT COALESCE(MAX(attempt_number),0)+1 AS n FROM onboarding_events WHERE onboarding_case_id=${c.id}`)[0].n;
    await tx`INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_name_raw,source_type,l0_code,l0_label_snapshot,remark)
      VALUES(${c.id},${customerId},${n},'Paytm callback request','system','SYSTEM_CALLBACK_REOPENED','Reopened: callback requested',
        ${`Merchant asked for a callback on Paytm${stage?` (${stage.replace(/_/g,' ')})`:''}, request ${requestId}. Lost case reopened.`})`;
    return true;
  });
}
