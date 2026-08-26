import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { parseWorkbook } from '../lib/source-parser';
import { normalizeStatus } from '../lib/status';
import { seedDispositions } from './seed-dispositions-fn';

const LOCKED = { customers:1039, standard_calls:1650, legacy_followups:233, total_interactions:1883 } as const;
type MigrationPayload = { customers:any[]; calls:any[]; flags:any[]; locked?:Record<string,number> };

function assertLockedSource(p: MigrationPayload) {
  const source = {
    customers: p.customers.length,
    standard_calls: p.calls.filter(c => c.sourceType === 'standard_call').length,
    legacy_followups: p.calls.filter(c => c.sourceType === 'legacy_followup').length,
    total_interactions: p.calls.length,
  };
  const failures = Object.entries(LOCKED).filter(([k,v]) => source[k as keyof typeof source] !== v).map(([k,v]) => `${k}: expected ${v}, parsed ${source[k as keyof typeof source]}`);
  if (failures.length) throw new Error(`SOURCE BASELINE CHECK FAILED. Refusing to write to Neon. ${failures.join('; ')}`);
  return source;
}

async function loadPayload(): Promise<MigrationPayload> {
  const payloadPath = process.env.MIGRATION_PAYLOAD_JSON;
  if (payloadPath) return JSON.parse(fs.readFileSync(payloadPath,'utf8'));
  const file = process.argv[2] || path.join(process.cwd(),'source','Disposition Sheet - Sellers.xlsx');
  return await parseWorkbook(file) as any;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL to your Neon connection string');
  if (url.includes('localhost') || url.includes('127.0.0.1')) throw new Error('This script is for Neon production.');

  console.log('=== NEON PRODUCTION MIGRATION ===\n');
  console.log('1. Loading and verifying migration source...');
  const p = await loadPayload();
  const source = assertLockedSource(p);
  console.log('   Locked source baselines confirmed:', JSON.stringify(source),'\n');

  const sql = postgres(url,{ssl:'require',max:1,connect_timeout:30});
  try {
    console.log('2. Testing Neon connection...');
    const [{now}] = await sql`SELECT now()`;
    console.log(`   Connected: ${now}\n`);
    console.log('3. Running atomic schema + seed + migration + reconciliation...');

    const result = await sql.begin(async tx => {
      await tx.unsafe(fs.readFileSync(path.join(process.cwd(),'db','001_init.sql'),'utf8'));
      await seedDispositions(tx as any);

      for (const c of p.customers) await tx`
        INSERT INTO customers (customer_id,merchant_name,phone,category,sub_category,funnel_stage,contact_priority)
        VALUES (${c.customerId},${c.merchantName||null},${c.phone||null},${c.category||null},${c.subCategory||null},${c.funnelStage||null},${c.contactPriority||null})
        ON CONFLICT (customer_id) DO UPDATE SET
          merchant_name=COALESCE(customers.merchant_name,EXCLUDED.merchant_name), phone=COALESCE(customers.phone,EXCLUDED.phone),
          category=COALESCE(customers.category,EXCLUDED.category), sub_category=COALESCE(customers.sub_category,EXCLUDED.sub_category),
          funnel_stage=COALESCE(customers.funnel_stage,EXCLUDED.funnel_stage), contact_priority=COALESCE(customers.contact_priority,EXCLUDED.contact_priority), updated_at=now()`;

      for (const f of p.flags) await tx`
        INSERT INTO customer_legacy_flags (customer_id,source_sheet,source_row,call_over_wa,entry_point_issue,insights_issue,fb_linking_issue,ads_creative_issue,payment_issue,wants_visit,wants_sample_over_wa,fb_page_linking_pending,legacy_total_touches,legacy_last_contact,legacy_current_status,raw_json)
        VALUES (${f.customerId},${f.sheet},${f.row},${f.callOverWa||null},${f.entryPointIssue||null},${f.insightsIssue||null},${f.fbLinkingIssue||null},${f.adsCreativeIssue||null},${f.paymentIssue||null},${f.wantsVisit||null},${f.wantsSampleOverWa||null},${f.fbPageLinkingPending||null},${f.legacyTotalTouches||null},${f.legacyLastContact||null},${f.legacyCurrentStatus||null},${JSON.stringify(f.raw||{})}::jsonb)
        ON CONFLICT (source_sheet,source_row) DO NOTHING`;

      for (const c of p.calls) await tx`
        INSERT INTO calls (customer_id,attempt_number,call_date,call_seq,agent_name_raw,source_type,source_sheet,source_row,source_call_num,source_key,status_raw,status_normalized,what_happened,remark,is_legacy,is_conversion_authoritative)
        VALUES (${c.customerId},${c.attemptNumber},${c.date}::date,${c.callSeq},${c.agentName},${c.sourceType},${c.sheet},${c.row},${c.sourceCallNum},${c.sourceKey},${c.statusRaw},${normalizeStatus(c.statusRaw)},${c.whatHappened},${c.remark},TRUE,TRUE)
        ON CONFLICT (source_key) DO NOTHING`;

      const [counts] = await tx`SELECT
        (SELECT count(DISTINCT customer_id)::int FROM calls WHERE is_legacy=TRUE AND is_conversion_authoritative=TRUE) AS customers,
        (SELECT count(*)::int FROM calls WHERE is_legacy=TRUE AND is_conversion_authoritative=TRUE AND source_type='standard_call') AS standard_calls,
        (SELECT count(*)::int FROM calls WHERE is_legacy=TRUE AND is_conversion_authoritative=TRUE AND source_type='legacy_followup') AS legacy_followups,
        (SELECT count(*)::int FROM calls WHERE is_legacy=TRUE AND is_conversion_authoritative=TRUE) AS total_interactions,
        (SELECT count(*)::int FROM calls WHERE is_legacy=TRUE AND l0_id IS NOT NULL) AS legacy_with_l0`;
      const actual={customers:Number(counts.customers),standard_calls:Number(counts.standard_calls),legacy_followups:Number(counts.legacy_followups),total_interactions:Number(counts.total_interactions)};
      const failures=Object.entries(LOCKED).filter(([k,v])=>actual[k as keyof typeof actual]!==v).map(([k,v])=>`${k}: expected ${v}, Neon has ${actual[k as keyof typeof actual]}`);
      if(Number(counts.legacy_with_l0)!==0) failures.push(`${counts.legacy_with_l0} legacy calls have L0 assigned`);
      if(failures.length) throw new Error(`NEON RECONCILIATION FAILED; rolling back. ${failures.join('; ')}`);

      const umesh=await tx`SELECT status_raw,remark FROM calls WHERE customer_id='1495499942' AND is_legacy=TRUE ORDER BY attempt_number`;
      if(!umesh.some((c:any)=>!c.status_raw&&c.remark)) throw new Error('Spot check failed for Umesh remark-only history');
      const [fu]=await tx`SELECT count(*)::int AS n FROM calls WHERE is_legacy=TRUE AND source_type='legacy_followup'`;
      if(Number(fu.n)!==233) throw new Error('Spot check failed for Sheena legacy follow-ups');
      const same=await tx`SELECT 1 FROM calls WHERE is_legacy=TRUE GROUP BY customer_id,call_date HAVING count(*)>1 LIMIT 1`;
      if(!same.length) throw new Error('Spot check failed for same-day multiple calls');
      return actual;
    });

    console.log('\n=== MIGRATION SUMMARY ===');
    console.log(`Neon historical customers: ${result.customers}`);
    console.log(`Standard calls:             ${result.standard_calls}`);
    console.log(`Legacy follow-ups:          ${result.legacy_followups}`);
    console.log(`Total interactions:         ${result.total_interactions}`);
    console.log('Migration errors:           0');
    console.log('Validation:                 ALL LOCKED CHECKS PASSED');
  } finally { await sql.end(); }
}
main().catch(e=>{console.error('MIGRATION FAILED:',e?.message||e);process.exit(1)});
