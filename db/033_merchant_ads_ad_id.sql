-- "Ads ID" per AdsRun Raw row (header Ads ID; the tracker's own ID, not the Meta ad ID). Additive only.
ALTER TABLE merchant_ads ADD COLUMN IF NOT EXISTS ad_id TEXT;
CREATE INDEX IF NOT EXISTS merchant_ads_ad_id_idx ON merchant_ads(ad_id);
