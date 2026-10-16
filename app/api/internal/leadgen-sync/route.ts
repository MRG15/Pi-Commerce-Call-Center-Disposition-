import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ingestLeads,linkLeadsToCustomers,linkAfterMerchantSync,assignUnassignedLeads } from '@/lib/leadgen';

// Lead Gen Ads sheet → portal (scripts/leadgen-sync.gs, every 5 minutes). Takes the sheet's new
// rows, links the new leads to Cust IDs by phone and assigns any unassigned leads. (Older
// unlinked leads are re-checked after the daily merchant sync, when merchant phones change.)
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
  const {newIds,...ingest}=await ingestLeads(sql,rows);
  // New leads now; every unlinked lead once after each merchant sync (if that sync didn't already).
  const linked=await linkLeadsToCustomers(sql,newIds)
    +await linkAfterMerchantSync(sql).catch((e:any)=>{console.error('lead linking after merchant sync failed',e);return 0;});
  const assigned=await assignUnassignedLeads(sql);
  return NextResponse.json({ok:true,received:rows.length,...ingest,linked,assigned});
}
