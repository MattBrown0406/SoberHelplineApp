-- Free tier: coupon codes + source tracking on entitlements

-- Track where an entitlement came from (coupon code, manual, etc.)
ALTER TABLE entitlements ADD COLUMN IF NOT EXISTS source text;

-- Coupon codes table — only accessible via SECURITY DEFINER RPC
CREATE TABLE IF NOT EXISTS coupon_codes (
  code       text PRIMARY KEY,
  tier       text NOT NULL DEFAULT 'essential',
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coupon_codes ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT policies: only the RPC below can touch this table

-- Redeem a coupon code and grant the corresponding entitlement tier
CREATE OR REPLACE FUNCTION redeem_coupon(p_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier       text;
  v_account_id uuid;
BEGIN
  SELECT tier INTO v_tier
  FROM coupon_codes
  WHERE code = upper(trim(p_code)) AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_coupon';
  END IF;

  SELECT id INTO v_account_id
  FROM accounts
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_account';
  END IF;

  -- Don't downgrade a premium subscriber
  IF EXISTS (
    SELECT 1 FROM entitlements
    WHERE account_id = v_account_id
      AND tier = 'premium'
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC
    LIMIT 1
  ) THEN
    RAISE EXCEPTION 'already_premium';
  END IF;

  INSERT INTO entitlements (account_id, tier, source, created_at)
  VALUES (v_account_id, v_tier, 'coupon:' || upper(trim(p_code)), now());

  RETURN v_tier;
END;
$$;
