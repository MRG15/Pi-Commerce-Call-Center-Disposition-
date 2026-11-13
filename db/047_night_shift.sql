-- Night shift: onboarders ticked "Night shift" in Teams get new onboarding cases created from 7 PM to
-- 9 AM IST, in their own round robin (lib/onboarding.ts). Additive.
CREATE TABLE IF NOT EXISTS onboarding_night_roster(
  agent_id UUID PRIMARY KEY REFERENCES agents(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
