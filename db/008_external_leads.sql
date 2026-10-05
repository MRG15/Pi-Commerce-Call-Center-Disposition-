-- Leads added by sellers for people who are not yet in the Paytm merchant list.
-- Additive only. The customer also gets a normal customers row so search, history and
-- dispositions work exactly as for any other customer.
CREATE TABLE IF NOT EXISTS external_leads (
  customer_id TEXT PRIMARY KEY REFERENCES customers(customer_id),
  name TEXT,
  phone TEXT,
  added_by UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS external_leads_added_by_idx ON external_leads(added_by, created_at DESC);
