import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { loadOnboardingRoster,takeNextOnboarder } from '@/lib/onboarding';

type SourceRow = {
  customerId?: unknown;
  subFirstDate?: unknown;
  totalAdsExecuted?: unknown;
  firstAdDate?: unknown;
  sourceRow?: unknown;
  totalImpressions?: unknown;
  totalSpend?: unknown;
  latestAdStatus?: unknown;
};

type NormalizedRow = {
  customerId: string;
  subFirstDate: string;
  totalAdsExecuted: number;
  firstAdDate: string | null;
  sourceRow: number | null;
  // Delivery fields are only trusted when the script sent them (older script versions do not).
  deliveryKnown: boolean;
  totalImpressions: number;
  totalSpend: number;
  latestAdStatus: string;
};

// An onboarder-marked Ads Live case is checked against Sub Raw once it is at least a day old:
//   REOPEN      – no ad has ever run (0 ads executed, 0 impressions, 0 spend)
//   FLAG_FAILED – the ad did run (impressions or spend) but its latest status is FAILED
//   OK          – anything else, including PAUSED and rows without delivery fields
type LiveCheck='OK'|'REOPEN'|'FLAG_FAILED';

function sheetNumber(value:unknown):number|null{
  const t=String(value??'').replace(/,/g,'').trim();
  if(!t) return 0;
  const n=Number(t);
  return Number.isFinite(n)&&n>=0?n:null;
}

function checkOnboarderLive(c:any,row:NormalizedRow,cutoffDate:string):LiveCheck{
  if(c.current_status!=='ads_live' || c.has_external) return 'OK';
  if(!c.ads_live_day || c.ads_live_day>cutoffDate) return 'OK';
  if(!row.deliveryKnown || row.totalAdsExecuted>0) return 'OK';
  if(row.totalImpressions===0 && row.totalSpend===0) return 'REOPEN';
  if(row.latestAdStatus==='FAILED' && !c.failed_flagged) return 'FLAG_FAILED';
  return 'OK';
}

function sameSecret(a:string,b:string){
  const aa=Buffer.from(a); const bb=Buffer.from(b);
  return aa.length===bb.length && timingSafeEqual(aa,bb);
}

