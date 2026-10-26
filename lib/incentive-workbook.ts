import ExcelJS from 'exceljs';

// The incentive payout workbook (Incentives → Download incentive format): Payout Summary, Incentive
// Structure, then the Sales, Onboarding and CSM working tabs. Built from buildIncentiveReport.
const round=(n:number)=>Math.round(n*100)/100;
const fmtDay=(d:string)=>new Date(d+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const TEAM_LABEL:Record<string,string>={sales:'Sales',onboarding:'Onboarding',csm:'CSM','':'Other'};

export async function buildPayoutWorkbook(report:any,byName:Map<string,any>,from:string,to:string){
  // Payout sheet: one row per employee (admins excluded), grouped Sales → Onboarding → CSM.
  const order=['sales','onboarding','csm',''];
  const people=(report.people as any[]).filter(p=>!(byName.get(p.name) as any)?.is_super_admin&&(p.total>0||p.sales>0||p.adsLiveCases>0||p.topUps>0||p.renewals>0))
    .sort((a,b)=>order.indexOf(a.team||'')-order.indexOf(b.team||'')||b.total-a.total||a.name.localeCompare(b.name));
  const wb=new ExcelJS.Workbook(); const ws=wb.addWorksheet('Payout Summary');
  ws.columns=[{width:3},{width:7},{width:22},{width:12},{width:13},{width:30},{width:11},{width:14},{width:14},{width:10},{width:14},{width:14},{width:14}];
  ws.getCell('B2').value=`Pi Commerce call centre · incentive payout for ${fmtDay(from)} – ${fmtDay(to)}`; ws.getCell('B2').font={bold:true,size:14};
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
      r.getCell(10).value=p.adsLiveCases; r.getCell(11).value=round(p.casePay); r.getCell(12).value=round(p.topUpPay+p.renewalPay+(p.csmPay||0)); // incl. the CSM revenue sprint
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

  // Working tabs, as in the payout workbook: structure, then Sales, Onboarding and CSM detail.
  const teamOf=new Map((report.people as any[]).map(p=>[p.name,p.team||'']));
  const sheet=(name:string,title:string,sub:string,cols:[string,number][])=>{
    const w=wb.addWorksheet(name); w.columns=[{width:3},...cols.map(([,width])=>({width}))];
    w.getCell('B2').value=title; w.getCell('B2').font={bold:true,size:13};
    w.getCell('B3').value=sub; w.getCell('B3').font={italic:true,color:{argb:'FF6B7280'}};
    const h=w.getRow(5); cols.forEach(([t],i)=>{const c=h.getCell(i+2);c.value=t;c.font={bold:true,color:{argb:'FFFFFFFF'}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF002970'}};c.alignment={wrapText:true,vertical:'middle'};});
    h.height=30; w.views=[{state:'frozen',ySplit:5}];
    let n=6;
    const add=(vals:any[],moneyCols:number[]=[])=>{const r=w.getRow(n++);vals.forEach((v,i)=>{const c=r.getCell(i+2);c.value=v;if(moneyCols.includes(i))c.numFmt=money;});};
    const total=(sumCols:number[],label='Total')=>{if(n===6){w.getCell('B6').value='Nothing in this period.';return;}const r=w.getRow(n);r.getCell(2).value=label;sumCols.forEach(i=>{const col=String.fromCharCode(66+i);const c=r.getCell(i+2);c.value={formula:`SUM(${col}6:${col}${n-1})`};c.numFmt=money;});r.font={bold:true};n++;};
    const note=(t:string)=>{n++;w.getCell(`B${n++}`).value=t;};
    return {add,total,note};
  };
  const inr=(v:number)=>'₹'+Number(v).toLocaleString('en-IN');
  const period=`${fmtDay(from)} – ${fmtDay(to)}`;
  const P:any=report.plans;
  // A plan without an end date runs until the next plan in its list starts.
  const prevDay=(d:string)=>new Date(new Date(d+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  const inForce=(list:any[])=>list.map((p,i)=>({...p,to:p.to||(list[i+1]?prevDay(list[i+1].from):undefined)})).filter(p=>p.from<=to&&(!p.to||p.to>=from));

  // Incentive Structure (plans in force during the period)
  {
    const st=sheet('Incentive Structure',`Incentive structure in force, ${period}`,'Plans as configured in the portal; each applies on the dates shown.',[['Plan / rule',58],['Value',16],['Applies',30]]);
    const span=(p:any)=>`${fmtDay(p.from)}${p.to?' – '+fmtDay(p.to):' onwards'}`;
    for(const p of inForce(P.sellerDaily)){
      st.add([`Sales · daily incentive (${p.name}) · unlock at sale #`,p.unlock,span(p)]); st.add(['  Unlock amount',inr(p.unlockPay),'']);
      let prev=p.unlock; for(const b of p.bands){st.add([`  Per sale, sale ${prev+1}${b.upTo?'–'+b.upTo:'+'}`,inr(b.rate),'']);prev=b.upTo||prev;}
    }
    for(const p of inForce(P.sellerWeekly)) for(const sl of p.slabs) st.add([`Sales · weekly bonus · ${sl.at}+ sales in the week pays`,inr(sl.pay),span(p)]);
    for(const p of inForce(P.sellerPlanDaily)) for(const k of ['silver','gold','platinum']){const l=p.ladders[k];st.add([`Sales · daily plan incentive · ${k[0].toUpperCase()+k.slice(1)}: ${l.unlock} sale(s) unlock, then each`,`${inr(l.unlockPay)} + ${inr(l.extra)}`,span(p)]);}
    for(const p of inForce(P.sellerRevenue)){
      for(const role of ['BDE','SBDE','TL']) st.add([`Sales · weekly revenue slabs (${role}), cumulative`,'',span(p)]),p.slabs[role].forEach((sl:any)=>st.add([`  ${inr(sl.at)} revenue in the week adds`,inr(sl.pay),'']));
      st.add(['  Team Lead also earns share of each BDE\'s payout',`${Math.round(p.tlShareOfBde*100)}%`,'']);
    }
    for(const p of inForce(P.onboarder)){
      st.add([`Onboarding / CSM (${p.name}) · Ads Live: unlock at case # per day`,p.unlock,span(p)]); st.add(['  Unlock amount',inr(p.unlockPay),'']); st.add(['  Each case after the unlock',inr(p.perCase),'']);
      st.add(['  Top-up: minimum qualifying amount',inr(p.topUpMin),'']); st.add([`  Top-up up to ${inr(p.topUpCeiling)} earns`,`${p.rateUpToCeiling*100}%`,'']); st.add([`  Top-up above ${inr(p.topUpCeiling)} earns (whole amount)`,`${p.rateAboveCeiling*100}%`,'']);
      if(p.paysRenewals) st.add(['  Subscription renewals and plan upgrades are priced like top-ups','','']);
    }
  }
  // Sales
  {
    const sd=sheet('Sales - Daily',`Sales team · daily incentive, ${period}`,'One row per seller per day with a sale. Up to 30 Sep: daily ladder on subscriptions sold. From 1 Oct: daily plan incentive (each plan on its own).',[['Date',13],['Seller',16],['Team',12],['Subs sold',11],['Silver',9],['Gold',9],['Platinum',10],['Daily incentive',15]]);
    const rows=[...report.sellerDaily.map((d:any)=>({date:d.date,person:d.person,sales:d.sales,s:'',g:'',p:'',pay:d.pay})),...report.sellerPlanDaily.map((d:any)=>({date:d.date,person:d.person,sales:d.silver+d.gold+d.platinum,s:d.silver,g:d.gold,p:d.platinum,pay:d.pay}))]
      .sort((a:any,b:any)=>a.date.localeCompare(b.date)||a.person.localeCompare(b.person));
    for(const r of rows) sd.add([r.date,r.person,TEAM_LABEL[teamOf.get(r.person)||''],r.sales,r.s,r.g,r.p,r.pay],[7]);
    sd.total([3,7]);
    const sw=sheet('Sales - Weekly',`Sales team · weekly incentive, ${period}`,'Up to 30 Sep: weekly bonus on subscriptions sold. From 1 Oct: weekly revenue slabs by role (a Team Lead also earns a share of each BDE). A week is paid in the period its Sunday falls in.',[['Week start',12],['Week end',12],['Seller',16],['Role',10],['Subs in week',12],['Revenue (₹)',14],['Bonus / slabs',14],['TL team share',14],['Weekly incentive',16]]);
    for(const w of report.sellerWeekly) sw.add([w.weekStart,w.weekEnd,w.person,'',w.sales,'',w.pay,'',w.pay],[5,6,7,8]);
    for(const w of report.sellerRevenueWeekly) sw.add([w.activeFrom,w.activeTo,w.person,w.role,w.sales,round(w.revenue),round(w.slabPay),round(w.teamShare),round(w.slabPay+w.teamShare)],[5,6,7,8]);
    sw.total([4,5,6,7,8]);
  }
  // Onboarding and CSM
  const topRows=(report.raw as any[]).filter(r=>r.section==='Top-up'||r.section==='Subscription renewal');
  {
    const al=sheet('Onboarding - Ads Live',`Onboarding · Ads Live, ${period}`,'Cases whose ads went live, credited to the case owner, counted per day. Cases made live outside the onboarding flow are excluded.',[['Date',13],['Onboarder',16],['Team',12],['Ads live',10],['Incentive',14]]);
    for(const o of (report.onboarderDaily as any[]).filter(o=>o.cases>0)) al.add([o.date,o.person,TEAM_LABEL[teamOf.get(o.person)||''],o.cases,o.casePay],[4]);
    al.total([3,4]);
    for(const [team,name] of [['onboarding','Onboarding - Top-ups'],['csm','CSM - Top-ups']] as [string,string][]){
      const rows=topRows.filter(r=>team==='csm'?teamOf.get(r.person)==='csm':teamOf.get(r.person)!=='csm');
      const tp=sheet(name,`${team==='csm'?'CSM':'Onboarding'} · top-ups, upgrades and renewals, ${period}`,'One row per entry, priced on its own: below ₹1,000 nothing; up to ₹5,000 earns 5%; above ₹5,000 earns 10% of the whole amount.',[['Date',13],['Name',16],['Customer ID / source',30],['Type',22],['Amount (₹)',13],['Incentive',13]]);
      for(const r of rows.sort((a,b)=>a.date.localeCompare(b.date)||a.person.localeCompare(b.person))) tp.add([r.date,r.person,r.customer||'',r.detail||'',r.amount,r.incentive],[4,5]);
      tp.total([4,5]);
    }
  }
  return wb.xlsx.writeBuffer();
}
