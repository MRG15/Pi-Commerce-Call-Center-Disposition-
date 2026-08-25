CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customers (
  customer_id TEXT PRIMARY KEY,
  merchant_name TEXT,
  phone TEXT,
  category TEXT,
  sub_category TEXT,
  funnel_stage TEXT,
  contact_priority TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent','admin')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_agent_idx ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS disposition_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  level SMALLINT NOT NULL CHECK (level BETWEEN 0 AND 2),
  parent_id UUID REFERENCES disposition_nodes(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disposition_parent_idx ON disposition_nodes(parent_id, sort_order);

CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  attempt_number INTEGER NOT NULL,
  call_date DATE NOT NULL,
  call_seq INTEGER NOT NULL DEFAULT 1,
  event_time TIMESTAMPTZ,
  agent_id UUID REFERENCES agents(id),
  agent_name_raw TEXT,

  source_type TEXT NOT NULL CHECK (source_type IN ('standard_call','legacy_followup','new_call')),
  source_sheet TEXT,
  source_row INTEGER,
  source_call_num TEXT,
  source_key TEXT NOT NULL UNIQUE,

  status_raw TEXT,
  status_normalized TEXT,
  what_happened TEXT,
  remark TEXT,

  l0_id UUID REFERENCES disposition_nodes(id),
  l1_id UUID REFERENCES disposition_nodes(id),
  l2_id UUID REFERENCES disposition_nodes(id),
  l0_label_snapshot TEXT,
  l1_label_snapshot TEXT,
  l2_label_snapshot TEXT,

  facebook_page_status TEXT,
  whatsapp_handoff BOOLEAN,
  call_duration_seconds INTEGER,

  is_legacy BOOLEAN NOT NULL DEFAULT TRUE,
  is_conversion_authoritative BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(customer_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS calls_customer_idx ON calls(customer_id, call_date, call_seq);
CREATE INDEX IF NOT EXISTS calls_date_idx ON calls(call_date);
CREATE INDEX IF NOT EXISTS calls_agent_idx ON calls(agent_id);
CREATE INDEX IF NOT EXISTS calls_source_type_idx ON calls(source_type);
CREATE INDEX IF NOT EXISTS calls_l0_idx ON calls(l0_id);

CREATE TABLE IF NOT EXISTS customer_legacy_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  call_over_wa TEXT,
  entry_point_issue TEXT,
  insights_issue TEXT,
  fb_linking_issue TEXT,
  ads_creative_issue TEXT,
  payment_issue TEXT,
  wants_visit TEXT,
  wants_sample_over_wa TEXT,
  fb_page_linking_pending TEXT,
  legacy_total_touches TEXT,
  legacy_last_contact TEXT,
  legacy_current_status TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_sheet, source_row)
);
CREATE INDEX IF NOT EXISTS legacy_flags_customer_idx ON customer_legacy_flags(customer_id);

CREATE TABLE IF NOT EXISTS technical_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT REFERENCES customers(customer_id),
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  raw_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_sheet, source_row)
);

CREATE TABLE IF NOT EXISTS tracking_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT REFERENCES customers(customer_id),
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  raw_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_sheet, source_row)
);
