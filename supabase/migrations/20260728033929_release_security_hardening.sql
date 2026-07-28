-- Close release-blocking privilege and cross-tenant reaction gaps discovered by
-- the independent ASC audit.

-- Supabase's legacy/default table ACLs included REFERENCES, TRIGGER, and
-- TRUNCATE for client roles. RLS does not protect TRUNCATE, so remove every
-- table/sequence privilege and rebuild the explicit application allowlist.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON TABLE public.accounts TO authenticated;
GRANT UPDATE (first_name, last_name, language, timezone, push_token, locale)
  ON TABLE public.accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.checkins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.walls TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tracker_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.consents TO authenticated;
GRANT SELECT ON TABLE public.entitlements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.letter_drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.loved_ones TO authenticated;
GRANT SELECT ON TABLE public.sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.session_rsvps TO authenticated;
GRANT SELECT, INSERT ON TABLE public.session_questions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.threads TO authenticated;
GRANT SELECT, INSERT ON TABLE public.messages TO authenticated;
GRANT SELECT, INSERT ON TABLE public.message_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_reactions TO authenticated;
GRANT SELECT, DELETE ON TABLE public.community_posts TO authenticated;
GRANT SELECT ON TABLE public.community_supports TO authenticated;
GRANT SELECT ON TABLE public.community_reports TO authenticated;
GRANT SELECT ON TABLE public.ai_response_drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.family_spaces TO authenticated;
GRANT SELECT, DELETE ON TABLE public.family_members TO authenticated;
GRANT SELECT, INSERT ON TABLE public.family_journal_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shared_walls TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.wall_commitments TO authenticated;
GRANT SELECT ON TABLE public.group_hosts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_rsvps TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.rehearsal_sessions TO authenticated;
GRANT SELECT ON TABLE public.funnel_events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.wavering_events TO authenticated;
GRANT INSERT ON TABLE public.web_sso_tokens TO authenticated;
GRANT SELECT ON TABLE public.video_sessions TO authenticated;
GRANT SELECT ON TABLE public.video_session_events TO authenticated;
GRANT SELECT ON TABLE public.video_session_proposals TO authenticated;
GRANT SELECT ON TABLE public.video_staff_roles TO authenticated;
GRANT SELECT, INSERT ON TABLE public.coaching_bookings TO authenticated;

-- The service key remains the only role with broad operational access.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- A SECURITY DEFINER RPC must verify that the target message belongs to a thread
-- visible to the caller; checking only the inserted reaction's account_id lets a
-- member mutate reactions on another family's private thread.
CREATE OR REPLACE FUNCTION public.toggle_reaction(p_message_id uuid, p_reaction text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid := public.my_account_id();
BEGIN
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '28000';
  END IF;

  IF p_reaction IS NULL OR p_reaction NOT IN ('👍', '❤️', '😂', '😢', '😮', '👎') THEN
    RAISE EXCEPTION 'invalid_reaction' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.threads t ON t.id = m.thread_id
    WHERE m.id = p_message_id
      AND (t.account_id = v_account_id OR public.is_admin_jwt())
  ) THEN
    RAISE EXCEPTION 'message_not_accessible' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.message_reactions
    WHERE message_id = p_message_id
      AND account_id = v_account_id
      AND reaction = p_reaction
  ) THEN
    DELETE FROM public.message_reactions
    WHERE message_id = p_message_id
      AND account_id = v_account_id
      AND reaction = p_reaction;
  ELSE
    INSERT INTO public.message_reactions (message_id, account_id, reaction)
    VALUES (p_message_id, v_account_id, p_reaction);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_reaction(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_reaction(uuid, text) TO authenticated;
