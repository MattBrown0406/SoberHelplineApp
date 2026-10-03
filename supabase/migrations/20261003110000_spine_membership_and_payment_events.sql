-- Ecosystem Spine (hub/CRM) events from the app: memberships and coaching payments.
--
-- 1. Memberships were only reported for source 'stripe', which nothing writes,
--    so the hub never heard about App Store or website members. They are now
--    reported as a 'membership_started' event when access starts:
--      - App Store (RevenueCat mirror) rows: on insert. The mirror upserts in
--        place on renewal and deletes on lapse, so an insert is a (re)start.
--      - Website-granted rows ('web' mirror, or 'scholarship' with the website
--        marker): on insert, and when membership-import re-grants a row it had
--        expired (update from expired to active).
--      - Staff scholarships and org rows are not paid memberships: not reported.
--    Not a 'payment' event: the hub turns every 'payment' into a Freedom
--    Interventions deal at the payment stage and overwrites the deal amount, and
--    the mirrors carry no amount (a $0 "payment" would zero a real deal). The
--    hub records 'membership_started' (events table, HubSpot contact activity)
--    without touching deals.
--    No double reports: one event per membership even when the website
--    membership is mirrored twice (the app's 'web' row and the website-granted
--    row): a row starting while another active row of the same origin and tier
--    exists is the same membership.
-- 2. Plan-review coaching payments were labelled processor 'stripe' and valued at
--    the booking's list rate. They are PayPal captures on soberhelpline.com (or
--    payments the owner records by hand, source 'manual'): the processor and
--    amount ($150 or the $125 member price) now come from the captured
--    plan_review_payment_events row. The payment id is unchanged
--    ('<booking>_coaching'), so the hub's payment upsert stays idempotent.
-- 3. Every new event carries occurred_at, so a hub retry (5xx after its own
--    write) replays onto the same event row instead of adding a second one,
--    and events without an email (the hub rejects them) are not queued.
-- Re-runnable.

