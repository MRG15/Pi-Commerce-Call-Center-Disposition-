import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { whatsappCallback } from '@/lib/paytm-callbacks';

// "Request a callback" from a WhatsApp campaign the team sends themselves. One JSON object per tap:
//   { "phone": "9876543210", "customer_id"?, "name"?, "campaign"?, "request_id"?, "route_to"?: "Sales"|"Onboarding"|"CSM" }
// Routing and assignment: lib/paytm-callbacks.ts (whatsappCallback). Auth: header x-callback-secret = WA_CALLBACK_SECRET.
function sameSecret(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}

export async function POST(req:Request){
  const configured=process.env.WA_CALLBACK_SECRET||'';
  const supplied=req.headers.get('x-callback-secret')||'';
  if(!configured||!supplied||!sameSecret(configured,supplied)) return NextResponse.json({ok:false,error:'Unauthorized'},{status:401});
  const body:any=await req.json().catch(()=>null);
  if(!body||typeof body!=='object'||Array.isArray(body)) return NextResponse.json({ok:false,error:'Send a JSON object'},{status:400});
  const r=await whatsappCallback(db(),body);
  return NextResponse.json(r,{status:r.ok?200:400});
}
