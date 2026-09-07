-- Merchant information mirror from Google Sheet (Tab 1 / Onboardings)
-- The Google Sheet remains the source of truth. Portal reads only from Neon.

CREATE TABLE IF NOT EXISTS merchant_information (
  customer_id TEXT PRIMARY KEY,
  merchant_name TEXT,
  phone_number TEXT,
  category TEXT,
  sub_category TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_information_active_idx
  ON merchant_information (customer_id)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS merchant_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_count INTEGER NOT NULL,
  source_name TEXT NOT NULL DEFAULT 'Onboardings_Updated_List',
  status TEXT NOT NULL DEFAULT 'success'
);
