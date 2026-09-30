-- Subscription plans (from 1 Oct 2026) and seller team roles. Additive only:
-- no existing row or column is changed.

ALTER TABLE calls ADD COLUMN IF NOT EXISTS plan_code TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS plan_amount_inr NUMERIC(12,2);
ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_plan_code_check;
ALTER TABLE calls ADD CONSTRAINT calls_plan_code_check CHECK (plan_code IS NULL OR plan_code IN ('silver','gold','platinum'));

ALTER TABLE onboarding_events ADD COLUMN IF NOT EXISTS plan_code TEXT;
ALTER TABLE onboarding_events ADD COLUMN IF NOT EXISTS plan_amount_inr NUMERIC(12,2);
ALTER TABLE onboarding_events DROP CONSTRAINT IF EXISTS onboarding_events_plan_code_check;
ALTER TABLE onboarding_events ADD CONSTRAINT onboarding_events_plan_code_check CHECK (plan_code IS NULL OR plan_code IN ('silver','gold','platinum'));

-- Seller team structure. One row per change, never edited: the row in force on a date
-- is the latest effective_from on or before it, so changes never re-price earlier weeks.
-- role NONE takes someone off the seller team plan.
CREATE TABLE IF NOT EXISTS seller_roles (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  role TEXT NOT NULL CHECK (role IN ('BDE','SBDE','TL','NONE')),
  team_lead_id UUID REFERENCES agents(id),
  effective_from DATE NOT NULL,
  created_by UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role='BDE' OR team_lead_id IS NULL),
  UNIQUE (agent_id, effective_from)
);
CREATE INDEX IF NOT EXISTS seller_roles_agent_idx ON seller_roles(agent_id, effective_from DESC);

-- Team structure from 1 Oct 2026.
INSERT INTO seller_roles(agent_id,role,effective_from)
SELECT a.id,v.role,'2026-10-01'::date
FROM (VALUES ('sheena','TL'),('umesh','TL'),('deepak','TL'),('rajdeep','SBDE'),('jay','SBDE')) v(username,role)
JOIN agents a ON a.username=v.username
ON CONFLICT (agent_id,effective_from) DO NOTHING;
