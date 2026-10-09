-- PPSL CleverTap identifies merchants by MID. Payment events may carry the MID (with or without
-- the Cust ID); the portal maps MID -> Cust ID where it knows it. Additive only.
ALTER TABLE ct_payment_events ADD COLUMN IF NOT EXISTS mid TEXT;
ALTER TABLE ct_payment_events ALTER COLUMN customer_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS ct_payment_events_mid_idx ON ct_payment_events(mid);
