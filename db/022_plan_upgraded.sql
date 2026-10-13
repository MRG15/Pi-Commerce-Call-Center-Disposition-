-- Plan Upgraded: a new L0 in the Seller, Onboarding and CSM workspaces. The agent picks a higher
-- plan than the merchant's current one; the upgrade value (new plan price minus current plan
-- price, ₹799 for the legacy plan) counts for incentives. Additive only.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS upgrade_from_plan TEXT CHECK (upgrade_from_plan IN ('legacy','silver','gold'));
ALTER TABLE calls ADD COLUMN IF NOT EXISTS upgrade_value_inr NUMERIC(14,2);
ALTER TABLE onboarding_events ADD COLUMN IF NOT EXISTS upgrade_from_plan TEXT CHECK (upgrade_from_plan IN ('legacy','silver','gold'));
ALTER TABLE onboarding_events ADD COLUMN IF NOT EXISTS upgrade_value_inr NUMERIC(14,2);

INSERT INTO disposition_nodes(code,label,level,parent_id,sort_order,active)
VALUES('l0_plan_upgraded','Plan Upgraded',0,NULL,8,TRUE) ON CONFLICT (code) DO NOTHING;
INSERT INTO onboarding_disposition_nodes(code,label,level,sort_order)
VALUES('OB_PLAN_UPGRADED','Plan Upgraded',0,36) ON CONFLICT (code) DO NOTHING;

-- Kunal's 12 Oct "Subscription Renewed – Silver" for 468785048 was an upgrade from the ₹799 plan.
UPDATE onboarding_events SET l0_code='OB_PLAN_UPGRADED',l0_label_snapshot='Plan Upgraded',upgrade_from_plan='legacy',upgrade_value_inr=1200
WHERE customer_id='468785048' AND l0_code='OB_SUBS_RENEWED' AND plan_code='silver' AND event_date='2026-10-12';
