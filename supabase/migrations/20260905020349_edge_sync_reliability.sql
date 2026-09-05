-- Stable identities for access mirrors, not processor transactions.
DELETE FROM public.entitlements e USING (
 SELECT id,row_number() OVER (PARTITION BY account_id,source,tier ORDER BY expires_at DESC NULLS LAST,created_at,id) n
 FROM public.entitlements WHERE source IN ('web','revenuecat')
) d WHERE e.id=d.id AND d.n>1;
CREATE UNIQUE INDEX entitlements_mirror_identity ON public.entitlements(account_id,source,tier)
 WHERE source IN ('web','revenuecat');
-- Service-only web reconciliation: validation + replacement is one transaction.
CREATE FUNCTION public.reconcile_web_membership(p_account_id uuid, p_membership jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member boolean;
BEGIN
  IF jsonb_typeof(p_membership) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_membership->'isMember') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'invalid_membership';
  END IF;
  v_member := (p_membership->>'isMember')::boolean;
  -- Same account lock namespace as RevenueCat reconciliation.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text, 82731));
  PERFORM 1 FROM public.accounts WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account_not_found'; END IF;
  DELETE FROM public.entitlements WHERE account_id=p_account_id AND source='web'
    AND (NOT v_member OR tier <> 'essential');
  IF v_member THEN
    INSERT INTO public.entitlements(account_id, source, tier, expires_at, raw)
    VALUES (p_account_id, 'web', 'essential', now() + interval '35 days',
      jsonb_build_object('checked_at', now(), 'email', p_membership->>'email'))
    ON CONFLICT (account_id,source,tier) WHERE source IN ('web','revenuecat')
    DO UPDATE SET expires_at=EXCLUDED.expires_at,raw=EXCLUDED.raw
    WHERE entitlements.expires_at < now()+interval '34 days'
       OR entitlements.expires_at IS NULL
       OR entitlements.raw->>'email' IS DISTINCT FROM EXCLUDED.raw->>'email';
  END IF;
  RETURN v_member;
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_web_membership(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_web_membership(uuid,jsonb) TO service_role;

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
    WHERE item.expires_at IS NULL OR item.expires_at::timestamptz <= now() OR NOT isfinite(item.expires_at::timestamptz)
  ) THEN
    RAISE EXCEPTION 'inactive_entitlement';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text, 82731));

  DELETE FROM public.entitlements
   WHERE account_id = p_account_id AND source = 'revenuecat' AND NOT (p_entitlements ? tier);

  INSERT INTO public.entitlements(account_id, source, tier, expires_at, raw)
  SELECT
    p_account_id,
    'revenuecat',
    item.tier,
    item.expires_at::timestamptz,
    jsonb_build_object('checked_at', now(), 'rc_expires', item.expires_at)
  FROM jsonb_each_text(p_entitlements) AS item(tier, expires_at)
  ON CONFLICT (account_id,source,tier) WHERE source IN ('web','revenuecat')
  DO UPDATE SET expires_at=EXCLUDED.expires_at,raw=EXCLUDED.raw
  WHERE entitlements.expires_at IS DISTINCT FROM EXCLUDED.expires_at;

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

-- RC mirrors have no payment identity/amount: preserve Stripe and coaching only.
CREATE OR REPLACE FUNCTION _spine_on_entitlement_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name  text;
BEGIN
  IF NEW.source <> 'stripe' THEN RETURN NEW; END IF;

  SELECT u.email,
         nullif(trim(coalesce(a.first_name,'') || ' ' || coalesce(a.last_name,'')), '')
  INTO v_email, v_name
  FROM accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.id = NEW.account_id;

  INSERT INTO spine_outbox (event_name, payload)
  VALUES ('payment', jsonb_build_object(
    'email',    v_email,
    'name',     v_name,
    'property', 'soberhelpline',
    'payment',  jsonb_build_object(
      'id',           NEW.id::text,
      'processor',    NEW.source,
      'amount_cents', 0,
      'kind',         NEW.tier
    )
  ));
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

-- Keep the existing status contract; a pending/failed row can have an active lease.
ALTER TABLE public.spine_outbox ADD COLUMN lease_token uuid,
  ADD COLUMN lease_expires_at timestamptz;

-- Claim ONE just before sending, not a batch whose leases expire while queued.
-- Attempts are incremented here, including worker crashes. Expired final attempts
-- remain failed and cannot be re-claimed.
CREATE FUNCTION public.claim_spine_outbox()
RETURNS SETOF public.spine_outbox
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH candidate AS (
    SELECT id FROM public.spine_outbox
    WHERE status IN ('pending', 'failed') AND attempts < 6
      AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
    ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE public.spine_outbox o SET
    status = 'failed', attempts = o.attempts + 1,
    last_error = 'delivery claimed; completion pending',
    lease_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '60 seconds'
  FROM candidate c WHERE o.id = c.id RETURNING o.*;
$$;
CREATE FUNCTION public.complete_spine_outbox(p_id bigint, p_token uuid, p_sent boolean, p_error text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_sent IS NULL THEN RAISE EXCEPTION 'invalid_completion'; END IF;
  UPDATE public.spine_outbox SET
    status = CASE WHEN p_sent THEN 'sent' ELSE 'failed' END,
    sent_at = CASE WHEN p_sent THEN clock_timestamp() ELSE NULL END,
    last_error = CASE WHEN p_sent THEN NULL ELSE left(p_error, 500) END,
    lease_token = NULL,
    -- Back off failures to the next drain rather than retry six times in one run.
    lease_expires_at = CASE WHEN p_sent THEN NULL ELSE clock_timestamp() + interval '5 minutes' END
  WHERE id = p_id AND lease_token = p_token AND lease_expires_at > clock_timestamp()
    AND status = 'failed';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_spine_outbox() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_spine_outbox(bigint,uuid,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_spine_outbox() TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_spine_outbox(bigint,uuid,boolean,text) TO service_role;
