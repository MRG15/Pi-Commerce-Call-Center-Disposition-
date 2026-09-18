import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

type SourceRow = {
  customerId?: unknown;
  subFirstDate?: unknown;
  totalAdsExecuted?: unknown;
  firstAdDate?: unknown;
  sourceRow?: unknown;
};

type NormalizedRow = {
  customerId: string;
  subFirstDate: string;
  totalAdsExecuted: number;
  firstAdDate: string | null;
  sourceRow: number | null;
};

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
  return {
    customerId,
    subFirstDate,
    totalAdsExecuted:ads,
    firstAdDate:firstAdDateRaw||null,
    sourceRow:Number.isInteger(sourceRowNumber)&&sourceRowNumber>0?sourceRowNumber:null,
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
  const people=await sql`
    SELECT a.id,a.name
    FROM agents a
    JOIN workspace_access w ON w.agent_id=a.id AND w.workspace='onboarding'
    WHERE a.active=TRUE AND a.name IN ('Dhruv','Ashish')
  `;
  const byName:any={}; for(const p of people) byName[p.name]=p;
  if(!byName.Dhruv || !byName.Ashish){
    return NextResponse.json({error:'Dhruv and Ashish must both be active with Onboarding access.'},{status:409});
  }

  const summary={
    inputRows:input.length,
    eligibleRows:deduped.size,
    invalidRows,
    createdOpenDhruv:0,
    createdOpenAshish:0,
    createdExternalLive:0,
    existingMarkedExternalLive:0,
    alreadyAdsLive:0,
    existingOpenNoChange:0,
    lostNoChange:0,
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

    const ageRows=await sql`SELECT (${cutoffDate}::date - ${row.subFirstDate}::date)::int AS age_days`;
    const ageDays=Number(ageRows[0]?.age_days||0);
    const target=isLiveAsOfCutoff?null:(ageDays>=3?byName.Dhruv:byName.Ashish);

    if(dryRun){
      const existing=await sql`
        SELECT id,current_status,ads_live_at
        FROM onboarding_cases
        WHERE customer_id=${row.customerId}
        ORDER BY created_at ASC
        LIMIT 1
      `;
      const c:any=existing[0]||null;
      if(!c){
        if(isLiveAsOfCutoff){
          summary.createdExternalLive++;
          summary.actions.push({customerId:row.customerId,action:'CREATE_EXTERNAL_ADS_LIVE'});
        }else if(target?.name==='Dhruv'){
          summary.createdOpenDhruv++;
          summary.actions.push({customerId:row.customerId,action:'CREATE_OPEN_DHRUV'});
        }else{
          summary.createdOpenAshish++;
          summary.actions.push({customerId:row.customerId,action:'CREATE_OPEN_ASHISH'});
        }
      }else if(c.current_status==='ads_live' || c.ads_live_at){
        summary.alreadyAdsLive++;
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
        SELECT id,current_status,ads_live_at,assigned_to
        FROM onboarding_cases
        WHERE customer_id=${row.customerId}
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE
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
          if(target.name==='Dhruv') summary.createdOpenDhruv++;
          else summary.createdOpenAshish++;
          summary.actions.push({customerId:row.customerId,action:target.name==='Dhruv'?'CREATE_OPEN_DHRUV':'CREATE_OPEN_ASHISH'});
        }
        return;
      }

      if(c.current_status==='ads_live' || c.ads_live_at){
        summary.alreadyAdsLive++;
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
