import fs from 'fs';
import path from 'path';
import { parseWorkbook } from '../lib/source-parser';
import { db } from '../lib/db';

async function main() {
  const file = process.argv[2] || path.join(process.cwd(),'source','Disposition Sheet - Sellers.xlsx');
  const p = await parseWorkbook(file);
  const sql = db();
  const [dbCounts] = await sql`
    SELECT
      (SELECT count(*)::int FROM customers) AS customers,
      (SELECT count(*)::int FROM calls WHERE is_legacy=TRUE AND source_type='standard_call') AS standard_calls,
      (SELECT count(*)::int FROM calls WHERE is_legacy=TRUE AND source_type='legacy_followup') AS legacy_followups,
      (SELECT count(*)::int FROM calls WHERE is_legacy=TRUE) AS total_interactions,
      (SELECT count(*)::int FROM calls WHERE is_legacy=TRUE AND status_raw IS NOT NULL) AS with_status,
      (SELECT count(*)::int FROM calls WHERE is_legacy=TRUE AND status_raw IS NULL) AS without_status
  `;
  const expected = {
    customers:p.customers.length,
    standard_calls:p.calls.filter(c=>c.sourceType==='standard_call').length,
    legacy_followups:p.calls.filter(c=>c.sourceType==='legacy_followup').length,
    total_interactions:p.calls.length,
    with_status:p.calls.filter(c=>c.statusRaw).length,
    without_status:p.calls.filter(c=>!c.statusRaw).length,
  };
  const actual = Object.fromEntries(Object.entries(dbCounts).map(([k,v])=>[k,Number(v)]));
  const checks = Object.fromEntries(Object.keys(expected).map(k=>[k,(expected as any)[k] === (actual as any)[k]]));
  const ok = Object.values(checks).every(Boolean);
  const report = {expected,actual,checks,ok};
  fs.writeFileSync(path.join(process.cwd(),'migration-validation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if (!ok) process.exit(2);
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
