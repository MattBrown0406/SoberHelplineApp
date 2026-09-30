-- =============================================================================
-- Close anonymous and member access to internal SECURITY DEFINER helpers.
--
-- Supabase's default function ACL grants EXECUTE to anon and authenticated on
-- every new function in public. Earlier migrations only revoked FROM PUBLIC,
-- which leaves those explicit role grants in place: anyone holding the public
-- app key could call _video_push (push arbitrary text to any member's phone),
-- _video_cancel / _video_event (forge video-session history) and probe account
-- roles and entitlements by id.
--
-- anon uses no table and no RPC in this app (every client and Edge Function
-- call is either signed in or service_role), so anon loses EXECUTE on every
-- public function. Signed-in members keep exactly what they could call before,
-- now as an explicit grant, except the internal video helpers below.
-- supabase/tests/function_execute_exposure_test.sql fails CI if a later
-- migration reintroduces an anon-callable function.
-- =============================================================================

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END IF;
    IF has_function_privilege('service_role', fn, 'EXECUTE') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Internal helpers are only ever called from inside other SECURITY DEFINER
-- functions (which run as the owner), never by a client or an RLS policy.
REVOKE EXECUTE ON FUNCTION
  public._video_push(uuid, text, text, text, uuid, integer, text),
  public._video_event(public.video_sessions, uuid, text, text, text, jsonb),
  public._video_cancel(uuid, integer, uuid, text, text),
  public._coach_video_transition(uuid, integer, text, text),
  public._video_assert_coach_available(uuid, uuid, timestamptz, integer),
  public._video_assert_timezone(text),
  public._video_assert_version(integer, integer),
  public.is_video_owner(uuid)
FROM authenticated;
