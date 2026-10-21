import { randomBytes,timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Voice AI handoff (the onboarding voice AI's "transfer to a human" tool). Each call adds the merchant
// to the onboarding Req Call Back pane, tagged Voice AI, for the onboarder who owns their case; it
// clears like any callback request once a disposition is logged. Only phone is required; every field
// sent is kept as-is (wa_messages.variables) so the voice AI team can add fields later.
// Merchant: customer_id when sent, else the phone (onboarding case first, then merchant info).
// No match: still saved, shown to onboarding admins as "Voice AI · unmatched". A second call for the
// same merchant while a request is open bumps it instead of adding another.
// Auth: header x-voice-ai-secret = VOICE_AI_CALLBACK_SECRET.
const TEMPLATE='VOICE_AI_HANDOFF';

function sameSecret(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
const pick=(b:any,names:string[])=>{for(const n of names){const v=b?.[n];if(v!==undefined&&v!==null&&String(v).trim()!=='') return String(v).trim();}return '';};

export async function POST(req:Request){
  const configured=process.env.VOICE_AI_CALLBACK_SECRET||'';
  const supplied=req.headers.get('x-voice-ai-secret')||'';
  if(!configured||!supplied||!sameSecret(configured,supplied)) return NextResponse.json({ok:false,error:'Unauthorized'},{status:401});
  const body:any=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body)) return NextResponse.json({ok:false,error:'Send a JSON object'},{status:400});
  const phone=pick(body,['phone','phone_number','mobile','msisdn']).replace(/\D/g,'').slice(-10);
  if(phone.length!==10) return NextResponse.json({ok:false,error:'phone is required (10-digit Indian mobile number)'},{status:400});
  const sentCustomer=pick(body,['customer_id','cust_id','custid']).replace(/\.0$/,'');
  const sql=db();

  let customerId:string|null=null;
  if(/^\d+$/.test(sentCustomer)){
    const c=await sql`SELECT customer_id FROM onboarding_cases WHERE customer_id=${sentCustomer} LIMIT 1`;
    customerId=c[0]?.customer_id||null;
  }
  if(!customerId){
    const m=await sql`
      SELECT x.customer_id FROM (
        SELECT customer_id FROM merchant_information WHERE active=TRUE AND right(regexp_replace(COALESCE(phone_number,''),'[^0-9]','','g'),10)=${phone}
        UNION SELECT customer_id FROM customers WHERE right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),10)=${phone}
      ) x JOIN onboarding_cases c ON c.customer_id=x.customer_id
      ORDER BY (c.current_status='open') DESC,c.created_at DESC LIMIT 1
    `;
    customerId=m[0]?.customer_id||null;
  }
  // Customer ID sent but no onboarding case for it: keep their ID on the request anyway.
  const storeCustomer=customerId||(/^\d+$/.test(sentCustomer)?sentCustomer:null);
  const variables={...body,received_at:new Date().toISOString()};

  const open=await sql`
    SELECT id FROM wa_messages WHERE workspace='onboarding' AND template=${TEMPLATE} AND resolved_at IS NULL AND clicked_at IS NOT NULL
      AND ${storeCustomer?sql`customer_id=${storeCustomer}`:sql`customer_id IS NULL AND phone=${phone}`}
    ORDER BY clicked_at DESC LIMIT 1
  `;
  let id;
  if(open[0]){
    await sql`UPDATE wa_messages SET clicked_at=now(),click_count=click_count+1,variables=${sql.json(variables)},phone=${phone} WHERE id=${open[0].id}`;
    id=open[0].id;
  }else{
    const r=await sql`
      INSERT INTO wa_messages(token,template,workspace,customer_id,phone,source_ref,variables,status,status_note,clicked_at,click_count)
      VALUES(${randomBytes(12).toString('base64url')},${TEMPLATE},'onboarding',${storeCustomer},${phone},${pick(body,['call_id','callId','session_id'])||null},
        ${sql.json(variables)},'skipped',${customerId?'Voice AI handoff (no WhatsApp sent)':'Voice AI handoff (no WhatsApp sent); no onboarding case found for this phone / customer ID'},now(),1)
      RETURNING id
    `;
    id=r[0].id;
  }
  return NextResponse.json({ok:true,request_id:String(id),matched:Boolean(customerId),customer_id:storeCustomer});
}
