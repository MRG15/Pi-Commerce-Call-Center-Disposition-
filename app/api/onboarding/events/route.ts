import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,isWorkspaceAdmin } from '@/lib/workspace-access';
import { toIstCallback } from '@/lib/onboarding';

export async function POST(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'onboarding')) return NextResponse.json({error:'Onboarding access required'},{status:403});
  const body=await req.json();
  const caseId=String(body.caseId||'');
  const l0Code=String(body.l0Code||'');
  const l1Code=body.l1Code?String(body.l1Code):null;
  const l2Code=body.l2Code?String(body.l2Code):null;
  const remark=String(body.remark||'').trim()||null;
  const resolveTechId=body.resolveTechnicalCaseId?String(body.resolveTechnicalCaseId):null;
  const rawTopUp=body.topUpAmount;
  const topUpAmount=rawTopUp===null||rawTopUp===undefined||String(rawTopUp).trim()===''?null:Number(rawTopUp);
  if(topUpAmount!==null&&(!Number.isFinite(topUpAmount)||topUpAmount<0)) return NextResponse.json({error:'Top-up amount must be zero or more.'},{status:400});
  if(!caseId) return NextResponse.json({error:'Case is required.'},{status:400});
  if(!l0Code&&!resolveTechId) return NextResponse.json({error:'Outcome is required.'},{status:400});
  const sql=db();
  try{
    await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${caseId}))`;
      const caseRows=await tx`SELECT * FROM onboarding_cases WHERE id=${caseId}::uuid FOR UPDATE`;
      const c:any=caseRows[0];
      if(!c) throw new Error('CASE_NOT_FOUND');
      if(!isWorkspaceAdmin(user,'onboarding') && c.assigned_to!==user.id) throw new Error('NOT_ASSIGNED');

      const attemptRows=await tx`SELECT COALESCE(MAX(attempt_number),0)+1 AS n FROM onboarding_events WHERE onboarding_case_id=${caseId}::uuid`;
      const attempt=Number(attemptRows[0]?.n||1);

      // Resolving a technical issue is an event, but must not overwrite the merchant's main onboarding disposition.
      if(resolveTechId&&!l0Code){
        const updated=await tx`
          UPDATE technical_cases SET status='resolved',resolved_by=${user.id}::uuid,resolved_at=now(),latest_remark=COALESCE(${remark},latest_remark),updated_at=now()
          WHERE id=${resolveTechId}::uuid AND onboarding_case_id=${caseId}::uuid AND status='open'
          RETURNING id,issue_label
        `;
        if(!updated[0]) throw new Error('TECH_NOT_FOUND');
        await tx`
          INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_id,agent_name_raw,source_type,l0_code,l0_label_snapshot,remark)
          VALUES(${caseId}::uuid,${c.customer_id},${attempt},${user.id}::uuid,${user.name},'system','TECH_RESOLVED','Technical issue resolved',${remark||updated[0].issue_label})
        `;
        await tx`UPDATE onboarding_cases SET last_activity_at=now(),updated_at=now() WHERE id=${caseId}::uuid`;
        return;
      }

      const codes=[l0Code,l1Code,l2Code].filter(Boolean) as string[];
      const nodes=await tx`SELECT id,code,label,level,parent_id FROM onboarding_disposition_nodes WHERE code=ANY(${codes}) AND active=TRUE`;
      const byCode:any={}; for(const n of nodes) byCode[n.code]=n;
      const l0=byCode[l0Code]; const l1=l1Code?byCode[l1Code]:null; const l2=l2Code?byCode[l2Code]:null;
      if(!l0||l0.level!==0) throw new Error('BAD_TAXONOMY');
      if(l1 && (l1.level!==1 || l1.parent_id!==l0.id)) throw new Error('BAD_TAXONOMY');
      if(l2 && (!l1 || l2.level!==2 || l2.parent_id!==l1.id)) throw new Error('BAD_TAXONOMY');

      const additionalTopUp=l0Code==='OB_ADDITIONAL_TOPUP';
      if(additionalTopUp){
        if(c.current_status!=='ads_live') throw new Error('TOPUP_ADS_LIVE_ONLY');
        if(l1Code||l2Code) throw new Error('BAD_TAXONOMY');
        if(topUpAmount===null||topUpAmount<=0) throw new Error('TOPUP_REQUIRED');
        await tx`
          INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_id,agent_name_raw,source_type,l0_code,l0_label_snapshot,top_up_amount_inr)
          VALUES(${caseId}::uuid,${c.customer_id},${attempt},${user.id}::uuid,${user.name},'new_event',${l0Code},${l0.label},${topUpAmount})
        `;
        await tx`UPDATE onboarding_cases SET last_activity_at=now(),updated_at=now() WHERE id=${caseId}::uuid`;
        return;
      }

      if(c.current_status!=='open') throw new Error('CASE_CLOSED');
      if(l0Code==='OB_IN_PROCESS' && !l1) throw new Error('L1_REQUIRED');
      if((l0Code==='OB_NOT_INTERESTED'||l0Code==='OB_REFUND_REQUESTED') && !l1) throw new Error('REASON_REQUIRED');
      if(l1Code==='OB_TECHNICAL' && !l2) throw new Error('L2_REQUIRED');
      const callback=toIstCallback(body.callbackDate?String(body.callbackDate):null,body.callbackTime?String(body.callbackTime):null);
      if(l1Code==='OB_CALLBACK' && !callback) throw new Error('CALLBACK_REQUIRED');
      if(callback && callback.getTime()<=Date.now()) throw new Error('CALLBACK_PAST');
      if((l1Code==='OB_OTHER_PROCESS'||l1Code==='OB_NI_OTHER'||l1Code==='OB_REFUND_OTHER'||l2Code==='OB_TECH_OTHER') && !remark) throw new Error('REMARK_REQUIRED');

      await tx`
        INSERT INTO onboarding_events(onboarding_case_id,customer_id,attempt_number,agent_id,agent_name_raw,source_type,l0_code,l1_code,l2_code,l0_label_snapshot,l1_label_snapshot,l2_label_snapshot,remark,callback_at,top_up_amount_inr)
        VALUES(${caseId}::uuid,${c.customer_id},${attempt},${user.id}::uuid,${user.name},'new_event',${l0Code},${l1Code},${l2Code},${l0.label},${l1?.label||null},${l2?.label||null},${remark},${callback},${topUpAmount})
      `;
      let status='open'; let adsLiveAt:any=null; let closedAt:any=null;
      if(l0Code==='OB_ADS_LIVE'){status='ads_live';adsLiveAt=new Date();closedAt=adsLiveAt;}
      if(l0Code==='OB_NOT_INTERESTED'||l0Code==='OB_REFUND_REQUESTED'){status='lost';closedAt=new Date();}
      await tx`
        UPDATE onboarding_cases SET current_l0=${l0.label},current_l1=${l1?.label||null},current_l2=${l2?.label||null},
          current_status=${status},next_callback_at=${callback},last_activity_at=now(),ads_live_at=${adsLiveAt},closed_at=${closedAt},updated_at=now()
        WHERE id=${caseId}::uuid
      `;
      if(l1Code==='OB_TECHNICAL'){
        const openTech=await tx`SELECT id FROM technical_cases WHERE onboarding_case_id=${caseId}::uuid AND status='open' LIMIT 1`;
        if(openTech[0]){
          await tx`UPDATE technical_cases SET issue_code=${l2Code},issue_label=${l2.label},latest_remark=${remark},updated_at=now() WHERE id=${openTech[0].id}::uuid`;
        }else{
          await tx`
            INSERT INTO technical_cases(onboarding_case_id,customer_id,issue_code,issue_label,opened_by,assigned_to,latest_remark)
            VALUES(${caseId}::uuid,${c.customer_id},${l2Code},${l2.label},${user.id}::uuid,${c.assigned_to},${remark})
          `;
        }
      }
      if(resolveTechId){
        await tx`UPDATE technical_cases SET status='resolved',resolved_by=${user.id}::uuid,resolved_at=now(),latest_remark=COALESCE(${remark},latest_remark),updated_at=now() WHERE id=${resolveTechId}::uuid AND onboarding_case_id=${caseId}::uuid AND status='open'`;
      }
    });
    return NextResponse.json({ok:true});
  }catch(e:any){
    const code=String(e?.message||'');
    const map:any={CASE_NOT_FOUND:['Case not found',404],NOT_ASSIGNED:['This case is assigned to another onboarder.',403],CASE_CLOSED:['This onboarding case is already closed.',409],TECH_NOT_FOUND:['Technical case is already resolved or not found.',409],BAD_TAXONOMY:['Invalid onboarding disposition.',400],L1_REQUIRED:['Select an in-process reason.',400],REASON_REQUIRED:['Select a reason for this outcome.',400],L2_REQUIRED:['Select the technical issue.',400],CALLBACK_REQUIRED:['Callback date and time are required.',400],CALLBACK_PAST:['Callback must be in the future.',400],REMARK_REQUIRED:['A remark is required for this option.',400],TOPUP_REQUIRED:['Enter the additional top-up amount.',400],TOPUP_ADS_LIVE_ONLY:['Additional top-up can only be logged after Ads Live.',409]};
    const hit=map[code]; if(hit) return NextResponse.json({error:hit[0]},{status:hit[1]});
    console.error('onboarding event error',e);
    return NextResponse.json({error:'Could not save onboarding update.'},{status:500});
  }
}
