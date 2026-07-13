-- Lock down the legacy coaching table so client input cannot assert payment truth.
DROP POLICY IF EXISTS "coaching_bookings: owner insert" ON coaching_bookings;
CREATE POLICY "coaching_bookings: owner insert" ON coaching_bookings FOR INSERT TO authenticated
  WITH CHECK (account_id=my_account_id() AND status='requested' AND payment_status='unpaid' AND rate_cents=15000 AND scheduled_at IS NULL AND zoom_url IS NULL);
DROP POLICY IF EXISTS "coaching_bookings: owner cancel" ON coaching_bookings;
REVOKE UPDATE ON coaching_bookings FROM authenticated;

-- Privacy-preserving plan-review bookings on the existing video scheduling state machine.
ALTER TABLE video_sessions
  ADD COLUMN booking_purpose text NOT NULL DEFAULT 'general_support'
    CHECK (booking_purpose IN ('general_support','plan_review','boundaries','treatment_options','family_alignment','crisis_follow_up')),
  ADD COLUMN member_tier_at_booking text NOT NULL DEFAULT 'premier'
    CHECK (member_tier_at_booking IN ('essential','premier','organization')),
  ADD COLUMN appointment_type text NOT NULL DEFAULT 'membership_included'
    CHECK (appointment_type IN ('membership_included','one_off_150')),
  ADD COLUMN payment_status text NOT NULL DEFAULT 'included'
    CHECK (payment_status IN ('included','pending_payment','paid','refunded')),
  ADD COLUMN coaching_booking_id uuid REFERENCES coaching_bookings(id) ON DELETE RESTRICT,
  ADD COLUMN focus_reason text,
  ADD COLUMN member_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN selected_plan_sections text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN plan_snapshot jsonb,
  ADD COLUMN plan_snapshot_hash text,
  ADD COLUMN snapshot_created_at timestamptz,
  ADD COLUMN consent_version text,
  ADD COLUMN consent_text text,
  ADD COLUMN consent_locale text,
  ADD COLUMN consented_at timestamptz,
  ADD COLUMN update_requested_at timestamptz,
  ADD COLUMN update_request_note text;

-- Private staff preparation is deliberately separate from video_sessions because
-- members can select their own video-session rows. RLS cannot hide one column.
CREATE TABLE plan_review_admin_preparation (
  session_id uuid PRIMARY KEY REFERENCES video_sessions(id) ON DELETE CASCADE,
  notes text CHECK (length(COALESCE(notes,'')) <= 10000),
  updated_by uuid NOT NULL REFERENCES accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE plan_review_admin_preparation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plan_review_admin_preparation FROM PUBLIC, anon, authenticated;
GRANT ALL ON plan_review_admin_preparation TO service_role;

-- A requested update creates a new immutable revision; the booking-time snapshot
-- remains untouched for audit/history.
CREATE TABLE plan_review_snapshot_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES video_sessions(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  selected_plan_sections text[] NOT NULL,
  plan_snapshot jsonb NOT NULL,
  plan_snapshot_hash text NOT NULL,
  consent_version text NOT NULL,
  consent_text text NOT NULL,
  consent_locale text NOT NULL CHECK (consent_locale IN ('en','es')),
  consented_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,revision_number)
);
ALTER TABLE plan_review_snapshot_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plan_review_snapshot_revisions FROM PUBLIC,anon,authenticated;
GRANT ALL ON plan_review_snapshot_revisions TO service_role;

