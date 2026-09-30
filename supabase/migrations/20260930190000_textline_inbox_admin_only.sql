-- =============================================================================
-- The Urgent Text Line inbox is admin-only.
--
-- admin_get_active_threads() was gated on is_video_staff(), so any account
-- given the video "coach" role could list every member's Text Line thread with
-- their name and the latest message, although messages themselves are
-- admin-only under RLS and the app only calls this for admins.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_get_active_threads()
RETURNS TABLE(
  thread_id uuid,
  first_name text,
  last_name text,
  last_message text,
  last_message_at timestamptz,
  message_count bigint,
  unread_count bigint,
  risk_level text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    a.first_name,
    a.last_name,
    (SELECT m.body FROM public.messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
    COALESCE(t.last_message_at, (SELECT m.created_at FROM public.messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1)),
    (SELECT count(*) FROM public.messages m WHERE m.thread_id = t.id),
    (SELECT count(*) FROM public.messages m
      WHERE m.thread_id = t.id
        AND m.sender_role = 'member'
        AND (t.last_admin_read_at IS NULL OR m.created_at > t.last_admin_read_at)),
    t.risk_level,
    t.status
  FROM public.threads t
  JOIN public.accounts a ON a.id = t.account_id
  WHERE t.archived_at IS NULL
    AND t.kind = 'oncall'
  ORDER BY COALESCE(t.last_message_at, (SELECT m.created_at FROM public.messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1)) DESC NULLS LAST
  LIMIT 100;
END
$$;

-- Matches 20260714010339 exactly (plus an explicit PUBLIC revoke for clarity;
-- CREATE OR REPLACE preserves ACLs, so be explicit about the final posture).
REVOKE ALL ON FUNCTION public.admin_get_active_threads() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_active_threads() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_active_threads() TO authenticated;
