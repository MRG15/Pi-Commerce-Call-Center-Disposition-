import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { currentUserAccess } from '@/lib/workspace-access';
import { buildIncentiveReport } from '@/lib/incentive-report';

// Incentives tab downloads (Super Admin):
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
  if(!user.isSuperAdmin) return NextResponse.json({error:'Super Admin access required'},{status:403});
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

  // Payout sheet: one row per employee (admins excluded), grouped Sales → Onboarding → CSM.
  const order=['sales','onboarding','csm',''];
  const people=(report.people as any[]).filter(p=>!(byName.get(p.name) as any)?.is_super_admin&&(p.total>0||p.sales>0||p.adsLiveCases>0||p.topUps>0||p.renewals>0))
    .sort((a,b)=>order.indexOf(a.team||'')-order.indexOf(b.team||'')||b.total-a.total||a.name.localeCompare(b.name));
  const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('Payout Summary');
  ws.columns=[{width:3},{width:7},{width:22},{width:12},{width:13},{width:30},{width:11},{width:14},{width:14},{width:10},{width:14},{width:14},{width:14}];
  ws.getCell('B2').value=`Pi Commerce call centre · incentive payout for ${fmtDay(from!)} – ${fmtDay(to!)}`; ws.getCell('B2').font={bold:true,size:14};
  ws.getCell('B3').value='Calculated from the disposition portal (Incentives tab) · one row per employee = one payment'; ws.getCell('B3').font={italic:true,color:{argb:'FF6B7280'}};
  const header=['S.No','Name','Team','Employee ID','Email','Subs sold','Daily sales incentive','Weekly sales bonus','Ads live','Ads-live incentive','Top-up incentive','Total payable'];
  const hr=ws.getRow(5); header.forEach((h,i)=>{const c=hr.getCell(i+2);c.value=h;c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF002970'}};c.alignment={wrapText:true,vertical:'middle'};});
  hr.height=32;
  const money='#,##0.##'; let rowNo=6,sn=0; const subtotalRows:number[]=[]; const teamTotals:{team:string;n:number;row:number}[]=[];
  const yellow={type:'pattern' as const,pattern:'solid' as const,fgColor:{argb:'FFFFF59D'}};
  for(const t of order){
    const list=people.filter(p=>(p.team||'')===t); if(!list.length) continue;
    const first=rowNo;
    for(const p of list){
      const a:any=byName.get(p.name); const r=ws.getRow(rowNo);
      r.getCell(2).value=++sn; r.getCell(3).value=p.name; r.getCell(4).value=TEAM_LABEL[t];
      r.getCell(5).value=a?.employee_id?Number(a.employee_id)||a.employee_id:null; r.getCell(6).value=a?.email||null;
      if(!a?.employee_id) r.getCell(5).fill=yellow; if(!a?.email) r.getCell(6).fill=yellow;
      r.getCell(7).value=p.sales; r.getCell(8).value=round(p.sellerDaily); r.getCell(9).value=round(p.weeklyBonus+p.revenuePay+p.teamShare);
      r.getCell(10).value=p.adsLiveCases; r.getCell(11).value=round(p.casePay); r.getCell(12).value=round(p.topUpPay+p.renewalPay);
      r.getCell(13).value={formula:`H${rowNo}+I${rowNo}+K${rowNo}+L${rowNo}`,result:round(p.total)};
      [8,9,11,12,13].forEach(i=>r.getCell(i).numFmt=money);
      rowNo++;
    }
    const st=ws.getRow(rowNo); st.getCell(3).value=`${TEAM_LABEL[t]} team subtotal`;
    ['G','H','I','J','K','L','M'].forEach((col,i)=>{const c=st.getCell(7+i);c.value={formula:`SUM(${col}${first}:${col}${rowNo-1})`};c.numFmt=money;});
    st.font={bold:true}; st.eachCell(c=>c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEEF2FF'}});
    subtotalRows.push(rowNo); teamTotals.push({team:TEAM_LABEL[t],n:list.length,row:rowNo}); rowNo++;
  }
  const gt=ws.getRow(rowNo); gt.getCell(3).value='Grand total';
  ['G','H','I','J','K','L','M'].forEach((col,i)=>{const c=gt.getCell(7+i);c.value={formula:subtotalRows.length?subtotalRows.map(r=>`${col}${r}`).join('+'):'0'};c.numFmt=money;});
  gt.font={bold:true}; rowNo+=2;
  ws.getCell(`B${rowNo}`).value='Team-wise payout'; ws.getCell(`B${rowNo}`).font={bold:true}; rowNo++;
  ['Team','Employees','Total payable'].forEach((h,i)=>{const c=ws.getRow(rowNo).getCell(3+i);c.value=h;c.font={bold:true};}); rowNo++;
  const tStart=rowNo;
  for(const t of teamTotals){const r=ws.getRow(rowNo);r.getCell(3).value=t.team;r.getCell(4).value=t.n;r.getCell(5).value={formula:`M${t.row}`};r.getCell(5).numFmt=money;rowNo++;}
  const tr=ws.getRow(rowNo); tr.getCell(3).value='Total'; tr.getCell(4).value={formula:`SUM(D${tStart}:D${rowNo-1})`}; tr.getCell(5).value={formula:`SUM(E${tStart}:E${rowNo-1})`}; tr.getCell(5).numFmt=money; tr.font={bold:true};
  rowNo+=2;
  const notes=['Notes',
    '• Yellow cells (Employee ID, email) are missing in the portal; complete them before processing.',
    '• Daily sales incentive: daily incentive on sales (to 30 Sep) and the daily plan incentive (from 1 Oct).',
    '• Weekly sales bonus: weekly bonus on sales (to 30 Sep) and the weekly revenue incentive incl. Team Lead team share (from 1 Oct); a week is paid in the period its Sunday falls in.',
    '• Top-up incentive: each top-up, plan upgrade (Onboarding / CSM) and, from 1 Oct, each subscription renewal priced on its own.',
    '• Team is as on the last day of the period. Admin users are excluded from payout.',
    '• The line-by-line working is in Incentives → Download raw dump CSV.'];
  notes.forEach((n,i)=>{const c=ws.getCell(`B${rowNo+i}`);c.value=n;if(i===0)c.font={bold:true};});
  ws.views=[{state:'frozen',ySplit:5}];
  const buf=await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf as ArrayBuffer),{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="Pi_Commerce_Incentive_Payout_${from}_to_${to}.xlsx"`,'cache-control':'no-store'}});
}
