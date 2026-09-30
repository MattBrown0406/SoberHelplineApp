-- =============================================================================
-- Urgent Text Line: a member can start a new conversation after archiving.
--
-- threads still carried the original UNIQUE (account_id, kind), so once a
-- member archived their conversation the archived row kept the slot: the app's
-- create-a-fresh-thread insert failed with a unique violation, the chat screen
-- had no thread, and every message after that went nowhere. Only one ACTIVE
-- thread per member and kind is the real invariant.
-- =============================================================================

ALTER TABLE public.threads DROP CONSTRAINT IF EXISTS threads_account_id_kind_key;

CREATE UNIQUE INDEX IF NOT EXISTS threads_one_active_per_kind
  ON public.threads (account_id, kind)
  WHERE archived_at IS NULL;

-- Admin reply path: reuse the active thread, else open a new one. A concurrent
-- insert can only collide on the active-thread index, so fall back to it.
CREATE OR REPLACE FUNCTION public.admin_get_or_create_thread(p_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread uuid;
BEGIN
  IF NOT is_admin_jwt() THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT id INTO v_thread
  FROM threads
  WHERE account_id = p_account_id
    AND kind = 'oncall'
    AND archived_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_thread IS NOT NULL THEN RETURN v_thread; END IF;

  BEGIN
    INSERT INTO threads (account_id, kind)
    VALUES (p_account_id, 'oncall')
    RETURNING id INTO v_thread;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_thread
    FROM threads
    WHERE account_id = p_account_id
      AND kind = 'oncall'
      AND archived_at IS NULL;
  END;

  RETURN v_thread;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_or_create_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_or_create_thread(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Realtime: the chat and video screens subscribe to attachments, reactions and
-- video-session changes, but only messages was ever published, so photos from
-- the coach, reactions and schedule changes never arrived live. RLS still
-- scopes every event to rows the subscriber can read.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['message_attachments', 'message_reactions', 'video_sessions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
