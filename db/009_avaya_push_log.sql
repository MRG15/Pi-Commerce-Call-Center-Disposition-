-- Records when a customer was last sent to the Avaya dialer (used by POST /api/check-lead).
-- Already present in production; kept here so the schema files match.
CREATE TABLE IF NOT EXISTS avaya_push_log (
  customer_id TEXT PRIMARY KEY,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
