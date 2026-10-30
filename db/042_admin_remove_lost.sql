-- Onboarding admins can remove Lost from a Not Interested / Refund case; it reopens for its owner
-- ("Reopened: by admin"). Additive only.
ALTER TABLE onboarding_cases DROP CONSTRAINT IF EXISTS onboarding_cases_reopen_reason_check;
ALTER TABLE onboarding_cases ADD CONSTRAINT onboarding_cases_reopen_reason_check CHECK (reopen_reason IN ('no_ad_ran','ad_failed','callback_requested','refund_callback','admin_removed_lost'));
