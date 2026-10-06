import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { csmRole } from '@/lib/csm';
import { todayIst } from '@/lib/plans';

// CSM Admin pitch notes ("what to pitch"), one Cust ID or a pasted list.
// Bulk format: one merchant per line — Cust ID, then the note, separated by a tab, comma or " - ".
// Notes are only ever added; the newest one is shown on the merchant.
const parseLine=(line:string)=>{
  const t=line.trim(); if(!t) return null;
  const m=t.match(/^(\d{4,})\s*(?:\t|,|;|\||\s-\s|:)?\s*(.*)$/);
  if(!m) return {error:t};
  return {customerId:m[1],note:m[2].trim()};
};

export async function POST(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(csmRole(user)!=='admin') return NextResponse.json({error:'CSM Admin access required'},{status:403});
  const body=await req.json().catch(()=>({}));
  const noteDate=/^\d{4}-\d{2}-\d{2}$/.test(String(body.noteDate||''))?String(body.noteDate):todayIst();
  const items:{customerId:string;note:string}[]=[]; const errors:string[]=[];
  if(body.bulk){
    const shared=String(body.note||'').trim();
    for(const line of String(body.bulk).split(/\r?\n/)){
      const p:any=parseLine(line); if(!p) continue;
      if(p.error){errors.push(`Not a Cust ID: ${p.error.slice(0,60)}`);continue;}
      const note=p.note||shared;
      if(!note){errors.push(`${p.customerId}: no note`);continue;}
      items.push({customerId:p.customerId,note});
    }
  }else{
    const customerId=String(body.customerId||'').trim(); const note=String(body.note||'').trim();
    if(!/^\d+$/.test(customerId)||!note) return NextResponse.json({error:'Cust ID and note are required.'},{status:400});
    items.push({customerId,note});
  }
  if(!items.length) return NextResponse.json({error:errors[0]||'Nothing to save.',errors},{status:400});
  if(items.length>2000) return NextResponse.json({error:'Paste at most 2000 lines at a time.'},{status:400});
  const sql=db();
  await sql`
    INSERT INTO csm_notes(customer_id,kind,note,note_date,author_id,author_name,source)
    SELECT x.customer_id,'pitch',x.note,${noteDate}::date,${user.id}::uuid,${user.name},'portal'
    FROM jsonb_to_recordset(${sql.json(items.map(i=>({customer_id:i.customerId,note:i.note.slice(0,2000)})))}::jsonb) AS x(customer_id text,note text)
  `;
  return NextResponse.json({ok:true,saved:items.length,errors});
}
