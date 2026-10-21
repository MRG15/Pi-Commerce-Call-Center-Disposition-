-- Failure reason from the tracker's meta_failed_ads tab (matched on Ads ID), shown on the onboarding case. Additive only.
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS ad_fail_reason TEXT;
