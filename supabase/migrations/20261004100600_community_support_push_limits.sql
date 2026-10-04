-- "Someone sent you support 💙" — fewer, kinder pushes. Re-runnable.
--
-- Every new supporter queued its own push, at any hour, with no expiry: a
-- post that drew twenty hearts overnight woke its author twenty times, and a
-- member she had blocked could still reach her this way. Now:
--   * at most one support push per post per day (her day: the idempotency key
--     is community-support:<post id>:<her local date>);
--   * never for a supporter she has blocked (member_blocks, 20261004100100);
--   * only 9 AM–9 PM in her own time zone (accounts.timezone): a heart sent at
--     night is queued for 9 AM and is never shown after 9 PM that day
--     (dispatcher_outbox_delivery re-checks both, 20261004100200);
--   * not queued at all when she has no device to receive it.
-- Supporting itself is unchanged for the supporter: the heart is always
-- recorded and the new count returned, whether or not a push is queued.

CREATE OR REPLACE FUNCTION public.support_community_post(p_post_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account  uuid := my_account_id();
  v_author   uuid;
  v_locale   text;
  v_token    text;
  v_tz       text;
  v_local    timestamp;
  v_send_at  timestamptz;
  v_day      date;
  v_count    int;
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

  IF NOT v_inserted THEN
    SELECT support_count INTO v_count FROM community_posts WHERE id = p_post_id;
    RETURN v_count;
  END IF;

  UPDATE community_posts
  SET support_count = support_count + 1
  WHERE id = p_post_id
  RETURNING support_count INTO v_count;

  IF v_author = v_account
     OR EXISTS (SELECT 1 FROM member_blocks b
                WHERE b.blocker_account_id = v_author AND b.blocked_account_id = v_account) THEN
    RETURN v_count;
  END IF;

  SELECT locale, push_token, _invitation_valid_tz(timezone)
  INTO v_locale, v_token, v_tz
  FROM accounts WHERE id = v_author;
  IF nullif(v_token, '') IS NULL THEN
    RETURN v_count;
  END IF;

  -- 9 AM–9 PM her time; a heart sent at night waits for 9 AM.
  v_tz := coalesce(v_tz, 'UTC');
  v_local := now() AT TIME ZONE v_tz;
  v_send_at := CASE
    WHEN v_local::time < time '09:00' THEN (v_local::date + time '09:00') AT TIME ZONE v_tz
    WHEN v_local::time >= time '21:00' THEN ((v_local::date + 1) + time '09:00') AT TIME ZONE v_tz
    ELSE now()
  END;
  v_day := (v_send_at AT TIME ZONE v_tz)::date;

  INSERT INTO push_outbox (account_id, kind, title, body, metadata, idempotency_key, scheduled_for, expires_at)
  VALUES (
    v_author,
    'community_support',
    CASE WHEN v_locale LIKE 'es%' THEN 'Alguien te envió apoyo 💙' ELSE 'Someone sent you support 💙' END,
    CASE WHEN v_locale LIKE 'es%'
      THEN 'Una familia respondió a tu publicación en la comunidad. No estás sola en esto.'
      ELSE 'A family member responded to your post in the community. You are not alone in this.'
    END,
    jsonb_build_object('kind', 'community_support', 'post_id', p_post_id),
    'community-support:' || p_post_id::text || ':' || v_day::text,
    v_send_at,
    (v_day + time '21:00') AT TIME ZONE v_tz
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.support_community_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_community_post(uuid) TO authenticated;
