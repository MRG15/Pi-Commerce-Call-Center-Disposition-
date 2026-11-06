-- Outlet names per MID from the merchant sync (Onboardings_Updated_List), so an outlet case shows its
-- own name ("Pizza Wings Udaipur") instead of the one name kept per Cust ID. Additive.
CREATE TABLE IF NOT EXISTS merchant_outlets(
  mid TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  merchant_name TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
