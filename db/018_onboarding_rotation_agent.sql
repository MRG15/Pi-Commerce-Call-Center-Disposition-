-- Onboarding rotation counts the person the rotation picked for each case, not the current owner,
-- so an admin moving a case away no longer makes the rotation send that person more new cases.
-- Additive only: a new nullable column, filled for cases created since the roster started.
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS rotation_agent_id UUID REFERENCES agents(id);

UPDATE onboarding_cases c SET rotation_agent_id=a.id
FROM onboarding_events e, agents a
WHERE e.onboarding_case_id=c.id
  AND c.rotation_agent_id IS NULL
  AND c.source_type<>'manual_admin'
  AND c.created_at>=(SELECT min(added_at) FROM onboarding_roster)
  AND e.created_at=(SELECT min(created_at) FROM onboarding_events x WHERE x.onboarding_case_id=c.id)
  AND a.name=substring(e.remark FROM '(?:auto-assigned to|Assigned to) ([A-Za-z ]+?)(?: by Sub Raw|:|$)');
