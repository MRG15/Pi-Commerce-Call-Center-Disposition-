-- Onboarding: "Revival call" on Lost (Not Interested / Refund) cases. Logged as its own source type
-- (revival_call) so it does not change Touches / Connected; the case stays Lost until an admin removes
-- Lost. Additive only.
ALTER TABLE onboarding_events DROP CONSTRAINT IF EXISTS onboarding_events_source_type_check;
ALTER TABLE onboarding_events ADD CONSTRAINT onboarding_events_source_type_check
  CHECK (source_type IN ('new_event','historical_import','assignment','system','customer_success_followup','revival_call'));
INSERT INTO onboarding_disposition_nodes(code,label,level,parent_id,active,sort_order)
VALUES('OB_REVIVAL_CALL','Revival call',0,NULL,TRUE,980) ON CONFLICT DO NOTHING;
INSERT INTO onboarding_disposition_nodes(code,label,level,parent_id,active,sort_order)
SELECT x.code,x.label,1,p.id,TRUE,x.ord FROM onboarding_disposition_nodes p,
  (VALUES('OB_RV_NOT_CONNECTED','Not connected',10),('OB_RV_STILL_NI','Connected: still not interested',20),
         ('OB_RV_CALLBACK','Connected: callback',30),('OB_RV_AGREED_LIVE','Connected: agreed to go live',40)) x(code,label,ord)
WHERE p.code='OB_REVIVAL_CALL' ON CONFLICT DO NOTHING;
