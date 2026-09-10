-- Onboarding workspace V1. Additive migration only: existing seller calls and attribution are untouched.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS workspace_access (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  workspace TEXT NOT NULL CHECK (workspace IN ('seller','onboarding')),
  access_level TEXT NOT NULL CHECK (access_level IN ('agent','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, workspace)
);
CREATE INDEX IF NOT EXISTS workspace_access_workspace_idx ON workspace_access(workspace, access_level);

-- Preserve today's seller permissions when the new model is introduced.
INSERT INTO workspace_access(agent_id, workspace, access_level)
SELECT id, 'seller', CASE WHEN role='admin' THEN 'admin' ELSE 'agent' END
FROM agents
ON CONFLICT (agent_id, workspace) DO NOTHING;

CREATE TABLE IF NOT EXISTS onboarding_disposition_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  level SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 2),
  parent_id UUID REFERENCES onboarding_disposition_nodes(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onboarding_disposition_parent_idx ON onboarding_disposition_nodes(parent_id, sort_order);

CREATE TABLE IF NOT EXISTS onboarding_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  source_type TEXT NOT NULL CHECK (source_type IN ('seller_handoff','manual_admin','historical_import')),
  source_seller_call_id UUID REFERENCES calls(id),
  source_seller_agent_id UUID REFERENCES agents(id),
  source_seller_disposition TEXT,
  sale_date DATE,
  assigned_to UUID REFERENCES agents(id),
  assigned_at TIMESTAMPTZ,
  current_l0 TEXT,
  current_l1 TEXT,
  current_l2 TEXT,
  current_status TEXT NOT NULL DEFAULT 'open' CHECK (current_status IN ('open','ads_live','lost','closed')),
  next_callback_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  ads_live_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_one_open_case_per_customer_idx
  ON onboarding_cases(customer_id)
  WHERE current_status='open';
CREATE INDEX IF NOT EXISTS onboarding_cases_assignee_idx ON onboarding_cases(assigned_to, current_status, next_callback_at);
CREATE INDEX IF NOT EXISTS onboarding_cases_customer_idx ON onboarding_cases(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_case_id UUID NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  attempt_number INTEGER NOT NULL,
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_date DATE NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  agent_id UUID REFERENCES agents(id),
  agent_name_raw TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('new_event','historical_import','assignment','system')),
  source_sheet TEXT,
  source_row INTEGER,
  source_call_num TEXT,
  l0_code TEXT,
  l1_code TEXT,
  l2_code TEXT,
  l0_label_snapshot TEXT,
  l1_label_snapshot TEXT,
  l2_label_snapshot TEXT,
  remark TEXT,
  callback_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(onboarding_case_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS onboarding_events_case_idx ON onboarding_events(onboarding_case_id, attempt_number);
CREATE INDEX IF NOT EXISTS onboarding_events_agent_idx ON onboarding_events(agent_id, event_time);
CREATE INDEX IF NOT EXISTS onboarding_events_callback_idx ON onboarding_events(agent_id, callback_at) WHERE callback_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS technical_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_case_id UUID NOT NULL REFERENCES onboarding_cases(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  issue_code TEXT,
  issue_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  opened_by UUID REFERENCES agents(id),
  assigned_to UUID REFERENCES agents(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by UUID REFERENCES agents(id),
  resolved_at TIMESTAMPTZ,
  latest_remark TEXT,
  source_type TEXT NOT NULL DEFAULT 'new_event' CHECK (source_type IN ('new_event','historical_import')),
  source_sheet TEXT,
  source_row INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS technical_cases_open_idx ON technical_cases(assigned_to, status, opened_at);
CREATE INDEX IF NOT EXISTS technical_cases_customer_idx ON technical_cases(customer_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS access_audit_log (
  id BIGSERIAL PRIMARY KEY,
  target_agent_id UUID NOT NULL REFERENCES agents(id),
  changed_by UUID NOT NULL REFERENCES agents(id),
  previous_access JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_access JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- V1 onboarding taxonomy.
WITH l0 AS (
  INSERT INTO onboarding_disposition_nodes(code,label,level,sort_order) VALUES
    ('OB_IN_PROCESS','In Process',0,10),
    ('OB_NOT_CONNECTED','Not Connected',0,20),
    ('OB_NOT_INTERESTED_REFUND','Not Interested / Refund',0,30),
    ('OB_ADS_LIVE','Ads Live',0,40)
  ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, active=TRUE, sort_order=EXCLUDED.sort_order
  RETURNING id,code
)
SELECT 1;

INSERT INTO onboarding_disposition_nodes(code,label,level,parent_id,sort_order)
SELECT x.code,x.label,1,p.id,x.sort_order
FROM (VALUES
  ('OB_CALLBACK','Callback',10),
  ('OB_TECHNICAL','Technical Issue',20),
  ('OB_FB_LINKING','Facebook linking',30),
  ('OB_AD_SETUP','Ad setup',40),
  ('OB_OTHER_PROCESS','Other',50)
) x(code,label,sort_order)
JOIN onboarding_disposition_nodes p ON p.code='OB_IN_PROCESS'
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label,parent_id=EXCLUDED.parent_id,active=TRUE,sort_order=EXCLUDED.sort_order;

INSERT INTO onboarding_disposition_nodes(code,label,level,parent_id,sort_order)
SELECT x.code,x.label,2,p.id,x.sort_order
FROM (VALUES
  ('OB_TECH_ACCOUNT_LOAD','We Could Not Load Your Account',10),
  ('OB_TECH_CAMPAIGN_START','Campaign / ad could not start',20),
  ('OB_TECH_AD_ACCOUNT_RESTRICTED','Ad account restricted',30),
  ('OB_TECH_PAGE_NOT_ELIGIBLE','Page not eligible',40),
  ('OB_TECH_PAGE_NOT_FOUND','Page not found',50),
  ('OB_TECH_FB_LOGIN','Facebook login issue',60),
  ('OB_TECH_WHITE_SCREEN','White screen / linking issue',70),
  ('OB_TECH_WABA_MISSING','WABA number missing',80),
  ('OB_TECH_LOW_BALANCE','Low balance / payment issue',90),
  ('OB_TECH_SUBSCRIPTION','Subscription issue',100),
  ('OB_TECH_AD_CREATE','Unable to create ad',110),
  ('OB_TECH_OTHER','Other technical issue',120)
) x(code,label,sort_order)
JOIN onboarding_disposition_nodes p ON p.code='OB_TECHNICAL'
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label,parent_id=EXCLUDED.parent_id,active=TRUE,sort_order=EXCLUDED.sort_order;
