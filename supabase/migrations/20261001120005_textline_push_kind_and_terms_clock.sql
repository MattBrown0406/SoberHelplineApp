-- 1. Admin Urgent Text Line pushes carried no metadata, so a tap could not be
--    routed (it landed on Home). The payload now carries its kind (admin_*
--    kinds open /admin) and the thread id. Latest definition:
--    20260930180000_textline_admin_alert_fanout.sql.
-- 2. Signup terms consent was never recorded when the device clock ran ahead:
--    terms_accepted_at comes from the device and anything more than five
--    minutes in the future was rejected. The accepted version is still the
--    affirmative evidence; the server now clamps the time to its own clock.

CREATE OR REPLACE FUNCTION public._notify_admin_textline_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  INSERT INTO public.push_outbox (account_id, kind, title, body, metadata)
  SELECT a.id,
         'admin_textline_message',
         '💬 New Urgent Text Line message',
         'A member sent a new message. Open Admin to read and reply.',
         jsonb_build_object('kind', 'admin_textline_message', 'thread_id', NEW.thread_id)
  FROM public.accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE lower(coalesce(u.email, '')) = ANY (public.admin_email_list())
    AND a.push_token IS NOT NULL
    AND a.id IS DISTINCT FROM v_thread.account_id;

  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._notify_admin_textline_message() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._notify_admin_textline_message() TO service_role;

CREATE OR REPLACE FUNCTION public.record_signup_terms_consent()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_metadata jsonb;
  v_user_created_at timestamptz;
  v_version text;
  v_accepted_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, coalesce(u.raw_user_meta_data, '{}'::jsonb), u.created_at
  INTO v_account_id, v_metadata, v_user_created_at
  FROM public.accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- The affirmative evidence is the accepted version plus the acceptance
  -- marker the sign-up form writes when the box is ticked.
  v_version := nullif(v_metadata ->> 'terms_version', '');
  IF v_version IS NULL OR v_metadata ->> 'terms_accepted_at' IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_accepted_at := (v_metadata ->> 'terms_accepted_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN
    v_accepted_at := NULL;
  END;

  -- The time comes from the device clock, which may be wrong in either
  -- direction: never record a future time, nor one long before the account
  -- existed. An unreadable time falls back to the server's clock.
  v_accepted_at := LEAST(
    GREATEST(COALESCE(v_accepted_at, now()), COALESCE(v_user_created_at, now()) - interval '1 day'),
    now()
  );

  INSERT INTO public.consents(account_id, consent_key, version, granted_at)
  VALUES (v_account_id, '1', v_version, v_accepted_at)
  ON CONFLICT (account_id, consent_key) DO NOTHING;

  RETURN EXISTS (
    SELECT 1 FROM public.consents
    WHERE account_id = v_account_id
      AND consent_key = '1'
      AND revoked_at IS NULL
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_signup_terms_consent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_signup_terms_consent() TO authenticated, service_role;
