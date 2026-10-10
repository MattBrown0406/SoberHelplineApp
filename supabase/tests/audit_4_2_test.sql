BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(9);

-- Spanish members are reminded about La Sobremesa, so the app never claims to
-- remind them about The Family Squares (the website then emails them itself).
SELECT ok(
  public._app_reminds_family_call('ExponentPushToken[x]', now(), true, 'en'),
  'an English member with a fresh device and reminders on is reminded by the app'
);
SELECT ok(
  NOT public._app_reminds_family_call('ExponentPushToken[x]', now(), true, 'es'),
  'a Spanish member is not claimed for The Family Squares'
);
SELECT ok(
  NOT public._app_reminds_family_call('ExponentPushToken[x]', now(), true, 'es-MX'),
  'regional Spanish locales count as Spanish'
);
SELECT ok(
  (SELECT bool_and(pg_get_functiondef(p.oid) ~ '_app_reminds_family_call\([^)]*locale')
   FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('service_family_squares_attendees', 'service_family_squares_push_reachable')),
  'both website-bridge RPCs pass the member locale'
);

-- Reactions are written only through toggle_reaction.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.message_reactions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.message_reactions', 'UPDATE'),
  'members cannot insert or move reactions directly'
);

-- Message timestamps come from the server.
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'messages_server_created_at' AND NOT tgisinternal),
  'messages get the server time on insert'
);

-- La Sobremesa: Monday 8:00 PM Pacific, held until its 75 minutes are over.
SELECT is(
  public.next_la_sobremesa_start('2026-10-09 12:00:00+00'),
  '2026-10-13 03:00:00+00'::timestamptz,
  'next call from a Friday is Monday 8 PM PDT'
);
SELECT is(
  public.next_la_sobremesa_start('2026-10-13 04:10:00+00'),
  '2026-10-13 03:00:00+00'::timestamptz,
  'still tonight''s call at 9:10 PM'
);
SELECT is(
  public.next_la_sobremesa_start('2026-11-10 05:20:00+00'),
  '2026-11-17 04:00:00+00'::timestamptz,
  'after the call it moves to next Monday (PST)'
);

SELECT * FROM finish();
ROLLBACK;
