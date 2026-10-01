-- =============================================================================
-- Invitation Engine (CRAFT): the family's pattern map, two daily moves, the
-- receptivity forecast inputs, the outcome loop with per-family learning,
-- admin reporting, and the opt-in evening "Tonight may be a window" push.
--
-- Tables (all owner-read under RLS; every write goes through a validated RPC):
--   loved_one_profiles       pattern map in the family's own words (free tier)
--   invitation_engine_state  setup completion + window-push opt-in (default off)
--   invitation_move_logs     one row per daily move a member marked done
--   invitation_checks        optional "How are they today?" (calm/okay/rough)
--   invitation_forecasts     one forecast snapshot per member per local day
--   invitation_attempts      outcome log after an invitation attempt
--
-- The forecast is scored by the pure module shared between the app
-- (src/lib/invitationForecast.ts) and the invitation-window-push Edge Function
-- (supabase/functions/_shared/invitation-forecast.ts); SQL only gathers inputs.
-- Safety: a 'serious' safety concern anywhere in the family plan switches the
-- engine to its safety-first path and the window push never fires for it.
-- =============================================================================

-- ─── Small pure helpers (internal) ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._invitation_clean_text(p_value text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT btrim(left(
    btrim(regexp_replace(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]+', ' ', 'g'), '\s+', ' ', 'g')),
    greatest(coalesce(p_max, 0), 0)
  ))
$$;

-- A jsonb array of strings → a short, trimmed, de-duplicated text[].
CREATE OR REPLACE FUNCTION public._invitation_clean_list(p_value jsonb, p_max_items integer, p_max_len integer)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_out  text[] := '{}';
  v_seen text[] := '{}';
  v_item text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'array' THEN
    RETURN v_out;
  END IF;
  FOR v_item IN
    SELECT public._invitation_clean_text(t.e #>> '{}', p_max_len)
    FROM jsonb_array_elements(p_value) WITH ORDINALITY AS t(e, n)
    WHERE jsonb_typeof(t.e) = 'string'
    ORDER BY t.n
  LOOP
    CONTINUE WHEN v_item = '' OR lower(v_item) = ANY (v_seen);
    v_out := v_out || v_item;
    v_seen := v_seen || lower(v_item);
    EXIT WHEN cardinality(v_out) >= p_max_items;
  END LOOP;
  RETURN v_out;
END;
$$;

-- Forecast sources the app records with snapshots and attempts.
CREATE OR REPLACE FUNCTION public._invitation_clean_sources(p_sources text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT s ORDER BY s), '{}')
  FROM unnest(coalesce(p_sources, '{}')) AS s
  WHERE s IN ('consequence', 'trend', 'sober_time', 'consistency', 'calm')
$$;

-- Orders forecasts within a day: level first, then score. The forecast kept
-- for a day is that day's best window.
CREATE OR REPLACE FUNCTION public._invitation_forecast_rank(p_level text, p_score integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_level WHEN 'good' THEN 3000 WHEN 'possible' THEN 2000 ELSE 1000 END + coalesce(p_score, 0)
$$;

-- A usable time zone name, or UTC. Validated by asking the tz database
-- directly (microseconds) rather than scanning pg_timezone_names (~30 ms per
-- call), so per-member calls stay cheap; set-based queries join the zone list
-- once instead.
CREATE OR REPLACE FUNCTION public._invitation_valid_tz(p_tz text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_tz IS NULL OR btrim(p_tz) = '' THEN
    RETURN 'UTC';
  END IF;
  PERFORM now() AT TIME ZONE p_tz;
  RETURN p_tz;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN 'UTC';
END;
$$;

CREATE OR REPLACE FUNCTION public._invitation_account_tz(p_account uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((SELECT public._invitation_valid_tz(a.timezone) FROM public.accounts a WHERE a.id = p_account), 'UTC')
$$;

-- Daily move ids the app can show (src/lib/invitationMoves.ts; kept in sync by
-- tests/invitation-moves.test.ts).
CREATE OR REPLACE FUNCTION public._invitation_move_ids()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'reward_name_it', 'reward_sober_plan', 'reward_best_hour', 'reward_thank_effort', 'reward_warm_moment',
    'step_back_when_using', 'let_it_land', 'no_cover_story', 'money_line', 'morning_after',
    'i_statement', 'understanding', 'partial_responsibility', 'offer_help', 'positive_request',
    'listen_first', 'keep_it_short', 'their_costs', 'answer_their_line',
    'pick_the_moment', 'not_while_using', 'after_a_consequence', 'plan_around_trigger',
    'selfcare_one_thing', 'selfcare_support', 'selfcare_sleep', 'selfcare_good_thing', 'selfcare_breathe',
    'safety_plan', 'safety_code_word', 'safety_talk_pro', 'safety_not_alone'
  ]::text[]
$$;

-- The member's calendar day. A client-supplied day is honoured only when it is
-- within a day of the server's account-local day (devices near midnight or in a
-- different zone than the account setting); anything else uses the server day.
CREATE OR REPLACE FUNCTION public._invitation_local_date(p_account uuid, p_local_date date DEFAULT NULL)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE coalesce(public._invitation_account_tz(p_account), 'UTC'))::date;
BEGIN
  IF p_local_date IS NOT NULL AND p_local_date BETWEEN v_today - 1 AND v_today + 1 THEN
    RETURN p_local_date;
  END IF;
  RETURN v_today;
END;
$$;

-- Paid access: Essential/Premier/org entitlements, active attached orgs, or an
-- admin account (QA). Mirrors canAccessInvitationEngine in the app.
CREATE OR REPLACE FUNCTION public._invitation_engine_allowed(p_account uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p_account
      AND (
        (a.type = 'attached'
          AND EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = a.org_id AND o.status = 'active'))
        OR EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.account_id = a.id
            AND e.tier IN ('essential', 'premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = a.user_id
            AND lower(coalesce(u.email, '')) = ANY (public.admin_email_list())
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public._invitation_require_access()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '28000';
  END IF;
  IF NOT public._invitation_engine_allowed(v_account) THEN
    RAISE EXCEPTION 'upgrade_required' USING ERRCODE = '42501';
  END IF;
  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION public._invitation_family_space(p_account uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fm.family_space_id FROM public.family_members fm WHERE fm.account_id = p_account LIMIT 1
$$;

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.loved_one_profiles (
  account_id        uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  name              text NOT NULL DEFAULT '',
  relationship      text NOT NULL DEFAULT '',
  substances        text[] NOT NULL DEFAULT '{}',
  use_triggers      text[] NOT NULL DEFAULT '{}',
  what_use_gives    text[] NOT NULL DEFAULT '{}',
  costs_they_feel   text[] NOT NULL DEFAULT '{}',
  sober_moments     text[] NOT NULL DEFAULT '{}',
  sober_times       text[] NOT NULL DEFAULT '{}',
  usual_phrases     text[] NOT NULL DEFAULT '{}',
  recent_incidents  text[] NOT NULL DEFAULT '{}',
  safety_concern    text NOT NULL DEFAULT ''
                      CHECK (safety_concern IN ('', 'none', 'some', 'serious')),
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invitation_engine_state (
  account_id           uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  setup_completed_at   timestamptz,
  window_push_opt_in   boolean NOT NULL DEFAULT false,
  last_window_push_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invitation_move_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  family_space_id  uuid REFERENCES public.family_spaces(id) ON DELETE SET NULL,
  local_date       date NOT NULL,
  move_id          text NOT NULL CHECK (move_id ~ '^[a-z][a-z0-9_]{1,47}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, local_date, move_id)
);
CREATE INDEX IF NOT EXISTS invitation_move_logs_account_date_idx
  ON public.invitation_move_logs (account_id, local_date DESC);

CREATE TABLE IF NOT EXISTS public.invitation_checks (
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  local_date  date NOT NULL,
  mood        text NOT NULL CHECK (mood IN ('calm', 'okay', 'rough')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, local_date)
);

CREATE TABLE IF NOT EXISTS public.invitation_forecasts (
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  local_date  date NOT NULL,
  level       text NOT NULL CHECK (level IN ('low', 'possible', 'good')),
  score       smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  sources     text[] NOT NULL DEFAULT '{}',
  pushed_at   timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, local_date)
);

CREATE TABLE IF NOT EXISTS public.invitation_attempts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  family_space_id   uuid REFERENCES public.family_spaces(id) ON DELETE SET NULL,
  outcome           text NOT NULL CHECK (outcome IN ('yes', 'not_yet', 'angry', 'didnt_get_to_it')),
  note              text CHECK (note IS NULL OR char_length(note) <= 500),
  local_date        date NOT NULL,
  forecast_level    text CHECK (forecast_level IS NULL OR forecast_level IN ('low', 'possible', 'good')),
  window_sources    text[] NOT NULL DEFAULT '{}',
  line_style        text CHECK (line_style IS NULL OR line_style IN ('warm', 'observation', 'help', 'own')),
  next_window_date  date,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitation_attempts_account_created_idx
  ON public.invitation_attempts (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invitation_attempts_space_created_idx
  ON public.invitation_attempts (family_space_id, created_at DESC)
  WHERE family_space_id IS NOT NULL;

-- ─── RLS: owner read only; writes go through the RPCs below ──────────────────

ALTER TABLE public.loved_one_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_engine_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_move_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_checks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_forecasts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_attempts     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loved_one_profiles: owner select" ON public.loved_one_profiles;
CREATE POLICY "loved_one_profiles: owner select" ON public.loved_one_profiles
  FOR SELECT USING (account_id = public.my_account_id());

DROP POLICY IF EXISTS "invitation_engine_state: owner select" ON public.invitation_engine_state;
CREATE POLICY "invitation_engine_state: owner select" ON public.invitation_engine_state
  FOR SELECT USING (account_id = public.my_account_id());

DROP POLICY IF EXISTS "invitation_move_logs: owner select" ON public.invitation_move_logs;
CREATE POLICY "invitation_move_logs: owner select" ON public.invitation_move_logs
  FOR SELECT USING (account_id = public.my_account_id());

DROP POLICY IF EXISTS "invitation_checks: owner select" ON public.invitation_checks;
CREATE POLICY "invitation_checks: owner select" ON public.invitation_checks
  FOR SELECT USING (account_id = public.my_account_id());

DROP POLICY IF EXISTS "invitation_forecasts: owner select" ON public.invitation_forecasts;
CREATE POLICY "invitation_forecasts: owner select" ON public.invitation_forecasts
  FOR SELECT USING (account_id = public.my_account_id());

DROP POLICY IF EXISTS "invitation_attempts: owner select" ON public.invitation_attempts;
CREATE POLICY "invitation_attempts: owner select" ON public.invitation_attempts
  FOR SELECT USING (account_id = public.my_account_id());

REVOKE ALL ON TABLE public.loved_one_profiles      FROM anon, authenticated;
REVOKE ALL ON TABLE public.invitation_engine_state FROM anon, authenticated;
REVOKE ALL ON TABLE public.invitation_move_logs    FROM anon, authenticated;
REVOKE ALL ON TABLE public.invitation_checks       FROM anon, authenticated;
REVOKE ALL ON TABLE public.invitation_forecasts    FROM anon, authenticated;
REVOKE ALL ON TABLE public.invitation_attempts     FROM anon, authenticated;

GRANT SELECT ON TABLE public.loved_one_profiles      TO authenticated;
GRANT SELECT ON TABLE public.invitation_engine_state TO authenticated;
GRANT SELECT ON TABLE public.invitation_move_logs    TO authenticated;
GRANT SELECT ON TABLE public.invitation_checks       TO authenticated;
GRANT SELECT ON TABLE public.invitation_forecasts    TO authenticated;
GRANT SELECT ON TABLE public.invitation_attempts     TO authenticated;

-- The loved one's effective recovery phase, mirroring normalizeRecoveryPhase
-- in src/lib/recoveryPathway.ts: the Today pathway card writes loved_ones.stage
-- (canonical phases, or the original onboarding stages); status only decides
-- for legacy/blank stages. Kept in sync by tests/invitation-forecast.test.ts.
CREATE OR REPLACE FUNCTION public._invitation_recovery_phase(p_stage text, p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_stage IN ('active_use', 'considering_treatment', 'in_treatment', 'returning_home',
      'early_recovery_30', 'early_recovery_90', 'ongoing_recovery', 'return_to_use', 'unsure') THEN p_stage
    WHEN p_stage = 'using' THEN 'active_use'
    WHEN p_stage = 'seeking_help' THEN 'considering_treatment'
    WHEN p_stage = 'recovery' THEN
      CASE WHEN coalesce(p_status, '') IN ('using', 'escalating', 'crisis') THEN 'return_to_use' ELSE 'early_recovery_30' END
    WHEN p_stage = 'unsure' THEN 'unsure'
    WHEN p_status = 'in_treatment' THEN 'in_treatment'
    WHEN coalesce(p_status, '') IN ('using', 'escalating', 'crisis') THEN 'active_use'
    ELSE 'unsure'
  END
$$;

-- When the loved one's pathway STAGE last changed. updated_at moves for any
-- write (the Tracker's automatic status update on a warning spike, a name
-- edit), so the family phase follows real stage changes only. Maintained by
-- trigger: clients cannot set it. Safe on the populated table: a nullable
-- column, backfilled from updated_at with the trigger detached, then attached.
ALTER TABLE public.loved_ones ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz;

CREATE OR REPLACE FUNCTION public._loved_ones_stage_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.stage_changed_at := CASE WHEN NEW.stage IS NOT NULL THEN clock_timestamp() END;
  ELSIF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := clock_timestamp();
  ELSE
    NEW.stage_changed_at := OLD.stage_changed_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loved_ones_stage_changed_at ON public.loved_ones;
UPDATE public.loved_ones
SET stage_changed_at = updated_at
WHERE stage IS NOT NULL AND stage_changed_at IS NULL;
CREATE TRIGGER loved_ones_stage_changed_at
  BEFORE INSERT OR UPDATE ON public.loved_ones
  FOR EACH ROW EXECUTE FUNCTION public._loved_ones_stage_changed_at();

-- ─── Snapshot: everything the engine and the forecast need, in one read ─────
-- Daily moves are a family plan: the seed is the family space (or the account)
-- and the signals are the union of every member's saved pattern map. Only
-- booleans and coarse time-of-day buckets cross between members — never the
-- family's free text, and never anyone's safety answer.

CREATE OR REPLACE FUNCTION public._invitation_snapshot(p_account uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_space          uuid := public._invitation_family_space(p_account);
  v_tz             text := coalesce(public._invitation_account_tz(p_account), 'UTC');
  v_week           date := date_trunc('week', p_local_date)::date;
  v_members        integer;
  v_sober          boolean;
  v_triggers       boolean;
  v_costs          boolean;
  v_phrases        boolean;
  v_serious        boolean;
  v_sober_times    text[];
  v_profile        public.loved_one_profiles%ROWTYPE;
  v_state          public.invitation_engine_state%ROWTYPE;
  v_consequence_at timestamptz;
  v_warn_this      integer;
  v_warn_last      integer;
  v_recov_this     integer;
  v_recov_last     integer;
  v_move_days      integer;
  v_moves_today    text[];
  v_check          text;
  v_last_attempt   jsonb;
  v_outcome_gate   jsonb;
  v_status         text;
  v_stage          text;
  v_family_phase   text;
  v_today_forecast jsonb;
BEGIN
  -- Safety is per member and never crosses between family members: only the
  -- member who answered 'serious' is on the safety-first path (below).
  WITH members AS (
    SELECT fm.account_id FROM public.family_members fm
    WHERE v_space IS NOT NULL AND fm.family_space_id = v_space
    UNION
    SELECT p_account
  )
  SELECT
    (SELECT count(*) FROM members)::integer,
    coalesce(bool_or(cardinality(p.sober_moments) > 0 OR cardinality(p.sober_times) > 0), false),
    coalesce(bool_or(cardinality(p.use_triggers) > 0), false),
    coalesce(bool_or(cardinality(p.costs_they_feel) > 0), false),
    coalesce(bool_or(cardinality(p.usual_phrases) > 0), false),
    coalesce((
      SELECT array_agg(DISTINCT t ORDER BY t)
      FROM public.loved_one_profiles p2, unnest(p2.sober_times) AS t
      WHERE p2.account_id IN (SELECT account_id FROM members)
    ), '{}')
  INTO v_members, v_sober, v_triggers, v_costs, v_phrases, v_sober_times
  FROM public.loved_one_profiles p
  WHERE p.account_id IN (SELECT account_id FROM members);

  SELECT * INTO v_profile FROM public.loved_one_profiles WHERE account_id = p_account;
  SELECT * INTO v_state FROM public.invitation_engine_state WHERE account_id = p_account;
  v_serious := coalesce(v_profile.safety_concern = 'serious', false);
  SELECT status, stage INTO v_status, v_stage FROM public.loved_ones WHERE account_id = p_account;
  -- Treatment / recovery pauses are family-level too: the most recent STAGE
  -- change among her and the current members of her family space decides the
  -- phase (a later "return to use" reopens windows; a status-only update such
  -- as the Tracker's warning spike never does). With no stage anywhere, her
  -- own status decides. Only the phase is shared — never notes, never anyone's
  -- safety answer.
  SELECT public._invitation_recovery_phase(lo.stage, lo.status) INTO v_family_phase
  FROM public.loved_ones lo
  WHERE lo.stage IS NOT NULL
    AND (lo.account_id = p_account
      OR (v_space IS NOT NULL AND lo.account_id IN (
        SELECT fm.account_id FROM public.family_members fm WHERE fm.family_space_id = v_space
      )))
  ORDER BY lo.stage_changed_at DESC NULLS LAST, (lo.account_id = p_account) DESC
  LIMIT 1;
  IF v_family_phase IS NULL AND v_status IS NOT NULL THEN
    v_family_phase := public._invitation_recovery_phase(NULL, v_status);
  END IF;
  SELECT jsonb_build_object('level', f.level, 'score', f.score) INTO v_today_forecast
  FROM public.invitation_forecasts f
  WHERE f.account_id = p_account AND f.local_date = p_local_date;

  SELECT max(occurred_at) INTO v_consequence_at
  FROM public.consequence_events
  WHERE account_id = p_account AND occurred_at <= now() + interval '5 minutes';

  -- Tracker trend, like for like: this week so far against last week up to
  -- the same weekday (signs ticked later last week don't count yet). The
  -- scorer ignores the trend entirely while this week has no entries.
  SELECT
    count(*) FILTER (WHERE kind = 'warning' AND week = v_week),
    count(*) FILTER (WHERE kind = 'warning' AND week = v_week - 7
      AND (created_at AT TIME ZONE v_tz)::date <= p_local_date - 7),
    count(*) FILTER (WHERE kind = 'recovery' AND week = v_week),
    count(*) FILTER (WHERE kind = 'recovery' AND week = v_week - 7
      AND (created_at AT TIME ZONE v_tz)::date <= p_local_date - 7)
  INTO v_warn_this, v_warn_last, v_recov_this, v_recov_last
  FROM public.tracker_logs
  WHERE account_id = p_account AND week BETWEEN v_week - 7 AND v_week;

  SELECT count(DISTINCT local_date) INTO v_move_days
  FROM public.invitation_move_logs
  WHERE account_id = p_account AND local_date > p_local_date - 7 AND local_date <= p_local_date;

  SELECT coalesce(array_agg(move_id ORDER BY created_at), '{}') INTO v_moves_today
  FROM public.invitation_move_logs
  WHERE account_id = p_account AND local_date = p_local_date;

  SELECT mood INTO v_check
  FROM public.invitation_checks
  WHERE account_id = p_account AND local_date = p_local_date;

  SELECT jsonb_build_object(
    'outcome', a.outcome,
    'local_date', a.local_date,
    'created_at', a.created_at,
    'next_window_date', a.next_window_date
  ) INTO v_last_attempt
  FROM public.invitation_attempts a
  WHERE a.account_id = p_account
  -- The most recent ask by the day it happened (a late log of yesterday's
  -- attempt doesn't hide today's yes).
  ORDER BY a.local_date DESC, a.created_at DESC
  LIMIT 1;

  -- Outcome pauses are family-level: the latest yes / not yet / angry logged
  -- by her or by a current member of her family space (inside that space —
  -- the same scope invitation_learning shares). Outcome and dates only; never
  -- notes or anyone's safety answer.
  SELECT jsonb_build_object(
    'outcome', a.outcome,
    'local_date', a.local_date,
    'next_window_date', a.next_window_date
  ) INTO v_outcome_gate
  FROM public.invitation_attempts a
  WHERE a.outcome IN ('yes', 'not_yet', 'angry')
    AND (
      a.account_id = p_account
      OR (v_space IS NOT NULL
        AND a.family_space_id = v_space
        AND a.account_id IN (
          SELECT fm.account_id FROM public.family_members fm WHERE fm.family_space_id = v_space
        ))
    )
  ORDER BY a.local_date DESC, a.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'local_date', p_local_date,
    'has_access', public._invitation_engine_allowed(p_account),
    'profile', jsonb_build_object(
      'saved', v_profile.account_id IS NOT NULL,
      'completed', v_profile.completed_at IS NOT NULL,
      'safety_concern', coalesce(v_profile.safety_concern, '')
    ),
    'state', jsonb_build_object(
      'setup_completed_at', v_state.setup_completed_at,
      'window_push_opt_in', coalesce(v_state.window_push_opt_in, false),
      'last_window_push_at', v_state.last_window_push_at
    ),
    'plan', jsonb_build_object(
      'scope', CASE WHEN v_space IS NULL THEN 'solo' ELSE 'family' END,
      'seed', coalesce(v_space, p_account)::text,
      'members', coalesce(v_members, 1),
      'signals', jsonb_build_object(
        'sober_moments', coalesce(v_sober, false),
        'triggers', coalesce(v_triggers, false),
        'costs', coalesce(v_costs, false),
        'phrases', coalesce(v_phrases, false),
        'sober_times', to_jsonb(coalesce(v_sober_times, '{}'))
      )
    ),
    -- This member's own answer only (never a family-level signal).
    'safety_first', coalesce(v_serious, false),
    'loved_one_status', v_status,
    'loved_one_stage', v_stage,
    'recovery_phase', v_family_phase,
    'today', jsonb_build_object(
      'moves_done', to_jsonb(coalesce(v_moves_today, '{}')),
      'check', v_check,
      'forecast', v_today_forecast
    ),
    'inputs', jsonb_build_object(
      'latest_consequence_at', v_consequence_at,
      'warning_this_week', coalesce(v_warn_this, 0),
      'warning_last_week', coalesce(v_warn_last, 0),
      'recovery_this_week', coalesce(v_recov_this, 0),
      'recovery_last_week', coalesce(v_recov_last, 0),
      'move_days_7', coalesce(v_move_days, 0)
    ),
    'last_attempt', v_last_attempt,
    'outcome_gate', v_outcome_gate
  );
END;
$$;

-- ─── Member RPCs ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.my_invitation_engine(p_local_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '28000';
  END IF;
  RETURN public._invitation_snapshot(v_account, public._invitation_local_date(v_account, p_local_date));
END;
$$;

-- The pattern map is the free hook: any signed-in member may save it.
CREATE OR REPLACE FUNCTION public.save_loved_one_profile(p_profile jsonb, p_complete boolean DEFAULT false)
RETURNS public.loved_one_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
  v_safety  text;
  v_times   text[];
  v_row     public.loved_one_profiles;
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '28000';
  END IF;
  IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' THEN
    RAISE EXCEPTION 'invalid_profile' USING ERRCODE = '22023';
  END IF;

  v_safety := coalesce(p_profile->>'safetyConcern', '');
  IF v_safety NOT IN ('', 'none', 'some', 'serious') THEN
    RAISE EXCEPTION 'invalid_safety_concern' USING ERRCODE = '22023';
  END IF;
  -- A finished pattern map always carries an explicit safety answer.
  IF coalesce(p_complete, false) AND v_safety = '' THEN
    RAISE EXCEPTION 'safety_answer_required' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(DISTINCT t ORDER BY t), '{}') INTO v_times
  FROM unnest(public._invitation_clean_list(p_profile->'soberTimes', 4, 16)) AS t
  WHERE t IN ('morning', 'afternoon', 'evening', 'weekend');

  INSERT INTO public.loved_one_profiles AS lp (
    account_id, name, relationship, substances, use_triggers, what_use_gives,
    costs_they_feel, sober_moments, sober_times, usual_phrases, recent_incidents,
    safety_concern, completed_at, updated_at
  ) VALUES (
    v_account,
    public._invitation_clean_text(p_profile->>'name', 40),
    public._invitation_clean_text(p_profile->>'relationship', 40),
    public._invitation_clean_list(p_profile->'substances', 6, 40),
    public._invitation_clean_list(p_profile->'useTriggers', 6, 160),
    public._invitation_clean_list(p_profile->'whatUseGives', 6, 160),
    public._invitation_clean_list(p_profile->'costsTheyFeel', 6, 160),
    public._invitation_clean_list(p_profile->'soberMoments', 6, 160),
    v_times,
    public._invitation_clean_list(p_profile->'usualPhrases', 6, 160),
    public._invitation_clean_list(p_profile->'recentIncidents', 6, 160),
    v_safety,
    CASE WHEN coalesce(p_complete, false) THEN now() END,
    now()
  )
  ON CONFLICT (account_id) DO UPDATE SET
    name = excluded.name,
    relationship = excluded.relationship,
    substances = excluded.substances,
    use_triggers = excluded.use_triggers,
    what_use_gives = excluded.what_use_gives,
    costs_they_feel = excluded.costs_they_feel,
    sober_moments = excluded.sober_moments,
    sober_times = excluded.sober_times,
    usual_phrases = excluded.usual_phrases,
    recent_incidents = excluded.recent_incidents,
    -- An empty answer (a draft built without the saved map) never erases a
    -- stored one — above all never a 'serious'. Explicit changes still apply.
    safety_concern = CASE
      WHEN excluded.safety_concern = '' THEN lp.safety_concern
      ELSE excluded.safety_concern
    END,
    completed_at = CASE
      WHEN coalesce(p_complete, false) THEN coalesce(lp.completed_at, now())
      ELSE lp.completed_at
    END,
    updated_at = now()
  RETURNING lp.* INTO v_row;

  -- A serious safety concern turns the evening push off at the source as well.
  IF v_row.safety_concern = 'serious' THEN
    UPDATE public.invitation_engine_state
    SET window_push_opt_in = false, updated_at = now()
    WHERE account_id = v_account AND window_push_opt_in;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_invitation_setup(p_window_push boolean DEFAULT false)
RETURNS public.invitation_engine_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public._invitation_require_access();
  v_serious boolean;
  v_row     public.invitation_engine_state;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.loved_one_profiles WHERE account_id = v_account AND completed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'pattern_map_required' USING ERRCODE = '22023';
  END IF;
  v_serious := coalesce((public._invitation_snapshot(v_account, public._invitation_local_date(v_account))
    #>> '{safety_first}')::boolean, false);

  INSERT INTO public.invitation_engine_state AS s (account_id, setup_completed_at, window_push_opt_in, updated_at)
  VALUES (v_account, now(), coalesce(p_window_push, false) AND NOT v_serious, now())
  ON CONFLICT (account_id) DO UPDATE SET
    setup_completed_at = coalesce(s.setup_completed_at, now()),
    window_push_opt_in = coalesce(p_window_push, false) AND NOT v_serious,
    updated_at = now()
  RETURNING s.* INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_invitation_window_push(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public._invitation_require_access();
  v_serious boolean;
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_preference' USING ERRCODE = '22023';
  END IF;
  v_serious := coalesce((public._invitation_snapshot(v_account, public._invitation_local_date(v_account))
    #>> '{safety_first}')::boolean, false);
  IF p_enabled AND v_serious THEN
    RAISE EXCEPTION 'safety_first' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.invitation_engine_state AS s (account_id, window_push_opt_in, updated_at)
  VALUES (v_account, p_enabled, now())
  ON CONFLICT (account_id) DO UPDATE SET window_push_opt_in = p_enabled, updated_at = now();
  RETURN p_enabled;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_invitation_move_done(p_move_id text, p_local_date date, p_done boolean)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public._invitation_require_access();
  v_date    date;
  v_out     text[];
BEGIN
  IF p_move_id IS NULL OR NOT (p_move_id = ANY (public._invitation_move_ids())) THEN
    RAISE EXCEPTION 'invalid_move' USING ERRCODE = '22023';
  END IF;
  v_date := public._invitation_local_date(v_account, p_local_date);
  IF p_local_date IS NULL OR v_date <> p_local_date THEN
    RAISE EXCEPTION 'invalid_local_date' USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_done, false) THEN
    INSERT INTO public.invitation_move_logs (account_id, family_space_id, local_date, move_id)
    VALUES (v_account, public._invitation_family_space(v_account), v_date, p_move_id)
    ON CONFLICT (account_id, local_date, move_id) DO NOTHING;
  ELSE
    DELETE FROM public.invitation_move_logs
    WHERE account_id = v_account AND local_date = v_date AND move_id = p_move_id;
  END IF;

  SELECT coalesce(array_agg(move_id ORDER BY created_at), '{}') INTO v_out
  FROM public.invitation_move_logs
  WHERE account_id = v_account AND local_date = v_date;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_invitation_check(p_local_date date, p_mood text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public._invitation_require_access();
  v_date    date;
BEGIN
  v_date := public._invitation_local_date(v_account, p_local_date);
  IF p_local_date IS NULL OR v_date <> p_local_date THEN
    RAISE EXCEPTION 'invalid_local_date' USING ERRCODE = '22023';
  END IF;
  IF p_mood IS NULL THEN
    DELETE FROM public.invitation_checks WHERE account_id = v_account AND local_date = v_date;
    RETURN NULL;
  END IF;
  IF p_mood NOT IN ('calm', 'okay', 'rough') THEN
    RAISE EXCEPTION 'invalid_check' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.invitation_checks (account_id, local_date, mood)
  VALUES (v_account, v_date, p_mood)
  ON CONFLICT (account_id, local_date) DO UPDATE SET mood = excluded.mood, updated_at = now();
  RETURN p_mood;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invitation_forecast(
  p_local_date date,
  p_level text,
  p_score integer,
  p_sources text[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public._invitation_require_access();
  v_date    date;
BEGIN
  v_date := public._invitation_local_date(v_account, p_local_date);
  IF p_local_date IS NULL OR v_date <> p_local_date THEN
    RAISE EXCEPTION 'invalid_local_date' USING ERRCODE = '22023';
  END IF;
  IF p_level IS NULL OR p_level NOT IN ('low', 'possible', 'good')
     OR p_score IS NULL OR p_score NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'invalid_forecast' USING ERRCODE = '22023';
  END IF;
  -- Keep the day's best window: an invitation logged later that day (or the
  -- next morning) is attributed to the window the family actually had.
  INSERT INTO public.invitation_forecasts AS f (account_id, local_date, level, score, sources)
  VALUES (v_account, v_date, p_level, p_score, public._invitation_clean_sources(p_sources))
  ON CONFLICT (account_id, local_date) DO UPDATE SET
    level = excluded.level,
    score = excluded.score,
    sources = excluded.sources,
    updated_at = now()
  WHERE public._invitation_forecast_rank(excluded.level, excluded.score)
     >= public._invitation_forecast_rank(f.level, f.score);
END;
$$;

-- One-tap outcome log. "Yes" also alerts every admin device so Matt can reach
-- out (no member data rides in the push; Admin shows who). Returns the saved
-- attempt plus coach_alerted: whether an admin alert actually exists for a yes
-- in the last six hours, so the app never claims Matt was told when he wasn't.
-- (Return type changed before this migration shipped; the DROP keeps it
-- re-runnable.)
DROP FUNCTION IF EXISTS public.log_invitation_attempt(text, date, text, text, text[], text, date);
CREATE OR REPLACE FUNCTION public.log_invitation_attempt(
  p_outcome text,
  p_local_date date,
  p_note text DEFAULT NULL,
  p_forecast_level text DEFAULT NULL,
  p_window_sources text[] DEFAULT '{}',
  p_line_style text DEFAULT NULL,
  p_next_window_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account   uuid := public._invitation_require_access();
  v_date      date;
  v_note      text;
  v_next      date;
  v_recent    boolean;
  v_level     text;
  v_sources   text[];
  v_alerted   boolean := false;
  v_row       public.invitation_attempts;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('yes', 'not_yet', 'angry', 'didnt_get_to_it') THEN
    RAISE EXCEPTION 'invalid_outcome' USING ERRCODE = '22023';
  END IF;
  v_date := public._invitation_local_date(v_account, p_local_date);
  v_note := nullif(public._invitation_clean_text(p_note, 500), '');
  v_next := CASE
    WHEN p_outcome <> 'yes' AND p_next_window_date BETWEEN v_date AND v_date + 30 THEN p_next_window_date
  END;

  SELECT EXISTS (
    SELECT 1 FROM public.invitation_attempts
    WHERE account_id = v_account AND outcome = 'yes' AND created_at > now() - interval '6 hours'
  ) INTO v_recent;

  -- Attribute the attempt to the forecast recorded for the day of the ask
  -- (the day's best window), not to whatever the forecast says at logging
  -- time. The client's values are only a fallback for a day with no record.
  SELECT f.level, f.sources INTO v_level, v_sources
  FROM public.invitation_forecasts f
  WHERE f.account_id = v_account AND f.local_date = v_date;
  IF NOT FOUND THEN
    v_level := CASE WHEN p_forecast_level IN ('low', 'possible', 'good') THEN p_forecast_level END;
    v_sources := public._invitation_clean_sources(p_window_sources);
  END IF;

  INSERT INTO public.invitation_attempts (
    account_id, family_space_id, outcome, note, local_date, forecast_level,
    window_sources, line_style, next_window_date
  ) VALUES (
    v_account,
    public._invitation_family_space(v_account),
    p_outcome,
    v_note,
    v_date,
    v_level,
    v_sources,
    CASE WHEN p_line_style IN ('warm', 'observation', 'help', 'own') THEN p_line_style END,
    v_next
  )
  RETURNING * INTO v_row;

  IF p_outcome = 'yes' AND NOT v_recent THEN
    INSERT INTO public.push_outbox (account_id, kind, title, body, metadata, idempotency_key, scheduled_for)
    SELECT
      a.id,
      'admin_invitation_yes',
      'A family just heard YES',
      'A member logged that their loved one said yes to treatment. Open Admin to reach out.',
      jsonb_build_object('kind', 'admin_invitation_yes'),
      'invitation-yes:' || v_row.id::text || ':' || a.id::text,
      now()
    FROM public.accounts a
    JOIN auth.users u ON u.id = a.user_id
    WHERE lower(coalesce(u.email, '')) = ANY (public.admin_email_list())
      AND a.push_token IS NOT NULL
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;

  IF p_outcome = 'yes' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.invitation_attempts t
      JOIN public.push_outbox o
        ON o.kind = 'admin_invitation_yes'
       AND o.idempotency_key LIKE 'invitation-yes:' || t.id::text || ':%'
      WHERE t.account_id = v_account
        AND t.outcome = 'yes'
        AND t.created_at > now() - interval '6 hours'
    ) INTO v_alerted;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'outcome', v_row.outcome,
    'local_date', v_row.local_date,
    'next_window_date', v_row.next_window_date,
    'forecast_level', v_row.forecast_level,
    'coach_alerted', v_alerted
  );
END;
$$;

-- Attempts across the family plan, for "what's working for your family".
-- Other members' notes never leave their account.
CREATE OR REPLACE FUNCTION public.invitation_learning()
RETURNS TABLE (
  outcome text,
  window_sources text[],
  line_style text,
  created_at timestamptz,
  mine boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public._invitation_require_access();
  v_space   uuid := public._invitation_family_space(v_account);
BEGIN
  RETURN QUERY
  SELECT a.outcome, a.window_sources, a.line_style, a.created_at, a.account_id = v_account
  FROM public.invitation_attempts a
  WHERE a.created_at > now() - interval '365 days'
    AND (
      a.account_id = v_account
      -- Someone else's attempt counts only if it was logged inside this family
      -- space by a current member: history never follows a member who moves.
      OR (v_space IS NOT NULL
        AND a.family_space_id = v_space
        AND a.account_id IN (
          SELECT fm.account_id FROM public.family_members fm WHERE fm.family_space_id = v_space
        ))
    )
  ORDER BY a.created_at DESC
  LIMIT 300;
END;
$$;

-- ─── Admin reporting ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_invitation_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  WITH family_key AS (
    SELECT a.id AS account_id, coalesce(fm.family_space_id::text, a.id::text) AS fkey
    FROM public.accounts a
    LEFT JOIN public.family_members fm ON fm.account_id = a.id
  ),
  setups AS (
    SELECT fk.fkey, min(s.setup_completed_at) AS setup_at
    FROM public.invitation_engine_state s
    JOIN family_key fk ON fk.account_id = s.account_id
    WHERE s.setup_completed_at IS NOT NULL
    GROUP BY fk.fkey
  ),
  attempts AS (
    SELECT t.*, fk.fkey
    FROM public.invitation_attempts t
    JOIN family_key fk ON fk.account_id = t.account_id
  ),
  first_yes AS (
    SELECT fkey, min(created_at) AS yes_at FROM attempts WHERE outcome = 'yes' GROUP BY fkey
  ),
  days_to_yes AS (
    SELECT extract(epoch FROM (y.yes_at - s.setup_at)) / 86400.0 AS days
    FROM first_yes y JOIN setups s USING (fkey)
    WHERE y.yes_at >= s.setup_at
  ),
  weeks AS (
    SELECT generate_series(
      date_trunc('week', now())::date - 28,
      date_trunc('week', now())::date,
      interval '7 days'
    )::date AS week_start
  )
  SELECT jsonb_build_object(
    'families_using', (SELECT count(*) FROM setups),
    'profiles_mapped', (SELECT count(*) FROM public.loved_one_profiles WHERE completed_at IS NOT NULL),
    'window_push_opt_ins', (SELECT count(*) FROM public.invitation_engine_state WHERE window_push_opt_in),
    'attempts', (SELECT count(*) FROM attempts),
    'asks', (SELECT count(*) FROM attempts WHERE outcome <> 'didnt_get_to_it'),
    'outcomes', jsonb_build_object(
      'yes', (SELECT count(*) FROM attempts WHERE outcome = 'yes'),
      'not_yet', (SELECT count(*) FROM attempts WHERE outcome = 'not_yet'),
      'angry', (SELECT count(*) FROM attempts WHERE outcome = 'angry'),
      'didnt_get_to_it', (SELECT count(*) FROM attempts WHERE outcome = 'didnt_get_to_it')
    ),
    'yes_rate', (
      SELECT CASE WHEN count(*) FILTER (WHERE outcome <> 'didnt_get_to_it') = 0 THEN NULL
        ELSE round(
          (count(*) FILTER (WHERE outcome = 'yes'))::numeric
            / (count(*) FILTER (WHERE outcome <> 'didnt_get_to_it')),
          3)
      END
      FROM attempts
    ),
    'families_with_yes', (SELECT count(*) FROM first_yes),
    'median_days_to_yes', (
      SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY days))::numeric, 1) FROM days_to_yes
    ),
    'moves_done', (SELECT count(*) FROM public.invitation_move_logs),
    'last_30_days', jsonb_build_object(
      'attempts', (SELECT count(*) FROM attempts WHERE created_at >= now() - interval '30 days'),
      'yes', (SELECT count(*) FROM attempts WHERE outcome = 'yes' AND created_at >= now() - interval '30 days'),
      'moves_done', (SELECT count(*) FROM public.invitation_move_logs WHERE created_at >= now() - interval '30 days'),
      'new_families', (SELECT count(*) FROM setups WHERE setup_at >= now() - interval '30 days'),
      'active_families', (
        SELECT count(DISTINCT fk.fkey)
        FROM public.invitation_move_logs m JOIN family_key fk ON fk.account_id = m.account_id
        WHERE m.created_at >= now() - interval '30 days'
      )
    ),
    'prior_30_days', jsonb_build_object(
      'attempts', (SELECT count(*) FROM attempts
        WHERE created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days'),
      'yes', (SELECT count(*) FROM attempts WHERE outcome = 'yes'
        AND created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days'),
      'moves_done', (SELECT count(*) FROM public.invitation_move_logs
        WHERE created_at >= now() - interval '60 days' AND created_at < now() - interval '30 days'),
      'new_families', (SELECT count(*) FROM setups
        WHERE setup_at >= now() - interval '60 days' AND setup_at < now() - interval '30 days'),
      'active_families', (
        SELECT count(DISTINCT fk.fkey)
        FROM public.invitation_move_logs m JOIN family_key fk ON fk.account_id = m.account_id
        WHERE m.created_at >= now() - interval '60 days' AND m.created_at < now() - interval '30 days'
      )
    ),
    'weekly', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'week_start', w.week_start,
        'attempts', (SELECT count(*) FROM attempts t
          WHERE t.created_at >= w.week_start AND t.created_at < w.week_start + 7),
        'yes', (SELECT count(*) FROM attempts t WHERE t.outcome = 'yes'
          AND t.created_at >= w.week_start AND t.created_at < w.week_start + 7),
        'moves_done', (SELECT count(*) FROM public.invitation_move_logs m
          WHERE m.created_at >= w.week_start AND m.created_at < w.week_start + 7)
      ) ORDER BY w.week_start), '[]'::jsonb)
      FROM weeks w
    ),
    'recent_yes', (
      SELECT coalesce(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM (
        -- Who to call, not what they wrote: member notes stay with the member.
        SELECT t.id, t.created_at, a.first_name, a.last_name, u.email::text AS email
        FROM public.invitation_attempts t
        JOIN public.accounts a ON a.id = t.account_id
        LEFT JOIN auth.users u ON u.id = a.user_id
        WHERE t.outcome = 'yes' AND t.created_at >= now() - interval '14 days'
        ORDER BY t.created_at DESC
        LIMIT 10
      ) r
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ─── Evening window push (service role) ──────────────────────────────────────
-- Why a member must not get an invitation-window push on a given local day,
-- or NULL. Mirrors the shared forecast's hold/pause/rest rules: her own
-- safety answer; the loved one in treatment, coming home or in recovery; a
-- yes in the family within 30 days; or a family "not yet"/anger until its
-- suggested next window.
CREATE OR REPLACE FUNCTION public._invitation_window_blocked(p_snap jsonb, p_local_date date)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce((p_snap #>> '{safety_first}')::boolean, true)
      OR coalesce(p_snap #>> '{profile,safety_concern}', '') = 'serious' THEN 'safety'
    WHEN NOT coalesce((p_snap #>> '{profile,completed}')::boolean, false) THEN 'incomplete'
    WHEN p_snap ->> 'recovery_phase' = 'in_treatment' THEN 'in_treatment'
    WHEN p_snap ->> 'recovery_phase' = 'returning_home' THEN 'returning_home'
    WHEN p_snap ->> 'recovery_phase' IN ('early_recovery_30', 'early_recovery_90', 'ongoing_recovery') THEN 'in_recovery'
    WHEN p_snap #>> '{outcome_gate,outcome}' = 'yes'
      AND (p_snap #>> '{outcome_gate,local_date}')::date > p_local_date - 30 THEN 'after_yes'
    WHEN p_snap #>> '{outcome_gate,outcome}' IN ('not_yet', 'angry')
      AND (p_snap #>> '{outcome_gate,next_window_date}')::date > p_local_date THEN 'resting'
    ELSE NULL
  END
$$;

-- invitation-window-push calls this hourly; it returns only members who opted
-- in, finished setup, can receive pushes, have paid access, are not on their
-- own safety-first path, are not paused (in treatment, after a yes) or resting
-- (after "not yet"/"angry" until the next window), were not pushed yesterday
-- or today (local days), and whose local clock is in the evening hour now.

CREATE OR REPLACE FUNCTION public.invitation_window_push_candidates(
  p_now timestamptz DEFAULT now(),
  p_local_hour integer DEFAULT 17
)
RETURNS TABLE (
  account_id uuid,
  locale text,
  local_date date,
  local_hour integer,
  local_weekday integer,
  snapshot jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_local_hour IS NULL OR p_local_hour NOT BETWEEN 0 AND 23 THEN
    RAISE EXCEPTION 'invalid_local_hour' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH zones AS (
    -- One scan of the zone list per run (set-based), not one per member.
    SELECT z.name FROM pg_timezone_names z
  ),
  base AS (
    SELECT a.id, coalesce(a.locale, 'en') AS loc, coalesce(z.name, 'UTC') AS tz,
      s.last_window_push_at
    FROM public.invitation_engine_state s
    JOIN public.accounts a ON a.id = s.account_id
    LEFT JOIN zones z ON z.name = nullif(a.timezone, '')
    WHERE s.window_push_opt_in
      AND s.setup_completed_at IS NOT NULL
      AND a.push_token IS NOT NULL
  ),
  local_now AS (
    SELECT b.id, b.loc, (p_now AT TIME ZONE b.tz)::date AS d,
      extract(hour FROM (p_now AT TIME ZONE b.tz))::integer AS h,
      extract(dow FROM (p_now AT TIME ZONE b.tz))::integer AS dow
    FROM base b
    WHERE extract(hour FROM (p_now AT TIME ZONE b.tz))::integer = p_local_hour
      -- "At most once per 48h" by local calendar day: the hourly cron fires at
      -- the same local hour each evening, so an elapsed-time check would
      -- slip to every third evening.
      AND (b.last_window_push_at IS NULL
        OR (b.last_window_push_at AT TIME ZONE b.tz)::date <= (p_now AT TIME ZONE b.tz)::date - 2)
      AND public._invitation_engine_allowed(b.id)
  ),
  snaps AS (
    SELECT l.*, public._invitation_snapshot(l.id, l.d) AS snap FROM local_now l
  )
  SELECT s.id, s.loc, s.d, s.h, s.dow, s.snap
  FROM snaps s
  WHERE public._invitation_window_blocked(s.snap, s.d) IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_invitation_window_push(
  p_account_id uuid,
  p_local_date date,
  p_score integer,
  p_sources text[],
  p_title text,
  p_body text,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.invitation_engine_state%ROWTYPE;
  v_snap  jsonb;
  v_title text := public._invitation_clean_text(p_title, 120);
  v_body  text := public._invitation_clean_text(p_body, 240);
BEGIN
  IF p_account_id IS NULL OR p_local_date IS NULL OR v_title = '' OR v_body = ''
     OR p_score IS NULL OR p_score NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'invalid_window_push' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_state FROM public.invitation_engine_state
  WHERE account_id = p_account_id
  FOR UPDATE;
  IF NOT FOUND OR NOT v_state.window_push_opt_in OR v_state.setup_completed_at IS NULL
     OR (v_state.last_window_push_at IS NOT NULL
       AND (v_state.last_window_push_at AT TIME ZONE public._invitation_account_tz(p_account_id))::date > p_local_date - 2)
     OR NOT public._invitation_engine_allowed(p_account_id) THEN
    RETURN false;
  END IF;

  -- Re-check at enqueue time: a profile edit, a logged outcome or a change of
  -- treatment status since selection wins.
  v_snap := public._invitation_snapshot(p_account_id, p_local_date);
  IF public._invitation_window_blocked(v_snap, p_local_date) IS NOT NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.push_outbox (account_id, kind, title, body, metadata, idempotency_key, scheduled_for)
  VALUES (
    p_account_id,
    'invitation_window',
    v_title,
    v_body,
    jsonb_build_object('kind', 'invitation_window'),
    'invitation-window:' || p_account_id::text || ':' || p_local_date::text,
    p_now
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.invitation_engine_state
  SET last_window_push_at = p_now, updated_at = now()
  WHERE account_id = p_account_id;

  INSERT INTO public.invitation_forecasts AS f (account_id, local_date, level, score, sources, pushed_at)
  VALUES (p_account_id, p_local_date, 'good', p_score, public._invitation_clean_sources(p_sources), p_now)
  ON CONFLICT (account_id, local_date) DO UPDATE SET
    level = CASE WHEN public._invitation_forecast_rank(excluded.level, excluded.score)
      >= public._invitation_forecast_rank(f.level, f.score) THEN excluded.level ELSE f.level END,
    score = CASE WHEN public._invitation_forecast_rank(excluded.level, excluded.score)
      >= public._invitation_forecast_rank(f.level, f.score) THEN excluded.score ELSE f.score END,
    sources = CASE WHEN public._invitation_forecast_rank(excluded.level, excluded.score)
      >= public._invitation_forecast_rank(f.level, f.score) THEN excluded.sources ELSE f.sources END,
    pushed_at = excluded.pushed_at,
    updated_at = now();

  RETURN true;
END;
$$;

-- pg_cron → invitation-window-push, hourly. Same vault service-key lookup as
-- set_host_live: without a stored key (local dev) the call is skipped quietly.
CREATE OR REPLACE FUNCTION public.dispatch_invitation_window_push()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_service_key text;
BEGIN
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
  LIMIT 1;

  IF v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/invitation-window-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('job', 'window')
    );
  END IF;
END;
$$;

-- ─── Function privileges ─────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public._invitation_clean_text(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_clean_list(jsonb, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_clean_sources(text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_forecast_rank(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_valid_tz(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_move_ids() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_window_blocked(jsonb, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_recovery_phase(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._loved_ones_stage_changed_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_account_tz(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_local_date(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_engine_allowed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_require_access() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_family_space(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._invitation_snapshot(uuid, date) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.my_invitation_engine(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_loved_one_profile(jsonb, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.complete_invitation_setup(boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_invitation_window_push(boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_invitation_move_done(text, date, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_invitation_check(date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_invitation_forecast(date, text, integer, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_invitation_attempt(text, date, text, text, text[], text, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.invitation_learning() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_invitation_stats() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.my_invitation_engine(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_loved_one_profile(jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_invitation_setup(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_invitation_window_push(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_invitation_move_done(text, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_invitation_check(date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invitation_forecast(date, text, integer, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_invitation_attempt(text, date, text, text, text[], text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invitation_learning() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_invitation_stats() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.invitation_window_push_candidates(timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_invitation_window_push(uuid, date, integer, text[], text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_invitation_window_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invitation_window_push_candidates(timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_invitation_window_push(uuid, date, integer, text[], text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_invitation_window_push() TO service_role;

-- ─── Schedule ────────────────────────────────────────────────────────────────
-- Hourly at :20 (UTC). The function itself only pushes members whose local
-- clock reads 5 PM, so every member is evaluated once per evening.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

SELECT cron.schedule(
  'shl-invitation-window-push',
  '20 * * * *',
  $$SELECT public.dispatch_invitation_window_push()$$
);
