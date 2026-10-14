import { NextResponse,after } from 'next/server';
import { SELLER_WA_L0,triggerSellerWa,triggerSellerLeadWa,resolveCallbackRequests } from '@/lib/wa';
import { currentAgent } from '@/lib/auth';
import { db } from '@/lib/db';
import { PLANS, isPlanCode, plansRequiredOn } from '@/lib/plans';
import { resolveUpgrade,UPGRADE_ERRORS } from '@/lib/plan-upgrade';

function isCallbackLabel(v:string|null|undefined){
  const s=String(v||'').toLowerCase();
  return s.includes('callback') || s.includes('call back');
}

export async function POST(req: Request) {
  const agent=await currentAgent();
  if (!agent) return NextResponse.json({error:'Unauthenticated'},{status:401});
  const body=await req.json();
  let customerId=String(body.customerId||'').trim();
  // Lead Gen Ads: a lead with a Cust ID is logged against the Cust ID (and tagged with the lead);
  // a lead without one is logged against the lead (its phone), never with the phone as a Cust ID.
  const leadId=body.leadId&&/^[0-9a-f-]{36}$/i.test(String(body.leadId))?String(body.leadId):null;
  let lead:any=null;
  const l0Code=String(body.l0Code||'').trim();
  const l1Code=body.l1Code ? String(body.l1Code) : null;
  const l2Code=body.l2Code ? String(body.l2Code) : null;
  const remark=body.remark ? String(body.remark).trim() : null;
  const fb=body.facebookPageStatus ? String(body.facebookPageStatus) : null;
  const callbackDate=body.callbackDate ? String(body.callbackDate) : null;
  const callbackTime=body.callbackTime ? String(body.callbackTime) : null;
  const planCodeRaw=body.planCode ? String(body.planCode) : null;
  if (planCodeRaw && !isPlanCode(planCodeRaw)) return NextResponse.json({error:'Invalid plan'},{status:400});
  const sql=db();
  if (leadId) {
    lead=(await sql`SELECT id,phone,name,customer_id FROM leadgen_leads WHERE id=${leadId}::uuid`)[0]||null;
    if (!lead) return NextResponse.json({error:'Lead not found'},{status:404});
    customerId=lead.customer_id?String(lead.customer_id):'';
  }
  const leadOnly=Boolean(lead&&!customerId);
  if ((!customerId&&!leadOnly) || !l0Code) return NextResponse.json({error:'Customer ID and L0 are required'},{status:400});
  try {
    const result=await sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${leadOnly?'lead:'+lead.id:customerId}))`;
      if (!leadOnly) await tx`INSERT INTO customers (customer_id) VALUES (${customerId}) ON CONFLICT (customer_id) DO NOTHING`;
      const nodes=await tx`SELECT id,code,label,level,parent_id FROM disposition_nodes WHERE code IN (${l0Code},${l1Code},${l2Code}) AND active=TRUE`;
      const byCode=new Map(nodes.map((n:any)=>[n.code,n]));
      const l0:any=byCode.get(l0Code);
      const l1:any=l1Code?byCode.get(l1Code):null;
      const l2:any=l2Code?byCode.get(l2Code):null;
      if (!l0 || l0.level!==0) throw new Error('Invalid L0');
      if (l1 && (l1.level!==1 || String(l1.parent_id)!==String(l0.id))) throw new Error('Invalid L1 hierarchy');
      if (l2 && (!l1 || l2.level!==2 || String(l2.parent_id)!==String(l1.id))) throw new Error('Invalid L2 hierarchy');
      const l1Children = await tx`SELECT count(*)::int AS n FROM disposition_nodes WHERE parent_id=${String(l0.id)}::uuid AND active=TRUE`;
      if (Number(l1Children[0].n) > 0 && !l1) throw new Error('Please select L1');
      if (l1) {
        const l2Children = await tx`SELECT count(*)::int AS n FROM disposition_nodes WHERE parent_id=${String(l1.id)}::uuid AND active=TRUE`;
        if (Number(l2Children[0].n) > 0 && !l2) throw new Error('Please select L2');
      }
      const callbackNeedsRemark = new Set(['Callback — mid-pitch','Customer at counter','Asked for specific time','Driving / travelling','Owner not available']);
      if (callbackNeedsRemark.has(String(l1?.label||'')) && !remark) throw new Error('Remark is required for callback dispositions');
      const fbRequired = new Set(['Payment done','Taken to WhatsApp for closure','Technical blocker']);
      if (fbRequired.has(String(l1?.label||'')) && !fb) throw new Error('Facebook Page Status is required for this disposition');

      const callbackSelected=[l0?.label,l1?.label,l2?.label].some(isCallbackLabel);
      let callbackAt:any=null;
      if(callbackSelected){
        if(!callbackDate || !callbackTime) throw new Error('Callback date and time are required for callback dispositions');
        const cb=await tx`
          SELECT ((${callbackDate}::date + ${callbackTime}::time) AT TIME ZONE 'Asia/Kolkata') AS callback_at
        `;
        callbackAt=cb[0]?.callback_at||null;
        if(!callbackAt || new Date(callbackAt).getTime()<=Date.now()) throw new Error('Callback date and time must be in the future');
      }

      const max=leadOnly
        ?await tx`SELECT COALESCE(max(attempt_number),0)::int AS n FROM calls WHERE lead_id=${lead.id}::uuid AND customer_id IS NULL`
        :await tx`SELECT COALESCE(max(attempt_number),0)::int AS n FROM calls WHERE customer_id=${customerId}`;
      const attempt=Number(max[0].n)+1;
      // Business date is India time. Using UTC here would record the previous date between 00:00-05:30 IST.
      const [dateRow]=await tx`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today`;
      const today=String(dateRow.today);
      // Every sale (Payment done / Enrolled via WhatsApp) records the plan sold from 1 Oct 2026.
      const isSale=String(l1?.label||'')==='Payment done' || String(l2?.label||'')==='Enrolled via WhatsApp';
      let planCode=isSale && planCodeRaw && isPlanCode(planCodeRaw) ? planCodeRaw : null;
      if (isSale && plansRequiredOn(today) && !planCode) throw new Error('Select the plan sold (Silver, Gold or Platinum)');
      let planAmount:number|null=planCode ? PLANS[planCode].price : null;
      // Plan Upgraded: the new plan must be higher than the merchant's current plan; the
      // difference in price is the upgrade value counted for incentives.
      let upgradeFrom:string|null=null, upgradeValueInr:number|null=null;
      if (l0Code==='l0_plan_upgraded') {
        if (leadOnly) throw new Error('Plan Upgraded needs the merchant\'s Cust ID; this lead has none yet.');
        try {
          const u=await resolveUpgrade(tx,customerId,planCodeRaw,body.currentPlan);
          planCode=u.to; planAmount=u.price; upgradeFrom=u.from; upgradeValueInr=u.value;
        } catch (e:any) { throw new Error(UPGRADE_ERRORS[e?.message]||'Could not record the upgrade'); }
      }
      const seqRows=leadOnly
        ?await tx`SELECT COALESCE(max(call_seq),0)::int AS n FROM calls WHERE lead_id=${lead.id}::uuid AND customer_id IS NULL AND call_date=${today}::date`
        :await tx`SELECT COALESCE(max(call_seq),0)::int AS n FROM calls WHERE customer_id=${customerId} AND call_date=${today}::date`;
      const seq=Number(seqRows[0].n)+1;
      const sourceKey=`NEW|${leadOnly?'lead:'+lead.id:customerId}|${Date.now()}|${crypto.randomUUID()}`;
      const rows=await tx`
        INSERT INTO calls (
          customer_id,lead_id,phone,attempt_number,call_date,call_seq,event_time,agent_id,agent_name_raw,source_type,source_key,
          l0_id,l1_id,l2_id,l0_label_snapshot,l1_label_snapshot,l2_label_snapshot,remark,facebook_page_status,
          whatsapp_handoff,callback_at,is_legacy,is_conversion_authoritative,plan_code,plan_amount_inr,upgrade_from_plan,upgrade_value_inr
        ) VALUES (
          ${leadOnly?null:customerId},${lead?lead.id:null}::uuid,${lead?lead.phone:null},${attempt},${today}::date,${seq},now(),${String(agent.id)}::uuid,${String(agent.name)},'new_call',${sourceKey},
          ${String(l0.id)}::uuid,${l1?String(l1.id):null}::uuid,${l2?String(l2.id):null}::uuid,${String(l0.label)},${l1?String(l1.label):null},${l2?String(l2.label):null},${remark},${fb},
          ${String(l1?.label||'')==='Taken to WhatsApp for closure'},${callbackAt},FALSE,TRUE,${planCode},${planAmount},${upgradeFrom},${upgradeValueInr}
        ) RETURNING *
      `;
      return rows[0];
    });
    // Clear this merchant's open callback requests now, so the pane updates as soon as the save
    // returns. The WhatsApp nudge runs after the response so the save is never slowed down.
    try{await resolveCallbackRequests(sql,'seller',leadOnly?null:customerId,lead?.id);}catch(e){console.error('seller callback resolve error',e);}
    after(async()=>{
      try{
        if(SELLER_WA_L0.includes(l0Code)){
          if(leadOnly) await triggerSellerLeadWa(sql,{id:String(lead.id),phone:String(lead.phone),name:lead.name},String(agent.id),String(result.id));
          else await triggerSellerWa(sql,customerId,String(agent.id),String(result.id));
        }
      }catch(e){console.error('seller whatsapp error',e);}
    });
    return NextResponse.json({ok:true,call:result});
  } catch (e:any) {
    return NextResponse.json({error:e.message||'Could not log call'},{status:400});
  }
}
