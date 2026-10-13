import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { WA_TEMPLATES,queueWa,sendQueuedWa,waPhone,type WaTemplate } from '@/lib/wa';

// Super Admin: send a WhatsApp template to test numbers with sample values, before it goes live.
// Test messages are logged in wa_messages (customer "TEST"); the page shows whether each was sent
// and whether "Request a callback" was tapped.
const SAMPLE:Record<string,string>={merchant_name:'',impressions:'12,450',credits:'₹2,000',plan_name:'Gold',
  purchase_date:'12 Oct 2026',expiry_date:'11 Nov 2026',ad_end_date:'14 Oct 2026'};
const WORKSPACE:Record<WaTemplate,'seller'|'onboarding'|'csm'>={SELLER_NOT_CONNECTED:'seller',ONB_NOT_CONNECTED:'onboarding',
  T1_RENEW:'csm',T2_ENDED_FREE:'csm',T3_ENDED_TOPUP:'csm',T4_ENDING_FREE:'csm',T5_ENDING_TOPUP:'csm'};

async function superAdmin(){const u:any=await currentUserAccess();return u?.isSuperAdmin?u:null;}

export async function GET(){
  if(!await superAdmin()) return NextResponse.json({error:'Super Admin only'},{status:403});
  const rows=await db()`
    SELECT id,template,phone,variables->>'merchant_name' AS name,status,status_note,created_at,sent_at,clicked_at,click_count
    FROM wa_messages WHERE source_ref='test' ORDER BY id DESC LIMIT 50
  `;
  const templates=Object.entries(WA_TEMPLATES).map(([k,t])=>({key:k,name:t!.name,body:t!.body,image:t!.headerImage!==undefined,imageUrl:t!.headerImage||''}));
  return NextResponse.json({rows,templates});
}

export async function POST(req:Request){
  const user=await superAdmin();
  if(!user) return NextResponse.json({error:'Super Admin only'},{status:403});
  const b=await req.json().catch(()=>({}));
  const key=String(b.template||'') as WaTemplate;
  const t=WA_TEMPLATES[key];
  if(!t) return NextResponse.json({error:'Unknown or unconfigured template'},{status:400});
  const people=(Array.isArray(b.recipients)?b.recipients:[]).map((p:any)=>({name:String(p.name||'').trim(),phone:waPhone(p.phone)})).filter((p:any)=>p.phone);
  if(!people.length||people.length>10) return NextResponse.json({error:'Add 1–10 phone numbers'},{status:400});
  const image=String(b.imageUrl||'').trim();
  if(image&&!/^https:\/\//.test(image)) return NextResponse.json({error:'Image link must start with https://'},{status:400});
  const sql=db(); const ids:number[]=[];
  for(const p of people){
    const variables:Record<string,string>={};
    for(const k of t.body) variables[k]=k==='merchant_name'?(p.name||'Test merchant'):(SAMPLE[k]??'');
    if(image) variables.header_media_url=image;
    const id=await queueWa(sql,{template:key,workspace:WORKSPACE[key],customerId:'TEST',phone:p.phone,agentId:user.id,sourceRef:'test',variables});
    if(id) ids.push(id);
  }
  await sendQueuedWa(sql,ids);
  return NextResponse.json({ok:true,count:ids.length});
}
