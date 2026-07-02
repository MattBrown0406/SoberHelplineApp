-- =============================================================================
-- Web membership bridge: members who subscribed on soberhelpline.com ($14.99
-- family membership) get the Essential tier in the app without buying the IAP
-- again (App Store 3.1.3(b) — access acquired elsewhere may be unlocked).
--
-- The sync-web-membership edge function verifies the app user, asks the
-- website whether their email has an active family membership, and maintains
-- a source='web' entitlement row here. AccountContext already honors
-- entitlements ahead of RevenueCat.
-- =============================================================================

ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_source_check;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_source_check
  CHECK (source IN ('revenuecat', 'stripe', 'org', 'scholarship', 'web'));
