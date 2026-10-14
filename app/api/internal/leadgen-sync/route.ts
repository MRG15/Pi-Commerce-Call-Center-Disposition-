import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ingestLeads,linkLeadsToCustomers,assignUnassignedLeads } from '@/lib/leadgen';

// Lead Gen Ads sheet → portal (scripts/leadgen-sync.gs, every 5 minutes). Takes the sheet's new
// rows, then links leads to Cust IDs by phone and assigns any unassigned leads.
// Uses the same secret as the Sub Raw / CSM syncs.
function sameSecret(a:string,b:string){
  const aa=Buffer.from(a); const bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}

export const maxDuration=60;

export async function POST(req:Request){
  const configured=process.env.SUB_RAW_SYNC_SECRET||'';
  const supplied=req.headers.get('x-sub-raw-sync-secret')||'';
  if(!configured||!supplied||!sameSecret(configured,supplied)) return NextResponse.json({error:'Unauthorized'},{status:401});
  const body:any=await req.json().catch(()=>null);
  const rows=Array.isArray(body?.rows)?body.rows:[];
  if(rows.length>1000) return NextResponse.json({error:'Send at most 1000 rows per request'},{status:400});
  const sql=db();
  const ingest=await ingestLeads(sql,rows);
  const linked=await linkLeadsToCustomers(sql);
  const assigned=await assignUnassignedLeads(sql);
  return NextResponse.json({ok:true,received:rows.length,...ingest,linked,assigned});
}
