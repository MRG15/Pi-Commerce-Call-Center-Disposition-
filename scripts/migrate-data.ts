import path from 'path';
import { parseWorkbook } from '../lib/source-parser';
import { normalizeStatus } from '../lib/status';
import { db } from '../lib/db';

async function main() {
  const file = process.argv[2] || path.join(process.cwd(),'source','Disposition Sheet - Sellers.xlsx');
  const p = await parseWorkbook(file);
  const sql = db();

  console.log(`Preparing to migrate ${p.customers.length} customers and ${p.calls.length} historical interactions...`);
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

  console.log('Historical migration complete. Run: npm run migrate:validate');
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
