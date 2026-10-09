-- CleverTap (PPSL) payment_success webhook: every subscription sale as CT reports it, with the
-- employee code of whoever brought it in. Stored as received; not used for incentives yet.
-- Additive only: a new table.
CREATE TABLE IF NOT EXISTS ct_payment_events (
  id BIGSERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  flow TEXT,                  -- subscribe / upgrade
  plan TEXT,                  -- silver / gold / platinum
  amount NUMERIC(14,2),
  employee_code TEXT,
  event_at TIMESTAMPTZ,       -- time CT reports for the payment (falls back to received_at)
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dedupe_key TEXT NOT NULL UNIQUE, -- customer|flow|plan|amount|IST day: CT retries are stored once
  raw JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ct_payment_events_customer_idx ON ct_payment_events(customer_id, received_at);
CREATE INDEX IF NOT EXISTS ct_payment_events_employee_idx ON ct_payment_events(employee_code);
