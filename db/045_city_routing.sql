-- Real-time language routing from CleverTap's city (lib/language-routing.ts). A case routed on city is
-- marked so the next Sub Raw sync can check it against the communication address. Additive.
ALTER TABLE onboarding_cases ADD COLUMN IF NOT EXISTS lb_city_routed BOOLEAN NOT NULL DEFAULT FALSE;
