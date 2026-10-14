import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canAccess,isWorkspaceAdmin } from '@/lib/workspace-access';

// One lead, in the same shape as /api/customers/[id], so the Seller disposition screen can show a
// lead that has no Cust ID yet (its history = dispositions saved against the lead).
export async function GET(_:Request,ctx:{params:Promise<{id:string}>}){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canAccess(user,'seller')) return NextResponse.json({error:'Seller access required'},{status:403});
  const {id}=await ctx.params;
  if(!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error:'Lead not found'},{status:404});
  const sql=db();
  const rows=await sql`SELECT l.*,a.name AS assigned_name FROM leadgen_leads l LEFT JOIN agents a ON a.id=l.assigned_to WHERE l.id=${id}::uuid`;
  const lead=rows[0];
  if(!lead) return NextResponse.json({error:'Lead not found'},{status:404});
  if(!isWorkspaceAdmin(user,'seller')&&String(lead.assigned_to)!==String(user.id)) return NextResponse.json({error:'This lead is assigned to someone else.'},{status:403});
  const calls=await sql`
    SELECT c.id,c.customer_id,c.lead_id,c.phone,c.attempt_number,c.call_date,c.call_seq,c.event_time,c.agent_id,c.agent_name_raw,c.source_type,
      c.remark,c.l0_label_snapshot,c.l1_label_snapshot,c.l2_label_snapshot,c.callback_at,c.is_legacy,c.created_at,a.name AS agent_name
    FROM calls c LEFT JOIN agents a ON a.id=c.agent_id
    WHERE c.lead_id=${id}::uuid AND c.customer_id IS NULL
    ORDER BY c.call_date,c.call_seq,c.attempt_number
  `;
  const last=calls.at(-1);
  return NextResponse.json({
    found:true,lead,customer:{customer_id:null},merchant:null,externalLead:null,
    summary:{totalAttempts:calls.length,firstCallDate:calls[0]?.call_date??null,lastCallDate:last?.call_date??null,lastAgent:last?.agent_name??last?.agent_name_raw??null,latestOutcome:last?.l0_label_snapshot??'New lead'},
    calls,activeFlags:{},legacyFlagSources:[]
  });
}
