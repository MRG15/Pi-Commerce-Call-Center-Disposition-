-- Failure reason from the tracker's meta_failed_ads tab (matched on Ads ID), shown on the onboarding case. Additive only.
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS ad_fail_reason TEXT;
-- Conversations are matched on Ads ID (Onboardings_Updated_List Ad_ID). Additive only.
CREATE INDEX IF NOT EXISTS ad_conversions_ad_id_idx ON ad_conversions(ad_id);
