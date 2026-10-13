-- WhatsApp nudges sent through the Pi Commerce platform, and "Request a callback" clicks.
--   Seller: Voicemail / Disconnected / Not Connected logged          -> SELLER_NOT_CONNECTED
--   Onboarding: Not Connected logged                                  -> ONB_NOT_CONNECTED
--   CSM (after the daily sync): T1_RENEW, T2_ENDED_FREE, T3_ENDED_TOPUP, T4_ENDING_FREE, T5_ENDING_TOPUP
-- Each message carries a unique token used in the template's "Request a callback" link
-- (/cb/<token>). A click shows up in the workspace's Req Call Back pane. Additive only.
CREATE TABLE IF NOT EXISTS wa_messages (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  template TEXT NOT NULL,
  workspace TEXT NOT NULL CHECK (workspace IN ('seller','onboarding','csm')),
  customer_id TEXT NOT NULL,
  phone TEXT,
  agent_id UUID REFERENCES agents(id),   -- seller: who logged the disposition
  source_ref TEXT,                       -- call / event id that triggered it
  dedupe_key TEXT UNIQUE,                -- CSM: one message per template, merchant and cycle
  variables JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped','baseline')),
  status_note TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  click_count INT NOT NULL DEFAULT 0,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS wa_messages_customer_idx ON wa_messages(customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS wa_messages_open_requests_idx ON wa_messages(workspace,clicked_at) WHERE clicked_at IS NOT NULL AND resolved_at IS NULL;
