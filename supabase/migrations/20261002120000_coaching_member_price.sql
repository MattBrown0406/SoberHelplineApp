-- Coaching member price: paying members (Essential, Premier, active provider
-- org) get $25 off a plan-review coaching call — $125 instead of $150 — the
-- same member discount soberhelpline.com gives on coaching.
--
-- The app's server quotes the price when it opens the website checkout (the
-- signed token carries the cents); the website charges exactly that. A session
-- remembers that it was quoted the member price, so a $125 capture is only
-- accepted for a session the app actually offered it to (a stale link still
-- works after the membership lapses). create-plan-review-checkout only quotes
-- $125 once PLAN_REVIEW_MEMBER_PRICE=on is set — after the website accepts it.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS plan_review_member_quote boolean NOT NULL DEFAULT false;

ALTER TABLE public.plan_review_payment_events DROP CONSTRAINT IF EXISTS plan_review_payment_events_amount_cents_check;
ALTER TABLE public.plan_review_payment_events ADD CONSTRAINT plan_review_payment_events_amount_cents_check
  CHECK (amount_cents IN (15000, 12500));

-- Price for this plan-review checkout, in cents. Service role only.
CREATE OR REPLACE FUNCTION public.service_plan_review_checkout_cents(p_session_id uuid, p_member_price boolean)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.video_sessions;
  v_member boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.booking_purpose <> 'plan_review' THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;
  v_member := coalesce(p_member_price, false) AND public.has_active_textline_access(v_session.account_id);
  IF v_member AND NOT v_session.plan_review_member_quote THEN
    UPDATE public.video_sessions SET plan_review_member_quote = true WHERE id = p_session_id;
  END IF;
  RETURN CASE WHEN v_member THEN 12500 ELSE 15000 END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.service_plan_review_checkout_cents(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_plan_review_checkout_cents(uuid, boolean) TO service_role;

-- Accept the $125 member price for a session quoted it (and keep $150).
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
    OR p_amount_cents NOT IN (15000, 12500) OR p_currency<>'USD'
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
 -- $125 is the member price: only valid for a session the app quoted it for.
 IF p_amount_cents = 12500 AND NOT v_session.plan_review_member_quote THEN
   RAISE EXCEPTION 'invalid_payment_event';
 END IF;
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
      SELECT r.account_id, 'admin_refund_owed', '💳 Plan review refund owed', 'A plan-review payment arrived for a review that is now included with Premier. Refund it in PayPal.',
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

REVOKE EXECUTE ON FUNCTION public.apply_plan_review_payment_event(text, uuid, text, text, text, integer, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_review_payment_event(text, uuid, text, text, text, integer, text, timestamptz) TO service_role;
