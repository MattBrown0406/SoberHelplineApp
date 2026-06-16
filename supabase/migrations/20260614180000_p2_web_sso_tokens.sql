-- =============================================================================
-- Web SSO tokens
-- Short-lived (5 min), single-use tokens the mobile app creates so a
-- subscriber can open soberhelpline.com paywalled pages without a separate login.
-- The website validates these server-side using the service role key.
-- =============================================================================

CREATE TABLE web_sso_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE web_sso_tokens ENABLE ROW LEVEL SECURITY;

-- App users can create tokens for themselves only; no read/update/delete policy
-- (validation is done server-side on soberhelpline.com using the service role key)
CREATE POLICY "web_sso_tokens: owner insert"
  ON web_sso_tokens FOR INSERT
  WITH CHECK (account_id = my_account_id());
