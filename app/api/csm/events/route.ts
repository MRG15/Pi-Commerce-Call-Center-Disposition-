import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { toIstCallback } from '@/lib/onboarding';
import { PLANS,isPlanCode,plansRequiredOn,todayIst } from '@/lib/plans';
import { CSM_BUCKETS,CSM_L0_CODES,csmRole } from '@/lib/csm';

// Logs a CSM call on a live merchant. Saved as a customer_success_followup onboarding event,
// exactly like post-live follow-ups before, so CSM analytics, incentives (top-ups, renewals)
// and Seller Payment Done (renewals) keep working. The onboarding case itself is not changed.
export async function POST(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const role=csmRole(user);
  if(!role) return NextResponse.json({error:'CSM access required'},{status:403});
  const body=await req.json().catch(()=>({}));
  const customerId=String(body.customerId||'').trim();
  const l0Code=String(body.l0Code||''); const l1Code=body.l1Code?String(body.l1Code):null; const l2Code=body.l2Code?String(body.l2Code):null;
  const remark=String(body.remark||'').trim()||null;
  const rawTopUp=body.topUpAmount; const topUp=rawTopUp===null||rawTopUp===undefined||String(rawTopUp).trim()===''?null:Number(rawTopUp);
  const planRaw=body.planCode?String(body.planCode):null;
  const bucket=CSM_BUCKETS.includes(String(body.bucket))?String(body.bucket):null;
  if(!customerId||!CSM_L0_CODES.includes(l0Code)) return NextResponse.json({error:'Customer and outcome are required.'},{status:400});
  if(planRaw&&!isPlanCode(planRaw)) return NextResponse.json({error:'Invalid plan.'},{status:400});
  const sql=db();
  try{
    await sql.begin(async(tx:any)=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${customerId}))`;
      const cases=await tx`SELECT id,customer_id,current_status,assigned_to FROM onboarding_cases WHERE customer_id=${customerId} ORDER BY created_at LIMIT 1 FOR UPDATE`;
      const c=cases[0];
      if(!c) throw new Error('NO_CASE');
      // Onboarding-lost merchants are open to every CSM (low priority); others only to their CSM.
      if(role==='agent'&&c.current_status!=='lost'){
        const own=await tx`SELECT 1 FROM csm_assignments WHERE customer_id=${customerId} AND agent_id=${user.id}::uuid`;
        if(!own[0]) throw new Error('NOT_ASSIGNED');
      }
      const codes=[l0Code,l1Code,l2Code].filter(Boolean) as string[];
      const nodes=await tx`SELECT id,code,label,level,parent_id FROM onboarding_disposition_nodes WHERE code=ANY(${codes}) AND active=TRUE`;
      const by:any={}; for(const n of nodes) by[n.code]=n;
      const l0=by[l0Code],l1=l1Code?by[l1Code]:null,l2=l2Code?by[l2Code]:null;
      if(!l0||l0.level!==0) throw new Error('BAD_TAXONOMY');
      if(l1&&(l1.level!==1||l1.parent_id!==l0.id)) throw new Error('BAD_TAXONOMY');
      if(l2&&(!l1||l2.level!==2||l2.parent_id!==l1.id)) throw new Error('BAD_TAXONOMY');
      if(l0Code==='OB_IN_PROCESS'&&!l1) throw new Error('L1_REQUIRED');
      if((l0Code==='OB_NOT_INTERESTED'||l0Code==='OB_REFUND_REQUESTED')&&!l1) throw new Error('REASON_REQUIRED');
      if(l1Code==='OB_TECHNICAL'&&!l2) throw new Error('L2_REQUIRED');
      if((l1Code==='OB_OTHER_PROCESS'||l1Code==='OB_NI_OTHER'||l1Code==='OB_REFUND_OTHER'||l2Code==='OB_TECH_OTHER')&&!remark) throw new Error('REMARK_REQUIRED');
      if(l0Code==='OB_ADDITIONAL_TOPUP'&&!(topUp!==null&&Number.isFinite(topUp)&&topUp>0)) throw new Error('TOPUP_REQUIRED');
      const planCode=l0Code==='OB_SUBS_RENEWED'&&planRaw&&isPlanCode(planRaw)?planRaw:null;
      if(l0Code==='OB_SUBS_RENEWED'&&plansRequiredOn(todayIst())&&!planCode) throw new Error('PLAN_REQUIRED');
      const callback=toIstCallback(body.callbackDate?String(body.callbackDate):null,body.callbackTime?String(body.callbackTime):null);
      if(l1Code==='OB_CALLBACK'&&!callback) throw new Error('CALLBACK_REQUIRED');
      if(callback&&callback.getTime()<=Date.now()) throw new Error('CALLBACK_PAST');
      const att=await tx`SELECT COALESCE(MAX(attempt_number),0)+1 AS n FROM onboarding_events WHERE onboarding_case_id=${c.id}::uuid`;
      await tx`
        INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_id,agent_name_raw,source_type,l0_code,l1_code,l2_code,
          l0_label_snapshot,l1_label_snapshot,l2_label_snapshot,remark,callback_at,top_up_amount_inr,plan_code,plan_amount_inr,csm_bucket)
        VALUES(${c.id}::uuid,${customerId},${Number(att[0].n)},${user.id}::uuid,${user.name},'customer_success_followup',${l0Code},${l1?.code||null},${l2?.code||null},
          ${l0.label},${l1?.label||null},${l2?.label||null},${remark},${callback},${l0Code==='OB_ADDITIONAL_TOPUP'?topUp:null},${planCode},${planCode?PLANS[planCode].price:null},${bucket})
      `;
      if(l1Code==='OB_TECHNICAL'){
        const open=await tx`SELECT id FROM technical_cases WHERE onboarding_case_id=${c.id}::uuid AND status='open' LIMIT 1`;
        if(open[0]) await tx`UPDATE technical_cases SET issue_code=${l2Code},issue_label=${l2.label},latest_remark=${remark},updated_at=now() WHERE id=${open[0].id}::uuid`;
        else await tx`
          INSERT INTO technical_cases(onboarding_case_id,customer_id,issue_code,issue_label,opened_by,assigned_to,latest_remark,source_type)
          VALUES(${c.id}::uuid,${customerId},${l2Code},${l2.label},${user.id}::uuid,${c.assigned_to},${remark},'customer_success_followup')
        `;
      }
    });
    return NextResponse.json({ok:true});
  }catch(e:any){
    const map:any={NO_CASE:['This merchant has no onboarding case yet, so a call cannot be logged.',409],
      NOT_ASSIGNED:['This merchant is assigned to another CSM.',403],BAD_TAXONOMY:['Invalid outcome.',400],L1_REQUIRED:['Select a reason.',400],REASON_REQUIRED:['Select a reason for this outcome.',400],
      L2_REQUIRED:['Select the technical issue.',400],REMARK_REQUIRED:['A remark is required for this option.',400],TOPUP_REQUIRED:['Enter the top-up amount.',400],
      PLAN_REQUIRED:['Select the plan renewed (Silver, Gold or Platinum).',400],CALLBACK_REQUIRED:['Callback date and time are required.',400],CALLBACK_PAST:['Callback must be in the future.',400]};
    const hit=map[String(e?.message||'')]; if(hit) return NextResponse.json({error:hit[0]},{status:hit[1]});
    console.error('csm event error',e);
    return NextResponse.json({error:'Could not save the call.'},{status:500});
  }
}
