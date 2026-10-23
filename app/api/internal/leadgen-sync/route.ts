import { timingSafeEqual } from 'crypto';
import { NextResponse,after } from 'next/server';
import { db } from '@/lib/db';
import { retryOnboardingNoPhone,ensureCsmWaRun } from '@/lib/wa';
import { runDailyJobs } from '@/lib/onboarding-rebalance';
import { syncPicomDnd } from '@/lib/clevertap-dnd';
import { runWinbackWa } from '@/lib/winback-wa';
import { ingestLeads,linkLeadsToCustomers,linkAfterMerchantSync,assignUnassignedLeads } from '@/lib/leadgen';

// Lead Gen Ads sheet → portal (scripts/leadgen-sync.gs, every 5 minutes). Takes the sheet's new
// rows, links the new leads to Cust IDs by phone and assigns any unassigned leads. (Older
// unlinked leads are re-checked after the daily merchant sync, when merchant phones change.)
// Uses the same secret as the Sub Raw / CSM syncs.
function sameSecret(a:string,b:string){
  const aa=Buffer.from(a); const bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}

export const maxDuration=300;

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
  // Rides on this 5-minute trigger: yesterday's onboarding WhatsApps that had no phone go out from 9 AM.
  await retryOnboardingNoPhone(sql).catch((e:any)=>console.error('onboarding no-phone retry failed',e));
  // Also the clock for once-a-day jobs: the 8:30 AM onboarding backlog rebalance.
  await runDailyJobs(sql).catch((e:any)=>console.error('daily jobs failed',e));
  // And for the CSM WhatsApps at 12 PM (once per day's snapshot), after the response so the
  // sheet script isn't kept waiting while they send.
  after(async()=>{await ensureCsmWaRun(sql).catch((e:any)=>console.error('csm whatsapp error',e));});
  // Not Interested / Refund merchants -> Picom_dnd on OCL CleverTap (lib/clevertap-dnd.ts).
  after(async()=>{await syncPicomDnd(sql).catch((e:any)=>console.error('picom dnd error',e));});
  // Win-back testimonial WhatsApp to the same merchants, from 12 PM every second day (lib/winback-wa.ts).
  after(async()=>{await runWinbackWa(sql).catch((e:any)=>console.error('winback whatsapp error',e));});
  return NextResponse.json({ok:true,received:rows.length,...ingest,linked,assigned});
}
