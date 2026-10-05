import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { phoneKey,todayIst } from '@/lib/plans';

const isDate=(v:string|null)=>Boolean(v&&/^\d{4}-\d{2}-\d{2}$/.test(v));
const isUuid=(v:string|null)=>Boolean(v&&/^[0-9a-f-]{36}$/i.test(v));

async function tableExists(sql:any,name:string){
  const r=await sql`SELECT to_regclass(${'public.'+name}) IS NOT NULL AS ok`;
  return Boolean(r[0]?.ok);
}

// Whose leads this user may see: everyone for Seller Admins / Super Admins, a Team Lead's own
// plus their BDEs' (team as on today), otherwise only their own.
async function visibleAgents(sql:any,user:any){
  if(isWorkspaceAdmin(user,'seller')){
    const rows=await sql`
      SELECT a.id,a.name FROM agents a JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='seller'
      ORDER BY a.active DESC,a.name
    `;
    const list=rows.map((r:any)=>({id:String(r.id),name:r.name}));
    if(!list.some((a:any)=>a.id===user.id)) list.unshift({id:user.id,name:user.name});
    return {scope:'admin',agents:list};
  }
  const agents=[{id:String(user.id),name:user.name}];
  if(await tableExists(sql,'seller_roles')){
    const today=todayIst();
    const team=await sql`
      WITH cur AS (
        SELECT DISTINCT ON (agent_id) agent_id,role,team_lead_id
        FROM seller_roles WHERE effective_from<=${today}::date
        ORDER BY agent_id,effective_from DESC
      )
      SELECT a.id,a.name FROM cur JOIN agents a ON a.id=cur.agent_id
      WHERE cur.role='BDE' AND cur.team_lead_id=${user.id}::uuid
        AND EXISTS (SELECT 1 FROM cur me WHERE me.agent_id=${user.id}::uuid AND me.role='TL')
      ORDER BY a.name
    `;
    for(const r of team) agents.push({id:String(r.id),name:r.name});
  }
  return {scope:agents.length>1?'team':'self',agents};
}

export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'seller')) return NextResponse.json({error:'Seller access required'},{status:403});
  const u=new URL(req.url);
  const from=u.searchParams.get('from'),to=u.searchParams.get('to');
  if(!isDate(from)||!isDate(to)||from!>to!) return NextResponse.json({error:'from and to are required (YYYY-MM-DD, from ≤ to)'},{status:400});
  const l0=u.searchParams.get('l0'),l1=u.searchParams.get('l1'),l2=u.searchParams.get('l2');
  const q=String(u.searchParams.get('q')||'').trim();
  const qDigits=q.replace(/\D/g,'');
  const mode=u.searchParams.get('mode')==='all'?'all':'latest';
  const sql=db();
  const visible=await visibleAgents(sql,user);
  const requested=u.searchParams.get('agentId')||String(user.id);
  const ids=requested==='all'?visible.agents.map((a:any)=>a.id):visible.agents.some((a:any)=>a.id===requested)?[requested]:null;
  if(!ids) return NextResponse.json({error:'You cannot view this agent\'s leads.'},{status:403});
  const l0Id=isUuid(l0)?l0:null, l1Id=l0Id&&isUuid(l1)?l1:null, l2Id=l1Id&&isUuid(l2)?l2:null;
  const external=await tableExists(sql,'external_leads');
  const externalJoin=external
    ?sql`LEFT JOIN external_leads el ON el.customer_id=b.customer_id`
    :sql`LEFT JOIN (SELECT NULL::text AS customer_id,NULL::text AS name,NULL::text AS phone) el ON FALSE`;

  // One row per call, or (default) each lead's latest disposition in the range, so the
  // disposition filter shows which bucket every lead is in now.
  const rows=await sql`
    WITH base AS (
      SELECT c.id,c.customer_id,c.call_date::text AS call_date,c.event_time,COALESCE(a.name,c.agent_name_raw) AS agent_name,
        c.l0_id,c.l1_id,c.l2_id,c.l0_label_snapshot,c.l1_label_snapshot,c.l2_label_snapshot,c.remark,c.callback_at,c.plan_code,c.plan_amount_inr,
        count(*) OVER (PARTITION BY c.customer_id) AS calls_in_range,
        row_number() OVER (PARTITION BY c.customer_id ORDER BY c.event_time DESC NULLS LAST,c.attempt_number DESC) AS rn
      FROM calls c LEFT JOIN agents a ON a.id=c.agent_id
      WHERE c.source_type='new_call'
        AND c.agent_id=ANY(${ids}::uuid[])
        AND c.call_date BETWEEN ${from}::date AND ${to}::date
    ), named AS (
      SELECT b.*,
        COALESCE(m.merchant_name,cu.merchant_name,el.name) AS name,
        COALESCE(m.phone_number,cu.phone,el.phone) AS phone,
        (el.customer_id IS NOT NULL) AS external
      FROM base b
      LEFT JOIN merchant_information m ON m.customer_id=b.customer_id AND m.active=TRUE
      LEFT JOIN customers cu ON cu.customer_id=b.customer_id
      ${externalJoin}
      WHERE (${mode}='all' OR b.rn=1)
    )
    SELECT * FROM named
    WHERE (${l0Id}::uuid IS NULL OR l0_id=${l0Id}::uuid)
      AND (${l1Id}::uuid IS NULL OR l1_id=${l1Id}::uuid)
      AND (${l2Id}::uuid IS NULL OR l2_id=${l2Id}::uuid)
      AND (${q}='' OR customer_id ILIKE ${'%'+q+'%'} OR COALESCE(name,'') ILIKE ${'%'+q+'%'}
        OR (${qDigits.length>=4} AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') LIKE ${'%'+qDigits+'%'}))
    ORDER BY event_time DESC NULLS LAST
    LIMIT 2000
  `;
  return NextResponse.json({rows,agents:visible.agents,scope:visible.scope,truncated:rows.length===2000});
}

