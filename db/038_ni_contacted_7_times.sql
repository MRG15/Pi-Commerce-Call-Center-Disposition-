-- Onboarding: Not Interested -> "Contacted 7 times" (L1). Onboarding workspace only; the CSM disposition
-- list leaves it out (app/api/csm/dispositions). Additive only.
INSERT INTO onboarding_disposition_nodes(code,label,level,parent_id,active,sort_order)
SELECT 'OB_NI_CONTACTED_7_TIMES','Contacted 7 times',1,id,TRUE,45 FROM onboarding_disposition_nodes WHERE code='OB_NOT_INTERESTED'
ON CONFLICT DO NOTHING;
