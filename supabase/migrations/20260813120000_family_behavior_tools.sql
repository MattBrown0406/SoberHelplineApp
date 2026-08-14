-- Family-behavior tools used by free and paid accounts alike.
-- 1) Co-members can read first names (never push tokens / emails).
-- 2) Propose a personal wall into Family Space in one call.
-- 3) Persist "I'm wavering" and optionally share a no-shame backup notice.
-- 4) Hold-log: did WE hold the wall this week? Private by default; opt-in share.
-- Do not apply this migration to production from this PR — document and apply
-- via the usual Supabase workflow after review.

-- ─── Member first names (narrow, family-space scoped) ─────────────────────────

CREATE OR REPLACE FUNCTION public.family_member_profiles(p_space_id uuid)
RETURNS TABLE(account_id uuid, first_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.first_name
  FROM public.family_members fm
  JOIN public.accounts a ON a.id = fm.account_id
  WHERE fm.family_space_id = p_space_id
    AND public.is_family_member(p_space_id);
$$;

REVOKE ALL ON FUNCTION public.family_member_profiles(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.family_member_profiles(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.family_member_profiles(uuid) TO authenticated, service_role;

-- ─── Propose a wall to the caller's Family Space ──────────────────────────────

CREATE OR REPLACE FUNCTION public.propose_shared_wall(
  p_text text,
  p_anchor text DEFAULT NULL,
  p_anchor_tag text DEFAULT NULL,
  p_source_wall_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_space_id uuid;
  v_wall_id uuid;
  v_anchor text;
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

  SELECT fm.family_space_id INTO v_space_id
  FROM public.family_members fm
  WHERE fm.account_id = v_account_id
  LIMIT 1;

  IF v_space_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'no_family_space';
  END IF;

  IF p_text IS NULL OR length(btrim(p_text)) < 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_wall_text';
  END IF;

  v_anchor := CASE
    WHEN p_anchor IN ('enabling', 'harm', 'both') THEN p_anchor
    ELSE NULL
  END;

  INSERT INTO public.shared_walls (
    family_space_id, proposed_by, text, anchor, anchor_tag, source_wall_id
  )
  VALUES (
    v_space_id, v_account_id, btrim(p_text), v_anchor, p_anchor_tag, p_source_wall_id
  )
  RETURNING id INTO v_wall_id;

  INSERT INTO public.wall_commitments (shared_wall_id, account_id, status)
  VALUES (v_wall_id, v_account_id, 'committed')
  ON CONFLICT (shared_wall_id, account_id) DO UPDATE
    SET status = 'committed', updated_at = now();

  RETURN v_wall_id;
END;
$$;

REVOKE ALL ON FUNCTION public.propose_shared_wall(text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propose_shared_wall(text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.propose_shared_wall(text, text, text, uuid) TO authenticated, service_role;

-- ─── Persist wavering (and optional family backup notice) ─────────────────────

CREATE OR REPLACE FUNCTION public.record_wall_wavering(
  p_shared_wall_id uuid,
  p_share_with_family boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.wall_commitments (shared_wall_id, account_id, status)
  VALUES (p_shared_wall_id, v_account_id, 'wavering')
  ON CONFLICT (shared_wall_id, account_id) DO UPDATE
    SET status = 'wavering', updated_at = now();

  INSERT INTO public.wavering_events (
    shared_wall_id, account_id, shared_with_family, coach_pinged
  )
  VALUES (
    p_shared_wall_id, v_account_id, coalesce(p_share_with_family, false), false
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_wall_wavering(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_wall_wavering(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_wall_wavering(uuid, boolean) TO authenticated, service_role;

-- ─── Hold-log: we held / mostly / slipped — private by default ────────────────

CREATE TABLE public.wall_hold_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  family_space_id     uuid REFERENCES public.family_spaces(id) ON DELETE SET NULL,
  week_start          date NOT NULL,
  result              text NOT NULL CHECK (result IN ('held', 'mostly', 'slipped')),
  shared_with_family  boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, week_start)
);

ALTER TABLE public.wall_hold_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wall_hold_logs: own select"
  ON public.wall_hold_logs FOR SELECT
  USING (account_id = public.my_account_id());

CREATE POLICY "wall_hold_logs: shared family select"
  ON public.wall_hold_logs FOR SELECT
  USING (
    shared_with_family
    AND family_space_id IS NOT NULL
    AND public.is_family_member(family_space_id)
  );

CREATE POLICY "wall_hold_logs: self insert"
  ON public.wall_hold_logs FOR INSERT
  WITH CHECK (
    account_id = public.my_account_id()
    AND (
      family_space_id IS NULL
      OR public.is_family_member(family_space_id)
    )
    AND (NOT shared_with_family OR family_space_id IS NOT NULL)
  );

CREATE POLICY "wall_hold_logs: self update"
  ON public.wall_hold_logs FOR UPDATE
  USING (account_id = public.my_account_id())
  WITH CHECK (
    account_id = public.my_account_id()
    AND (
      family_space_id IS NULL
      OR public.is_family_member(family_space_id)
    )
    AND (NOT shared_with_family OR family_space_id IS NOT NULL)
  );

-- A shared wavering event may trigger at most one push fan-out. The Edge
-- Function atomically claims this nullable timestamp before sending.
ALTER TABLE public.wavering_events
  ADD COLUMN notification_claimed_at timestamptz;

GRANT SELECT, INSERT, UPDATE ON TABLE public.wall_hold_logs TO authenticated;
GRANT ALL ON TABLE public.wall_hold_logs TO service_role;

COMMENT ON TABLE public.wall_hold_logs IS
  'Weekly log of whether the family member held their walls — not whether the loved one used. Private by default; sharing is opt-in.';
