-- When the Lead Gen leads were last re-checked against the merchant phones of this merchant sync
-- (once per sync; the 5-minute lead sync does it if the merchant sync couldn't). Additive only.
ALTER TABLE merchant_sync_runs ADD COLUMN IF NOT EXISTS leads_linked_at TIMESTAMPTZ;
