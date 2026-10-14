-- Conversions per ad from the "Ad performance analysis" sheet (data tab: customer_id, ad_id, ad_name,
-- conversations), shown in the CSM workspace after Reach. The sheet is "as on" its last update, so
-- each push overwrites the numbers for the ads it contains.
CREATE TABLE IF NOT EXISTS ad_conversions(
  customer_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  conversions NUMERIC,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id,ad_id)
);
CREATE INDEX IF NOT EXISTS ad_conversions_name_idx ON ad_conversions(customer_id,lower(btrim(ad_name)));
