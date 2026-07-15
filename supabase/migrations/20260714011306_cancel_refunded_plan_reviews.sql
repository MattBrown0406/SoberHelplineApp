-- A refunded one-off review must not remain visibly scheduled or startable.
CREATE OR REPLACE FUNCTION public._cancel_refunded_plan_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.booking_purpose = 'plan_review'
     AND NEW.appointment_type = 'one_off_150'
     AND NEW.payment_status = 'refunded'
     AND OLD.payment_status IS DISTINCT FROM 'refunded'
     AND OLD.status IN ('requested','scheduled','live') THEN
    NEW.status := 'cancelled';
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    NEW.cancellation_reason := COALESCE(NEW.cancellation_reason, 'Payment refunded');
    NEW.calendar_sync_status := CASE
      WHEN NEW.calendar_event_id IS NULL THEN 'cancelled'
      ELSE 'pending'
    END;
    NEW.calendar_sync_error := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_plan_review_refund_state ON public.video_sessions;
CREATE TRIGGER trg_plan_review_refund_state
BEFORE UPDATE OF payment_status ON public.video_sessions
FOR EACH ROW EXECUTE FUNCTION public._cancel_refunded_plan_review();

CREATE OR REPLACE FUNCTION public._notify_refunded_plan_review_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.booking_purpose = 'plan_review'
     AND NEW.appointment_type = 'one_off_150'
     AND NEW.payment_status = 'refunded'
     AND NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.video_session_proposals
       SET status = 'superseded', responded_at = now()
     WHERE session_id = NEW.id AND status = 'pending';

    PERFORM public._video_push(
      NEW.account_id,
      'member_video_cancelled',
      'Plan review cancelled',
      'Your plan-review payment was refunded and the session was cancelled.',
      NEW.id,
      NEW.version,
      'payment_refunded'
    );
    IF NEW.assigned_coach_id IS NOT NULL THEN
      PERFORM public._video_push(
        NEW.assigned_coach_id,
        'coach_video_cancelled',
        'Plan review refunded',
        'A paid plan review was refunded and cancelled.',
        NEW.id,
        NEW.version,
        'payment_refunded'
      );
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_notify_refunded_plan_review_cancelled ON public.video_sessions;
CREATE TRIGGER trg_notify_refunded_plan_review_cancelled
AFTER UPDATE OF payment_status ON public.video_sessions
FOR EACH ROW EXECUTE FUNCTION public._notify_refunded_plan_review_cancelled();

REVOKE EXECUTE ON FUNCTION public._cancel_refunded_plan_review(), public._notify_refunded_plan_review_cancelled() FROM PUBLIC, anon, authenticated;
