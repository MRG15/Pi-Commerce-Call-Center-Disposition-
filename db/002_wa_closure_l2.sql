BEGIN;

-- Add specific L2 outcomes under Interested → Taken to WhatsApp for closure.
-- Existing calls are not updated; their snapshotted labels remain unchanged.
WITH parent AS (
  SELECT id FROM disposition_nodes
  WHERE code='l1_interested__taken_to_whatsapp_for_closure'
  LIMIT 1
)
INSERT INTO disposition_nodes (code,label,level,parent_id,sort_order,active)
SELECT v.code,v.label,2,parent.id,v.sort_order,TRUE
FROM parent
CROSS JOIN (VALUES
  ('l2_interested__taken_to_whatsapp_for_closure__enrolled_via_whatsapp','Enrolled via WhatsApp',0),
  ('l2_interested__taken_to_whatsapp_for_closure__pi_icon_not_visible_in_p4b','Pi icon not visible in P4B',1),
  ('l2_interested__taken_to_whatsapp_for_closure__blank_non_loading_home_page','Blank / non-loading home page',2),
  ('l2_interested__taken_to_whatsapp_for_closure__facebook_login_failing','Facebook login failing',3),
  ('l2_interested__taken_to_whatsapp_for_closure__no_facebook_business_page','No Facebook business page',4),
  ('l2_interested__taken_to_whatsapp_for_closure__facebook_page_link_failing','Facebook page link failing',5),
  ('l2_interested__taken_to_whatsapp_for_closure__ad_not_being_generated','Ad not being generated',6),
  ('l2_interested__taken_to_whatsapp_for_closure__payment_not_processing','Payment not processing',7),
  ('l2_interested__taken_to_whatsapp_for_closure__creative_not_satisfactory','Creative not satisfactory',8),
  ('l2_interested__taken_to_whatsapp_for_closure__callback_needed','Callback needed',9)
) AS v(code,label,sort_order)
ON CONFLICT (code) DO UPDATE
SET label=EXCLUDED.label,
    parent_id=EXCLUDED.parent_id,
    sort_order=EXCLUDED.sort_order,
    active=TRUE,
    updated_at=now();

-- Retire the old generic option only for future selection. Historical snapshots remain untouched.
UPDATE disposition_nodes
SET active=FALSE, updated_at=now()
WHERE code='l2_interested__taken_to_whatsapp_for_closure__technical_blocker_see_remark';

COMMIT;
