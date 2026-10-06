-- Seller workspace: "Not Connected" L0 (no sub-options). Counted as not connected in analytics
-- (lib/status.ts NON_CONNECTED). Additive; existing dispositions are unchanged.
INSERT INTO disposition_nodes(code,label,level,parent_id,sort_order)
VALUES ('l0_not_connected','Not Connected',0,NULL,7)
ON CONFLICT (code) DO NOTHING;
