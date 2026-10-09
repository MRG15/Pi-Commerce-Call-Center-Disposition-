-- Calls to the CT payment webhook that were refused (missing or wrong secret, bad JSON), so a
-- CT setup problem can be seen instead of guessed. The secret itself is never stored.
CREATE TABLE IF NOT EXISTS ct_webhook_rejects (
  id BIGSERIAL PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL,          -- missing_secret / wrong_secret / invalid_json
  body_excerpt TEXT              -- first 2000 characters of the request body
);
