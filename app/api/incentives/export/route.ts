import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess,canSeeIncentives } from '@/lib/workspace-access';
import { buildIncentiveReport } from '@/lib/incentive-report';
import { buildPayoutWorkbook } from '@/lib/incentive-workbook';

// Incentives tab downloads (Super Admins and Incentives access):
//   format=raw     every line behind the payout (CSV)
//   format=payout  one row per employee in the payout sheet layout (Excel)
const isDate=(v:string|null)=>Boolean(v&&/^\d{4}-\d{2}-\d{2}$/.test(v));
const round=(n:number)=>Math.round(n*100)/100;
const cell=(v:unknown)=>{if(v===null||v===undefined)return '';const s=String(v);return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
const fmtDay=(d:string)=>new Date(d+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const TEAM_LABEL:Record<string,string>={sales:'Sales',onboarding:'Onboarding',csm:'CSM','':'Other'};

export async function GET(req:Request){
  const user:any=await currentUserAccess();
  if(!user) return NextResponse.json({error:'Unauthenticated'},{status:401});
  if(!canSeeIncentives(user)) return NextResponse.json({error:'Incentives access required'},{status:403});
  const u=new URL(req.url); const from=u.searchParams.get('from'); const to=u.searchParams.get('to'); const format=u.searchParams.get('format');
  if(!isDate(from)||!isDate(to)||from!>to!) return NextResponse.json({error:'from and to are required (YYYY-MM-DD, from ≤ to)'},{status:400});
  const sql=db();
  const report:any=await buildIncentiveReport(sql,from!,to!);
  const agents=await sql`SELECT name,employee_id,email,is_super_admin FROM agents`;
  const byName=new Map(agents.map((a:any)=>[String(a.name),a]));

  if(format==='raw'){
    const headers=['Section','Date','Week end','Person','Team','Employee ID','Customer ID / note','Detail','Count','Amount (₹)','Incentive (₹)'];
    const teamOf=new Map((report.people as any[]).map(p=>[p.name,p.team]));
    const lines=[headers.join(','),...report.raw.map((r:any)=>{const a:any=byName.get(r.person);return [r.section,r.date,r.weekEnd||'',r.person,TEAM_LABEL[teamOf.get(r.person)||''],a?.employee_id||'',r.customer||'',r.detail||'',r.count??'',r.amount??'',r.incentive??''].map(cell).join(',');})];
    return new NextResponse('﻿'+lines.join('\r\n'),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="pi-commerce-incentive-raw-${from}-to-${to}.csv"`,'cache-control':'no-store'}});
  }
  if(format!=='payout') return NextResponse.json({error:'format must be raw or payout'},{status:400});

  const buf=await buildPayoutWorkbook(report,byName as Map<string,any>,from!,to!);
  return new NextResponse(Buffer.from(buf as ArrayBuffer),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="Pi_Commerce_Incentive_Payout_${from}_to_${to}.xlsx"`,'cache-control':'no-store'}});
}
