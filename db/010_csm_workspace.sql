-- CSM workspace: post-live upsell for merchants whose ads have gone live.
-- Additive: one CHECK constraint is widened to allow the new 'csm' workspace; every other
-- statement creates new tables or rows. No existing row is changed.

ALTER TABLE workspace_access DROP CONSTRAINT IF EXISTS workspace_access_workspace_check;
ALTER TABLE workspace_access ADD CONSTRAINT workspace_access_workspace_check CHECK (workspace IN ('seller','onboarding','csm'));

-- Daily snapshot of the SMB Daily Tracker (Sub Raw + AdsRun Raw), pushed by Apps Script.
-- Rows belong to a sync run; the app only reads the latest completed run, so a failed or
-- partial sync never replaces good data.
CREATE TABLE IF NOT EXISTS csm_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','complete','failed')),
  subs_rows INTEGER NOT NULL DEFAULT 0,
  ads_rows INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  note TEXT
);

CREATE TABLE IF NOT EXISTS merchant_subscriptions (
  sync_run_id BIGINT NOT NULL REFERENCES csm_sync_runs(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL,
  merchant_name TEXT,
  phone_number TEXT,
  category TEXT,
  sub_category TEXT,
  mcc TEXT,
  sub_first_date DATE,
  PRIMARY KEY (sync_run_id, customer_id)
);

CREATE TABLE IF NOT EXISTS merchant_ads (
  id BIGSERIAL PRIMARY KEY,
  sync_run_id BIGINT NOT NULL REFERENCES csm_sync_runs(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  client_id TEXT,
  mid TEXT,
  merchant_name TEXT,
  phone_number TEXT,
  category TEXT,
  sub_category TEXT,
  onboarded_date DATE,
  creative_name TEXT,
  description TEXT,
  ad_status TEXT NOT NULL,
  budget NUMERIC(12,2),
  start_date DATE,
  end_date DATE,
  impressions NUMERIC(14,2),
  clicks NUMERIC(14,2),
  ctr NUMERIC(10,4),
  reach NUMERIC(14,2),
  spend NUMERIC(14,2),
  source_row INTEGER
);
CREATE INDEX IF NOT EXISTS merchant_ads_run_customer_idx ON merchant_ads(sync_run_id, customer_id);

-- Which CSM owns which merchant. New merchants are allocated by weight (round robin).
CREATE TABLE IF NOT EXISTS csm_assignments (
  customer_id TEXT PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  method TEXT NOT NULL DEFAULT 'auto' CHECK (method IN ('auto','manual')),
  assigned_by UUID REFERENCES agents(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS csm_assignments_agent_idx ON csm_assignments(agent_id);

CREATE TABLE IF NOT EXISTS csm_weights (
  agent_id UUID PRIMARY KEY REFERENCES agents(id),
  weight INTEGER NOT NULL CHECK (weight >= 0),
  updated_by UUID REFERENCES agents(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin pitch notes and imported sheet remarks, newest shown first. Never edited, only added.
CREATE TABLE IF NOT EXISTS csm_notes (
  id BIGSERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pitch','sheet_remark')),
  note TEXT NOT NULL,
  note_date DATE NOT NULL,
  author_id UUID REFERENCES agents(id),
  author_name TEXT,
  source TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('portal','sheet_import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS csm_notes_customer_idx ON csm_notes(customer_id, kind, note_date DESC, id DESC);

-- Starting team: Kunal and Abhishek as CSM agents (50 / 50), Nausheen as CSM admin.
INSERT INTO workspace_access(agent_id,workspace,access_level)
SELECT a.id,'csm',v.level FROM (VALUES ('kunal','agent'),('abhishek','agent'),('nausheen','admin')) v(username,level)
JOIN agents a ON a.username=v.username
ON CONFLICT (agent_id,workspace) DO NOTHING;

INSERT INTO csm_weights(agent_id,weight)
SELECT a.id,50 FROM agents a WHERE a.username IN ('kunal','abhishek')
ON CONFLICT (agent_id) DO NOTHING;
