-- CSM buckets from Sub Raw, per-call bucket tagging, and the onboarding Language Barrier tile.
-- Additive only: new nullable columns and one new disposition option.

-- Sub Raw fields the CSM queues use (filled by scripts/csm-sync.gs).
ALTER TABLE merchant_subscriptions ADD COLUMN IF NOT EXISTS check_sub_status TEXT;
ALTER TABLE merchant_subscriptions ADD COLUMN IF NOT EXISTS cancelled_at DATE;
ALTER TABLE merchant_subscriptions ADD COLUMN IF NOT EXISTS expected_renewal_due_date DATE;
ALTER TABLE merchant_subscriptions ADD COLUMN IF NOT EXISTS renewal_date DATE;
ALTER TABLE merchant_subscriptions ADD COLUMN IF NOT EXISTS completed_ads_count INTEGER;
ALTER TABLE merchant_subscriptions ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(14,2);

-- The CSM bucket a merchant was in when the call was logged (for bucket metrics).
ALTER TABLE onboarding_events ADD COLUMN IF NOT EXISTS csm_bucket TEXT;

-- Onboarding: cases flagged as Language Barrier (by the new option, or tagged from remarks).
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS language_barrier_at TIMESTAMPTZ;

INSERT INTO onboarding_disposition_nodes(code,label,level,parent_id,sort_order)
SELECT 'OB_LANGUAGE_BARRIER','Language Barrier',1,p.id,90 FROM onboarding_disposition_nodes p WHERE p.code='OB_IN_PROCESS'
ON CONFLICT (code) DO NOTHING;
