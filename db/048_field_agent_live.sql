-- Onboarding L0 "Ads to be made live by Field Agent (denying CC support)": merchant wants the field
-- agent to make the ad live, not the call centre. Case stays open. Additive.
INSERT INTO onboarding_disposition_nodes(code,label,level,parent_id,active,sort_order)
VALUES('OB_FIELD_AGENT_LIVE','Ads to be made live by Field Agent (denying CC support)',0,NULL,TRUE,25) ON CONFLICT DO NOTHING;
