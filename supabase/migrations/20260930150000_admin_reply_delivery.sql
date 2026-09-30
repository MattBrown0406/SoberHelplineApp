-- =============================================================================
-- Admin replies always reach the member, and "Matt replied" means he did.
--
-- 1. A reply sent from an archived thread went into that archived thread, which
--    the member's app never shows again. It is now delivered to the member's
--    current conversation (or reopens the archived one if there is none).
-- 2. A situation brief was marked 'replied' the moment an admin opened the
--    reply thread, before anything was sent, so the member saw "Matt replied"
--    with nothing waiting. Sending a coach message now marks the member's
--    outstanding briefs replied instead.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_send_thread_message(p_thread_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id uuid;
  v_account    uuid;
  v_kind       text;
  v_archived   timestamptz;
  v_target     uuid := p_thread_id;
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT account_id, kind, archived_at
  INTO v_account, v_kind, v_archived
  FROM public.threads
  WHERE id = p_thread_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'thread_not_found';
  END IF;

  IF v_archived IS NOT NULL THEN
    SELECT id INTO v_target
    FROM public.threads
    WHERE account_id = v_account AND kind = v_kind AND archived_at IS NULL;

    IF v_target IS NULL THEN
      UPDATE public.threads SET archived_at = NULL WHERE id = p_thread_id;
      v_target := p_thread_id;
    END IF;
  END IF;

  INSERT INTO public.messages (thread_id, sender_role, body)
  VALUES (v_target, 'coach', trim(p_body))
  RETURNING id INTO v_message_id;

  UPDATE public.threads SET last_admin_read_at = now() WHERE id = v_target;

  UPDATE public.situation_briefs
  SET status     = 'replied',
      read_at    = coalesce(read_at, now()),
      replied_at = coalesce(replied_at, now())
  WHERE account_id = v_account
    AND status <> 'replied';

  RETURN v_message_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_send_thread_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_send_thread_message(uuid, text) TO authenticated;
