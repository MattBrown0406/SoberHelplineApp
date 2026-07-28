-- Opt-in AI practice-call pushes. The database schedules privacy-safe prompts
-- into the existing leased/retryable push_outbox; the app creates the actual AI
-- opening line only after the member taps the notification and answers.

CREATE TABLE public.practice_push_preferences (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  frequency_per_week smallint NOT NULL DEFAULT 2
    CHECK (frequency_per_week BETWEEN 1 AND 3),
  window_start_hour smallint NOT NULL DEFAULT 10
    CHECK (window_start_hour BETWEEN 8 AND 19),
  window_end_hour smallint NOT NULL DEFAULT 20
    CHECK (window_end_hour BETWEEN 9 AND 22),
  next_prompt_at timestamptz,
  last_enqueued_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practice_push_window_order CHECK (window_end_hour > window_start_hour)
);

CREATE TABLE public.practice_push_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  answered_at timestamptz,
  generation_started_at timestamptz,
  opening_text text,
  break_character boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT practice_push_events_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT practice_push_events_answer_check CHECK (answered_at IS NULL OR answered_at >= created_at)
);
ALTER TABLE public.practice_push_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.practice_push_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.practice_push_events TO service_role;
CREATE INDEX practice_push_events_account_idx
  ON public.practice_push_events(account_id, expires_at DESC);

ALTER TABLE public.practice_push_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "practice preferences: own select"
  ON public.practice_push_preferences FOR SELECT TO authenticated
  USING (account_id = public.my_account_id());
CREATE POLICY "practice preferences: own insert"
  ON public.practice_push_preferences FOR INSERT TO authenticated
  WITH CHECK (account_id = public.my_account_id());
CREATE POLICY "practice preferences: own update"
  ON public.practice_push_preferences FOR UPDATE TO authenticated
  USING (account_id = public.my_account_id())
  WITH CHECK (account_id = public.my_account_id());

REVOKE ALL ON TABLE public.practice_push_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.practice_push_preferences TO authenticated;
GRANT INSERT (account_id, enabled, frequency_per_week, window_start_hour, window_end_hour)
  ON public.practice_push_preferences TO authenticated;
GRANT UPDATE (account_id, enabled, frequency_per_week, window_start_hour, window_end_hour)
  ON public.practice_push_preferences TO authenticated;

