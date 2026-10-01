-- One-off ($150) plan reviews:
-- 1. member_get_coaching_bookings(): "My bookings" listed the coaching_bookings
--    row each one-off plan review creates (raw UTC text, a status that never
--    moves). Plan-review payment records are now excluded; members still have
--    no direct access to anything new.
-- 2. service_convert_plan_review_to_included(): a member who upgrades to
--    Premier while a one-off is pending payment gets it included instead of
--    paying $150 (called by create-plan-review-checkout with the service role).
--    A capture that still arrives for a converted session is recorded and
--    flagged as a refund owed rather than rejected.
-- 3. admin_mark_plan_review_paid(): owner-only manual "mark paid" that records
--    a manual payment event with the same bookkeeping as a verified capture.

CREATE INDEX IF NOT EXISTS video_sessions_coaching_booking_idx
  ON public.video_sessions (coaching_booking_id)
  WHERE coaching_booking_id IS NOT NULL;

ALTER TABLE public.plan_review_payment_events
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'paypal',
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS recorded_by_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.plan_review_payment_events DROP CONSTRAINT IF EXISTS plan_review_payment_events_source_check;
ALTER TABLE public.plan_review_payment_events ADD CONSTRAINT plan_review_payment_events_source_check
  CHECK (source IN ('paypal', 'manual') AND (note IS NULL OR length(note) <= 500));

-- ── 1. Member coaching bookings without plan-review payment records ──────────
CREATE OR REPLACE FUNCTION public.member_get_coaching_bookings(p_limit integer DEFAULT 10)
RETURNS TABLE (
  id uuid,
  preferred_times text,
  status text,
  payment_status text,
  scheduled_at timestamptz,
  zoom_url text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.preferred_times, b.status, b.payment_status, b.scheduled_at, b.zoom_url, b.created_at
  FROM public.coaching_bookings b
  WHERE b.account_id = public.my_account_id()
    -- A plan review's payment record is shown (and kept current) on the
    -- plan-review card in Crisis Mode, never as a separate coaching call.
    AND NOT EXISTS (SELECT 1 FROM public.video_sessions s WHERE s.coaching_booking_id = b.id)
    AND NOT EXISTS (SELECT 1 FROM public.plan_review_payment_events e WHERE e.coaching_booking_id = b.id)
  ORDER BY b.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50)
$$;

