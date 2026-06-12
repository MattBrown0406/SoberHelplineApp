-- =============================================================================
-- P0 entitlements table
-- Tracks the source of a user's subscription or org access.
-- AccountContext resolves accountState from this table at login.
-- =============================================================================

CREATE TABLE entitlements (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source      text        NOT NULL CHECK (source IN ('revenuecat', 'stripe', 'org', 'scholarship')),
  tier        text        NOT NULL CHECK (tier IN ('essential', 'premium', 'org')),
  expires_at  timestamptz,
  raw         jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;

-- Users can read their own entitlement rows (write is server-side only)
CREATE POLICY "entitlements: owner select"
  ON entitlements FOR SELECT
  USING (account_id = my_account_id());
