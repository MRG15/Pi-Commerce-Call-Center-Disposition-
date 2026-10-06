import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { allocateUnassigned } from '@/lib/csm';

// Daily push of the SMB Daily Tracker's Sub Raw and AdsRun Raw tabs (scripts/csm-sync.gs).
// Protocol: start → subs / ads batches → finish. Rows are written under a new run and only
// become visible when finish succeeds, so a failed or partial push never replaces good data.
// Uses the same secret as the Sub Raw onboarding sync.

function sameSecret(a:string,b:string){
  const aa=Buffer.from(a); const bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}
const iso=(v:unknown)=>{const t=String(v??'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(t)?t:null;};
const num=(v:unknown)=>{const t=String(v??'').replace(/,/g,'').trim();if(!t)return null;const n=Number(t);return Number.isFinite(n)?n:null;};
const txt=(v:unknown)=>{const t=String(v??'').trim();return t||null;};
const custId=(v:unknown)=>{const t=String(v??'').trim().replace(/\.0$/,'');return /^\d+$/.test(t)?t:null;};

export async function POST(req:Request){
  const configured=process.env.SUB_RAW_SYNC_SECRET||'';
  const supplied=req.headers.get('x-sub-raw-sync-secret')||'';
  if(!configured||!supplied||!sameSecret(configured,supplied)) return NextResponse.json({error:'Unauthorized'},{status:401});
  const body:any=await req.json().catch(()=>null);
  const action=String(body?.action||'');
  const sql=db();

  if(action==='start'){
    await sql`UPDATE csm_sync_runs SET status='failed',finished_at=now(),note='abandoned' WHERE status='running' AND started_at<now()-interval '1 hour'`;
    const rows=await sql`INSERT INTO csm_sync_runs(status) VALUES('running') RETURNING id`;
    return NextResponse.json({ok:true,runId:Number(rows[0].id)});
  }

  const runId=Number(body?.runId);
  if(!Number.isInteger(runId)) return NextResponse.json({error:'runId is required'},{status:400});
  const run=await sql`SELECT status FROM csm_sync_runs WHERE id=${runId}`;
  if(run[0]?.status!=='running') return NextResponse.json({error:'This sync run is not open.'},{status:409});
  const input:any[]=Array.isArray(body?.rows)?body.rows:[];
  if(input.length>1000) return NextResponse.json({error:'Send at most 1000 rows per request.'},{status:400});

  if(action==='subs'){
    const rows:any[]=[]; const invalid:number[]=[];
    for(const r of input){
      const id=custId(r.customerId); const status=String(r.status||'').trim().toUpperCase();
      if(!id||!['ACTIVE','CANCELLED','EXPIRED'].includes(status)){invalid.push(Number(r.sourceRow)||0);continue;}
      rows.push({customer_id:id,status,merchant_name:txt(r.merchantName),phone_number:txt(r.phone),category:txt(r.category),sub_category:txt(r.subCategory),mcc:txt(r.mcc),sub_first_date:iso(r.subFirstDate)});
    }
    if(rows.length) await sql`
      INSERT INTO merchant_subscriptions(sync_run_id,customer_id,status,merchant_name,phone_number,category,sub_category,mcc,sub_first_date)
      SELECT ${runId},x.customer_id,x.status,x.merchant_name,x.phone_number,x.category,x.sub_category,x.mcc,x.sub_first_date::date
      FROM jsonb_to_recordset(${sql.json(rows)}::jsonb) AS x(customer_id text,status text,merchant_name text,phone_number text,category text,sub_category text,mcc text,sub_first_date text)
      ON CONFLICT (sync_run_id,customer_id) DO UPDATE SET status=EXCLUDED.status,merchant_name=EXCLUDED.merchant_name,phone_number=EXCLUDED.phone_number,
        category=EXCLUDED.category,sub_category=EXCLUDED.sub_category,mcc=EXCLUDED.mcc,sub_first_date=EXCLUDED.sub_first_date
    `;
    return NextResponse.json({ok:true,accepted:rows.length,invalidRows:invalid});
  }

  if(action==='ads'){
    const rows:any[]=[]; const invalid:number[]=[];
    for(const r of input){
      const id=custId(r.customerId); const status=String(r.adStatus||'').trim().toUpperCase();
      if(!id||!['ACTIVE','COMPLETED'].includes(status)){invalid.push(Number(r.sourceRow)||0);continue;}
      rows.push({customer_id:id,client_id:txt(r.clientId),mid:txt(r.mid),merchant_name:txt(r.merchantName),phone_number:txt(r.phone),category:txt(r.category),sub_category:txt(r.subCategory),
        onboarded_date:iso(r.onboardedDate),creative_name:txt(r.creativeName),description:txt(r.description),ad_status:status,budget:num(r.budget),start_date:iso(r.startDate),end_date:iso(r.endDate),
        impressions:num(r.impressions),clicks:num(r.clicks),ctr:num(r.ctr),reach:num(r.reach),spend:num(r.spend),source_row:Number(r.sourceRow)||null});
    }
    if(rows.length) await sql`
      INSERT INTO merchant_ads(sync_run_id,customer_id,client_id,mid,merchant_name,phone_number,category,sub_category,onboarded_date,creative_name,description,ad_status,budget,start_date,end_date,impressions,clicks,ctr,reach,spend,source_row)
      SELECT ${runId},x.customer_id,x.client_id,x.mid,x.merchant_name,x.phone_number,x.category,x.sub_category,x.onboarded_date::date,x.creative_name,x.description,x.ad_status,
        x.budget,x.start_date::date,x.end_date::date,x.impressions,x.clicks,x.ctr,x.reach,x.spend,x.source_row
      FROM jsonb_to_recordset(${sql.json(rows)}::jsonb) AS x(customer_id text,client_id text,mid text,merchant_name text,phone_number text,category text,sub_category text,onboarded_date text,
        creative_name text,description text,ad_status text,budget numeric,start_date text,end_date text,impressions numeric,clicks numeric,ctr numeric,reach numeric,spend numeric,source_row int)
    `;
    return NextResponse.json({ok:true,accepted:rows.length,invalidRows:invalid});
  }

  if(action==='finish'){
    const counts=await sql`
      SELECT (SELECT count(*)::int FROM merchant_subscriptions WHERE sync_run_id=${runId}) AS subs,
             (SELECT count(*)::int FROM merchant_ads WHERE sync_run_id=${runId}) AS ads
    `;
    const subs=counts[0].subs, ads=counts[0].ads;
    const expectedSubs=Number(body?.expectedSubs), expectedAds=Number(body?.expectedAds);
    const fail=async(note:string)=>{
      await sql`UPDATE csm_sync_runs SET status='failed',finished_at=now(),subs_rows=${subs},ads_rows=${ads},note=${note} WHERE id=${runId}`;
      return NextResponse.json({error:note,subs,ads},{status:409});
    };
    if(subs!==expectedSubs||ads!==expectedAds) return fail(`Row counts do not match: received ${subs} subscriptions / ${ads} ads, script sent ${expectedSubs} / ${expectedAds}.`);
    const prev=await sql`SELECT subs_rows,ads_rows FROM csm_sync_runs WHERE status='complete' ORDER BY id DESC LIMIT 1`;
    if(prev[0]&&(subs<prev[0].subs_rows*0.5||ads<prev[0].ads_rows*0.5)) return fail(`Refusing: far fewer rows than the last sync (${prev[0].subs_rows} subscriptions / ${prev[0].ads_rows} ads).`);
    await sql`UPDATE csm_sync_runs SET status='complete',finished_at=now(),subs_rows=${subs},ads_rows=${ads} WHERE id=${runId}`;
    // Keep the two most recent complete runs; older snapshots are removed.
    await sql`
      DELETE FROM csm_sync_runs WHERE id NOT IN (SELECT id FROM csm_sync_runs WHERE status='complete' ORDER BY id DESC LIMIT 2)
        AND (status<>'running')
    `;
    // Fresh planner statistics: the snapshot tables are rebuilt daily.
    try{await sql`ANALYZE merchant_subscriptions`;await sql`ANALYZE merchant_ads`;}catch{}
    const allocation=await allocateUnassigned(sql,runId);
    return NextResponse.json({ok:true,runId,subscriptions:subs,ads,newlyAssigned:allocation.assigned});
  }

  return NextResponse.json({error:'Unknown action'},{status:400});
}
