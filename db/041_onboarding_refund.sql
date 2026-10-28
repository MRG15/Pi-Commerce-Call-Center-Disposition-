-- Onboarding admins: "Refunded (no contact)". Logged on a closed (Not Interested) case to record a refund
-- of the merchant's plan amount; it sends the picommerce_refund WhatsApp ("Get ad setup" = Request a
-- callback, to the case owner; tapping it reopens the case). The case status is not changed. Additive only.
INSERT INTO onboarding_disposition_nodes(code,label,level,parent_id,active,sort_order)
VALUES('OB_REFUND_PROCESSED','Refunded (no contact)',0,NULL,TRUE,990)
ON CONFLICT DO NOTHING;
ALTER TABLE onboarding_events ADD COLUMN IF NOT EXISTS refund_amount_inr NUMERIC(14,2);
ALTER TABLE onboarding_cases DROP CONSTRAINT IF EXISTS onboarding_cases_reopen_reason_check;
ALTER TABLE onboarding_cases ADD CONSTRAINT onboarding_cases_reopen_reason_check CHECK (reopen_reason IN ('no_ad_ran','ad_failed','callback_requested','refund_callback'));
