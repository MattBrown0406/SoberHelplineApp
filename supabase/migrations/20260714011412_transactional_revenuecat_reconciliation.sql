-- Reconcile the RevenueCat mirror atomically so a failed insert cannot erase
-- previously valid access.
CREATE OR REPLACE FUNCTION public.reconcile_revenuecat_entitlements(
  p_account_id uuid,
  p_entitlements jsonb
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tiers text[];
BEGIN
  IF p_account_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'account_not_found';
  END IF;
  IF p_entitlements IS NULL OR jsonb_typeof(p_entitlements) <> 'object' THEN
    RAISE EXCEPTION 'invalid_entitlements';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_entitlements) AS key
    WHERE key NOT IN ('essential','premium')
  ) THEN
    RAISE EXCEPTION 'invalid_entitlement_tier';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_each_text(p_entitlements) AS item(tier, expires_at)
    WHERE item.expires_at::timestamptz <= now()
  ) THEN
    RAISE EXCEPTION 'inactive_entitlement';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text, 82731));

  DELETE FROM public.entitlements
   WHERE account_id = p_account_id AND source = 'revenuecat';

  INSERT INTO public.entitlements(account_id, source, tier, expires_at, raw)
  SELECT
    p_account_id,
    'revenuecat',
    item.tier,
    item.expires_at::timestamptz,
    jsonb_build_object('checked_at', now(), 'rc_expires', item.expires_at)
  FROM jsonb_each_text(p_entitlements) AS item(tier, expires_at);

  SELECT COALESCE(array_agg(item.tier ORDER BY item.tier), '{}'::text[])
    INTO v_tiers
  FROM jsonb_each_text(p_entitlements) AS item(tier, expires_at);
  RETURN v_tiers;
EXCEPTION
  WHEN invalid_datetime_format THEN
    RAISE EXCEPTION 'invalid_entitlement_expiry';
END
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_revenuecat_entitlements(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_revenuecat_entitlements(uuid,jsonb) TO service_role;
