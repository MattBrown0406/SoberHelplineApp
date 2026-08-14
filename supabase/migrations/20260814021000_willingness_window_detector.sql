-- Willingness-Window Detector: account-owned consequence events and situation posture.

CREATE TABLE public.consequence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'legal', 'medical', 'employment', 'relationship', 'housing', 'financial', 'other'
  )),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consequence_events_account_occurred_idx
  ON public.consequence_events (account_id, occurred_at DESC);

ALTER TABLE public.consequence_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consequence_events: owner select"
  ON public.consequence_events FOR SELECT
  USING (account_id = public.my_account_id());

CREATE POLICY "consequence_events: owner delete"
  ON public.consequence_events FOR DELETE
  USING (account_id = public.my_account_id());

REVOKE ALL ON TABLE public.consequence_events FROM anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.consequence_events TO authenticated;

CREATE OR REPLACE FUNCTION public.log_consequence_event(
  p_event_type text,
  p_occurred_at timestamptz DEFAULT now()
)
RETURNS public.consequence_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
  v_row public.consequence_events;
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '42501';
  END IF;
  IF p_event_type IS NULL OR p_event_type NOT IN (
    'legal', 'medical', 'employment', 'relationship', 'housing', 'financial', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid_consequence_type' USING ERRCODE = '22023';
  END IF;
  IF p_occurred_at IS NULL
     OR p_occurred_at < now() - interval '30 days'
     OR p_occurred_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'invalid_consequence_time' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.consequence_events (account_id, event_type, occurred_at)
  VALUES (v_account, p_event_type, p_occurred_at)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.log_consequence_event(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_consequence_event(text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_situation()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account       uuid := public.my_account_id();
  v_low_days      int;
  v_avg_mood      numeric;
  v_warn          int;
  v_recov         int;
  v_net           int;
  v_status        text;
  v_status_weight int;
  v_score         int;
  v_band          text;
  v_sustained     boolean;
  v_consequence_id uuid;
  v_consequence_type text;
  v_consequence_at timestamptz;
  v_window_ends_at timestamptz;
  v_window_active boolean := false;
BEGIN
  IF v_account IS NULL THEN
    RETURN jsonb_build_object(
      'score', 0, 'band', 'calm', 'sustained', false,
      'drivers', jsonb_build_object()
    );
  END IF;

  SELECT
    count(*) FILTER (WHERE mood <= 2),
    round(avg(mood)::numeric, 2)
  INTO v_low_days, v_avg_mood
  FROM public.checkins
  WHERE account_id = v_account
    AND created_at >= now() - interval '7 days';

  SELECT
    count(*) FILTER (WHERE kind = 'warning'),
    count(*) FILTER (WHERE kind = 'recovery')
  INTO v_warn, v_recov
  FROM public.tracker_logs
  WHERE account_id = v_account
    AND week >= (CURRENT_DATE - 14);

  v_low_days := coalesce(v_low_days, 0);
  v_warn     := coalesce(v_warn, 0);
  v_recov    := coalesce(v_recov, 0);
  v_net      := v_warn - v_recov;

  SELECT status INTO v_status
  FROM public.loved_ones
  WHERE account_id = v_account;

  SELECT id, event_type, occurred_at
  INTO v_consequence_id, v_consequence_type, v_consequence_at
  FROM public.consequence_events
  WHERE account_id = v_account
  ORDER BY occurred_at DESC
  LIMIT 1;

  IF v_consequence_at IS NOT NULL THEN
    v_window_ends_at := v_consequence_at + interval '72 hours';
    v_window_active := v_consequence_at <= now() + interval '5 minutes'
      AND v_window_ends_at > now();
  END IF;

  v_status_weight := CASE coalesce(v_status, 'unknown')
    WHEN 'stable'       THEN 0
    WHEN 'in_treatment' THEN 0
    WHEN 'unknown'      THEN 5
    WHEN 'using'        THEN 15
    WHEN 'escalating'   THEN 25
    WHEN 'crisis'       THEN 35
    ELSE 5
  END;

  -- A fresh concrete consequence changes posture immediately. It is an opening,
  -- not a guarantee; the client still shows emergency and spontaneous-help paths.
  v_score := (v_low_days * 10)
    + (greatest(v_net, 0) * 10)
    + v_status_weight
    + CASE WHEN v_window_active THEN 30 ELSE 0 END;

  v_band := CASE
    WHEN v_score >= 60 THEN 'crisis'
    WHEN v_score >= 30 THEN 'elevated'
    WHEN v_score >= 10 THEN 'watch'
    ELSE 'calm'
  END;

  v_sustained := (v_low_days >= 3 AND v_warn >= 3);

  RETURN jsonb_build_object(
    'score', v_score,
    'band', v_band,
    'sustained', v_sustained,
    'drivers', jsonb_build_object(
      'low_mood_days', v_low_days,
      'avg_mood', v_avg_mood,
      'warning_signs', v_warn,
      'recovery_signs', v_recov,
      'net_warnings', v_net,
      'loved_one_status', v_status,
      'latest_consequence_id', v_consequence_id,
      'latest_consequence_type', v_consequence_type,
      'latest_consequence_at', v_consequence_at,
      'willingness_window_ends_at', v_window_ends_at,
      'willingness_window_active', v_window_active
    )
  );
END;
$$;
