-- Meta ad ID per AdsRun Raw row (matches the Ad performance analysis sheet's ad_id). Additive only.
ALTER TABLE merchant_ads ADD COLUMN IF NOT EXISTS ad_id TEXT;
CREATE INDEX IF NOT EXISTS merchant_ads_ad_id_idx ON merchant_ads(ad_id);
