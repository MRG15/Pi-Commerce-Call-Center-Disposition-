-- Onboarding: Sub Raw fields on each case (filled by the daily Sub Raw onboarding sync) for the
-- subscription pills, credits / subscribed-date / stage sorting and the stage filter; and a
-- reopened flag for cases the sync sends back to Open (no ad ran, or the ad failed).
-- Additive only: new nullable columns and a new table.
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS sub_status TEXT;
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS sub_cancelled_at DATE;
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS sub_credits NUMERIC(14,2);
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS last_completed_stage TEXT;
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS sub_synced_at TIMESTAMPTZ;
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS reopen_reason TEXT CHECK (reopen_reason IN ('no_ad_ran','ad_failed'));

-- Order of onboarding stages (Sub Raw last_completed_stage), lowest rank = earliest stage.
-- Stages not listed sort after the listed ones.
CREATE TABLE IF NOT EXISTS onboarding_stage_order (
  stage TEXT PRIMARY KEY,
  rank INTEGER NOT NULL
);
