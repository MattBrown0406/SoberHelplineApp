-- =============================================================================
-- Family and provider invite codes cannot be discovered by guessing.
--
-- * Members could INSERT family_spaces rows directly with an invite_code of
--   their choosing; a bulk insert fails with a unique violation that names the
--   colliding code, revealing live family codes (and so the family's journal
--   and shared boundaries) far faster than guessing through the join RPC.
--   Spaces are only ever created through create_family_space(), so direct
--   INSERT is removed; owners may still rename, but can no longer rewrite
--   invite_code (the same collision probe through UPDATE).
-- * join_family_space() and redeem_invite_code() had no attempt limit.
--   Failed attempts are now recorded and capped per account per hour. Unknown
--   family codes return NULL (the app already treats NULL as "invalid code")
--   so the recorded attempt is not rolled back by an exception.
-- * The app models one family space per member, but a double-tapped "create"
--   (or joining a second family) could leave a member in two; the client and
--   propose_shared_wall() then each picked an arbitrary one, so shared walls
--   landed in a space the member never sees. Membership is now unique per
--   account, create_family_space() returns the member's existing space, and
--   joining a different family is refused.
-- =============================================================================

REVOKE INSERT, UPDATE ON public.family_spaces FROM authenticated;
GRANT UPDATE (name) ON public.family_spaces TO authenticated;
DROP POLICY IF EXISTS "family_spaces: anyone insert" ON public.family_spaces;

-- Keep one membership per account before enforcing it (prod had none to
-- remove when this was written; a double-tap before deploy must not abort the
-- migration): prefer the space the member owns, then the earliest joined.
DELETE FROM public.family_members fm
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY account_id
           ORDER BY (role = 'owner') DESC, joined_at, id
         ) AS rn
  FROM public.family_members
) ranked
WHERE fm.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS family_members_one_space_per_account
  ON public.family_members (account_id);

CREATE OR REPLACE FUNCTION public.create_family_space(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_space_id   uuid;
BEGIN
  v_account_id := my_account_id();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT family_space_id INTO v_space_id
  FROM family_members
  WHERE account_id = v_account_id;
  IF v_space_id IS NOT NULL THEN
    RETURN v_space_id;
  END IF;

  v_space_id := gen_random_uuid();

  INSERT INTO family_spaces (id, name, created_by)
  VALUES (v_space_id, p_name, v_account_id);

  INSERT INTO family_members (family_space_id, account_id, role)
  VALUES (v_space_id, v_account_id, 'owner');

  RETURN v_space_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_family_space(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_family_space(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.invite_code_attempts (
  account_id   uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kind         text        NOT NULL CHECK (kind IN ('family', 'org')),
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invite_code_attempts_recent_idx
  ON public.invite_code_attempts (account_id, kind, attempted_at DESC);
ALTER TABLE public.invite_code_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invite_code_attempts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._invite_attempts_exhausted(p_account_id uuid, p_kind text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*) >= 10
  FROM public.invite_code_attempts
  WHERE account_id = p_account_id
    AND kind = p_kind
    AND attempted_at > now() - interval '1 hour';
$$;

REVOKE EXECUTE ON FUNCTION public._invite_attempts_exhausted(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_family_space(p_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_normalized_code text;
  v_space_id uuid;
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

  v_normalized_code := upper(btrim(p_invite_code));
  IF v_normalized_code IS NULL
     OR v_normalized_code !~ '^[0-9A-F]{4}-[0-9A-F]{4}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_invite_code';
  END IF;

  IF public._invite_attempts_exhausted(v_account_id, 'family') THEN
    RAISE EXCEPTION USING ERRCODE = '54000', MESSAGE = 'too_many_attempts';
  END IF;

  SELECT fs.id INTO v_space_id
  FROM public.family_spaces AS fs
  WHERE fs.invite_code = v_normalized_code;

  IF v_space_id IS NULL THEN
    INSERT INTO public.invite_code_attempts (account_id, kind) VALUES (v_account_id, 'family');
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.family_members
    WHERE account_id = v_account_id AND family_space_id <> v_space_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'already_in_family_space';
  END IF;

  INSERT INTO public.family_members (family_space_id, account_id, role)
  VALUES (v_space_id, v_account_id, 'member')
  ON CONFLICT (family_space_id, account_id) DO NOTHING;

  RETURN v_space_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.join_family_space(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_family_space(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_invite_code(invite_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
  v_org_name text;
  v_user_id uuid := auth.uid();
  v_account_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT a.id INTO v_account_id FROM public.accounts a WHERE a.user_id = v_user_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF invite_code IS NULL OR length(btrim(invite_code)) NOT BETWEEN 4 AND 64 THEN
    RETURN NULL;
  END IF;

  IF public._invite_attempts_exhausted(v_account_id, 'org') THEN
    RAISE EXCEPTION 'too_many_attempts' USING ERRCODE = '54000';
  END IF;

  SELECT o.id, o.name INTO v_org_id, v_org_name
    FROM public.org_invite_codes c
    JOIN public.orgs o ON o.id = c.org_id
   WHERE c.code = upper(btrim(invite_code))
     AND c.active
     AND o.status = 'active';

  IF v_org_id IS NULL THEN
    INSERT INTO public.invite_code_attempts (account_id, kind) VALUES (v_account_id, 'org');
    RETURN NULL;
  END IF;

  UPDATE public.accounts
     SET type = 'attached', org_id = v_org_id
   WHERE id = v_account_id;

  RETURN v_org_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;
