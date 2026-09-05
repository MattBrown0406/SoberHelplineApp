-- Keep legacy direct writes, but bind authorship and wall references to the
-- authenticated family member. Restrictive policies also constrain the legacy
-- permissive FOR ALL policy (adding another permissive policy would not).
CREATE POLICY "shared_walls: authenticated author insert"
  ON public.shared_walls AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    proposed_by = public.my_account_id()
    AND public.is_family_member(family_space_id)
    AND (source_wall_id IS NULL OR EXISTS (
      SELECT 1 FROM public.walls w
      WHERE w.id = source_wall_id AND w.account_id = public.my_account_id()
    ))
  );

-- Preserve collaborative content edits, but clients must not rewrite identity
-- columns to evade the INSERT checks. RPCs and service-role writes are unchanged.
REVOKE UPDATE ON public.shared_walls FROM authenticated;
GRANT UPDATE (text, anchor, anchor_tag) ON public.shared_walls TO authenticated;

ALTER POLICY "wall_commitments: self insert" ON public.wall_commitments
  WITH CHECK (
    account_id = public.my_account_id()
    AND EXISTS (
      SELECT 1 FROM public.shared_walls sw
      WHERE sw.id = shared_wall_id
        AND public.is_family_member(sw.family_space_id)
    )
  );

-- Upserts used by commitWall must remain valid, but moving a commitment onto a
-- foreign family's wall must fail just like a direct INSERT.
ALTER POLICY "wall_commitments: self update" ON public.wall_commitments
  USING (
    account_id = public.my_account_id()
    AND EXISTS (
      SELECT 1 FROM public.shared_walls sw
      WHERE sw.id = shared_wall_id
        AND public.is_family_member(sw.family_space_id)
    )
  )
  WITH CHECK (
    account_id = public.my_account_id()
    AND EXISTS (
      SELECT 1 FROM public.shared_walls sw
      WHERE sw.id = shared_wall_id
        AND public.is_family_member(sw.family_space_id)
    )
  );

ALTER POLICY "wavering_events: self insert" ON public.wavering_events
  WITH CHECK (
    account_id = public.my_account_id()
    AND EXISTS (
      SELECT 1 FROM public.shared_walls sw
      WHERE sw.id = shared_wall_id
        AND public.is_family_member(sw.family_space_id)
    )
  );

-- useWebSSO uses create_web_sso_token(), which generates the opaque UUID and
-- applies the five-minute server default. Direct INSERT bypassed both controls.
DROP POLICY "web_sso_tokens: owner insert" ON public.web_sso_tokens;
REVOKE INSERT ON public.web_sso_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_web_sso_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_web_sso_token() TO authenticated, service_role;

-- Fresh Supabase databases grant service_role EXECUTE through default ACLs.
-- Match the existing family-outcomes test contract explicitly rather than
-- relying on environment-specific defaults. These RPCs require a member/admin JWT.
REVOKE EXECUTE ON FUNCTION public.record_family_outcome(uuid,text,date,text,text,text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.update_family_outcome(uuid,text,date,text,text,text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.delete_family_outcome(uuid) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.admin_family_outcome_counts() FROM service_role;

-- Definer RPC bypasses RLS: enforce provenance explicitly.
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

  IF p_source_wall_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.walls w WHERE w.id = p_source_wall_id AND w.account_id = v_account_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'source_wall_not_owned';
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
