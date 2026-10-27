import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ingestPaytmCallbacks } from '@/lib/paytm-callbacks';

// Merchant Callback Request sheet ("Callbacks" tab) -> Req Call Back panes (scripts/paytm-callback-sync.gs,
// every 3 hours). Same secret as the Sub Raw / CSM syncs. Re-sending rows is safe: each request ID is
// handled once.
function sameSecret(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}

export async function POST(req:Request){
  const configured=process.env.SUB_RAW_SYNC_SECRET||'';
  const supplied=req.headers.get('x-sub-raw-sync-secret')||'';
  if(!configured||!supplied||!sameSecret(configured,supplied)) return NextResponse.json({error:'Unauthorized'},{status:401});
  const body:any=await req.json().catch(()=>null);
  const rows=Array.isArray(body?.rows)?body.rows:[];
  if(rows.length>3000) return NextResponse.json({error:'Send at most 3000 rows per request'},{status:400});
  const result=await ingestPaytmCallbacks(db(),rows);
  return NextResponse.json({ok:true,...result});
}
