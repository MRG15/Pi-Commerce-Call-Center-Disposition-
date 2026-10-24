// Picom_dnd on OCL CleverTap. Merchants marked Not Interested / Refund Requested — an onboarding case
// closed as lost, or ever by a CSM — get profile property Picom_dnd = true (identity = Cust ID) through
// CleverTap's Upload Profile API, so CleverTap campaigns can exclude them. Runs every 5 minutes (lead
// sync): enrols new merchants (when app_settings.picom_dnd_enroll is on), then pushes pending and failed
// rows in batches. A merchant who leaves the bucket (e.g. a lost case reopened, and never marked NI /
// Refund by a CSM) is pushed Picom_dnd = false; marked again later, true again. picom_dnd_pushes.want
// is the value to hold in CleverTap; status is whether that value has been pushed.
// Credentials: CT_OCL_ACCOUNT_ID, CT_OCL_PASSCODE, CT_OCL_REGION (e.g. in1).
const BATCH=500;
const MAX_ATTEMPTS=10;

export async function syncPicomDnd(sql:any){
  const account=process.env.CT_OCL_ACCOUNT_ID||'';
  const passcode=process.env.CT_OCL_PASSCODE||'';
  const region=process.env.CT_OCL_REGION||'in1';
  if(!account||!passcode) return {skipped:'CleverTap credentials not set'};
  const on=(await sql`SELECT value FROM app_settings WHERE key='picom_dnd_enroll'`)[0]?.value===true;
  let enrolled=0,cleared=0;
  if(on){
    const rows=await sql`
      WITH b AS (
        SELECT customer_id,min(reason) AS reason FROM (
          SELECT customer_id,'Onboarding: '||COALESCE(current_l0,'lost') AS reason FROM onboarding_cases WHERE current_status='lost'
          UNION ALL
          SELECT customer_id,'CSM: '||COALESCE(l0_label_snapshot,l0_code) FROM onboarding_events
          WHERE source_type='customer_success_followup' AND l0_code IN ('OB_NOT_INTERESTED','OB_REFUND_REQUESTED')
        ) x WHERE customer_id ~ '^[0-9]+$' GROUP BY customer_id
      ),
      cleared AS (
        UPDATE picom_dnd_pushes p SET want=FALSE,status='pending',attempts=0,last_error=NULL,reason='Left the bucket'
        WHERE p.want AND NOT EXISTS (SELECT 1 FROM b WHERE b.customer_id=p.customer_id) RETURNING 1
      )
      INSERT INTO picom_dnd_pushes(customer_id,reason)
      SELECT customer_id,reason FROM b
      ON CONFLICT (customer_id) DO UPDATE SET want=TRUE,status='pending',attempts=0,last_error=NULL,reason=EXCLUDED.reason
        WHERE NOT picom_dnd_pushes.want
      RETURNING customer_id
    `;
    enrolled=rows.length;
    cleared=(await sql`SELECT count(*)::int AS n FROM picom_dnd_pushes WHERE NOT want AND status='pending'`)[0].n;
  }
  const pending=await sql`
    SELECT customer_id,want FROM picom_dnd_pushes WHERE status IN ('pending','failed') AND attempts<${MAX_ATTEMPTS}
    ORDER BY created_at LIMIT ${BATCH*4}
  `;
  let sent=0,failed=0;
  for(let i=0;i<pending.length;i+=BATCH){
    const batch=pending.slice(i,i+BATCH);
    const ids:string[]=batch.map((r:any)=>String(r.customer_id));
    let bad=new Map<string,string>(); let batchError='';
    try{
      const res=await fetch(`https://${region}.api.clevertap.com/1/upload`,{
        method:'POST',
        headers:{'X-CleverTap-Account-Id':account,'X-CleverTap-Passcode':passcode,'Content-Type':'application/json; charset=utf-8'},
        body:JSON.stringify({d:batch.map((r:any)=>({identity:String(r.customer_id),type:'profile',profileData:{Picom_dnd:Boolean(r.want)}}))}),
        signal:AbortSignal.timeout(20000),
      });
      const j:any=await res.json().catch(()=>null);
      if(!res.ok||j?.status!=='success') batchError=`HTTP ${res.status}: ${JSON.stringify(j).slice(0,300)}`;
      for(const u of j?.unprocessed||[]) bad.set(String(u?.record?.identity??''),`${u?.code??''} ${u?.error??''}`.trim());
    }catch(e:any){ batchError=String(e?.message||e).slice(0,300); }
    for(const id of ids){
      const err=batchError||bad.get(id)||'';
      if(err){ failed++; await sql`UPDATE picom_dnd_pushes SET status='failed',attempts=attempts+1,last_error=${err} WHERE customer_id=${id}`; }
      else{ sent++; await sql`UPDATE picom_dnd_pushes SET status='sent',attempts=attempts+1,last_error=NULL,sent_at=now() WHERE customer_id=${id}`; }
    }
  }
  return {enrolled,cleared,sent,failed};
}
