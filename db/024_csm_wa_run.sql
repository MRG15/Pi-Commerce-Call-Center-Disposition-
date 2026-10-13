-- Which CSM WhatsApp templates were live when a snapshot was processed (see ensureCsmWaRun).
ALTER TABLE csm_sync_runs ADD COLUMN IF NOT EXISTS wa_templates TEXT;
