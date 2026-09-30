-- =============================================================================
-- Urgent Text Line alerts reach every admin device.
--
-- The alert went to admin_account_id() only: one admin account, chosen by
-- email, whether or not it had a registered push token. If that account had no
-- device (or a second admin was the one on call) a member's urgent message
-- produced no alert at all. Enqueue one push per admin with a device instead.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._notify_admin_textline_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread public.threads%ROWTYPE;
BEGIN
  IF NEW.sender_role <> 'member' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_thread FROM public.threads WHERE id = NEW.thread_id;
  IF v_thread.kind IS DISTINCT FROM 'oncall' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.push_outbox (account_id, kind, title, body)
  SELECT a.id,
         'admin_textline_message',
         '💬 New Urgent Text Line message',
         'A member sent a new message. Open Admin to read and reply.'
  FROM public.accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE lower(coalesce(u.email, '')) = ANY (public.admin_email_list())
    AND a.push_token IS NOT NULL
    AND a.id IS DISTINCT FROM v_thread.account_id;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_admin_textline_message() FROM PUBLIC, anon, authenticated;
