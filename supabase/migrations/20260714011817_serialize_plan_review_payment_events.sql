-- Serialize deliveries of the same event ID so simultaneous retries receive the
-- same idempotent success instead of racing into a unique-violation conflict.
CREATE OR REPLACE FUNCTION public.apply_plan_review_payment_event(
 p_event_id text,p_session_id uuid,p_order_id text,p_capture_id text,p_status text,
 p_amount_cents integer,p_currency text,p_occurred_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_session video_sessions; v_existing plan_review_payment_events; v_new_payment text;
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
   IF v_session.payment_status NOT IN ('pending_payment','paid') THEN RAISE EXCEPTION 'invalid_payment_transition'; END IF;
   v_new_payment:='paid';
 ELSIF p_status IN ('refunded','reversed') THEN
   IF NOT EXISTS(SELECT 1 FROM plan_review_payment_events e WHERE e.session_id=p_session_id
                 AND e.paypal_capture_id=p_capture_id AND e.payment_status='captured') THEN
     RAISE EXCEPTION 'invalid_payment_transition';
   END IF;
   v_new_payment:='refunded';
 ELSE
   IF v_session.payment_status='paid' THEN RAISE EXCEPTION 'invalid_payment_transition'; END IF;
   v_new_payment:='pending_payment';
 END IF;
 INSERT INTO plan_review_payment_events(event_id,session_id,coaching_booking_id,paypal_order_id,paypal_capture_id,
   payment_status,amount_cents,currency,occurred_at)
 VALUES(p_event_id,p_session_id,v_session.coaching_booking_id,p_order_id,p_capture_id,p_status,p_amount_cents,p_currency,p_occurred_at);
 UPDATE coaching_bookings SET payment_status=CASE WHEN v_new_payment='paid' THEN 'paid' WHEN v_new_payment='refunded' THEN 'refunded' ELSE 'unpaid' END
 WHERE id=v_session.coaching_booking_id;
 UPDATE video_sessions SET payment_status=v_new_payment,version=version+1 WHERE id=p_session_id RETURNING * INTO v_session;
 PERFORM _video_event(v_session,NULL,'system',CASE WHEN v_new_payment='paid' THEN 'payment_verified' ELSE 'payment_'||p_status END,
   v_session.status,jsonb_build_object('event_id',p_event_id,'order_id',p_order_id,'capture_id',p_capture_id));
 RETURN jsonb_build_object('duplicate',false,'status',p_status);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'capture_conflict';
END $$;

REVOKE EXECUTE ON FUNCTION public.apply_plan_review_payment_event(text,uuid,text,text,text,integer,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_plan_review_payment_event(text,uuid,text,text,text,integer,text,timestamptz) TO service_role;
