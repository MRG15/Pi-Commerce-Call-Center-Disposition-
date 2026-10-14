-- Phone lookups on merchant_information (Lead Gen linking every 5 minutes, Seller search by phone)
-- used to scan all ~40k rows per phone (2.8 s per lead sync); this index makes them instant.
CREATE INDEX IF NOT EXISTS merchant_information_phone10_idx ON merchant_information ((right(regexp_replace(COALESCE(phone_number,''),'[^0-9]','','g'),10))) WHERE active=TRUE;
