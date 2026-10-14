// Lead Gen Ads: Meta lead-form leads synced from the lead sheet.
//   - One lead per person: the sheet repeats rows (same Meta lead ID), and a person often submits
//     several times in a row; submissions from the same phone within 24 hours are one lead.
//   - A submission more than 24 hours after that phone's last lead is a new lead, tagged
//     "Repeat submission" (high intent), and goes through the rotation again.
//   - A lead a seller already called (a Seller disposition on its phone / Cust ID on or after the
//     day it came in) goes to that seller, tagged "Already called".
//   - Otherwise leads are shared round robin among the sellers switched on for Lead gen in
//     Manage Access (leadgen_roster), like the onboarding rotation. Switching someone off keeps
//     their leads with them; they just get no new ones.
//   - The phone is matched to a merchant (merchant sync) to get the Cust ID; until then the lead's
//     dispositions are saved against the lead, never with the phone as a Cust ID.

export type SheetLead={id?:string;created_time?:string;ad_name?:string;adset_name?:string;campaign_name?:string;form_name?:string;platform?:string;full_name?:string;phone_number?:string};

// A phone from the lead sheet ("p:+919876543210") as 10 digits.
export function leadPhone(raw:unknown){
  let d=String(raw??'').replace(/\D/g,'');
  if(d.length===12&&d.startsWith('91')) d=d.slice(2);
  else if(d.length===11&&d.startsWith('0')) d=d.slice(1);
  return d.length===10?d:null;
}

const clean=(v:unknown)=>{const s=String(v??'').trim();return s||null;};
const DAY=86400000;

export async function ingestLeads(sql:any,rows:SheetLead[]){
  const parsed=rows.map(r=>({meta:clean(String(r.id||'').replace(/^l:/,'')),phone:leadPhone(r.phone_number),at:new Date(String(r.created_time||'')),r}))
    .filter(x=>x.meta&&x.phone&&!Number.isNaN(x.at.getTime()))
    .sort((a,b)=>a.at.getTime()-b.at.getTime());
  const seen=new Set<string>();
  let created=0,merged=0,skipped=0;
  for(const x of parsed){
    if(seen.has(x.meta!)){skipped++;continue;}
    seen.add(x.meta!);
    const known=await sql`SELECT 1 FROM leadgen_meta_ids WHERE meta_lead_id=${x.meta}`;
    if(known[0]){skipped++;continue;}
    const prev=(await sql`SELECT id,last_submitted_at FROM leadgen_leads WHERE phone=${x.phone} ORDER BY submitted_at DESC LIMIT 1`)[0];
    if(prev&&Math.abs(x.at.getTime()-new Date(prev.last_submitted_at).getTime())<DAY){
      await sql`UPDATE leadgen_leads SET submissions=submissions+1,last_submitted_at=GREATEST(last_submitted_at,${x.at.toISOString()}::timestamptz),
        name=COALESCE(name,${clean(x.r.full_name)}) WHERE id=${prev.id}`;
      await sql`INSERT INTO leadgen_meta_ids(meta_lead_id,lead_id) VALUES(${x.meta},${prev.id}) ON CONFLICT DO NOTHING`;
      merged++;continue;
    }
    const ins=await sql`
      INSERT INTO leadgen_leads(phone,name,submitted_at,last_submitted_at,campaign_name,adset_name,ad_name,form_name,platform,is_repeat)
      VALUES(${x.phone},${clean(x.r.full_name)},${x.at.toISOString()},${x.at.toISOString()},${clean(x.r.campaign_name)},${clean(x.r.adset_name)},
        ${clean(x.r.ad_name)},${clean(x.r.form_name)},${clean(x.r.platform)},${Boolean(prev)})
      RETURNING id
    `;
    await sql`INSERT INTO leadgen_meta_ids(meta_lead_id,lead_id) VALUES(${x.meta},${ins[0].id}) ON CONFLICT DO NOTHING`;
    created++;
  }
  return {created,merged,skipped};
}

