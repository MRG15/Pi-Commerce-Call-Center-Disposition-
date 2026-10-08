-- Onboarding auto-assignment roster: new cases (seller handoff, Sub Raw sync, admin "auto
-- assign") are shared equally among these people. Existing cases are not moved.
CREATE TABLE IF NOT EXISTS onboarding_roster (
  agent_id UUID PRIMARY KEY REFERENCES agents(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO onboarding_roster(agent_id)
SELECT a.id FROM agents a WHERE a.username IN ('priyanshi','dhruv','ashish')
ON CONFLICT (agent_id) DO NOTHING;
