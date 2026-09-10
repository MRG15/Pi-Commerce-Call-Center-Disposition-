-- Additive onboarding revenue actions. Existing seller and onboarding history remain untouched.

ALTER TABLE onboarding_events
  ADD COLUMN IF NOT EXISTS top_up_amount_inr NUMERIC(12,2);

ALTER TABLE onboarding_events
  DROP CONSTRAINT IF EXISTS onboarding_events_top_up_amount_nonnegative;
ALTER TABLE onboarding_events
  ADD CONSTRAINT onboarding_events_top_up_amount_nonnegative
  CHECK (top_up_amount_inr IS NULL OR top_up_amount_inr >= 0);

INSERT INTO onboarding_disposition_nodes(code,label,level,sort_order)
VALUES ('OB_SUBS_RENEWED','Subscription Renewed',0,35)
ON CONFLICT (code) DO UPDATE
SET label=EXCLUDED.label, active=TRUE, sort_order=EXCLUDED.sort_order;
