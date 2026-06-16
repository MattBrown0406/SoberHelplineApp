-- Helper functions used by the notify-chat-message Edge Function.
-- Both run as SECURITY DEFINER so the edge function (service role) can join
-- into auth.users without exposing that table to regular RLS callers.

CREATE OR REPLACE FUNCTION get_thread_member_info(p_thread_id uuid)
RETURNS TABLE(account_id uuid, first_name text, push_token text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.first_name, a.push_token
  FROM threads t
  JOIN accounts a ON a.id = t.account_id
  WHERE t.id = p_thread_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION get_account_push_token_by_email(p_email text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT a.push_token
  FROM accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE u.email = p_email
  LIMIT 1;
$$;
