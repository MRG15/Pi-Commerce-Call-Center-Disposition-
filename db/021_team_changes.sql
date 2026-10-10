-- Team membership by date (Sales / Onboarding / CSM). Each row is a change from effective_from:
-- joining (member=true) or leaving (member=false), and whether the person earns that team's
-- incentive. The row in force on a date is the latest one on or before it, so earlier days are
-- never re-priced. Workspace access follows a change once its date arrives (applied_at).
-- The Sales role (BDE / SBDE / TL) stays in seller_roles. Additive only.
CREATE TABLE IF NOT EXISTS team_changes (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  team TEXT NOT NULL CHECK (team IN ('sales','onboarding','csm')),
  effective_from DATE NOT NULL,
  member BOOLEAN NOT NULL,
  incentive BOOLEAN NOT NULL DEFAULT TRUE,
  applied_at TIMESTAMPTZ,
  created_by UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, team, effective_from)
);
CREATE INDEX IF NOT EXISTS team_changes_pending_idx ON team_changes(effective_from) WHERE applied_at IS NULL;

-- Starting state, matching how incentives were paid so far (the onboarder / CSM list in code)
-- plus Satyendra in CSM from 9 Oct 2026. Seed rows are marked applied: access is already set.
INSERT INTO team_changes(agent_id,team,effective_from,member,incentive,applied_at)
SELECT a.id,x.team,x.d::date,TRUE,x.inc,now()
FROM (VALUES
  ('Ashish','onboarding','2026-09-01',TRUE),('Dhruv','onboarding','2026-09-01',TRUE),
  ('Priyanshi','onboarding','2026-09-01',TRUE),('Abhishek','onboarding','2026-09-01',TRUE),
  ('Kunal','csm','2026-09-01',TRUE),('Satyendra','csm','2026-10-09',TRUE),
  ('Akash Kumar','onboarding','2026-09-01',FALSE),('Aman Kumar','onboarding','2026-09-01',FALSE),
  ('Aryan Thakur','onboarding','2026-09-01',FALSE),('Dhruv Bansal','onboarding','2026-09-01',FALSE),
  ('Harsh Shrivastava','onboarding','2026-09-01',FALSE),('Praveen Pandey','onboarding','2026-09-01',FALSE),
  ('Rohit Sharma','onboarding','2026-09-01',FALSE),('Sachin Kumar','onboarding','2026-09-01',FALSE)
) AS x(name,team,d,inc)
JOIN agents a ON a.name=x.name
ON CONFLICT (agent_id,team,effective_from) DO NOTHING;

-- Sales team follows the dated seller roles (NONE = left the team).
INSERT INTO team_changes(agent_id,team,effective_from,member,incentive,applied_at)
SELECT r.agent_id,'sales',r.effective_from,r.role<>'NONE',TRUE,now() FROM seller_roles r
ON CONFLICT (agent_id,team,effective_from) DO NOTHING;
