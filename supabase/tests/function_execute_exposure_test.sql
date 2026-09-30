BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(5);

-- The app never calls the database without a signed-in session, so no public
-- function may be callable with only the anon key. A new migration that relies
-- on Supabase's default ACL (or only revokes FROM PUBLIC) fails here.
SELECT is(
  ARRAY(
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prokind = 'f'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    ORDER BY 1
  ),
  ARRAY[]::text[],
  'no public function is executable by anon'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public._video_push(uuid,text,text,text,uuid,integer,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._video_cancel(uuid,integer,uuid,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._video_event(public.video_sessions,uuid,text,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._coach_video_transition(uuid,integer,text,text)', 'EXECUTE'),
  'members cannot call internal video helpers directly'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.is_video_owner(uuid)', 'EXECUTE'),
  'members cannot probe who owns the video desk'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.has_active_textline_access(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.is_video_staff(uuid)', 'EXECUTE'),
  'helpers used by RLS policies stay callable for members'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.my_situation()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.coach_start_video_session(uuid,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._video_push(uuid,text,text,text,uuid,integer,text)', 'EXECUTE'),
  'member RPCs and service-role access are unchanged'
);

SELECT * FROM finish();
ROLLBACK;
