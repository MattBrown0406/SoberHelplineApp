-- Close critical SECURITY DEFINER exposure and restore the narrow table grants
-- required by RLS-protected member flows.

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
  IF NOT public.is_video_staff() THEN
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

CREATE OR REPLACE FUNCTION public.moderate_community_post(p_post_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_video_owner() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_status NOT IN ('visible', 'held', 'removed') THEN
    RAISE EXCEPTION 'bad_status';
  END IF;
  UPDATE public.community_posts SET status = p_status WHERE id = p_post_id;
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_active_threads() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_active_threads() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.moderate_community_post(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_community_post(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_thread_member_info(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_account_push_token_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_thread_member_info(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_account_push_token_by_email(text) TO service_role;

-- RLS remains the authorization boundary for these direct client reads/writes.
GRANT SELECT ON TABLE public.entitlements TO authenticated;
GRANT SELECT ON TABLE public.video_sessions TO authenticated;
GRANT SELECT, INSERT ON TABLE public.coaching_bookings TO authenticated;

-- The RevenueCat sync Edge Function resolves the authenticated user's account
-- with its service client before calling the transactional reconciliation RPC.
-- RLS bypass does not supply the underlying table privilege.
GRANT SELECT ON TABLE public.accounts, public.entitlements TO service_role;
