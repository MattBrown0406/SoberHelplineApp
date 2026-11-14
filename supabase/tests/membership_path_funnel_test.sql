BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- ── Privileges ──────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.log_funnel_event(text,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.log_funnel_event(text,jsonb)', 'EXECUTE'),
  'only signed-in members log funnel events');
SELECT ok(NOT has_function_privilege('anon', 'public._membership_path_stages()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._membership_path_stages()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._membership_path_sources()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._membership_path_sources()', 'EXECUTE'),
  'clients cannot call the list helpers');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_funnel_stats()', 'EXECUTE'), 'anon cannot read the admin figures');
SELECT is(array_length(public._membership_path_stages(), 1), 8, 'eight steps on the membership path');

-- ── Fixtures ────────────────────────────────────────────────────────────────
DELETE FROM public.funnel_events;
INSERT INTO auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
  ('1b000000-0000-0000-0000-000000000001', 'path-a@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000002', 'path-b@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000003', 'path-c@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-0000000000ff', 'matt@soberhelpline.com', now(), '{}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('2b000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid
WHERE user_id::text LIKE '1b000000-0000-0000-0000-00000000000_';

-- ── Only the source and the tier are kept ───────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000001","email":"path-a@example.com","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.log_funnel_event('plans_viewed', '{"source":"today_locked_preview","note":"private words","email":"someone@example.com"}')$$,
  'seeing the plans screen is recorded');
SELECT lives_ok($$SELECT public.log_funnel_event('plans_viewed', '{"source":"today_locked_preview"}')$$,
  'a second visit is recorded too (the app sends one per visit)');
SELECT lives_ok($$SELECT public.log_funnel_event('plan_sheet_opened', '{"tier":"essential","source":"support_tab","price":"9.99"}')$$,
  'opening a plan is recorded');
SELECT lives_ok($$SELECT public.log_funnel_event('purchase_started', '{"tier":"premium","source":"my son relapsed"}')$$,
  'a source outside the list is accepted');
SELECT lives_ok($$SELECT public.log_funnel_event('purchase_cancelled', '{"tier":"gold","source":"chat_gate"}')$$,
  'a tier outside the two plans is accepted');
SELECT lives_ok($$SELECT public.log_funnel_event('purchase_failed', '{}')$$, 'no metadata at all is accepted');
SELECT lives_ok($$SELECT public.log_funnel_event('purchase_succeeded')$$, 'the metadata argument can be left out');
SELECT lives_ok($$SELECT public.log_funnel_event('membership_invite_shown', '{"source":"after_meeting"}')$$, 'an invitation on screen is recorded');
SELECT lives_ok($$SELECT public.log_funnel_event('membership_invite_shown', '{"source":"after_meeting","tier":"essential"}')$$,
  'the same invitation later the same day is accepted quietly');
SELECT lives_ok($$SELECT public.log_funnel_event('membership_invite_shown', '{"source":"today_locked_preview"}')$$,
  'an invitation somewhere else is recorded');
SELECT lives_ok($$SELECT public.log_funnel_event('membership_invite_tapped', '{"source":"after_meeting"}')$$, 'a tap is recorded');
SELECT lives_ok($$SELECT public.log_funnel_event('membership_invite_tapped', '{"source":"after_meeting"}')$$, 'every tap is recorded');
SELECT throws_ok($$SELECT public.log_funnel_event('plan_bought', '{}')$$, 'P0001', 'bad_stage', 'unknown stages are still refused');
SELECT lives_ok($$SELECT public.log_funnel_event('attended', '{"source":"today"}')$$, 'a Join tap is still logged as before');
SELECT lives_ok($$SELECT public.log_funnel_event('tool_opened', '{"tool":"letter"}')$$, 'tool usage is still logged as before');
SELECT throws_ok($$SELECT public.log_funnel_event('tool_opened', '{"tool":"somewhere"}')$$, 'P0001', 'bad_tool', 'unknown tools are still refused');
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000002","email":"path-b@example.com","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.log_funnel_event('plans_viewed', '{"source":"chat_gate"}')$$, 'another member sees the plans');
SELECT lives_ok($$SELECT public.log_funnel_event('membership_invite_shown', '{"source":"after_meeting"}')$$,
  'the once-a-day rule is per member');
-- The admin looking at the screens is not part of the figures.
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.log_funnel_event('plans_viewed', '{"source":"support_tab"}')$$, 'an admin can open the plans screen');
SELECT lives_ok($$SELECT public.log_funnel_event('purchase_started', '{"tier":"essential","source":"support_tab"}')$$, 'and start a test purchase');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT is((SELECT count(*)::integer FROM public.funnel_events WHERE stage = 'plans_viewed' AND account_id = '2b000000-0000-0000-0000-000000000001'), 2,
  'plans_viewed is not collapsed by the server');
