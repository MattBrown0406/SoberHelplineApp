BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(5);

UPDATE public.sessions SET next_at = now() + interval '2 days', zoom_url_override_until = NULL
WHERE id = public.family_squares_session_id();

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15200000-0000-0000-0000-000000000001","email":"member@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.admin_update_family_squares_zoom_url('https://us02web.zoom.us/j/1234567890')$$,
  'P0001', 'not authorized', 'members cannot change the call link');
SELECT set_config('request.jwt.claims','{"sub":"15200000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.admin_update_family_squares_zoom_url('https://us02web.zoom.us/j/1234567890')$$,
  'the admin sets the call link');
RESET ROLE;

SELECT is((SELECT zoom_url FROM sessions WHERE id = public.family_squares_session_id()),
  'https://us02web.zoom.us/j/1234567890', 'the link is saved');
SELECT is((SELECT zoom_url_override_until FROM sessions WHERE id = public.family_squares_session_id()),
  (SELECT next_at + interval '1 hour' FROM sessions WHERE id = public.family_squares_session_id()),
  'it holds until the next call ends, so zoom-sync does not overwrite it');

-- Right after a call, before zoom-sync moves next_at on: hold until the next call ends, not a week.
UPDATE public.sessions SET next_at = now() - interval '90 minutes' WHERE id = public.family_squares_session_id();
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15200000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT public.admin_update_family_squares_zoom_url('https://us02web.zoom.us/j/1234567890');
RESET ROLE;
SELECT ok((SELECT zoom_url_override_until > now() AND zoom_url_override_until <= now() + interval '7 days'
  AND extract(isodow FROM zoom_url_override_until AT TIME ZONE 'America/Los_Angeles') = 1
  AND (zoom_url_override_until AT TIME ZONE 'America/Los_Angeles')::time = time '20:00'
  FROM sessions WHERE id = public.family_squares_session_id()),
  'a stale next_at holds the link until the next Monday call ends (8 PM Pacific)');

SELECT * FROM finish();
ROLLBACK;
