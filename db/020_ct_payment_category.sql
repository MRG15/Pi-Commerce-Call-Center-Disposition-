-- Category and action of each CT payment as CT sent them, so subscription payments can be told
-- apart from top-ups and other payments (now and when top-ups are tracked later). Additive only.
ALTER TABLE ct_payment_events ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE ct_payment_events ADD COLUMN IF NOT EXISTS action TEXT;
UPDATE ct_payment_events SET category=lower(raw->>'category'),action=lower(raw->>'action') WHERE category IS NULL;
