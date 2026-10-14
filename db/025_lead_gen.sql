-- Lead Gen Ads: Meta lead-form leads (phone numbers) synced from the lead sheet and shared round
-- robin among sellers switched on for "Lead gen" in Manage Access → Teams → Sales.
-- Dispositions on a lead that has no Cust ID yet are saved against the lead (calls.lead_id +
-- calls.phone, customer_id empty) — a phone number is never stored as a Cust ID. Once the lead's
-- phone shows up in the merchant sync, the lead and its dispositions are linked to that Cust ID.

CREATE TABLE IF NOT EXISTS leadgen_roster(
  agent_id UUID PRIMARY KEY REFERENCES agents(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leadgen_leads(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL CHECK (phone ~ '^[0-9]{10}$'),
  name TEXT,
  submitted_at TIMESTAMPTZ NOT NULL,
  last_submitted_at TIMESTAMPTZ NOT NULL,
  submissions INT NOT NULL DEFAULT 1,
  campaign_name TEXT, adset_name TEXT, ad_name TEXT, form_name TEXT, platform TEXT,
  customer_id TEXT,
  assigned_to UUID REFERENCES agents(id),
  assigned_at TIMESTAMPTZ,
  rotation_agent_id UUID REFERENCES agents(id),
  is_repeat BOOLEAN NOT NULL DEFAULT FALSE,
  already_called BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leadgen_leads_phone_idx ON leadgen_leads(phone,submitted_at DESC);
CREATE INDEX IF NOT EXISTS leadgen_leads_assigned_idx ON leadgen_leads(assigned_to,submitted_at DESC);
CREATE INDEX IF NOT EXISTS leadgen_leads_customer_idx ON leadgen_leads(customer_id);

-- Every Meta lead ID seen in the sheet (the sheet repeats rows), so each is processed once.
CREATE TABLE IF NOT EXISTS leadgen_meta_ids(
  meta_lead_id TEXT PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES leadgen_leads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE calls ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leadgen_leads(id);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS phone TEXT;
DO $$ BEGIN
  ALTER TABLE calls ADD CONSTRAINT calls_customer_or_lead CHECK (customer_id IS NOT NULL OR lead_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS calls_lead_attempt_key ON calls(lead_id,attempt_number) WHERE customer_id IS NULL;
CREATE INDEX IF NOT EXISTS calls_lead_idx ON calls(lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE wa_messages ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE wa_messages ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leadgen_leads(id);