-- Minimal, immutable audit log of website-verified PayPal events. No plan data or
-- family details cross the website/app boundary.
CREATE TABLE plan_review_payment_events (
  event_id text PRIMARY KEY CHECK (length(event_id) BETWEEN 10 AND 255),
  session_id uuid NOT NULL REFERENCES video_sessions(id) ON DELETE RESTRICT,
  coaching_booking_id uuid NOT NULL REFERENCES coaching_bookings(id) ON DELETE RESTRICT,
  paypal_order_id text NOT NULL CHECK (length(paypal_order_id) BETWEEN 5 AND 255),
  paypal_capture_id text NOT NULL CHECK (length(paypal_capture_id) BETWEEN 5 AND 255),
  payment_status text NOT NULL CHECK (payment_status IN ('captured','refunded','reversed','failed')),
  amount_cents integer NOT NULL CHECK (amount_cents=15000),
  currency text NOT NULL CHECK (currency='USD'),
  occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plan_review_payment_capture_paid_unique
  ON plan_review_payment_events(paypal_capture_id) WHERE payment_status='captured';
CREATE UNIQUE INDEX plan_review_payment_order_paid_unique
  ON plan_review_payment_events(paypal_order_id) WHERE payment_status='captured';
ALTER TABLE plan_review_payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON plan_review_payment_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON plan_review_payment_events TO service_role;
GRANT SELECT,UPDATE ON video_sessions,coaching_bookings TO service_role;

ALTER TABLE video_sessions ADD CONSTRAINT video_plan_review_contract CHECK (
  booking_purpose <> 'plan_review' OR (
    plan_snapshot IS NOT NULL AND jsonb_typeof(plan_snapshot)='object'
    AND cardinality(selected_plan_sections) > 0
    AND selected_plan_sections <@ ARRAY['situation','risk','safetyPlan','boundaries','incidents','familyRoles']::text[]
    AND snapshot_created_at IS NOT NULL AND consented_at IS NOT NULL
    AND consent_version='plan-review-v1'
    AND consent_text IS NOT NULL AND length(consent_text) BETWEEN 20 AND 1000
    AND consent_locale IN ('en','es')
    AND plan_snapshot_hash IS NOT NULL
    AND ((appointment_type='membership_included' AND payment_status='included')
      OR (appointment_type='one_off_150' AND payment_status IN ('pending_payment','paid','refunded')))
  )
);
ALTER TABLE video_sessions ADD CONSTRAINT video_plan_review_text_limits CHECK (
  length(COALESCE(focus_reason,'')) <= 2000
  AND length(COALESCE(update_request_note,'')) <= 2000
  AND jsonb_typeof(member_questions)='array' AND jsonb_array_length(member_questions) <= 10
);

CREATE OR REPLACE FUNCTION _plan_review_snapshot_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF OLD.plan_snapshot IS DISTINCT FROM NEW.plan_snapshot
     OR OLD.plan_snapshot_hash IS DISTINCT FROM NEW.plan_snapshot_hash
     OR OLD.snapshot_created_at IS DISTINCT FROM NEW.snapshot_created_at
     OR OLD.selected_plan_sections IS DISTINCT FROM NEW.selected_plan_sections
     OR OLD.consent_text IS DISTINCT FROM NEW.consent_text
     OR OLD.consent_version IS DISTINCT FROM NEW.consent_version
     OR OLD.consent_locale IS DISTINCT FROM NEW.consent_locale
     OR OLD.consented_at IS DISTINCT FROM NEW.consented_at THEN
    RAISE EXCEPTION 'plan_review_snapshot_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_plan_review_snapshot_immutable BEFORE UPDATE ON video_sessions
FOR EACH ROW WHEN (OLD.plan_snapshot IS NOT NULL) EXECUTE FUNCTION _plan_review_snapshot_immutable();

CREATE OR REPLACE FUNCTION request_plan_review_video_session(
  p_starts_at timestamptz, p_timezone text, p_duration_minutes integer,
  p_purpose text, p_focus_reason text, p_questions jsonb,
  p_selected_sections text[], p_snapshot jsonb, p_consent_text text,
  p_consent_locale text, p_payment_choice text DEFAULT 'membership_included')
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_account uuid:=my_account_id(); v_row video_sessions; v_owner uuid;
  v_tier text; v_appointment text; v_payment text; v_coaching uuid;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM _video_assert_timezone(p_timezone);
  IF p_starts_at IS NULL OR p_starts_at<=now() OR p_duration_minutes NOT BETWEEN 15 AND 240
    OR p_purpose <> 'plan_review'
    OR p_selected_sections IS NULL OR cardinality(p_selected_sections)=0
    OR cardinality(p_selected_sections)<>(SELECT count(DISTINCT section_key) FROM unnest(p_selected_sections) AS section_key)
    OR NOT p_selected_sections <@ ARRAY['situation','risk','safetyPlan','boundaries','incidents','familyRoles']::text[]
    OR p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'object' OR octet_length(p_snapshot::text)>100000
    OR COALESCE(p_snapshot->>'schemaVersion','')<>'1'
    OR NOT (p_snapshot ? 'sections')
    OR jsonb_typeof(p_snapshot->'sections')<>'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_snapshot->'sections') k WHERE NOT k=ANY(p_selected_sections))
    OR NOT p_selected_sections <@ ARRAY(SELECT jsonb_object_keys(p_snapshot->'sections'))
    OR p_questions IS NULL OR jsonb_typeof(p_questions)<>'array' OR jsonb_array_length(p_questions)>10
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_questions) question WHERE jsonb_typeof(question)<>'string' OR length(question#>>'{}')>1000)
    OR length(COALESCE(p_focus_reason,''))>2000
    OR p_consent_text IS NULL OR length(p_consent_text) NOT BETWEEN 20 AND 1000
    OR p_consent_locale NOT IN ('en','es') THEN
    RAISE EXCEPTION 'invalid_plan_review_request';
  END IF;

  IF has_active_private_video_access(v_account) THEN
    v_tier:=CASE WHEN EXISTS(SELECT 1 FROM accounts WHERE id=v_account AND type='attached') THEN 'organization' ELSE 'premier' END;
    v_appointment:='membership_included'; v_payment:='included';
  ELSIF EXISTS (SELECT 1 FROM entitlements e WHERE e.account_id=v_account AND e.tier='essential' AND (e.expires_at IS NULL OR e.expires_at>now())) THEN
    IF p_payment_choice<>'one_off_150' THEN RAISE EXCEPTION 'premier_upgrade_or_payment_required'; END IF;
    v_tier:='essential'; v_appointment:='one_off_150'; v_payment:='pending_payment';
    INSERT INTO coaching_bookings(account_id,preferred_times,note,status,payment_status,rate_cents)
    VALUES(v_account,p_starts_at::text||' ('||p_timezone||')','Plan review video session','requested','unpaid',15000)
    RETURNING id INTO v_coaching;
  ELSE
    RAISE EXCEPTION 'essential_or_premier_required';
  END IF;

  INSERT INTO video_sessions(account_id,room_name,status,requested_start,requested_timezone,duration_minutes,
    member_note,booking_purpose,member_tier_at_booking,appointment_type,payment_status,coaching_booking_id,
    focus_reason,member_questions,selected_plan_sections,plan_snapshot,plan_snapshot_hash,snapshot_created_at,
    consent_version,consent_text,consent_locale,consented_at)
  VALUES(v_account,'premium-video-'||gen_random_uuid(),'requested',p_starts_at,p_timezone,p_duration_minutes,
    NULLIF(btrim(p_focus_reason),''),'plan_review',v_tier,v_appointment,v_payment,v_coaching,
    NULLIF(btrim(p_focus_reason),''),p_questions,p_selected_sections,p_snapshot,
    encode(extensions.digest(convert_to(p_snapshot::text,'UTF8'),'sha256'),'hex'),now(),
    'plan-review-v1',p_consent_text,p_consent_locale,now()) RETURNING * INTO v_row;
  INSERT INTO video_session_proposals(session_id,proposed_by_account_id,proposed_by_role,starts_at,timezone,duration_minutes,note)
  VALUES(v_row.id,v_account,'member',p_starts_at,p_timezone,p_duration_minutes,NULLIF(btrim(p_focus_reason),''));
  PERFORM _video_event(v_row,v_account,'member','plan_review_requested',NULL,jsonb_build_object('appointment_type',v_appointment,'payment_status',v_payment));
  FOR v_owner IN SELECT account_id FROM video_staff_roles WHERE active LOOP
    PERFORM _video_push(v_owner,'admin_video_request','New plan review request','A member submitted a private plan-review request.',v_row.id,v_row.version,'plan_review_requested');
  END LOOP;
  RETURN v_row;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'active_session_exists' USING ERRCODE='23505';
END $$;

-- Payment truth remains coaching_bookings. This RPC only mirrors a server/manual/webhook verified paid row.
CREATE OR REPLACE FUNCTION sync_plan_review_payment(p_session_id uuid)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row video_sessions;
BEGIN
  IF NOT is_video_staff() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND OR v_row.appointment_type<>'one_off_150' OR v_row.coaching_booking_id IS NULL THEN RAISE EXCEPTION 'not_one_off_plan_review'; END IF;
  IF NOT EXISTS(SELECT 1 FROM coaching_bookings WHERE id=v_row.coaching_booking_id AND payment_status='paid') THEN RAISE EXCEPTION 'payment_not_verified'; END IF;
  UPDATE video_sessions SET payment_status='paid',version=version+1 WHERE id=p_session_id RETURNING * INTO v_row;
  PERFORM _video_event(v_row,my_account_id(),'coach','payment_verified',v_row.status,'{}');
  RETURN v_row;
END $$;

-- Called only by the HMAC-verifying Edge Function using the service-role client.
-- It atomically records payment truth and updates both linked app records.
CREATE OR REPLACE FUNCTION apply_plan_review_payment_event(
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

CREATE OR REPLACE FUNCTION admin_get_plan_review_payment_events(p_session_ids uuid[])
RETURNS SETOF plan_review_payment_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT is_video_staff() THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF COALESCE(cardinality(p_session_ids),0)>100 THEN RAISE EXCEPTION 'invalid_session_ids'; END IF;
 RETURN QUERY SELECT e.* FROM plan_review_payment_events e
  WHERE e.session_id=ANY(COALESCE(p_session_ids,'{}'::uuid[])) ORDER BY e.received_at DESC;
END $$;

CREATE OR REPLACE FUNCTION admin_update_plan_review_prep(p_session_id uuid,p_notes text)
RETURNS TABLE(session_id uuid, notes text, updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
#variable_conflict use_column
DECLARE v_actor uuid:=my_account_id();
BEGIN
 IF NOT is_video_staff(v_actor) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF length(COALESCE(p_notes,''))>10000 THEN RAISE EXCEPTION 'invalid_prep_notes'; END IF;
 IF NOT EXISTS(SELECT 1 FROM video_sessions s WHERE s.id=p_session_id AND s.booking_purpose='plan_review') THEN RAISE EXCEPTION 'session_not_found'; END IF;
 INSERT INTO plan_review_admin_preparation AS prep(session_id,notes,updated_by,updated_at)
 VALUES(p_session_id,NULLIF(btrim(p_notes),''),v_actor,now())
 ON CONFLICT (session_id) DO UPDATE SET notes=EXCLUDED.notes,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at;
 RETURN QUERY SELECT prep.session_id,prep.notes,prep.updated_at FROM plan_review_admin_preparation prep WHERE prep.session_id=p_session_id;
END $$;
CREATE OR REPLACE FUNCTION admin_get_plan_review_prep(p_session_ids uuid[])
RETURNS TABLE(session_id uuid, notes text, updated_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT is_video_staff() THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF COALESCE(cardinality(p_session_ids),0)>100 THEN RAISE EXCEPTION 'invalid_session_ids'; END IF;
 RETURN QUERY SELECT prep.session_id,prep.notes,prep.updated_at FROM plan_review_admin_preparation prep WHERE prep.session_id=ANY(COALESCE(p_session_ids,'{}'::uuid[]));
END $$;
CREATE OR REPLACE FUNCTION admin_request_plan_review_update(p_session_id uuid,p_note text DEFAULT NULL)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row video_sessions;
BEGIN
 IF NOT is_video_staff() THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF length(COALESCE(p_note,''))>2000 THEN RAISE EXCEPTION 'invalid_update_note'; END IF;
 UPDATE video_sessions SET update_requested_at=now(),update_request_note=NULLIF(btrim(p_note),''),version=version+1 WHERE id=p_session_id AND booking_purpose='plan_review' RETURNING * INTO v_row;
 IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
 PERFORM _video_event(v_row,my_account_id(),'coach','plan_update_requested',v_row.status,jsonb_build_object('request_note',v_row.update_request_note));
 PERFORM _video_push(v_row.account_id,'member_plan_update_requested','Plan update requested','Your coach requested an updated plan before your meeting.',v_row.id,v_row.version,'plan_update_requested'); RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION member_submit_plan_review_revision(
 p_session_id uuid,p_selected_sections text[],p_snapshot jsonb,p_consent_text text,p_consent_locale text)
RETURNS plan_review_snapshot_revisions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account uuid:=my_account_id(); v_session video_sessions; v_revision plan_review_snapshot_revisions; v_number integer;
BEGIN
 SELECT * INTO v_session FROM video_sessions WHERE id=p_session_id AND account_id=v_account FOR UPDATE;
 IF NOT FOUND OR v_session.booking_purpose<>'plan_review' THEN RAISE EXCEPTION 'session_not_found'; END IF;
 IF v_session.update_requested_at IS NULL THEN RAISE EXCEPTION 'plan_update_not_requested'; END IF;
 IF p_selected_sections IS NULL OR cardinality(p_selected_sections)=0
   OR cardinality(p_selected_sections)<>(SELECT count(DISTINCT section_key) FROM unnest(p_selected_sections) AS section_key)
   OR NOT p_selected_sections <@ ARRAY['situation','risk','safetyPlan','boundaries','incidents','familyRoles']::text[]
   OR p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'object' OR octet_length(p_snapshot::text)>100000
   OR COALESCE(p_snapshot->>'schemaVersion','')<>'1' OR jsonb_typeof(p_snapshot->'sections')<>'object'
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_snapshot->'sections') k WHERE NOT k=ANY(p_selected_sections))
   OR NOT p_selected_sections <@ ARRAY(SELECT jsonb_object_keys(p_snapshot->'sections'))
   OR p_consent_text IS NULL OR length(p_consent_text) NOT BETWEEN 20 AND 1000 OR p_consent_locale NOT IN ('en','es') THEN
   RAISE EXCEPTION 'invalid_plan_review_revision';
 END IF;
 SELECT COALESCE(max(revision_number),0)+1 INTO v_number FROM plan_review_snapshot_revisions WHERE session_id=p_session_id;
 INSERT INTO plan_review_snapshot_revisions(session_id,revision_number,selected_plan_sections,plan_snapshot,plan_snapshot_hash,consent_version,consent_text,consent_locale)
 VALUES(p_session_id,v_number,p_selected_sections,p_snapshot,encode(extensions.digest(convert_to(p_snapshot::text,'UTF8'),'sha256'),'hex'),'plan-review-v1',p_consent_text,p_consent_locale)
 RETURNING * INTO v_revision;
 UPDATE video_sessions SET update_requested_at=NULL,update_request_note=NULL,version=version+1 WHERE id=p_session_id RETURNING * INTO v_session;
 PERFORM _video_event(v_session,v_account,'member','plan_update_submitted',v_session.status,jsonb_build_object('revision_number',v_number));
 RETURN v_revision;
END $$;

CREATE OR REPLACE FUNCTION admin_get_plan_review_revisions(p_session_ids uuid[])
RETURNS SETOF plan_review_snapshot_revisions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT is_video_staff() THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF COALESCE(cardinality(p_session_ids),0)>100 THEN RAISE EXCEPTION 'invalid_session_ids'; END IF;
 RETURN QUERY SELECT r.* FROM plan_review_snapshot_revisions r WHERE r.session_id=ANY(COALESCE(p_session_ids,'{}'::uuid[])) ORDER BY r.session_id,r.revision_number DESC;
END $$;

-- Paid one-off sessions may be scheduled only after server-side payment truth is mirrored.
CREATE OR REPLACE FUNCTION _plan_review_payment_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status IN ('scheduled','live') AND OLD.status IS DISTINCT FROM NEW.status
    AND NEW.appointment_type='one_off_150'
    AND (NEW.payment_status<>'paid' OR NEW.coaching_booking_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM coaching_bookings booking WHERE booking.id=NEW.coaching_booking_id AND booking.payment_status='paid'
    )) THEN
   RAISE EXCEPTION 'payment_not_verified';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER trg_plan_review_payment_guard BEFORE UPDATE ON video_sessions
FOR EACH ROW EXECUTE FUNCTION _plan_review_payment_guard();

REVOKE EXECUTE ON FUNCTION _plan_review_snapshot_immutable(),_plan_review_payment_guard(),request_plan_review_video_session(timestamptz,text,integer,text,text,jsonb,text[],jsonb,text,text,text),sync_plan_review_payment(uuid),apply_plan_review_payment_event(text,uuid,text,text,text,integer,text,timestamptz),admin_get_plan_review_payment_events(uuid[]),admin_update_plan_review_prep(uuid,text),admin_get_plan_review_prep(uuid[]),admin_request_plan_review_update(uuid,text),member_submit_plan_review_revision(uuid,text[],jsonb,text,text),admin_get_plan_review_revisions(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_plan_review_video_session(timestamptz,text,integer,text,text,jsonb,text[],jsonb,text,text,text),member_submit_plan_review_revision(uuid,text[],jsonb,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION sync_plan_review_payment(uuid),admin_get_plan_review_payment_events(uuid[]),admin_update_plan_review_prep(uuid,text),admin_get_plan_review_prep(uuid[]),admin_request_plan_review_update(uuid,text),admin_get_plan_review_revisions(uuid[]) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION apply_plan_review_payment_event(text,uuid,text,text,text,integer,text,timestamptz),_plan_review_snapshot_immutable(),_plan_review_payment_guard() TO service_role;
