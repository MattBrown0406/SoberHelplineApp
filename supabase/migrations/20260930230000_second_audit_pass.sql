-- =============================================================================
-- Second audit pass.
--
-- 1. record_wall_wavering: "Keep it private" still flipped the member's
--    family-visible commitment to 'wavering', so every relative saw it.
-- 2. Access through a provider (attached accounts) survived the provider's
--    suspension indefinitely; it now requires an active org.
-- 3. Plan-review payments: a capture arriving after the session was cancelled,
--    or a second capture on a paid session, was silently accepted, and
--    refunding the duplicate cancelled the session the first capture paid
--    for. Such captures are recorded, flagged, and the owners alerted; a
--    refund only cancels when no unrefunded capture remains. Cancelling a paid
--    one-off also alerts the owners that a refund may be owed.
-- 4. A private video session left 'live' (coach never pressed Complete)
--    blocked the member from ever booking again; it is closed after 4 hours.
-- 5. Community reports reached no one until three members flagged a post;
--    each new report now alerts the admins.
-- 6. Win-back pushes follow the member's daily-reminder consent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_wall_wavering(p_shared_wall_id uuid, p_share_with_family boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_space_id uuid;
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'not_authenticated';
  END IF;

  SELECT a.id INTO v_account_id
  FROM public.accounts AS a
  WHERE a.user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'account_not_found';
  END IF;

  SELECT sw.family_space_id INTO v_space_id
  FROM public.shared_walls sw
  WHERE sw.id = p_shared_wall_id;

  IF v_space_id IS NULL OR NOT public.is_family_member(v_space_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_family_member';
  END IF;

  -- "Keep it private" must stay private: only a shared wavering changes the
  -- family-visible commitment. The private event is readable by its author only.
  IF coalesce(p_share_with_family, false) THEN
    INSERT INTO public.wall_commitments (shared_wall_id, account_id, status)
    VALUES (p_shared_wall_id, v_account_id, 'wavering')
    ON CONFLICT (shared_wall_id, account_id) DO UPDATE
      SET status = 'wavering', updated_at = now();
  END IF;

  INSERT INTO public.wavering_events (
    shared_wall_id, account_id, shared_with_family, coach_pinged
  )
  VALUES (
    p_shared_wall_id, v_account_id, coalesce(p_share_with_family, false), false
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.record_wall_wavering(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_wall_wavering(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_active_textline_access(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p_account_id
      AND (
        (
        a.type = 'attached'
        AND EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = a.org_id AND o.status = 'active')
      )
        OR EXISTS (
          SELECT 1
          FROM public.entitlements e
          WHERE e.account_id = p_account_id
            AND e.tier IN ('essential', 'premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR public.is_admin_jwt()
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.has_active_private_video_access(p_account_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p_account_id
      AND (
        (
        a.type = 'attached'
        AND EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = a.org_id AND o.status = 'active')
      )
        OR EXISTS (
          SELECT 1
          FROM public.entitlements e
          WHERE e.account_id = p_account_id
            AND e.tier IN ('premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR public.is_admin_jwt()
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.apply_plan_review_payment_event(p_event_id text, p_session_id uuid, p_order_id text, p_capture_id text, p_status text, p_amount_cents integer, p_currency text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_session video_sessions; v_existing plan_review_payment_events; v_new_payment text;
  v_refund_owed boolean := false;
BEGIN
 IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF p_event_id IS NULL OR length(p_event_id) NOT BETWEEN 10 AND 255
    OR p_order_id IS NULL OR length(p_order_id) NOT BETWEEN 5 AND 255
    OR p_capture_id IS NULL OR length(p_capture_id) NOT BETWEEN 5 AND 255
    OR p_status NOT IN ('captured','refunded','reversed','failed')
    OR p_amount_cents<>15000 OR p_currency<>'USD'
    OR (p_occurred_at IS NOT NULL AND p_occurred_at>now()+interval '5 minutes') THEN
   RAISE EXCEPTION 'invalid_payment_event';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id, 53917));
 SELECT * INTO v_existing FROM plan_review_payment_events WHERE event_id=p_event_id;
 IF FOUND THEN
   IF v_existing.session_id<>p_session_id OR v_existing.paypal_order_id<>p_order_id
      OR v_existing.paypal_capture_id<>p_capture_id OR v_existing.payment_status<>p_status
      OR v_existing.amount_cents<>p_amount_cents OR v_existing.currency<>p_currency THEN
     RAISE EXCEPTION 'event_conflict';
   END IF;
   RETURN jsonb_build_object('duplicate',true,'status',v_existing.payment_status);
 END IF;

 SELECT * INTO v_session FROM video_sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND OR v_session.booking_purpose<>'plan_review' OR v_session.appointment_type<>'one_off_150'
    OR v_session.coaching_booking_id IS NULL THEN RAISE EXCEPTION 'session_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM plan_review_payment_events e WHERE e.payment_status='captured'
           AND (e.paypal_capture_id=p_capture_id OR e.paypal_order_id=p_order_id) AND e.session_id<>p_session_id) THEN
   RAISE EXCEPTION 'capture_conflict';
 END IF;
 IF p_status='captured' THEN
   IF v_session.payment_status NOT IN ('pending_payment','paid','refunded') THEN RAISE EXCEPTION 'invalid_payment_transition'; END IF;
   -- The money moved, so record it; but a capture for a session that is no
   -- longer active, already refunded, or already paid by another capture is
   -- owed back.
   v_refund_owed := v_session.status NOT IN ('requested','scheduled','live')
     OR v_session.payment_status = 'refunded'
     OR EXISTS(SELECT 1 FROM plan_review_payment_events e
               WHERE e.session_id=p_session_id AND e.payment_status='captured'
                 AND e.paypal_capture_id<>p_capture_id
                 AND NOT EXISTS(SELECT 1 FROM plan_review_payment_events r
                                WHERE r.paypal_capture_id=e.paypal_capture_id
                                  AND r.payment_status IN ('refunded','reversed')));
   v_new_payment:='paid';
 ELSIF p_status IN ('refunded','reversed') THEN
   IF NOT EXISTS(SELECT 1 FROM plan_review_payment_events e WHERE e.session_id=p_session_id
                 AND e.paypal_capture_id=p_capture_id AND e.payment_status='captured') THEN
     RAISE EXCEPTION 'invalid_payment_transition';
   END IF;
   -- Refunding a duplicate capture must not cancel the session the other
   -- capture still pays for.
   v_new_payment:=CASE WHEN EXISTS(
       SELECT 1 FROM plan_review_payment_events e
       WHERE e.session_id=p_session_id AND e.payment_status='captured'
         AND e.paypal_capture_id<>p_capture_id
         AND NOT EXISTS(SELECT 1 FROM plan_review_payment_events r
                        WHERE r.paypal_capture_id=e.paypal_capture_id
                          AND r.payment_status IN ('refunded','reversed')))
     THEN 'paid' ELSE 'refunded' END;
 ELSE
   IF v_session.payment_status='paid' THEN RAISE EXCEPTION 'invalid_payment_transition'; END IF;
   -- A failed attempt after a refund is recorded but must not make a
   -- refunded (cancelled) session read as awaiting payment again.
   v_new_payment:=CASE WHEN v_session.payment_status='refunded' THEN 'refunded' ELSE 'pending_payment' END;
 END IF;
 INSERT INTO plan_review_payment_events(event_id,session_id,coaching_booking_id,paypal_order_id,paypal_capture_id,
   payment_status,amount_cents,currency,occurred_at)
 VALUES(p_event_id,p_session_id,v_session.coaching_booking_id,p_order_id,p_capture_id,p_status,p_amount_cents,p_currency,p_occurred_at);
 UPDATE coaching_bookings SET payment_status=CASE WHEN v_new_payment='paid' THEN 'paid' WHEN v_new_payment='refunded' THEN 'refunded' ELSE 'unpaid' END
 WHERE id=v_session.coaching_booking_id;
 UPDATE video_sessions SET payment_status=v_new_payment,version=version+1 WHERE id=p_session_id RETURNING * INTO v_session;
 PERFORM _video_event(v_session,NULL,'system',CASE WHEN p_status='captured' THEN 'payment_verified' ELSE 'payment_'||p_status END,
   v_session.status,jsonb_build_object('event_id',p_event_id,'order_id',p_order_id,'capture_id',p_capture_id,'refund_owed',v_refund_owed));
 IF v_refund_owed THEN
   INSERT INTO public.push_outbox (account_id, kind, title, body, metadata)
    SELECT r.account_id, 'admin_refund_owed', '💳 Plan review refund owed', 'A $150 plan-review payment arrived for a session that was cancelled or already paid. Refund it in PayPal.',
           jsonb_build_object('kind', 'admin_refund_owed', 'session_id', p_session_id)
    FROM public.video_staff_roles r
    WHERE r.role = 'owner' AND r.active;
 END IF;
 RETURN jsonb_build_object('duplicate',false,'status',p_status,'refund_owed',v_refund_owed);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'capture_conflict';
END $function$
;

REVOKE EXECUTE ON FUNCTION public.apply_plan_review_payment_event(text, uuid, text, text, text, integer, text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._video_cancel(p_session_id uuid, p_expected_version integer, p_actor uuid, p_role text, p_reason text)
 RETURNS video_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row video_sessions; v_old text;
BEGIN
 SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF; PERFORM _video_assert_version(v_row.version,p_expected_version); IF v_row.status NOT IN ('requested','scheduled') THEN RAISE EXCEPTION 'invalid_transition'; END IF; v_old:=v_row.status;
 UPDATE video_session_proposals SET status='superseded',responded_at=now() WHERE session_id=v_row.id AND status='pending';
 UPDATE video_sessions SET status='cancelled',cancelled_at=now(),ended_at=COALESCE(ended_at,now()),archived_at=now(),cancelled_by_account_id=p_actor,cancellation_reason=NULLIF(btrim(p_reason),''),calendar_sync_status=CASE WHEN calendar_event_id IS NULL THEN 'cancelled' ELSE 'pending' END,calendar_sync_error=NULL,version=version+1 WHERE id=v_row.id RETURNING * INTO v_row;
 PERFORM _video_event(v_row,p_actor,p_role,'cancelled',v_old,jsonb_build_object('reason',p_reason));
 -- A paid one-off plan review that is cancelled is owed a refund; nobody else
 -- is told (no coach may be assigned yet), so alert the owners.
 IF v_row.appointment_type='one_off_150' AND v_row.payment_status='paid' THEN
   INSERT INTO public.push_outbox (account_id, kind, title, body, metadata)
    SELECT r.account_id, 'admin_refund_owed', '💳 Plan review refund owed', 'A paid $150 plan review was cancelled. Review it in Admin and refund it in PayPal if owed.',
           jsonb_build_object('kind', 'admin_refund_owed', 'session_id', v_row.id)
    FROM public.video_staff_roles r
    WHERE r.role = 'owner' AND r.active;
 END IF;
 RETURN v_row;
END $function$
;

REVOKE EXECUTE ON FUNCTION public._video_cancel(uuid, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.report_community_post(p_post_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account uuid := my_account_id();
  v_count   int;
  v_new     int;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;

  INSERT INTO community_reports (post_id, reporter_account_id, reason)
  VALUES (p_post_id, v_account, nullif(btrim(p_reason), ''))
  ON CONFLICT (post_id, reporter_account_id) DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;

  -- Every new report reaches an admin; the 3-report hold is only a backstop.
  IF v_new > 0 THEN
    INSERT INTO push_outbox (account_id, kind, title, body, metadata)
    SELECT a.id, 'admin_community_report', '🚩 Community post reported',
           'A member reported a community post. Please review it.',
           jsonb_build_object('kind', 'admin_community_report', 'post_id', p_post_id)
    FROM accounts a
    JOIN auth.users u ON u.id = a.user_id
    WHERE lower(coalesce(u.email, '')) = ANY (admin_email_list())
      AND a.push_token IS NOT NULL;
  END IF;

  UPDATE community_posts
  SET report_count = (SELECT count(*) FROM community_reports WHERE post_id = p_post_id)
  WHERE id = p_post_id
  RETURNING report_count INTO v_count;

  -- Hold the post pending admin review once enough members flag it.
  IF v_count >= 3 THEN
    UPDATE community_posts SET status = 'held'
    WHERE id = p_post_id AND status = 'visible';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_winback_push_targets()
 RETURNS TABLE(account_id uuid, first_name text, push_token text, locale text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT a.id, a.first_name, a.push_token, a.locale
  FROM accounts a
  WHERE a.push_token IS NOT NULL
    -- Re-engagement nudges follow the member's daily-reminder consent.
    AND a.daily_push_opt_in
    AND a.created_at < now() - interval '5 days'
    AND (a.last_winback_at IS NULL OR a.last_winback_at < now() - interval '7 days')
    AND NOT EXISTS (
      SELECT 1 FROM checkins c
      WHERE c.account_id = a.id
        AND c.created_at > now() - interval '5 days'
    );
$function$
;

REVOKE EXECUTE ON FUNCTION public.get_winback_push_targets() FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.close_stale_live_video_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.video_sessions;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.video_sessions
    WHERE status = 'live'
      AND coalesce(started_at, scheduled_for, requested_start) < now() - interval '4 hours'
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET status = 'completed',
        ended_at = coalesce(ended_at, now()),
        version = version + 1
    WHERE id = v_row.id
    RETURNING * INTO v_row;
    PERFORM public._video_event(v_row, NULL, 'system', 'completed', 'live',
      jsonb_build_object('reason', 'auto_closed_after_4h'));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_stale_live_video_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_stale_live_video_sessions() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'shl-close-stale-live-video';
    PERFORM cron.schedule('shl-close-stale-live-video', '*/15 * * * *',
      'SELECT public.close_stale_live_video_sessions()');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. Monday Family Squares reminders fired at fixed UTC times, so from the end
--    of daylight saving they arrived an hour early ("starts in about an hour"
--    two hours before the call). Both jobs now run at both candidate UTC hours
--    and the functions send only at the intended Pacific time.
--    'family-squares-reminder' was created in the dashboard; alter it only if
--    present so its stored command (and credentials) stay untouched.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.alter_job(jobid, schedule := '0 1,2 * * 2')
    FROM cron.job WHERE jobname = 'shl-session-reminder';
    PERFORM cron.alter_job(jobid, schedule := '45 1,2 * * 2')
    FROM cron.job WHERE jobname = 'family-squares-reminder';
  END IF;
END $$;
