import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

type MerchantRow = {
  customer_id?: unknown;
  merchant_name?: unknown;
  phone_number?: unknown;
  category?: unknown;
  sub_category?: unknown;
};

function clean(v: unknown) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

export async function POST(req: Request) {
  const configuredSecret = process.env.MERCHANT_SYNC_SECRET;
  const suppliedSecret = req.headers.get('x-merchant-sync-secret');
  if (!configuredSecret || !suppliedSecret || suppliedSecret !== configuredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const input: MerchantRow[] = Array.isArray(body?.rows) ? body.rows : [];
  const byCustomer = new Map<string, any>();
  for (const row of input) {
    const customerId = clean(row?.customer_id);
    if (!customerId) continue;
    byCustomer.set(customerId, {
      customer_id: customerId,
      merchant_name: clean(row?.merchant_name),
      phone_number: clean(row?.phone_number),
      category: clean(row?.category),
      sub_category: clean(row?.sub_category),
    });
  }

  const rows = Array.from(byCustomer.values());
  const minimumRows = Number(process.env.MERCHANT_SYNC_MIN_ROWS || '100');
  if (rows.length < minimumRows) {
    return NextResponse.json(
      { error: `Refusing sync: only ${rows.length} valid rows received (minimum ${minimumRows})` },
      { status: 400 },
    );
  }

  const sql = db();
  const [schema] = await sql`SELECT to_regclass('public.merchant_information')::text AS merchant_table`;
  if (!schema?.merchant_table) {
    return NextResponse.json({ error: 'Merchant information schema is not installed' }, { status: 503 });
  }

  const startedAt = new Date().toISOString();
  try {
    const result = await sql.begin(async tx => {
      await tx`
        WITH incoming AS (
          SELECT
            NULLIF(BTRIM(customer_id), '') AS customer_id,
            NULLIF(BTRIM(merchant_name), '') AS merchant_name,
            NULLIF(BTRIM(phone_number), '') AS phone_number,
            NULLIF(BTRIM(category), '') AS category,
            NULLIF(BTRIM(sub_category), '') AS sub_category
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
            AS x(customer_id text, merchant_name text, phone_number text, category text, sub_category text)
        )
        INSERT INTO merchant_information (
          customer_id, merchant_name, phone_number, category, sub_category, active, last_synced_at
        )
        SELECT customer_id, merchant_name, phone_number, category, sub_category, TRUE, ${startedAt}::timestamptz
        FROM incoming
        WHERE customer_id IS NOT NULL
        ON CONFLICT (customer_id) DO UPDATE SET
          merchant_name = EXCLUDED.merchant_name,
          phone_number = EXCLUDED.phone_number,
          category = EXCLUDED.category,
          sub_category = EXCLUDED.sub_category,
          active = TRUE,
          last_synced_at = EXCLUDED.last_synced_at
      `;

      await tx`
        UPDATE merchant_information
        SET active = FALSE
        WHERE active = TRUE
          AND last_synced_at <> ${startedAt}::timestamptz
      `;

      const [count] = await tx`SELECT count(*)::int AS n FROM merchant_information WHERE active = TRUE`;
      await tx`
        INSERT INTO merchant_sync_runs (started_at, row_count, source_name, status)
        VALUES (${startedAt}::timestamptz, ${rows.length}, ${String(body?.source || 'Onboardings_Updated_List')}, 'success')
      `;
      return Number(count?.n || 0);
    });

    return NextResponse.json({ ok: true, received: rows.length, activeMerchants: result, syncedAt: startedAt });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Merchant sync failed' }, { status: 500 });
  }
}
