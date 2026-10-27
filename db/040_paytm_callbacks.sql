-- Paytm callback requests ("Request a callback" on Paytm workflow pages), synced from the Merchant
-- Callback Request sheet every 3 hours. Each request is a wa_messages row (template PAYTM_CALLBACK,
-- status 'skipped': no WhatsApp is sent) so it shows in the team's Req Call Back pane. This table
-- records every sheet request ID seen, so a re-sync never adds or bumps a request twice. Additive only.
CREATE TABLE IF NOT EXISTS paytm_callback_ids(
  request_id TEXT PRIMARY KEY,
  wa_message_id BIGINT REFERENCES wa_messages(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
