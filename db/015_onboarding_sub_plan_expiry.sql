-- Onboarding: subscription plan (name and amount) and expiry on each case, filled by the daily
-- Sub Raw onboarding sync and shown in the case pane. Additive only: new nullable columns.
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS sub_plan_name TEXT;
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS sub_plan_amount NUMERIC(14,2);
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS sub_expiry_date DATE;
