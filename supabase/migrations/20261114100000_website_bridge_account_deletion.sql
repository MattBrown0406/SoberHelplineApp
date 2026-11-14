-- Website bridge, account deletion: when someone deletes their account on
-- soberhelpline.com, the website asks the app to delete the app account with
-- the same verified email (edge function website-account-deleted).
--
-- Two service-role-only helpers. Neither is callable by members or visitors.
-- Staff accounts are never deleted this way: the owner's admin emails and
-- anyone with an active video staff role are reported as protected.

-- Who would be deleted for this email, and may they be?
CREATE OR REPLACE FUNCTION public.service_account_deletion_target(p_email text)
RETURNS TABLE (user_id uuid, account_id uuid, protected boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.id,
    a.id,
    (
      lower(btrim(u.email::text)) = ANY (public.admin_email_list())
      OR EXISTS (
        SELECT 1 FROM public.video_staff_roles r
        WHERE r.account_id = a.id AND r.active
      )
    )
  FROM auth.users u
  LEFT JOIN public.accounts a ON a.user_id = u.id
  WHERE p_email IS NOT NULL
    AND lower(btrim(u.email::text)) = lower(btrim(p_email))
    AND u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
  ORDER BY u.created_at
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.service_account_deletion_target(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_account_deletion_target(text) TO service_role;

-- Delete that account. The id and the email must still belong together and
-- the account must still be unprotected at the moment of deletion, so a
-- changed email or a newly granted staff role cannot be raced past.
-- Returns 'deleted', 'not_found' or 'protected'. Everything the account owns
-- goes with it by the same cascades as delete_own_account().
CREATE OR REPLACE FUNCTION public.service_delete_account_for_website(p_user_id uuid, p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target record;
  v_deleted integer;
BEGIN
  SELECT t.user_id, t.protected INTO v_target
  FROM public.service_account_deletion_target(p_email) t;

  IF v_target.user_id IS NULL OR v_target.user_id IS DISTINCT FROM p_user_id THEN
    RETURN 'not_found';
  END IF;
  IF v_target.protected THEN
    RETURN 'protected';
  END IF;

  DELETE FROM auth.users WHERE id = p_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN CASE WHEN v_deleted = 1 THEN 'deleted' ELSE 'not_found' END;
END;
$$;

REVOKE ALL ON FUNCTION public.service_delete_account_for_website(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_delete_account_for_website(uuid, text) TO service_role;