// Gives unlinked leads the Cust ID of the merchant with that phone, and moves their lead-only
// dispositions onto the Cust ID (attempt numbers continue after the merchant's own calls).
export async function linkLeadsToCustomers(sql:any){
  const matches=await sql`
    SELECT l.id,l.phone,m.customer_id FROM leadgen_leads l
    JOIN LATERAL (
      SELECT customer_id FROM merchant_information
      WHERE active=TRUE AND right(regexp_replace(COALESCE(phone_number,''),'[^0-9]','','g'),10)=l.phone
      ORDER BY last_synced_at DESC NULLS LAST,customer_id LIMIT 1
    ) m ON TRUE
    WHERE l.customer_id IS NULL
  `;
  for(const x of matches){
    await sql.begin(async(tx:any)=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${String(x.customer_id)}))`;
      await tx`INSERT INTO customers(customer_id) VALUES(${x.customer_id}) ON CONFLICT (customer_id) DO NOTHING`;
      await tx`UPDATE leadgen_leads SET customer_id=${x.customer_id} WHERE id=${x.id} AND customer_id IS NULL`;
      await tx`
        WITH base AS (SELECT COALESCE(max(attempt_number),0) AS n FROM calls WHERE customer_id=${x.customer_id}),
        moved AS (SELECT id,row_number() OVER (ORDER BY event_time,attempt_number) AS k FROM calls WHERE lead_id=${x.id} AND customer_id IS NULL)
        UPDATE calls c SET customer_id=${x.customer_id},attempt_number=(SELECT n FROM base)+moved.k,phone=COALESCE(c.phone,${x.phone})
        FROM moved WHERE c.id=moved.id
      `;
      await tx`UPDATE wa_messages SET customer_id=${x.customer_id} WHERE lead_id=${x.id} AND customer_id IS NULL`;
    });
  }
  return matches.length;
}

export async function loadLeadgenRoster(sql:any){
  const rows=await sql`
    WITH r AS (
      SELECT a.id,a.name,(SELECT max(added_at) FROM leadgen_roster) AS since
      FROM leadgen_roster o JOIN agents a ON a.id=o.agent_id
      JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='seller'
      WHERE a.active=TRUE
    )
    SELECT r.id,r.name,
      (SELECT count(*)::int FROM leadgen_leads l WHERE l.rotation_agent_id=r.id AND l.assigned_at>=r.since) AS count,
      (SELECT max(l.assigned_at) FROM leadgen_leads l WHERE l.rotation_agent_id=r.id) AS last
    FROM r ORDER BY r.name
  `;
  return rows.map((x:any)=>({id:String(x.id),name:x.name,count:Number(x.count),last:x.last?new Date(x.last).getTime():0}));
}

// Assigns every unassigned lead, oldest first: to the seller who already called it, else the
// next seller in the Lead gen rotation. With nobody switched on, leads wait unassigned.
export async function assignUnassignedLeads(sql:any){
  const leads=await sql`SELECT id,phone,customer_id,submitted_at FROM leadgen_leads WHERE assigned_to IS NULL ORDER BY submitted_at`;
  if(!leads.length) return 0;
  const roster=await loadLeadgenRoster(sql);
  let n=0;
  for(const l of leads){
    const caller=(await sql`
      SELECT c.agent_id FROM calls c
      WHERE c.source_type='new_call' AND c.agent_id IS NOT NULL
        AND (c.lead_id=${l.id} OR c.customer_id=${l.phone} OR (${l.customer_id}::text IS NOT NULL AND c.customer_id=${l.customer_id}))
        AND c.call_date>=(${l.submitted_at}::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY c.event_time DESC NULLS LAST LIMIT 1
    `)[0];
    if(caller){
      await sql`UPDATE leadgen_leads SET assigned_to=${caller.agent_id},assigned_at=now(),already_called=TRUE WHERE id=${l.id} AND assigned_to IS NULL`;
      n++;continue;
    }
    if(!roster.length) continue;
    const next=[...roster].sort((a,b)=>(a.count-b.count)||(a.last-b.last)||a.name.localeCompare(b.name))[0];
    next.count++; next.last=Date.now();
    await sql`UPDATE leadgen_leads SET assigned_to=${next.id}::uuid,rotation_agent_id=${next.id}::uuid,assigned_at=now() WHERE id=${l.id} AND assigned_to IS NULL`;
    n++;
  }
  return n;
}