function isIsoDate(value:string){
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeRow(raw:SourceRow):NormalizedRow|null{
  const customerId=String(raw.customerId??'').trim();
  const subFirstDate=String(raw.subFirstDate??'').trim();
  const firstAdDateRaw=String(raw.firstAdDate??'').trim();
  const ads=Number(raw.totalAdsExecuted);
  const sourceRowNumber=Number(raw.sourceRow);
  if(!/^\d+$/.test(customerId) || !isIsoDate(subFirstDate) || !Number.isFinite(ads) || ads<0) return null;
  if(firstAdDateRaw && !isIsoDate(firstAdDateRaw)) return null;
  const impressions=raw.totalImpressions===undefined?null:sheetNumber(raw.totalImpressions);
  const spend=raw.totalSpend===undefined?null:sheetNumber(raw.totalSpend);
  return {
    customerId,
    subFirstDate,
    totalAdsExecuted:ads,
    firstAdDate:firstAdDateRaw||null,
    sourceRow:Number.isInteger(sourceRowNumber)&&sourceRowNumber>0?sourceRowNumber:null,
    deliveryKnown:impressions!==null&&spend!==null,
    totalImpressions:impressions??0,
    totalSpend:spend??0,
    latestAdStatus:String(raw.latestAdStatus??'').trim().toUpperCase(),
  };
}

export async function POST(req:Request){
  const configured=process.env.SUB_RAW_SYNC_SECRET||'';
  const supplied=req.headers.get('x-sub-raw-sync-secret')||'';
  if(!configured || !supplied || !sameSecret(configured,supplied)){
    return NextResponse.json({error:'Unauthorized'},{status:401});
  }

  const body:any=await req.json().catch(()=>null);
  const cutoffDate=String(body?.cutoffDate||'').trim();
  const dryRun=Boolean(body?.dryRun);
  if(!isIsoDate(cutoffDate)) return NextResponse.json({error:'cutoffDate must be YYYY-MM-DD'},{status:400});

  const todayIst=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(new Date());
  const yesterdayIst=new Date(`${todayIst}T00:00:00+05:30`);
  yesterdayIst.setDate(yesterdayIst.getDate()-1);
  const maxCutoff=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(yesterdayIst);
  if(cutoffDate>maxCutoff){
    return NextResponse.json({error:`cutoffDate cannot be later than T-1 (${maxCutoff})`},{status:400});
  }

  const input:Array<SourceRow>=Array.isArray(body?.rows)?body.rows:[];
  if(input.length>100) return NextResponse.json({error:'Send at most 100 rows per request.'},{status:400});

  const invalidRows:number[]=[];
  const deduped=new Map<string,NormalizedRow>();
  for(let i=0;i<input.length;i++){
    const row=normalizeRow(input[i]);
    if(!row){ invalidRows.push(Number(input[i]?.sourceRow)||i+1); continue; }
    // Sub Raw is authoritative. Ignore subscriptions newer than the requested T-1 cutoff.
    if(row.subFirstDate>cutoffDate) continue;
    deduped.set(row.customerId,row);
  }

  const sql=db();
  // New open cases are shared equally among the onboarding roster (lib/onboarding.ts).
  const roster=await loadOnboardingRoster(sql);
  if(!roster.length){
    return NextResponse.json({error:'No active onboarders in the onboarding roster.'},{status:409});
  }

  const summary={
    inputRows:input.length,
    eligibleRows:deduped.size,
    invalidRows,
    createdOpen:0,
    createdOpenDhruv:0,
    createdOpenAshish:0,
    createdOpenPriyanshi:0,
    createdExternalLive:0,
    existingMarkedExternalLive:0,
    alreadyAdsLive:0,
    adsLiveReopened:0,
    adFailedAfterLiveFlagged:0,
    existingOpenNoChange:0,
    lostNoChange:0,
    lostMarkedExternalLive:0,
    otherNoChange:0,
    missingFirstAdDate:0,
    actions:[] as Array<{customerId:string;action:string}>,
  };

  for(const row of deduped.values()){
    const isLiveAsOfCutoff=row.totalAdsExecuted>0 && Boolean(row.firstAdDate && row.firstAdDate<=cutoffDate);
    if(row.totalAdsExecuted>0 && !row.firstAdDate){
      summary.missingFirstAdDate++;
      summary.actions.push({customerId:row.customerId,action:'SKIP_MISSING_FIRST_AD_DATE'});
      continue;
    }

    const countCreated=(name:string)=>{summary.createdOpen++;const k=`createdOpen${name}`;(summary as any)[k]=((summary as any)[k]||0)+1;};

    if(dryRun){
      const existing=await sql`
        SELECT c.id,c.current_status,c.ads_live_at,
          (c.ads_live_at AT TIME ZONE 'Asia/Kolkata')::date::text AS ads_live_day,
          EXISTS (SELECT 1 FROM onboarding_events e WHERE e.onboarding_case_id=c.id AND e.l0_code='SYSTEM_EXTERNAL_ADS_LIVE') AS has_external,
          EXISTS (SELECT 1 FROM onboarding_events e WHERE e.onboarding_case_id=c.id AND e.l0_code='SYSTEM_AD_FAILED_AFTER_LIVE') AS failed_flagged
        FROM onboarding_cases c
        WHERE c.customer_id=${row.customerId}
        ORDER BY c.created_at ASC
        LIMIT 1
      `;
      const c:any=existing[0]||null;
      if(!c){
        if(isLiveAsOfCutoff){
          summary.createdExternalLive++;
          summary.actions.push({customerId:row.customerId,action:'CREATE_EXTERNAL_ADS_LIVE'});
        }else{
          const target=takeNextOnboarder(roster);
          countCreated(target.name);
          summary.actions.push({customerId:row.customerId,action:`CREATE_OPEN_${target.name.toUpperCase()}`});
        }
      }else if(c.current_status==='ads_live' || c.ads_live_at){
        const check=checkOnboarderLive(c,row,cutoffDate);
        if(check==='REOPEN'){
          summary.adsLiveReopened++;
          summary.actions.push({customerId:row.customerId,action:'REOPEN_ADS_LIVE_NOT_VERIFIED'});
        }else if(check==='FLAG_FAILED'){
          summary.adFailedAfterLiveFlagged++;
          summary.actions.push({customerId:row.customerId,action:'FLAG_AD_FAILED_AFTER_LIVE'});
        }else{
          summary.alreadyAdsLive++;
        }
      }else if(c.current_status==='lost' && isLiveAsOfCutoff){
        summary.lostMarkedExternalLive++;
        summary.actions.push({customerId:row.customerId,action:'MARK_LOST_EXTERNAL_ADS_LIVE'});
      }else if(c.current_status==='lost'){
        summary.lostNoChange++;
      }else if(c.current_status==='open' && isLiveAsOfCutoff){
        summary.existingMarkedExternalLive++;
        summary.actions.push({customerId:row.customerId,action:'MARK_EXTERNAL_ADS_LIVE'});
      }else if(c.current_status==='open'){
        summary.existingOpenNoChange++;
      }else{
        summary.otherNoChange++;
      }
      continue;
    }

    await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${row.customerId}))`;
      const existing=await tx`
        SELECT c.id,c.current_status,c.ads_live_at,c.assigned_to,
          (c.ads_live_at AT TIME ZONE 'Asia/Kolkata')::date::text AS ads_live_day,
          EXISTS (SELECT 1 FROM onboarding_events e WHERE e.onboarding_case_id=c.id AND e.l0_code='SYSTEM_EXTERNAL_ADS_LIVE') AS has_external,
          EXISTS (SELECT 1 FROM onboarding_events e WHERE e.onboarding_case_id=c.id AND e.l0_code='SYSTEM_AD_FAILED_AFTER_LIVE') AS failed_flagged
        FROM onboarding_cases c
        WHERE c.customer_id=${row.customerId}
        ORDER BY c.created_at ASC
        LIMIT 1
        FOR UPDATE OF c
      `;
      const c:any=existing[0]||null;

      if(!c){
        await tx`INSERT INTO customers(customer_id) VALUES(${row.customerId}) ON CONFLICT (customer_id) DO NOTHING`;

        if(isLiveAsOfCutoff){
          const created=await tx`
            INSERT INTO onboarding_cases(
              customer_id,source_type,sale_date,current_l0,current_status,last_activity_at,ads_live_at,closed_at
            )
            VALUES(
              ${row.customerId},'historical_import',${row.subFirstDate}::date,'Externally Ads Live','ads_live',now(),
              (${row.firstAdDate}::date::timestamp AT TIME ZONE 'Asia/Kolkata'),
              (${row.firstAdDate}::date::timestamp AT TIME ZONE 'Asia/Kolkata')
            )
            RETURNING id
          `;
          const caseId=created[0].id;
          await tx`
            INSERT INTO onboarding_events(
              onboarding_case_id,customer_id,attempt_number,source_type,source_sheet,source_row,
              l0_code,l0_label_snapshot,remark
            )
            VALUES(
              ${caseId}::uuid,${row.customerId},1,'system','Sub Raw',${row.sourceRow},
              'SYSTEM_EXTERNAL_ADS_LIVE','Externally Ads Live',
              'Ads execution detected from Sub Raw T-1 sync; closed externally.'
            )
          `;
          summary.createdExternalLive++;
          summary.actions.push({customerId:row.customerId,action:'CREATE_EXTERNAL_ADS_LIVE'});
        }else{
          const target=takeNextOnboarder(roster);
          const created=await tx`
            INSERT INTO onboarding_cases(
              customer_id,source_type,sale_date,assigned_to,assigned_at,last_activity_at
            )
            VALUES(
              ${row.customerId},'historical_import',${row.subFirstDate}::date,${target.id}::uuid,now(),NULL
            )
            RETURNING id
          `;
          const caseId=created[0].id;
          await tx`
            INSERT INTO onboarding_events(
              onboarding_case_id,customer_id,attempt_number,source_type,source_sheet,source_row,
              l0_code,l0_label_snapshot,remark
            )
            VALUES(
              ${caseId}::uuid,${row.customerId},1,'assignment','Sub Raw',${row.sourceRow},
              'SYSTEM_ASSIGNED','Assigned',${`Assigned to ${target.name} by Sub Raw T-1 sync`}
            )
          `;
          countCreated(target.name);
          summary.actions.push({customerId:row.customerId,action:`CREATE_OPEN_${target.name.toUpperCase()}`});
        }
        return;
      }

      if(c.current_status==='ads_live' || c.ads_live_at){
        const check=checkOnboarderLive(c,row,cutoffDate);
        if(check==='OK'){
          summary.alreadyAdsLive++;
          return;
        }
        const checkAttemptRows=await tx`
          SELECT COALESCE(MAX(attempt_number),0)+1 AS n
          FROM onboarding_events
          WHERE onboarding_case_id=${c.id}::uuid
        `;
        const checkAttempt=Number(checkAttemptRows[0]?.n||1);
        if(check==='REOPEN'){
          // Marked Ads Live by an onboarder, but Sub Raw shows no ad has ever run. Keep the
          // onboarder's Ads Live entry in the history and put the case back in the open queue;
          // clearing ads_live_at takes it out of the Ads Live counts, rate and incentives.
          await tx`
            INSERT INTO onboarding_events(
              onboarding_case_id,customer_id,attempt_number,source_type,source_sheet,source_row,
              l0_code,l0_label_snapshot,remark
            )
            VALUES(
              ${c.id}::uuid,${row.customerId},${checkAttempt},'system','Sub Raw',${row.sourceRow},
              'SYSTEM_ADS_LIVE_NOT_VERIFIED','Ads Live Not Verified',
              ${`Marked Ads Live on ${c.ads_live_day}, but Sub Raw shows no ad has run (0 ads executed, 0 impressions, 0 spend) as of ${cutoffDate}. Case reopened by the T-1 sync.`}
            )
          `;
          await tx`
            UPDATE onboarding_cases
            SET current_l0='Ads Live Not Verified',current_l1=NULL,current_l2=NULL,current_status='open',
                ads_live_at=NULL,closed_at=NULL,next_callback_at=now(),last_activity_at=now(),updated_at=now()
            WHERE id=${c.id}::uuid
          `;
          summary.adsLiveReopened++;
          summary.actions.push({customerId:row.customerId,action:'REOPEN_ADS_LIVE_NOT_VERIFIED'});
          return;
        }
        // The ad did run and then failed: the case stays Ads Live, tagged once so it can be followed up.
        await tx`
          INSERT INTO onboarding_events(
            onboarding_case_id,customer_id,attempt_number,source_type,source_sheet,source_row,
            l0_code,l0_label_snapshot,remark
          )
          VALUES(
            ${c.id}::uuid,${row.customerId},${checkAttempt},'system','Sub Raw',${row.sourceRow},
            'SYSTEM_AD_FAILED_AFTER_LIVE','Ad Failed After Live',
            ${`Ad ran (${row.totalImpressions} impressions, Rs ${row.totalSpend} spent) and its latest status is FAILED as of ${cutoffDate}. Ads Live retained.`}
          )
        `;
        await tx`
          UPDATE onboarding_cases
          SET current_l1='Ad Failed After Live',updated_at=now()
          WHERE id=${c.id}::uuid
        `;
        summary.adFailedAfterLiveFlagged++;
        summary.actions.push({customerId:row.customerId,action:'FLAG_AD_FAILED_AFTER_LIVE'});
        return;
      }
      if(c.current_status==='lost' && isLiveAsOfCutoff){
        // The merchant went live on their own after the agent closed the case as lost.
        // Keep the agent's last disposition and lost status; only record the external Ads Live
        // so it counts in Ads Made Live Externally and the Ads Live Rate.
        const lostAttemptRows=await tx`
          SELECT COALESCE(MAX(attempt_number),0)+1 AS n
          FROM onboarding_events
          WHERE onboarding_case_id=${c.id}::uuid
        `;
        await tx`
          INSERT INTO onboarding_events(
            onboarding_case_id,customer_id,attempt_number,source_type,source_sheet,source_row,
            l0_code,l0_label_snapshot,remark
          )
          VALUES(
            ${c.id}::uuid,${row.customerId},${Number(lostAttemptRows[0]?.n||1)},'system','Sub Raw',${row.sourceRow},
            'SYSTEM_EXTERNAL_ADS_LIVE','Externally Ads Live',
            'Ads execution detected from Sub Raw T-1 sync after the case was closed as lost; lost disposition retained.'
          )
        `;
        await tx`
          UPDATE onboarding_cases
          SET ads_live_at=(${row.firstAdDate}::date::timestamp AT TIME ZONE 'Asia/Kolkata'),updated_at=now()
          WHERE id=${c.id}::uuid
        `;
        summary.lostMarkedExternalLive++;
        summary.actions.push({customerId:row.customerId,action:'MARK_LOST_EXTERNAL_ADS_LIVE'});
        return;
      }
      if(c.current_status==='lost'){
        summary.lostNoChange++;
        return;
      }
      if(c.current_status==='open' && !isLiveAsOfCutoff){
        summary.existingOpenNoChange++;
        return;
      }
      if(c.current_status!=='open'){
        summary.otherNoChange++;
        return;
      }

      const attemptRows=await tx`
        SELECT COALESCE(MAX(attempt_number),0)+1 AS n
        FROM onboarding_events
        WHERE onboarding_case_id=${c.id}::uuid
      `;
      const attempt=Number(attemptRows[0]?.n||1);
      await tx`
        INSERT INTO onboarding_events(
          onboarding_case_id,customer_id,attempt_number,source_type,source_sheet,source_row,
          l0_code,l0_label_snapshot,remark
        )
        VALUES(
          ${c.id}::uuid,${row.customerId},${attempt},'system','Sub Raw',${row.sourceRow},
          'SYSTEM_EXTERNAL_ADS_LIVE','Externally Ads Live',
          'Ads execution detected from Sub Raw T-1 sync; closed externally.'
        )
      `;
      await tx`
        UPDATE onboarding_cases
        SET current_l0='Externally Ads Live',current_l1=NULL,current_l2=NULL,current_status='ads_live',
            next_callback_at=NULL,last_activity_at=now(),
            ads_live_at=(${row.firstAdDate}::date::timestamp AT TIME ZONE 'Asia/Kolkata'),
            closed_at=(${row.firstAdDate}::date::timestamp AT TIME ZONE 'Asia/Kolkata'),
            updated_at=now()
        WHERE id=${c.id}::uuid
      `;
      summary.existingMarkedExternalLive++;
      summary.actions.push({customerId:row.customerId,action:'MARK_EXTERNAL_ADS_LIVE'});
    });
  }

  return NextResponse.json({ok:true,dryRun,cutoffDate,...summary});
}
