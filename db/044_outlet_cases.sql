-- Outlet cases: a merchant (Cust ID) with several MIDs (outlets) gets one onboarding case per MID, each
-- called, disposed and counted on its own. Only for subscriptions from OUTLETS_FROM (2026-10-25) on;
-- older cases are untouched (mid stays NULL). Additive.
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS mid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_cases_mid_idx ON onboarding_cases(mid) WHERE mid IS NOT NULL;
-- One open case per outlet (was: per Cust ID).
DROP INDEX IF EXISTS onboarding_one_open_case_per_customer_idx;
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_one_open_case_per_outlet_idx
  ON onboarding_cases(customer_id,COALESCE(mid,'')) WHERE current_status='open';
-- Cases CleverTap opened carry the MID of the payment that opened them.
UPDATE onboarding_cases c SET mid=x.mid FROM (
  SELECT DISTINCT ON (e.customer_id) e.customer_id,e.mid FROM ct_payment_events e
  WHERE e.case_action='created' AND e.mid IS NOT NULL ORDER BY e.customer_id,e.event_at
) x
WHERE c.created_by_ct AND c.mid IS NULL AND c.customer_id=x.customer_id
  AND (SELECT count(*) FROM onboarding_cases o WHERE o.customer_id=c.customer_id)=1
  AND NOT EXISTS(SELECT 1 FROM onboarding_cases o WHERE o.mid=x.mid);