-- Which paid membership an entitlement row is, or NULL when it isn't one.
CREATE OR REPLACE FUNCTION public._spine_membership_origin(p_source text, p_raw jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_source = 'revenuecat' THEN 'app_store'
    WHEN p_source = 'stripe' THEN 'stripe'
    WHEN p_source = 'web' THEN 'website'
    WHEN p_source = 'scholarship' AND jsonb_typeof(p_raw) = 'object'
         AND p_raw->>'granted_by' = 'soberhelpline_website_membership' THEN 'website'
  END
$$;

REVOKE ALL ON FUNCTION public._spine_membership_origin(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._spine_on_entitlement_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origin text := public._spine_membership_origin(NEW.source, NEW.raw);
  v_email text;
  v_name text;
BEGIN
  IF v_origin IS NULL OR NEW.tier NOT IN ('essential', 'premium') THEN RETURN NEW; END IF;
  -- Only access that is active now starts a membership.
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Rolling mirrors refresh in place; only membership-import's re-grant of a
    -- website row it had expired restarts a membership by update.
    IF NEW.source <> 'scholarship' OR v_origin <> 'website'
       OR public._spine_membership_origin(OLD.source, OLD.raw) IS DISTINCT FROM 'website'
       OR OLD.expires_at IS NULL OR OLD.expires_at > now() THEN
      RETURN NEW;
    END IF;
  END IF;
  -- Same membership already active through another row (e.g. the 'web' mirror
  -- and the website-granted row): already reported.
  IF EXISTS (
    SELECT 1 FROM public.entitlements o
    WHERE o.account_id = NEW.account_id
      AND o.id <> NEW.id
      AND o.tier = NEW.tier
      AND (o.expires_at IS NULL OR o.expires_at > now())
      AND public._spine_membership_origin(o.source, o.raw) = v_origin
  ) THEN
    RETURN NEW;
  END IF;

  SELECT u.email,
         nullif(trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), '')
  INTO v_email, v_name
  FROM accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.id = NEW.account_id;
  IF nullif(btrim(v_email), '') IS NULL THEN RETURN NEW; END IF;

  INSERT INTO spine_outbox (event_name, payload)
  VALUES ('membership_started', jsonb_build_object(
    'email',       v_email,
    'name',        v_name,
    'property',    'soberhelpline',
    'occurred_at', clock_timestamp(),
    'props',       jsonb_build_object(
      'tier',       CASE NEW.tier WHEN 'premium' THEN 'premier' ELSE NEW.tier END,
      'source',     v_origin,
      'expires_at', NEW.expires_at
    )
  ));
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._spine_on_entitlement_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS spine_entitlement_insert ON public.entitlements;
DROP TRIGGER IF EXISTS spine_entitlement_reactivated ON public.entitlements;
CREATE TRIGGER spine_entitlement_insert
  AFTER INSERT ON public.entitlements
  FOR EACH ROW EXECUTE FUNCTION public._spine_on_entitlement_change();
CREATE TRIGGER spine_entitlement_reactivated
  AFTER UPDATE OF expires_at ON public.entitlements
  FOR EACH ROW
  WHEN (OLD.expires_at IS DISTINCT FROM NEW.expires_at)
  EXECUTE FUNCTION public._spine_on_entitlement_change();
DROP FUNCTION IF EXISTS public._spine_on_entitlement_insert();

-- Coaching payments: real processor and captured amount.
CREATE OR REPLACE FUNCTION public._spine_on_coaching_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name text;
  v_processor text;
  v_amount integer;
  v_paid_at timestamptz;
BEGIN
  IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
    -- The capture this booking was just marked paid for.
    SELECT e.source, e.amount_cents, coalesce(e.occurred_at, e.received_at)
    INTO v_processor, v_amount, v_paid_at
    FROM plan_review_payment_events e
    WHERE e.coaching_booking_id = NEW.id AND e.payment_status = 'captured'
    ORDER BY e.received_at DESC, e.event_id DESC
    LIMIT 1;

    SELECT u.email,
           nullif(trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), '')
    INTO v_email, v_name
    FROM accounts a
    JOIN auth.users u ON u.id = a.user_id
    WHERE a.id = NEW.account_id;
    IF nullif(btrim(v_email), '') IS NULL THEN RETURN NEW; END IF;

    v_paid_at := coalesce(v_paid_at, clock_timestamp());
    INSERT INTO spine_outbox (event_name, payload)
    VALUES ('payment', jsonb_build_object(
      'email',       v_email,
      'name',        v_name,
      'property',    'soberhelpline',
      'occurred_at', v_paid_at,
      'payment',     jsonb_build_object(
        'id',           NEW.id::text || '_coaching',
        -- 'paypal' (soberhelpline.com checkout) or 'manual' (recorded by the
        -- owner); a booking marked paid with no capture record is manual too.
        'processor',    coalesce(v_processor, 'manual'),
        'amount_cents', coalesce(v_amount, NEW.rate_cents),
        'kind',         'coaching_session',
        'occurred_at',  v_paid_at
      )
    ));
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

-- Account and booking events: stable occurred_at, and nothing the hub would reject.
CREATE OR REPLACE FUNCTION public._spine_on_account_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
  IF nullif(btrim(v_email), '') IS NULL THEN RETURN NEW; END IF;
  INSERT INTO spine_outbox (event_name, payload)
  VALUES ('account_created', jsonb_build_object(
    'email',       v_email,
    'name',        nullif(trim(coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '')), ''),
    'property',    'soberhelpline',
    'occurred_at', NEW.created_at,
    'props',       jsonb_build_object('account_type', NEW.type, 'language', NEW.language)
  ));
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._spine_on_coaching_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name  text;
BEGIN
  SELECT u.email,
         nullif(trim(coalesce(a.first_name, '') || ' ' || coalesce(a.last_name, '')), '')
  INTO v_email, v_name
  FROM accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.id = NEW.account_id;
  IF nullif(btrim(v_email), '') IS NULL THEN RETURN NEW; END IF;

  INSERT INTO spine_outbox (event_name, payload)
  VALUES ('session_booked', jsonb_build_object(
    'email',       v_email,
    'name',        v_name,
    'property',    'soberhelpline',
    'occurred_at', NEW.created_at,
    'props',       jsonb_build_object('booking_id', NEW.id, 'rate_cents', NEW.rate_cents)
  ));
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;
