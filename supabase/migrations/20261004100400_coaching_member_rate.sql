-- Coaching requests record the member price, and membership export includes
-- active provider-organization members. Re-runnable.
--
-- 1. The app tells paying members (Essential, Premier, active provider org) a
--    1:1 coaching call is $125, but a manual request (book-coaching →
--    coaching_bookings) was forced to rate_cents = 15000 by the insert policy,
--    so Matt's email, the hub's session_booked event and a manual "paid" mark
--    all said $150. The server now sets the rate from membership on every
--    member insert (has_active_textline_access — the same rule the app and
--    create-plan-review-checkout use), ignoring whatever the client sent.
--    Server-created plan-review records keep the rate they set (the checkout
--    quotes the actual price).
-- 2. service_membership_export reported only entitlement rows, so a member
--    of an active provider organization (accounts.type = 'attached') was
--    missing from the website's member list even though validate-sso-token
--    treats her as a member. She is now exported as tier 'org'.

-- ── 1. Member coaching rate ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._coaching_booking_member_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only a member's own request through the API. SECURITY DEFINER server
  -- code (plan-review records) runs as the function owner and keeps its rate.
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.rate_cents := CASE WHEN public.has_active_textline_access(NEW.account_id) THEN 12500 ELSE 15000 END;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._coaching_booking_member_rate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS coaching_bookings_member_rate ON public.coaching_bookings;
CREATE TRIGGER coaching_bookings_member_rate
  BEFORE INSERT ON public.coaching_bookings
  FOR EACH ROW EXECUTE FUNCTION public._coaching_booking_member_rate();

DROP POLICY IF EXISTS "coaching_bookings: owner insert" ON public.coaching_bookings;
CREATE POLICY "coaching_bookings: owner insert" ON public.coaching_bookings FOR INSERT TO authenticated
  WITH CHECK (
    account_id = public.my_account_id()
    AND status = 'requested'
    AND payment_status = 'unpaid'
    AND rate_cents IN (12500, 15000)
    AND scheduled_at IS NULL
    AND zoom_url IS NULL
  );

-- ── 2. Provider-organization members in the export ───────────────────────────
CREATE OR REPLACE FUNCTION public.service_membership_export(p_after uuid DEFAULT NULL, p_limit integer DEFAULT 1000)
RETURNS TABLE(account_id uuid, email text, tier text, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH qualifying AS (
    SELECT e.account_id, e.tier, e.expires_at
    FROM public.entitlements e
    WHERE e.tier IN ('essential', 'premium', 'org')
      AND e.source <> 'web'
      AND coalesce(e.raw->>'granted_by', '') <> 'soberhelpline_website_membership'
      AND (e.expires_at IS NULL OR e.expires_at > now())
      AND (p_after IS NULL OR e.account_id > p_after)
    UNION ALL
    -- Attached to an active provider organization (no expiry while active).
    SELECT a.id, 'org', NULL::timestamptz
    FROM public.accounts a
    JOIN public.orgs o ON o.id = a.org_id
    WHERE a.type = 'attached'
      AND o.status = 'active'
      AND (p_after IS NULL OR a.id > p_after)
  ),
  per_account AS (
    SELECT q.account_id,
           max(CASE q.tier WHEN 'premium' THEN 3 WHEN 'org' THEN 2 ELSE 1 END) AS rank,
           CASE WHEN bool_or(q.expires_at IS NULL) THEN NULL ELSE max(q.expires_at) END AS expires_at
    FROM qualifying q
    GROUP BY q.account_id
  )
  SELECT p.account_id,
         lower(btrim(u.email::text)),
         CASE p.rank WHEN 3 THEN 'premier' WHEN 2 THEN 'org' ELSE 'essential' END,
         p.expires_at
  FROM per_account p
  JOIN public.accounts a ON a.id = p.account_id
  JOIN auth.users u ON u.id = a.user_id
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND nullif(btrim(u.email::text), '') IS NOT NULL
  ORDER BY p.account_id
  LIMIT least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.service_membership_export(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_membership_export(uuid, integer) TO service_role;
