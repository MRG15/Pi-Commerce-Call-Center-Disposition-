// Paytm callback requests: merchants who asked for a callback on a Paytm workflow page (Merchant
// Callback Request sheet, "Callbacks" tab, synced every 3 hours by scripts/paytm-callback-sync.gs).
//   Team (from the sheet's status columns):
//     subscription_status "Not subscribed"                 -> Sales
//     subscribed and ad_live_status "Ad live/completed"    -> CSM
//     subscribed, ads created none live / no ads           -> Onboarding
//   Cust ID: the sheet's cust_id; when blank, matched from the MID (ads / CT) or the phone.
//   Owner (never an admin's queue; admins only reassign):
//     Sales       round robin among the Sales team's agents.
//     Onboarding  the case owner (also for lost / Not Interested cases), else whoever last logged an
//                 onboarding call for the merchant, else round robin among onboarding agents.
//     CSM         the assigned CSM, else the CSM who last called them; else, if onboarding has the
//                 merchant (e.g. lost before a CSM was assigned), it goes to that case owner in
//                 Onboarding; else round robin among CSM agents.
//   Repeats (as Lead Gen): a request within 24 hours of the merchant's last one, while
//   it is still open, is the same request (tapped N×). Otherwise it is a new request tagged "Repeat".
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
  let created=0,merged=0,seen=0,old=0;
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
    let team=callbackTeam(r.subscription_status,r.ad_live_status);
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
    let agentId:string|null=null;
    if(team==='seller') agentId=await nextOf('sales');
    else{
      const active=async(rows:any[])=>rows[0]?.id?String(rows[0].id):null;
      const caseOwner=customerId?await active(await sql`SELECT a.id FROM onboarding_cases c JOIN agents a ON a.id=c.assigned_to AND a.active
        WHERE c.customer_id=${customerId} ORDER BY c.created_at DESC LIMIT 1`):null;
      const lastCaller=async(source:string)=>customerId?active(await sql`SELECT a.id FROM onboarding_events e JOIN agents a ON a.id=e.agent_id AND a.active
        WHERE e.customer_id=${customerId} AND e.source_type=${source} ORDER BY e.event_time DESC LIMIT 1`):null;
      if(team==='onboarding') agentId=caseOwner||await lastCaller('new_event')||await nextOf('onboarding');
      else{
        agentId=(customerId?await active(await sql`SELECT a.id FROM csm_assignments x JOIN agents a ON a.id=x.agent_id AND a.active WHERE x.customer_id=${customerId}`):null)
          ||await lastCaller('customer_success_followup');
        if(!agentId&&caseOwner){team='onboarding';agentId=caseOwner;}
        if(!agentId) agentId=await nextOf('csm');
      }
    }
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
    }
  }
  return {created,merged,seen,old};
}