-- One Expo token belongs to one signed-in account at a time. Clean any legacy
-- duplicates before enforcing the invariant, then transfer ownership atomically
-- during registration rather than trusting the client to update arbitrary rows.
WITH ranked_tokens AS (
  SELECT id,
    row_number() OVER (PARTITION BY push_token ORDER BY created_at DESC, id DESC) AS token_rank
  FROM public.accounts
  WHERE push_token IS NOT NULL
)
UPDATE public.accounts a
SET push_token = NULL
FROM ranked_tokens r
WHERE a.id = r.id AND r.token_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_push_token_unique_idx
  ON public.accounts(push_token) WHERE push_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.register_push_device(p_token text, p_locale text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.my_account_id();
BEGIN
  IF v_account_id IS NULL THEN RETURN false; END IF;
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 20 AND 512
     OR p_token !~ '^Expo(nent)?PushToken[[][^]]+[]]$' THEN
    RAISE EXCEPTION 'invalid_push_token' USING ERRCODE = '22023';
  END IF;

  UPDATE public.accounts SET push_token = NULL
  WHERE push_token = p_token AND id <> v_account_id;
  UPDATE public.accounts
  SET push_token = p_token,
      locale = CASE WHEN coalesce(p_locale, 'en') LIKE 'es%' THEN 'es' ELSE 'en' END
  WHERE id = v_account_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.register_push_device(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_device(text,text) TO authenticated;

-- Produce the next bounded local-time prompt. The account/date hash gives each
-- member a stable hour inside their selected window without storing randomness.
CREATE OR REPLACE FUNCTION public._next_practice_prompt_at(
  p_account_id uuid,
  p_frequency_per_week smallint,
  p_window_start_hour smallint,
  p_window_end_hour smallint,
  p_after timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_timezone text;
  v_gap interval;
  v_not_before timestamptz;
  v_target_date date;
  v_window_width integer;
  v_hash bigint;
  v_hour integer;
  v_candidate timestamptz;
BEGIN
  IF p_frequency_per_week NOT BETWEEN 1 AND 3
     OR p_window_start_hour NOT BETWEEN 8 AND 19
     OR p_window_end_hour NOT BETWEEN 9 AND 22
     OR p_window_end_hour <= p_window_start_hour THEN
    RAISE EXCEPTION 'invalid_practice_push_schedule' USING ERRCODE = '22023';
  END IF;

  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = a.timezone) THEN a.timezone
    ELSE 'UTC'
  END
  INTO v_timezone
  FROM public.accounts a
  WHERE a.id = p_account_id;
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002'; END IF;

  v_gap := interval '7 days' / p_frequency_per_week::double precision;
  v_not_before := p_after + v_gap;
  v_target_date := (v_not_before AT TIME ZONE v_timezone)::date;
  v_window_width := p_window_end_hour - p_window_start_hour;
  v_hash := hashtextextended(p_account_id::text || ':' || v_target_date::text, 0)
    & 9223372036854775807::bigint;
  v_hour := p_window_start_hour + mod(v_hash, v_window_width)::integer;
  v_candidate := (v_target_date::timestamp + make_interval(hours => v_hour)) AT TIME ZONE v_timezone;

  IF v_candidate < v_not_before THEN
    v_target_date := v_target_date + 1;
    v_hash := hashtextextended(p_account_id::text || ':' || v_target_date::text, 0)
      & 9223372036854775807::bigint;
    v_hour := p_window_start_hour + mod(v_hash, v_window_width)::integer;
    v_candidate := (v_target_date::timestamp + make_interval(hours => v_hour)) AT TIME ZONE v_timezone;
  END IF;
  RETURN v_candidate;
END;
$$;
REVOKE ALL ON FUNCTION public._next_practice_prompt_at(uuid,smallint,smallint,smallint,timestamptz)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._set_practice_push_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_first_after timestamptz;
BEGIN
  NEW.updated_at := now();
  IF NOT NEW.enabled THEN
    NEW.next_prompt_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- First prompt arrives in roughly one day, inside the chosen local window.
    v_first_after := now()
      - (interval '7 days' / NEW.frequency_per_week::double precision)
      + interval '1 day';
    NEW.next_prompt_at := public._next_practice_prompt_at(
      NEW.account_id, NEW.frequency_per_week, NEW.window_start_hour,
      NEW.window_end_hour, v_first_after
    );
  ELSIF NOT OLD.enabled
     OR NEW.frequency_per_week IS DISTINCT FROM OLD.frequency_per_week
     OR NEW.window_start_hour IS DISTINCT FROM OLD.window_start_hour
     OR NEW.window_end_hour IS DISTINCT FROM OLD.window_end_hour THEN
    v_first_after := now()
      - (interval '7 days' / NEW.frequency_per_week::double precision)
      + interval '1 day';
    NEW.next_prompt_at := public._next_practice_prompt_at(
      NEW.account_id, NEW.frequency_per_week, NEW.window_start_hour,
      NEW.window_end_hour, v_first_after
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._set_practice_push_schedule() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER practice_push_preferences_schedule
BEFORE INSERT OR UPDATE ON public.practice_push_preferences
FOR EACH ROW EXECUTE FUNCTION public._set_practice_push_schedule();

-- Called only by pg_cron/service infrastructure. Entitlement is rechecked when
-- the prompt is queued, so expired/free accounts never receive paid AI practice.
CREATE OR REPLACE FUNCTION public.enqueue_due_practice_pushes(
  p_now timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_inserted boolean;
  v_event_id uuid;
BEGIN
  FOR v_row IN
    SELECT
      p.account_id,
      p.frequency_per_week,
      p.window_start_hour,
      p.window_end_hour,
      p.next_prompt_at,
      a.locale
    FROM public.practice_push_preferences p
    JOIN public.accounts a ON a.id = p.account_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = a.timezone) THEN a.timezone
        ELSE 'UTC'
      END AS name
    ) tz
    WHERE p.enabled
      AND p.next_prompt_at IS NOT NULL
      AND p.next_prompt_at <= p_now
      AND a.push_token IS NOT NULL
      AND extract(hour FROM (p_now AT TIME ZONE tz.name))::integer >= p.window_start_hour
      AND extract(hour FROM (p_now AT TIME ZONE tz.name))::integer < p.window_end_hour
      AND (
        a.type = 'attached'
        OR EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.account_id = a.id
            AND e.tier IN ('essential', 'premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > p_now)
        )
        OR EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = a.user_id
            AND lower(trim(u.email)) IN ('matt@soberhelpline.com', 'matt@freedominterventions.com')
        )
      )
    ORDER BY p.next_prompt_at, p.account_id
    FOR UPDATE OF p SKIP LOCKED
  LOOP
    v_event_id := gen_random_uuid();
    INSERT INTO public.push_outbox(
      account_id, kind, title, body, metadata, idempotency_key, scheduled_for
    ) VALUES (
      v_row.account_id,
      'practice_incoming',
      CASE WHEN coalesce(v_row.locale, 'en') LIKE 'es%'
        THEN 'Llamada de práctica entrante'
        ELSE 'Incoming practice call'
      END,
      CASE WHEN coalesce(v_row.locale, 'en') LIKE 'es%'
        THEN 'Tu compañero de práctica con IA está llamando. Contesta cuando estés listo para practicar bajo presión.'
        ELSE 'Your AI practice partner is calling. Answer when you are ready to practice responding under pressure.'
      END,
      jsonb_build_object(
        'kind', 'practice_incoming',
        'screen', 'rehearsal-incoming',
        'event_id', v_event_id::text,
        'expires_at', (p_now + interval '4 hours')::text
      ),
      'practice:' || v_row.account_id::text || ':' || floor(extract(epoch FROM v_row.next_prompt_at))::bigint::text,
      p_now
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    v_inserted := FOUND;
    IF v_inserted THEN
      INSERT INTO public.practice_push_events(event_id, account_id, expires_at, created_at)
      VALUES (v_event_id, v_row.account_id, p_now + interval '4 hours', p_now);
      v_count := v_count + 1;
    END IF;

    -- Deliver at most one catch-up prompt after downtime/token restoration, then
    -- fast-forward from the actual enqueue time instead of replaying a backlog.
    UPDATE public.practice_push_preferences
    SET last_enqueued_at = p_now,
        next_prompt_at = public._next_practice_prompt_at(
          v_row.account_id, v_row.frequency_per_week,
          v_row.window_start_hour, v_row.window_end_hour,
          greatest(v_row.next_prompt_at, p_now)
        )
    WHERE account_id = v_row.account_id;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_due_practice_pushes(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_due_practice_pushes(timestamptz) TO service_role;

-- The outbox sender rechecks this immediately before contacting Expo. A delayed
-- row therefore cannot regain four hours of life after an outage, and opting out
-- or losing entitlement cancels delivery even after enqueue.
CREATE OR REPLACE FUNCTION public.practice_push_delivery_ttl(
  p_event_id uuid,
  p_account_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM public.practice_push_events pe
    JOIN public.practice_push_preferences pp ON pp.account_id = pe.account_id
    JOIN public.accounts a ON a.id = pe.account_id
    WHERE pe.event_id = p_event_id
      AND pe.account_id = p_account_id
      AND pe.expires_at > now()
      AND pe.answered_at IS NULL
      AND pp.enabled
      AND a.push_token IS NOT NULL
      AND (
        a.type = 'attached'
        OR EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.account_id = a.id
            AND e.tier IN ('essential', 'premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = a.user_id
            AND lower(trim(u.email)) IN ('matt@soberhelpline.com', 'matt@freedominterventions.com')
        )
      )
  ) THEN greatest(1, least(14400, floor(extract(epoch FROM (
    (SELECT expires_at FROM public.practice_push_events
     WHERE event_id = p_event_id AND account_id = p_account_id) - now()
  )))::integer)) ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public.practice_push_delivery_ttl(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_push_delivery_ttl(uuid, uuid) TO service_role;

-- A tap is accepted only for the currently authenticated account. This prevents
-- a logged-out notification from account A opening a practice session after the
-- same device signs into account B.
CREATE OR REPLACE FUNCTION public.validate_practice_push_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.my_account_id() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.practice_push_events e
    WHERE e.account_id = public.my_account_id()
      AND e.event_id = p_event_id
      AND e.expires_at > now()
      AND e.answered_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.validate_practice_push_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_practice_push_event(uuid) TO authenticated;

-- Answering is the durable exactly-once boundary. Notification delivery/taps may
-- repeat, but only one authenticated answer can start the AI opening.
CREATE OR REPLACE FUNCTION public.claim_practice_push_event(p_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account_id uuid := public.my_account_id();
BEGIN
  IF v_account_id IS NULL THEN RETURN false; END IF;
  UPDATE public.practice_push_events
  SET answered_at = now()
  WHERE event_id = p_event_id
    AND account_id = v_account_id
    AND answered_at IS NULL
    AND expires_at > now();
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_practice_push_event(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_practice_push_event(uuid) TO authenticated;

CREATE INDEX practice_push_preferences_due_idx
  ON public.practice_push_preferences(next_prompt_at)
  WHERE enabled AND next_prompt_at IS NOT NULL;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.schedule(
  'shl-practice-push-enqueue',
  '2 * * * *',
  $$SELECT public.enqueue_due_practice_pushes()$$
);