// Adds a lead by Cust ID (name and phone optional). Anyone already in the system is not
// added again; the response points to the existing customer instead.
export async function POST(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'seller')) return NextResponse.json({error:'Seller access required'},{status:403});
  const body=await req.json().catch(()=>({}));
  const customerId=String(body.customerId||'').trim();
  const name=String(body.name||'').trim()||null;
  const phoneRaw=String(body.phone||'').trim();
  if(!/^\d+$/.test(customerId)) return NextResponse.json({error:'A numeric customer ID is required.'},{status:400});
  const phone=phoneRaw?phoneKey(phoneRaw):null;
  if(phoneRaw&&!phone) return NextResponse.json({error:'Enter a valid 10-digit phone number.'},{status:400});
  const sql=db();
  if(!await tableExists(sql,'external_leads')) return NextResponse.json({error:'Adding leads is not enabled yet.'},{status:503});
  const existing=await sql`
    SELECT customer_id FROM customers WHERE customer_id=${customerId}
    UNION SELECT customer_id FROM merchant_information WHERE customer_id=${customerId}
    LIMIT 1
  `;
  if(existing[0]) return NextResponse.json({error:'This customer ID already exists.',existingCustomerId:customerId},{status:409});
  if(phone){
    const byPhone=await sql`
      SELECT customer_id FROM merchant_information WHERE active=TRUE AND right(regexp_replace(COALESCE(phone_number,''),'[^0-9]','','g'),10)=${phone}
      UNION SELECT customer_id FROM customers WHERE right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),10)=${phone}
      LIMIT 1
    `;
    if(byPhone[0]) return NextResponse.json({error:`This phone number already belongs to customer ${byPhone[0].customer_id}.`,existingCustomerId:String(byPhone[0].customer_id)},{status:409});
  }
  await sql.begin(async (tx:any)=>{
    await tx`INSERT INTO customers(customer_id,merchant_name,phone) VALUES(${customerId},${name},${phone})`;
    await tx`INSERT INTO external_leads(customer_id,name,phone,added_by) VALUES(${customerId},${name},${phone},${user.id}::uuid)`;
  });
  return NextResponse.json({ok:true,customerId},{status:201});
}
