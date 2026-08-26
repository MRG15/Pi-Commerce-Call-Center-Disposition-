import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { parseWorkbook } from '../lib/source-parser';
import { normalizeStatus } from '../lib/status';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Set DATABASE_URL to your Neon connection string'); process.exit(1); }
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    console.error('This script is for Neon production. Use individual scripts for local dev.'); process.exit(1);
  }

  const sql = postgres(url, { ssl: 'require', max: 1, connect_timeout: 30 });
  console.log('=== NEON PRODUCTION MIGRATION ===\n');

  // Step 1: Test connection
  console.log('1. Testing Neon connection...');
  const [{now}] = await sql`SELECT now()`;
  console.log(`   Connected: ${now}\n`);

  // Step 2: Create schema
  console.log('2. Creating schema...');
  const migration = fs.readFileSync(path.join(process.cwd(),'db','001_init.sql'),'utf8');
  await sql.unsafe(migration);
  console.log('   Schema created.\n');

  // Step 3: Seed disposition tree
  console.log('3. Seeding disposition tree...');
  const {seedDispositions} = await import('./seed-dispositions-fn');
  await seedDispositions(sql);
  console.log('   Disposition tree seeded.\n');

  // Step 4: Parse workbook
  console.log('4. Parsing source workbook...');
  const file = process.argv[2] || path.join(process.cwd(),'source','Disposition Sheet - Sellers.xlsx');
  const p = await parseWorkbook(file);
  console.log(`   Parsed: ${p.customers.length} customers, ${p.calls.length} interactions\n`);

  // Step 5: Migrate data
  console.log('5. Migrating data to Neon...');
  await sql.begin(async tx => {
    for (const c of p.customers) {
      await tx`
        INSERT INTO customers (customer_id, merchant_name, phone, category, sub_category, funnel_stage, contact_priority)
        VALUES (${c.customerId},${c.merchantName||null},${c.phone||null},${c.category||null},${c.subCategory||null},${c.funnelStage||null},${c.contactPriority||null})
        ON CONFLICT (customer_id) DO UPDATE SET
          merchant_name=COALESCE(customers.merchant_name,EXCLUDED.merchant_name),
          phone=COALESCE(customers.phone,EXCLUDED.phone),
          category=COALESCE(customers.category,EXCLUDED.category),
          sub_category=COALESCE(customers.sub_category,EXCLUDED.sub_category),
          funnel_stage=COALESCE(customers.funnel_stage,EXCLUDED.funnel_stage),
          contact_priority=COALESCE(customers.contact_priority,EXCLUDED.contact_priority),
          updated_at=now()
      `;
    }
    for (const f of p.flags) {
      await tx`
        INSERT INTO customer_legacy_flags (
          customer_id,source_sheet,source_row,call_over_wa,entry_point_issue,insights_issue,fb_linking_issue,
          ads_creative_issue,payment_issue,wants_visit,wants_sample_over_wa,fb_page_linking_pending,
          legacy_total_touches,legacy_last_contact,legacy_current_status,raw_json
        ) VALUES (
          ${f.customerId},${f.sheet},${f.row},${f.callOverWa||null},${f.entryPointIssue||null},${f.insightsIssue||null},${f.fbLinkingIssue||null},
          ${f.adsCreativeIssue||null},${f.paymentIssue||null},${f.wantsVisit||null},${f.wantsSampleOverWa||null},${f.fbPageLinkingPending||null},
          ${f.legacyTotalTouches||null},${f.legacyLastContact||null},${f.legacyCurrentStatus||null},${JSON.stringify(f.raw)}::jsonb
        ) ON CONFLICT (source_sheet,source_row) DO NOTHING
      `;
    }
    for (const c of p.calls) {
      await tx`
        INSERT INTO calls (
          customer_id,attempt_number,call_date,call_seq,agent_name_raw,source_type,source_sheet,source_row,source_call_num,source_key,
          status_raw,status_normalized,what_happened,remark,is_legacy,is_conversion_authoritative
        ) VALUES (
          ${c.customerId},${c.attemptNumber},${c.date}::date,${c.callSeq},${c.agentName},${c.sourceType},${c.sheet},${c.row},${c.sourceCallNum},${c.sourceKey},
          ${c.statusRaw},${normalizeStatus(c.statusRaw)},${c.whatHappened},${c.remark},TRUE,TRUE
        ) ON CONFLICT (source_key) DO NOTHING
      `;
    }
  });
  console.log('   Data migrated.\n');

  // Step 6: Reconciliation
  console.log('6. Running reconciliation...');
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
    customers: p.customers.length,
    standard_calls: p.calls.filter(c=>c.sourceType==='standard_call').length,
    legacy_followups: p.calls.filter(c=>c.sourceType==='legacy_followup').length,
    total_interactions: p.calls.length,
    with_status: p.calls.filter(c=>c.statusRaw).length,
    without_status: p.calls.filter(c=>!c.statusRaw).length,
  };
  const actual = Object.fromEntries(Object.entries(dbCounts).map(([k,v])=>[k,Number(v)]));
  const checks = Object.fromEntries(Object.keys(expected).map(k=>[k,(expected as any)[k]===(actual as any)[k]]));
  const ok = Object.values(checks).every(Boolean);

  console.log('   Expected:', JSON.stringify(expected));
  console.log('   Actual:  ', JSON.stringify(actual));
  console.log('   Checks:  ', JSON.stringify(checks));
  console.log(`   Result:   ${ok ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'}\n`);

  // Step 7: Spot checks
  console.log('7. Spot checks...');

  // 7a: Umesh remark-only customer 1495499942
  const umeshCalls = await sql`SELECT source_key, call_date, status_raw, remark, l0_id FROM calls WHERE customer_id='1495499942' AND is_legacy=TRUE ORDER BY attempt_number`;
  console.log(`   CID 1495499942 (Umesh remark-only): ${umeshCalls.length} calls`);
  for (const c of umeshCalls) console.log(`     ${c.source_key} | ${c.call_date} | status=${c.status_raw||'NULL'} | remark=${(c.remark||'NULL').slice(0,50)} | L0=${c.l0_id||'NULL'}`);

  // 7b: Sheena customer with legacy follow-ups
  const sheenaFu = await sql`
    SELECT DISTINCT customer_id FROM calls
    WHERE is_legacy=TRUE AND source_type='legacy_followup'
    LIMIT 1`;
  if (sheenaFu.length) {
    const cid = sheenaFu[0].customer_id;
    const sheenaCalls = await sql`SELECT source_key, call_date, source_type, status_raw, remark FROM calls WHERE customer_id=${cid} AND is_legacy=TRUE ORDER BY attempt_number`;
    console.log(`\n   CID ${cid} (Sheena with follow-ups): ${sheenaCalls.length} calls`);
    for (const c of sheenaCalls) console.log(`     ${c.source_key} | ${c.call_date} | ${c.source_type} | status=${c.status_raw||'NULL'} | remark=${(c.remark||'NULL').slice(0,50)}`);
  }

  // 7c: Customer with same-day multiple calls
  const sameDayCustomer = await sql`
    SELECT customer_id, call_date, count(*)::int AS cnt
    FROM calls WHERE is_legacy=TRUE
    GROUP BY customer_id, call_date HAVING count(*) > 1
    ORDER BY cnt DESC LIMIT 1`;
  if (sameDayCustomer.length) {
    const {customer_id: cid2, call_date: dt} = sameDayCustomer[0];
    const sameDayCalls = await sql`SELECT source_key, call_date, call_seq, status_raw, remark FROM calls WHERE customer_id=${cid2} AND call_date=${dt} AND is_legacy=TRUE ORDER BY attempt_number`;
    console.log(`\n   CID ${cid2} same-day ${dt}: ${sameDayCalls.length} calls`);
    for (const c of sameDayCalls) console.log(`     ${c.source_key} | seq=${c.call_seq} | status=${c.status_raw||'NULL'} | remark=${(c.remark||'NULL').slice(0,50)}`);
  }

  // 7d: Verify no legacy call has L0/L1/L2
  const [legacyL0] = await sql`SELECT count(*)::int AS cnt FROM calls WHERE is_legacy=TRUE AND l0_id IS NOT NULL`;
  console.log(`\n   Legacy calls with L0 assigned: ${legacyL0.cnt} (expected: 0)`);

  // 7e: Verify disposition tree exists
  const [nodeCount] = await sql`SELECT count(*)::int AS cnt FROM disposition_nodes`;
  console.log(`   Disposition nodes: ${nodeCount.cnt}`);

  console.log('\n=== MIGRATION SUMMARY ===');
  console.log(`Neon customers:         ${actual.customers}`);
  console.log(`Standard calls:         ${actual.standard_calls}`);
  console.log(`Legacy follow-ups:      ${actual.legacy_followups}`);
  console.log(`Total interactions:     ${actual.total_interactions}`);
  console.log(`Migration errors:       0`);
  console.log(`Validation:             ${ok ? 'ALL 6 CHECKS PASSED' : 'FAILED'}`);

  await sql.end();
  if (!ok) process.exit(2);
}
main().catch(e=>{console.error('MIGRATION FAILED:',e);process.exit(1)});
