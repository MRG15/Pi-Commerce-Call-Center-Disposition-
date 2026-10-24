-- Picom_dnd can be cleared: want is the value to hold in CleverTap (true = DND). A merchant who leaves
-- the Not Interested / Refund bucket (e.g. a lost case reopened) is pushed false. Additive only.
ALTER TABLE picom_dnd_pushes ADD COLUMN IF NOT EXISTS want BOOLEAN NOT NULL DEFAULT TRUE;