REVOKE EXECUTE ON FUNCTION public.member_get_coaching_bookings(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_get_coaching_bookings(integer) TO authenticated;

-- ── 2. Premier upgrade converts a pending one-off ───────────────────────────
CREATE OR REPLACE FUNCTION public.service_convert_plan_review_to_included(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.video_sessions;
  v_tier text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_row.booking_purpose <> 'plan_review' THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_row.appointment_type <> 'one_off_150'
     OR v_row.payment_status <> 'pending_payment'
     OR v_row.status NOT IN ('requested', 'scheduled', 'live')
     OR NOT public.has_active_private_video_access(v_row.account_id)
     -- Money already moved for this session: keep it a paid one-off.
     OR EXISTS (SELECT 1 FROM public.plan_review_payment_events e
                WHERE e.session_id = v_row.id AND e.payment_status = 'captured') THEN
    RETURN 'not_eligible';
  END IF;

  v_tier := CASE WHEN EXISTS (
      SELECT 1 FROM public.accounts a JOIN public.orgs o ON o.id = a.org_id
      WHERE a.id = v_row.account_id AND a.type = 'attached' AND o.status = 'active')
    THEN 'organization' ELSE 'premier' END;

  -- coaching_booking_id is kept as the audit link to the abandoned payment record.
  UPDATE public.video_sessions
  SET appointment_type = 'membership_included',
      payment_status = 'included',
      member_tier_at_booking = v_tier,
      version = version + 1
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  UPDATE public.coaching_bookings
  SET status = 'cancelled'
  WHERE id = v_row.coaching_booking_id AND payment_status = 'unpaid';

  PERFORM public._video_event(v_row, NULL, 'system', 'converted_to_membership_included', v_row.status,
    jsonb_build_object('coaching_booking_id', v_row.coaching_booking_id, 'tier', v_tier));
  RETURN 'converted';
END
$$;

REVOKE EXECUTE ON FUNCTION public.service_convert_plan_review_to_included(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_convert_plan_review_to_included(uuid) TO service_role;

-- Latest definition: 20260930230000_second_audit_pass.sql. Unchanged except
-- for the converted-session branch (a capture for a plan review that is now
-- included with Premier is recorded and owed back instead of rejected).
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
 IF NOT FOUND OR v_session.booking_purpose<>'plan_review' OR v_session.coaching_booking_id IS NULL
    OR v_session.appointment_type NOT IN ('one_off_150','membership_included') THEN RAISE EXCEPTION 'session_not_found'; END IF;
 IF EXISTS(SELECT 1 FROM plan_review_payment_events e WHERE e.payment_status='captured'
           AND (e.paypal_capture_id=p_capture_id OR e.paypal_order_id=p_order_id) AND e.session_id<>p_session_id) THEN
   RAISE EXCEPTION 'capture_conflict';
 END IF;

 -- Converted to "included with Premier" (still linked to its payment record):
 -- the session's own payment state stays 'included'; the money is owed back.
 IF v_session.appointment_type='membership_included' THEN
   IF p_status IN ('refunded','reversed') AND NOT EXISTS(SELECT 1 FROM plan_review_payment_events e WHERE e.session_id=p_session_id
                 AND e.paypal_capture_id=p_capture_id AND e.payment_status='captured') THEN
     RAISE EXCEPTION 'invalid_payment_transition';
   END IF;
   v_refund_owed := p_status='captured';
   v_new_payment := CASE
     WHEN p_status='captured' THEN 'paid'
     WHEN p_status IN ('refunded','reversed') THEN CASE WHEN EXISTS(
         SELECT 1 FROM plan_review_payment_events e
         WHERE e.session_id=p_session_id AND e.payment_status='captured'
           AND e.paypal_capture_id<>p_capture_id
           AND NOT EXISTS(SELECT 1 FROM plan_review_payment_events r
                          WHERE r.paypal_capture_id=e.paypal_capture_id
                            AND r.payment_status IN ('refunded','reversed')))
       THEN 'paid' ELSE 'refunded' END
     ELSE NULL END;
   INSERT INTO plan_review_payment_events(event_id,session_id,coaching_booking_id,paypal_order_id,paypal_capture_id,
     payment_status,amount_cents,currency,occurred_at)
   VALUES(p_event_id,p_session_id,v_session.coaching_booking_id,p_order_id,p_capture_id,p_status,p_amount_cents,p_currency,p_occurred_at);
   IF v_new_payment IS NOT NULL THEN
     UPDATE coaching_bookings SET payment_status=v_new_payment WHERE id=v_session.coaching_booking_id;
   END IF;
   PERFORM _video_event(v_session,NULL,'system',CASE WHEN p_status='captured' THEN 'payment_verified' ELSE 'payment_'||p_status END,
     v_session.status,jsonb_build_object('event_id',p_event_id,'order_id',p_order_id,'capture_id',p_capture_id,
       'refund_owed',v_refund_owed,'membership_included',true));
   IF v_refund_owed THEN
     INSERT INTO public.push_outbox (account_id, kind, title, body, metadata)
      SELECT r.account_id, 'admin_refund_owed', '💳 Plan review refund owed', 'A $150 plan-review payment arrived for a review that is now included with Premier. Refund it in PayPal.',
             jsonb_build_object('kind', 'admin_refund_owed', 'session_id', p_session_id)
      FROM public.video_staff_roles r
      WHERE r.role = 'owner' AND r.active;
   END IF;
   RETURN jsonb_build_object('duplicate',false,'status',p_status,'refund_owed',v_refund_owed);
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
END $function$;

-- ── 3. Owner-only manual payment ─────────────────────────────────────────────
-- For a $150 review paid outside PayPal (or a PayPal capture the bridge never
-- delivered). Mirrors a verified capture: a 'captured' payment event, the
-- coaching booking and the session move to paid, so the payment guard lets
-- staff confirm the time.
CREATE OR REPLACE FUNCTION public.admin_mark_plan_review_paid(p_session_id uuid, p_note text)
RETURNS public.video_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.my_account_id();
  v_row public.video_sessions;
  v_note text := btrim(COALESCE(p_note, ''));
  v_reference text := 'MANUAL-' || replace(gen_random_uuid()::text, '-', '');
  v_event_id text := 'manual.' || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF v_actor IS NULL OR NOT public.is_video_owner(v_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF length(v_note) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'manual_payment_note_required'; END IF;

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_row.booking_purpose <> 'plan_review' OR v_row.appointment_type <> 'one_off_150'
     OR v_row.coaching_booking_id IS NULL THEN
    RAISE EXCEPTION 'not_one_off_plan_review';
  END IF;
  IF v_row.payment_status = 'paid' THEN RAISE EXCEPTION 'already_paid'; END IF;
  IF v_row.payment_status <> 'pending_payment' OR v_row.status NOT IN ('requested', 'scheduled', 'live') THEN
    RAISE EXCEPTION 'invalid_payment_transition';
  END IF;

  INSERT INTO public.plan_review_payment_events(event_id, session_id, coaching_booking_id, paypal_order_id,
    paypal_capture_id, payment_status, amount_cents, currency, occurred_at, source, note, recorded_by_account_id)
  VALUES (v_event_id, v_row.id, v_row.coaching_booking_id, v_reference, v_reference, 'captured', 15000, 'USD',
    now(), 'manual', v_note, v_actor);
  UPDATE public.coaching_bookings SET payment_status = 'paid' WHERE id = v_row.coaching_booking_id;
  UPDATE public.video_sessions SET payment_status = 'paid', version = version + 1
  WHERE id = v_row.id RETURNING * INTO v_row;
  PERFORM public._video_event(v_row, v_actor, 'coach', 'payment_marked_paid_manually', v_row.status,
    jsonb_build_object('event_id', v_event_id, 'note', v_note, 'manual', true));
  RETURN v_row;
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_mark_plan_review_paid(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_plan_review_paid(uuid, text) TO authenticated;
