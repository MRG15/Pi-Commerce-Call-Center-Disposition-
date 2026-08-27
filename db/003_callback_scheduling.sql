BEGIN;

ALTER TABLE calls
ADD COLUMN IF NOT EXISTS callback_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS calls_callback_agent_idx
ON calls (agent_id, callback_at)
WHERE callback_at IS NOT NULL;

COMMIT;
