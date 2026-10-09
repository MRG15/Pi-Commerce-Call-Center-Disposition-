import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';

// CleverTap (PPSL) webhook for the pic_subscription / payment_success event. Each sale is stored
// with its employee code so we know who brought the merchant in. Accepts CT's webhook body
// ({profiles:[{identity, key_values, event_properties, ...}]}), a single flat event, or an array.
// Field names: customer_id (or the profile identity), flow / event_label, plan / event_label2,
// amount / event_label3, employee_code / event_label4, event_time (optional). Values sent as
// "flow=subscribe" are read as "subscribe".

function sameSecret(a:string,b:string){
  const aa=Buffer.from(a); const bb=Buffer.from(b);
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}

function val(v:unknown){
  let s=String(v??'').trim();
  if(/^[a-z_ ]+=/i.test(s)) s=s.slice(s.indexOf('=')+1).trim();
  return s||null;
}

function pick(srcs:any[],names:string[]){
  for(const src of srcs){
    if(!src||typeof src!=='object') continue;
    for(const n of names){
      if(src[n]!==undefined&&src[n]!==null&&String(src[n]).trim()!=='') return src[n];
    }
  }
  return undefined;
}

function eventTime(v:unknown){
  if(v===undefined||v===null||v==='') return null;
  const n=Number(v);
  // CT sends epoch seconds; also accept milliseconds and ISO strings.
  const d=Number.isFinite(n)?new Date(n<1e12?n*1000:n):new Date(String(v));
  return isNaN(d.getTime())?null:d;
}

function istDay(d:Date){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}

function normalize(item:any){
  const srcs=[item?.key_values,item?.event_properties,item?.eventProperties,item?.evtData,item?.profileData,item];
  const customerId=val(pick(srcs,['customer_id','cust_id','custId','customerId','merchant_cust_id','identity']));
  if(!customerId||!/^\d+$/.test(customerId)) return null;
  const amountRaw=val(pick(srcs,['amount','event_label3']));
  const amount=amountRaw&&Number.isFinite(Number(amountRaw.replace(/[^0-9.]/g,'')))&&amountRaw.replace(/[^0-9.]/g,'')!==''?Number(amountRaw.replace(/[^0-9.]/g,'')):null;
  const flow=val(pick(srcs,['flow','event_label']))?.toLowerCase()||null;
  const plan=val(pick(srcs,['plan','event_label2']))?.toLowerCase()||null;
  const employeeCode=val(pick(srcs,['employee_code','employeeCode','event_label4']));
  const at=eventTime(pick(srcs,['event_time','eventTime','ts','timestamp']))||new Date();
  return {customerId,flow,plan,amount,employeeCode,at,
    dedupeKey:[customerId,flow||'',plan||'',amount??'',istDay(at)].join('|'),raw:item};
}

export async function POST(req:Request){
  const configured=process.env.CT_WEBHOOK_SECRET||'';
  const supplied=req.headers.get('x-ct-webhook-secret')||'';
  if(!configured||!supplied||!sameSecret(configured,supplied)) return NextResponse.json({error:'Unauthorized'},{status:401});
  const body:any=await req.json().catch(()=>null);
  if(!body) return NextResponse.json({error:'Invalid JSON'},{status:400});
  const items:any[]=Array.isArray(body)?body:Array.isArray(body.profiles)?body.profiles:Array.isArray(body.events)?body.events:[body];
  const rows=items.map(normalize).filter(Boolean) as NonNullable<ReturnType<typeof normalize>>[];
  const sql=db();
  let stored=0;
  for(const r of rows){
    const res=await sql`
      INSERT INTO ct_payment_events(customer_id,flow,plan,amount,employee_code,event_at,dedupe_key,raw)
      VALUES(${r.customerId},${r.flow},${r.plan},${r.amount},${r.employeeCode},${r.at},${r.dedupeKey},${sql.json(r.raw)})
      ON CONFLICT (dedupe_key) DO NOTHING
      RETURNING id
    `;
    stored+=res.length;
  }
  return NextResponse.json({ok:true,received:items.length,stored,duplicates:rows.length-stored,skipped:items.length-rows.length});
}

// Latest events, for admins to check the webhook is arriving.
export async function GET(){
  const user:any=await currentUserAccess();
  if(!user?.isSuperAdmin&&user?.role!=='admin') return NextResponse.json({error:'Admin only'},{status:403});
  const sql=db();
  const rows=await sql`
    SELECT customer_id,flow,plan,amount::float8 AS amount,employee_code,event_at,received_at
    FROM ct_payment_events ORDER BY received_at DESC LIMIT 100
  `;
  return NextResponse.json({events:rows});
}
