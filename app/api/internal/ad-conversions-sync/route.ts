import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// Onboardings_Updated_List "New" tab (Ad_ID = AdsRun Raw Ads ID) → ad_conversions (scripts/ad-conversions-sync.gs). Each push
// overwrites the conversions of the ads it contains (the sheet is "as on" its last update).
// Same secret as the Sub Raw / CSM syncs.
function sameSecret(a:string,b:string){const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
const id=(v:unknown)=>{const t=String(v??'').trim().replace(/\.0$/,'');return /^\d+$/.test(t)?t:null;};
const num=(v:unknown)=>{const t=String(v??'').replace(/[^0-9.\-]/g,'');if(!t)return null;const n=Number(t);return Number.isFinite(n)?n:null;};

export async function POST(req:Request){
  const configured=process.env.SUB_RAW_SYNC_SECRET||'';
  const supplied=req.headers.get('x-sub-raw-sync-secret')||'';
  if(!configured||!supplied||!sameSecret(configured,supplied)) return NextResponse.json({error:'Unauthorized'},{status:401});
  const body:any=await req.json().catch(()=>null);
  const input=Array.isArray(body?.rows)?body.rows:[];
  if(input.length>2000) return NextResponse.json({error:'Send at most 2000 rows per request'},{status:400});
  const rows:any[]=[]; let skipped=0;
  for(const r of input){
    const c=id(r.customer_id), a=id(r.ad_id);
    if(!c||!a){skipped++;continue;}
    rows.push({customer_id:c,ad_id:a,ad_name:String(r.ad_name??'').trim()||null,conversions:num(r.conversions)});
  }
  if(rows.length) await db()`
    INSERT INTO ad_conversions(customer_id,ad_id,ad_name,conversions,synced_at)
    SELECT x.customer_id,x.ad_id,x.ad_name,x.conversions,now() FROM jsonb_to_recordset(${db().json(rows)}::jsonb) AS x(customer_id text,ad_id text,ad_name text,conversions numeric)
    ON CONFLICT (customer_id,ad_id) DO UPDATE SET ad_name=EXCLUDED.ad_name,conversions=EXCLUDED.conversions,synced_at=now()
  `;
  return NextResponse.json({ok:true,saved:rows.length,skipped});
}
