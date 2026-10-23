-- Picom_dnd: merchants marked Not Interested / Refund Requested in the Onboarding or CSM workspace are
-- flagged on their OCL CleverTap profile (identity = Cust ID) so campaigns can exclude them
-- (lib/clevertap-dnd.ts). One row per merchant; status pending -> sent, or failed (retried).
-- app_settings.picom_dnd_enroll = true turns on automatic enrolment (backfill + new dispositions).
-- Additive only.
CREATE TABLE IF NOT EXISTS app_settings(
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS picom_dnd_pushes(
  customer_id TEXT PRIMARY KEY,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS picom_dnd_pushes_status_idx ON picom_dnd_pushes(status);
INSERT INTO app_settings(key,value) VALUES('picom_dnd_enroll','false'::jsonb) ON CONFLICT (key) DO NOTHING;
