-- =============================================================================
-- SoberHelplineApp → Ecosystem Spine wiring
-- Mirrors the Freedom Interventions outbox pattern: triggers write to
-- spine_outbox, the drain-spine-outbox function forwards to the hub every 5m.
-- Errors in triggers NEVER block the user action (EXCEPTION handlers swallow).
-- =============================================================================

-- ─── Outbox table ─────────────────────────────────────────────────────────────

CREATE TABLE spine_outbox (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_name  text        NOT NULL,
  payload     jsonb       NOT NULL DEFAULT '{}',
  status      text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed')),
  attempts    int         NOT NULL DEFAULT 0,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX spine_outbox_pending_idx ON spine_outbox (status, created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE spine_outbox ENABLE ROW LEVEL SECURITY;
GRANT ALL ON spine_outbox TO service_role;

-- ─── Trigger: account_created ─────────────────────────────────────────────────
-- Fires when accounts row is created (immediately after auth signup trigger).
-- Looks up email from auth.users since accounts table doesn't store it.

CREATE OR REPLACE FUNCTION _spine_on_account_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
  INSERT INTO spine_outbox (event_name, payload)
  VALUES ('account_created', jsonb_build_object(
    'email',    v_email,
    'name',     nullif(trim(coalesce(NEW.first_name,'') || ' ' || coalesce(NEW.last_name,'')), ''),
    'property', 'soberhelpline',
    'props',    jsonb_build_object('account_type', NEW.type, 'language', NEW.language)
  ));
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

CREATE TRIGGER spine_account_insert
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION _spine_on_account_insert();

-- ─── Trigger: session_booked (coaching requested) ─────────────────────────────

CREATE OR REPLACE FUNCTION _spine_on_coaching_insert()
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
         nullif(trim(coalesce(a.first_name,'') || ' ' || coalesce(a.last_name,'')), '')
  INTO v_email, v_name
  FROM accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.id = NEW.account_id;

  INSERT INTO spine_outbox (event_name, payload)
  VALUES ('session_booked', jsonb_build_object(
    'email',    v_email,
    'name',     v_name,
    'property', 'soberhelpline',
    'props',    jsonb_build_object('booking_id', NEW.id, 'rate_cents', NEW.rate_cents)
  ));
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

CREATE TRIGGER spine_coaching_insert
  AFTER INSERT ON coaching_bookings
  FOR EACH ROW EXECUTE FUNCTION _spine_on_coaching_insert();

-- ─── Trigger: payment (coaching session paid) ─────────────────────────────────

CREATE OR REPLACE FUNCTION _spine_on_coaching_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_name  text;
BEGIN
  IF NEW.payment_status = 'paid' AND OLD.payment_status <> 'paid' THEN
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
        'id',           NEW.id::text || '_coaching',
        'processor',    'stripe',
        'amount_cents', NEW.rate_cents,
        'kind',         'coaching_session'
      )
    ));
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

CREATE TRIGGER spine_coaching_payment
  AFTER UPDATE ON coaching_bookings
  FOR EACH ROW EXECUTE FUNCTION _spine_on_coaching_payment();

-- ─── Trigger: payment (subscription entitlement granted) ─────────────────────
-- Only fires for paid sources (revenuecat, stripe); skips org/scholarship.

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
  IF NEW.source NOT IN ('revenuecat', 'stripe') THEN RETURN NEW; END IF;

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

CREATE TRIGGER spine_entitlement_insert
  AFTER INSERT ON entitlements
  FOR EACH ROW EXECUTE FUNCTION _spine_on_entitlement_insert();

-- ─── Schedule drain every 5 minutes ──────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

SELECT cron.schedule(
  'shl-drain-spine-outbox',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/drain-spine-outbox',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
      )
    ),
    body    := jsonb_build_object('source', 'pg_cron', 'job', 'shl-drain-spine-outbox')
  );
  $$
);
