import fs from 'fs';
import path from 'path';
import { parseWorkbook, AUTHORITATIVE_SHEETS, EXCLUDED_SHEETS, TRACKING_SHEETS } from '../lib/source-parser';

async function main() {
  const file = process.argv[2] || path.join(process.cwd(),'source','Disposition Sheet - Sellers.xlsx');
  const parsed = await parseWorkbook(file);
  const bySheet:any = {};
  for (const s of AUTHORITATIVE_SHEETS) {
    const c = parsed.countsBySheet[s];
    bySheet[s] = { uniqueCustomers:c.customers.size, standardCalls:c.standard, legacyFollowups:c.followup };
  }
  const statusKnown = parsed.calls.filter(c=>c.statusRaw).length;
  const withRemark = parsed.calls.filter(c=>c.remark).length;
  const withWhat = parsed.calls.filter(c=>c.whatHappened).length;
  const dates = parsed.calls.map(c=>c.date).sort();
  const seen = new Map<string,number>();
  for (const s of AUTHORITATIVE_SHEETS) for (const id of parsed.countsBySheet[s].customers) seen.set(id,(seen.get(id)||0)+1);
  const overlapCustomers = [...seen.values()].filter(v=>v>1).length;

  const report = {
    generatedAt:new Date().toISOString(),
    sourceFile:path.basename(file),
    authoritativeSheets:AUTHORITATIVE_SHEETS,
    trackingSheets:TRACKING_SHEETS,
    excludedSheets:EXCLUDED_SHEETS,
    uniqueCustomers:parsed.customers.length,
    standardHistoricalCalls:parsed.calls.filter(c=>c.sourceType==='standard_call').length,
    legacyFollowups:parsed.calls.filter(c=>c.sourceType==='legacy_followup').length,
    totalHistoricalInteractions:parsed.calls.length,
    interactionsWithStatus:statusKnown,
    interactionsWithoutStatus:parsed.calls.length-statusKnown,
    interactionsWithRemark:withRemark,
    interactionsWithoutRemark:parsed.calls.length-withRemark,
    interactionsWithWhatHappened:withWhat,
    overlapCustomers,
    earliestDate:dates[0] || null,
    latestDate:dates.at(-1) || null,
    bySheet,
    note:'Counts are calculated directly from the workbook. Do not hard-code prior report numbers; use this report as the migration baseline.'
  };
  fs.writeFileSync(path.join(process.cwd(),'migration-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exit(1)});
