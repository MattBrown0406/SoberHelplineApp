-- =============================================================================
-- P3 — Engagement push: session reminders, win-back, community support hearts
--
-- Tables:  push_outbox (queued pushes, drained by send-engagement-push),
--          community_supports (❤️ "send support" on community posts — reaction
--          only, no free text, so no new moderation surface)
-- RPCs:    support_community_post (member-only, security definer),
--          get_winback_push_targets (service-side selection for win-back)
-- Crons:   drain outbox every 5 min; Monday-group reminder 1h before the call;
--          daily win-back sweep.
-- =============================================================================

-- ─── Win-back bookkeeping ────────────────────────────────────────────────────
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_winback_at timestamptz;

-- ─── Push outbox ─────────────────────────────────────────────────────────────
-- Service-role only: enqueued by triggers/RPCs, drained by the edge function.
CREATE TABLE push_outbox (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind       text        NOT NULL,
  title      text        NOT NULL,
  body       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz
);

CREATE INDEX push_outbox_unsent_idx ON push_outbox (created_at) WHERE sent_at IS NULL;

ALTER TABLE push_outbox ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) touches this table.

-- ─── Community support hearts ────────────────────────────────────────────────
ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS support_count int NOT NULL DEFAULT 0;

CREATE TABLE community_supports (
  post_id              uuid        NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  supporter_account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, supporter_account_id)
);

ALTER TABLE community_supports ENABLE ROW LEVEL SECURITY;

-- Members can see their own hearts (to render the filled state). Writes go
-- through the RPC only.
CREATE POLICY "community_supports: own select" ON community_supports FOR SELECT
  USING (supporter_account_id = my_account_id());

-- One tap = one heart. Bumps the denormalized count and queues a push for the
-- post author ("someone responded to you" is the strongest return trigger a
-- community has). Never notifies for self-hearts.
CREATE OR REPLACE FUNCTION support_community_post(p_post_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
  v_author  uuid;
  v_count   int;
  v_inserted boolean := false;
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT account_id INTO v_author
  FROM community_posts
  WHERE id = p_post_id AND status = 'visible';
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  INSERT INTO community_supports (post_id, supporter_account_id)
  VALUES (p_post_id, v_account)
  ON CONFLICT DO NOTHING;
  v_inserted := FOUND;

  IF v_inserted THEN
    UPDATE community_posts
    SET support_count = support_count + 1
    WHERE id = p_post_id
    RETURNING support_count INTO v_count;

    IF v_author <> v_account THEN
      INSERT INTO push_outbox (account_id, kind, title, body)
      VALUES (
        v_author,
        'community_support',
        'Someone sent you support 💙',
        'A family member responded to your post in the community. You are not alone in this.'
      );
    END IF;
  ELSE
    SELECT support_count INTO v_count FROM community_posts WHERE id = p_post_id;
  END IF;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION support_community_post(uuid) TO authenticated;

-- ─── Win-back target selection ───────────────────────────────────────────────
-- Accounts with a push token, no check-in for 5+ days, not nudged in the last
-- 7 days, and old enough that silence means lapsed rather than brand-new.
CREATE OR REPLACE FUNCTION get_winback_push_targets()
RETURNS TABLE(account_id uuid, first_name text, push_token text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.first_name, a.push_token
  FROM accounts a
  WHERE a.push_token IS NOT NULL
    AND a.created_at < now() - interval '5 days'
    AND (a.last_winback_at IS NULL OR a.last_winback_at < now() - interval '7 days')
    AND NOT EXISTS (
      SELECT 1 FROM checkins c
      WHERE c.account_id = a.id
        AND c.created_at > now() - interval '5 days'
    );
$$;

CREATE OR REPLACE FUNCTION mark_winback_sent(p_account_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE accounts SET last_winback_at = now() WHERE id = ANY(p_account_ids);
$$;

-- ─── Cron schedules ──────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Drain queued pushes (community hearts etc.) every 5 minutes.
SELECT cron.schedule(
  'shl-push-drain',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/send-engagement-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
      )
    ),
    body    := jsonb_build_object('job', 'drain')
  );
  $$
);

-- Monday-group reminder ~1 hour before the 7 PM PT call.
-- pg_cron runs in UTC: Tue 01:00 UTC = Mon 6:00 PM PDT (5:00 PM PST in winter —
-- still a sensible reminder window).
SELECT cron.schedule(
  'shl-session-reminder',
  '0 1 * * 2',
  $$
  SELECT net.http_post(
    url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/send-engagement-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
      )
    ),
    body    := jsonb_build_object('job', 'session_reminder')
  );
  $$
);

-- Daily win-back sweep at 17:00 UTC (~10 AM PT).
SELECT cron.schedule(
  'shl-winback',
  '0 17 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/send-engagement-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
      )
    ),
    body    := jsonb_build_object('job', 'winback')
  );
  $$
);
