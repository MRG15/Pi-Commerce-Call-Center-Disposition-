-- Language barrier routing. Onboarders ticked "Language" in Teams (onboarding_lb_roster) get:
--   - new cases whose Sub Raw communication address is in a southern state (except Maharashtra),
--     moved to them once at the Sub Raw sync (onboarding_cases.lb_routed_at marks the one move)
--   - cases tagged Language Barrier, moved to them and evened out among them by the 8:30 AM rebalance
-- sub_state / sub_south come from Sub Raw's communication address. Additive only.
CREATE TABLE IF NOT EXISTS onboarding_lb_roster(
  agent_id UUID PRIMARY KEY REFERENCES agents(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS sub_state TEXT;
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS sub_south BOOLEAN;
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS lb_routed_at TIMESTAMPTZ;