SELECT is((SELECT array_agg(DISTINCT metadata) FROM public.funnel_events WHERE stage = 'plans_viewed' AND account_id = '2b000000-0000-0000-0000-000000000001'),
  ARRAY['{"source":"today_locked_preview"}'::jsonb], 'nothing but the source is kept');
SELECT is((SELECT metadata FROM public.funnel_events WHERE stage = 'plan_sheet_opened' AND account_id = '2b000000-0000-0000-0000-000000000001'),
  '{"source":"support_tab","tier":"essential"}'::jsonb, 'the source and the tier, and no price');
SELECT is((SELECT metadata FROM public.funnel_events WHERE stage = 'purchase_started' AND account_id = '2b000000-0000-0000-0000-000000000001'),
  '{"source":"unknown","tier":"premium"}'::jsonb, 'words that are not a known label are never stored');
SELECT is((SELECT metadata FROM public.funnel_events WHERE stage = 'purchase_cancelled' AND account_id = '2b000000-0000-0000-0000-000000000001'),
  '{"source":"chat_gate"}'::jsonb, 'an unknown tier is left out');
SELECT is((SELECT metadata FROM public.funnel_events WHERE stage = 'purchase_failed' AND account_id = '2b000000-0000-0000-0000-000000000001'),
  '{"source":"unknown"}'::jsonb, 'no source reads as unknown');
SELECT is((SELECT metadata FROM public.funnel_events WHERE stage = 'purchase_succeeded' AND account_id = '2b000000-0000-0000-0000-000000000001'),
  '{"source":"unknown"}'::jsonb, 'left-out metadata reads as unknown');
SELECT is((SELECT count(*)::integer FROM public.funnel_events WHERE stage = 'membership_invite_shown' AND account_id = '2b000000-0000-0000-0000-000000000001'
    AND metadata ->> 'source' = 'after_meeting'), 1, 'an invitation counts once per member, place and day');
SELECT is((SELECT count(*)::integer FROM public.funnel_events WHERE stage = 'membership_invite_shown' AND account_id = '2b000000-0000-0000-0000-000000000001'), 2,
  'two places, two rows');
SELECT is((SELECT count(*)::integer FROM public.funnel_events WHERE stage = 'membership_invite_tapped' AND account_id = '2b000000-0000-0000-0000-000000000001'), 2,
  'taps are not collapsed');
SELECT is((SELECT metadata FROM public.funnel_events WHERE stage = 'attended' AND account_id = '2b000000-0000-0000-0000-000000000001'),
  '{"source":"today"}'::jsonb, 'other stages keep what they kept');

-- Yesterday's invitation does not hide today's; an old visit is outside the 30 days.
UPDATE public.funnel_events SET created_at = now() - interval '2 days'
WHERE stage = 'membership_invite_shown' AND account_id = '2b000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000002","email":"path-b@example.com","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.log_funnel_event('membership_invite_shown', '{"source":"after_meeting"}')$$, 'shown again another day');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT is((SELECT count(*)::integer FROM public.funnel_events WHERE stage = 'membership_invite_shown' AND account_id = '2b000000-0000-0000-0000-000000000002'), 2,
  'the once-a-day rule starts again each day');
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at) VALUES
  ('2b000000-0000-0000-0000-000000000003', 'plans_viewed', '{"source":"support_tab"}', now() - interval '40 days'),
  ('2b000000-0000-0000-0000-000000000003', 'purchase_succeeded', '{"source":"support_tab","tier":"essential"}', now() - interval '40 days');

-- ── The admin figure ────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000001","email":"path-a@example.com","role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.admin_funnel_stats()$$, 'P0001', 'not authorized', 'members cannot read the admin figures');
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}', true);
-- Kept in a setting: the admin's own role creates nothing in the database.
SELECT set_config('test.path_stats', public.admin_funnel_stats()::text, true);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
CREATE TEMP TABLE path_stats AS SELECT current_setting('test.path_stats')::jsonb AS s;

SELECT ok((SELECT s ?& ARRAY['members', 'paid_accounts', 'onboarded_loved_one', 'free_rsvps', 'attended',
    'coaching_requested', 'coaching_confirmed', 'intervention_viewed', 'intervention_started', 'bands',
    'family_squares_weeks'] FROM path_stats),
  'every key older admin builds read is still there');
SELECT is((SELECT s -> 'membership_path_30d' FROM path_stats),
  '{"plans_viewed":2,"plan_sheet_opened":1,"purchase_started":1,"purchase_succeeded":1,"purchase_cancelled":1,"purchase_failed":1,"membership_invite_shown":2,"membership_invite_tapped":1}'::jsonb,
  'members (not events) at each step in the last 30 days; not the admin, not a visit 40 days ago');

SELECT * FROM finish();
ROLLBACK;
