-- Restore the table privileges required for RLS-protected client and Edge
-- Function flows. PostgreSQL evaluates table privileges before row-level
-- policies; an owner policy alone does not let authenticated clients reach a
-- table. Keep these grants aligned with the operations allowed by final RLS.

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT SELECT ON TABLE public.accounts TO authenticated;
REVOKE UPDATE ON TABLE public.accounts FROM authenticated;
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
-- group_rsvps already has explicit SELECT/INSERT/UPDATE/DELETE grants in its
-- hardening migration; repeat them here so a clean final catalog is obvious.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_rsvps TO authenticated;

GRANT SELECT, INSERT, DELETE ON TABLE public.rehearsal_sessions TO authenticated;
GRANT SELECT ON TABLE public.funnel_events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.wavering_events TO authenticated;
GRANT INSERT ON TABLE public.web_sso_tokens TO authenticated;

-- Existing scheduling hardening intentionally exposes only these reads/writes.
GRANT SELECT ON TABLE public.video_sessions TO authenticated;
GRANT SELECT ON TABLE public.video_session_events TO authenticated;
GRANT SELECT ON TABLE public.video_session_proposals TO authenticated;
GRANT SELECT ON TABLE public.video_staff_roles TO authenticated;
GRANT SELECT, INSERT ON TABLE public.coaching_bookings TO authenticated;

-- RLS policies call this fixed-search-path boolean predicate. It returns no
-- private data, and callers need EXECUTE for policy evaluation to succeed.
GRANT EXECUTE ON FUNCTION public.is_video_staff(uuid) TO authenticated;

-- Edge Functions using the service key bypass RLS but still require ordinary
-- PostgreSQL privileges. The service role is trusted server-side and needs to
-- process outboxes, notifications, billing, scheduling, and reconciliation.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
