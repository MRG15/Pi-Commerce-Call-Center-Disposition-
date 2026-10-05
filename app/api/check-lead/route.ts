import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Server-to-server check used by n8n before sending a lead to the Avaya dialer.
// Authenticated by the x-api-key header only; no login session.

function sameKey(a:string,b:string){
  const aa=Buffer.from(a); const bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}

export async function GET(){
  return NextResponse.json({status:'ok'});
}

export async function POST(req:Request){
  const configured=process.env.Avaya_LEAD_CHECK_API_KEY||'';
  const supplied=req.headers.get('x-api-key')||'';
  if(!configured || !supplied || !sameKey(configured,supplied)){
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }

  const body:any=await req.json().catch(()=>null);
  const raw=body?.customer_id;
  const customerId=raw===null||raw===undefined?'':String(raw).trim();
  if(!customerId) return NextResponse.json({error:'customer_id is required'},{status:400});

  try{
    const sql=db();
    // Pass when the customer has had no call in the last 48 hours and never converted, and was
    // not already sent to the dialer in the last 48 hours. A passing check records the send.
    const rows=await sql`
      INSERT INTO avaya_push_log (customer_id, last_sent_at)
      SELECT ${customerId}::text, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM calls
        WHERE customer_id = ${customerId}::text
          AND (created_at > now() - interval '48 hours'
               OR l1_label_snapshot = 'Payment done'
               OR l2_label_snapshot = 'Enrolled via WhatsApp')
      )
      ON CONFLICT (customer_id) DO UPDATE SET last_sent_at = now()
      WHERE avaya_push_log.last_sent_at < now() - interval '48 hours'
      RETURNING customer_id
    `;
    return NextResponse.json({pass:rows.length>0});
  }catch(e){
    // Fail open so a database problem never drops a lead.
    console.error('check-lead failed',e);
    return NextResponse.json({pass:true,fail_open:true});
  }
}
