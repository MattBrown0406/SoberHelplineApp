BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(80);

-- ─── Fixtures ────────────────────────────────────────────────────────────────
-- free member · mom + dad sharing a family space (paid) · admin · paid outsider
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
  ('71000000-0000-0000-0000-000000000001', 'invite-free@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('71000000-0000-0000-0000-000000000002', 'invite-mom@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('71000000-0000-0000-0000-000000000003', 'invite-dad@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('71000000-0000-0000-0000-000000000004', 'matt@soberhelpline.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('71000000-0000-0000-0000-000000000005', 'invite-solo@example.com', '{}', '{}', 'authenticated', 'authenticated');

UPDATE public.accounts SET id = '72000000-0000-0000-0000-000000000001', timezone = 'America/New_York'
WHERE user_id = '71000000-0000-0000-0000-000000000001';
UPDATE public.accounts SET id = '72000000-0000-0000-0000-000000000002', timezone = 'America/New_York',
  push_token = 'ExponentPushToken[invite-mom]', locale = 'es'
WHERE user_id = '71000000-0000-0000-0000-000000000002';
UPDATE public.accounts SET id = '72000000-0000-0000-0000-000000000003', timezone = 'America/New_York'
WHERE user_id = '71000000-0000-0000-0000-000000000003';
UPDATE public.accounts SET id = '72000000-0000-0000-0000-000000000004', push_token = 'ExponentPushToken[invite-admin]'
WHERE user_id = '71000000-0000-0000-0000-000000000004';
UPDATE public.accounts SET id = '72000000-0000-0000-0000-000000000005', timezone = 'America/New_York'
WHERE user_id = '71000000-0000-0000-0000-000000000005';

INSERT INTO public.entitlements (account_id, source, tier, expires_at) VALUES
  ('72000000-0000-0000-0000-000000000002', 'scholarship', 'essential', now() + interval '30 days'),
  ('72000000-0000-0000-0000-000000000003', 'scholarship', 'essential', now() + interval '30 days'),
  ('72000000-0000-0000-0000-000000000005', 'scholarship', 'premium', now() + interval '30 days');

INSERT INTO public.family_spaces (id, name, created_by)
VALUES ('73000000-0000-0000-0000-000000000001', 'Mom', '72000000-0000-0000-0000-000000000002');
INSERT INTO public.family_members (family_space_id, account_id, role) VALUES
  ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002', 'owner'),
  ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000003', 'member');

-- ─── Privileges ──────────────────────────────────────────────────────────────
SELECT ok(
  bool_and(has_table_privilege('authenticated', 'public.' || t, 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.' || t, 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.' || t, 'DELETE')
    AND NOT has_table_privilege('anon', 'public.' || t, 'SELECT')),
  'members read engine tables under RLS and write only through validated RPCs'
) FROM unnest(ARRAY['loved_one_profiles', 'invitation_engine_state', 'invitation_move_logs',
  'invitation_checks', 'invitation_forecasts', 'invitation_attempts']) AS t;

SELECT ok(
  bool_and(has_function_privilege('authenticated', f, 'EXECUTE') AND NOT has_function_privilege('anon', f, 'EXECUTE')),
  'member RPCs are callable by signed-in members only'
) FROM unnest(ARRAY[
  'public.my_invitation_engine(date)', 'public.save_loved_one_profile(jsonb,boolean)',
  'public.complete_invitation_setup(boolean)', 'public.set_invitation_window_push(boolean)',
  'public.set_invitation_move_done(text,date,boolean)', 'public.set_invitation_check(date,text)',
  'public.record_invitation_forecast(date,text,integer,text[])',
  'public.log_invitation_attempt(text,date,text,text,text[],text,date)',
  'public.invitation_learning()', 'public.admin_invitation_stats()'
]) AS f;

SELECT ok(
  bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE') AND NOT has_function_privilege('anon', f, 'EXECUTE')
    AND has_function_privilege('service_role', f, 'EXECUTE')),
  'the evening push pipeline is service-role only'
) FROM unnest(ARRAY[
  'public.invitation_window_push_candidates(timestamptz,integer)',
  'public.enqueue_invitation_window_push(uuid,date,integer,text[],text,text,timestamptz)',
  'public.dispatch_invitation_window_push()'
]) AS f;

SELECT ok(
  bool_and(NOT has_function_privilege('authenticated', f, 'EXECUTE')),
  'internal helpers cannot be called directly'
) FROM unnest(ARRAY[
  'public._invitation_snapshot(uuid,date)', 'public._invitation_engine_allowed(uuid)',
  'public._invitation_require_access()', 'public._invitation_local_date(uuid,date)',
  'public._invitation_clean_list(jsonb,integer,integer)'
]) AS f;

SELECT is(
  ARRAY[public._invitation_valid_tz('America/New_York'), public._invitation_valid_tz('Not/AZone'),
        public._invitation_valid_tz(''), public._invitation_valid_tz(NULL)],
  ARRAY['America/New_York', 'UTC', 'UTC', 'UTC'],
  'time zones are validated cheaply, falling back to UTC'
);
SELECT ok(
  pg_get_functiondef('public._invitation_account_tz(uuid)'::regprocedure) NOT LIKE '%pg_timezone_names%'
  AND pg_get_functiondef('public._invitation_valid_tz(text)'::regprocedure) NOT LIKE '%pg_timezone_names%'
  AND pg_get_functiondef('public.invitation_window_push_candidates(timestamptz,integer)'::regprocedure) LIKE '%LEFT JOIN zones z%',
  'per-member calls never scan pg_timezone_names; the hourly query joins the zone list once'
);
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'shl-invitation-window-push'),
  '20 * * * *',
  'the window push is scheduled hourly'
);

-- ─── Free member: the pattern map is free; the engine is not ────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","email":"invite-free@example.com","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.save_loved_one_profile(jsonb_build_object(
    'name', '  Mike  ',
    'relationship', 'son',
    'substances', jsonb_build_array('alcohol'),
    'useTriggers', jsonb_build_array('  Friday   nights ', 'friday nights', 'after work', 'payday', 'stress', 'games', 'alone', 'pain', 42),
    'soberMoments', jsonb_build_array('Saturday mornings'),
    'soberTimes', jsonb_build_array('weekend', 'midnight'),
    'safetyConcern', 'none'
  ), true)$$,
  'a free member can save the pattern map'
);
SELECT is(
  (SELECT row(name, use_triggers[1], cardinality(use_triggers), sober_times, completed_at IS NOT NULL)::text
   FROM public.loved_one_profiles),
  row('Mike', 'Friday nights', 6, ARRAY['weekend'], true)::text,
  'lists are trimmed, de-duplicated, capped at six and sober times validated'
);
SELECT throws_ok(
  $$SELECT public.save_loved_one_profile('{"safetyConcern":"maybe"}'::jsonb, false)$$,
  '22023', 'invalid_safety_concern', 'unknown safety answers are rejected'
);
SELECT throws_ok(
  $$SELECT public.save_loved_one_profile('{"name":"Mike","safetyConcern":""}'::jsonb, true)$$,
  '22023', 'safety_answer_required', 'a pattern map cannot be finished without a safety answer'
);
SELECT throws_ok(
  $$SELECT public.set_invitation_move_done('i_statement', (now() AT TIME ZONE 'America/New_York')::date, true)$$,
  '42501', 'upgrade_required', 'daily moves are a paid feature'
);
SELECT is(
  (SELECT row(e->>'has_access', e#>>'{profile,completed}')::text FROM public.my_invitation_engine() e),
  row('false', 'true')::text,
  'the free snapshot shows a completed map without engine access'
);

-- ─── Paid mom: setup, moves, check, forecast ─────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000002","email":"invite-mom@example.com","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.complete_invitation_setup(true)$$,
  '22023', 'pattern_map_required', 'setup needs a finished pattern map'
);
SELECT lives_ok(
  $$SELECT public.save_loved_one_profile(jsonb_build_object(
    'name', 'Mike', 'soberMoments', jsonb_build_array('evenings after dinner'),
    'soberTimes', jsonb_build_array('evening'), 'costsTheyFeel', jsonb_build_array('his job'),
    'safetyConcern', 'some'), true)$$,
  'mom saves her pattern map'
);
SELECT is(
  (public.complete_invitation_setup(true)).window_push_opt_in,
  true,
  'mom opts in to window alerts during setup'
);
SELECT is(
  public.set_invitation_move_done('i_statement', (now() AT TIME ZONE 'America/New_York')::date, true),
  ARRAY['i_statement'],
  'one tap logs a daily move'
);
SELECT is(
  public.set_invitation_move_done('i_statement', (now() AT TIME ZONE 'America/New_York')::date, true),
  ARRAY['i_statement'],
  'logging the same move twice is idempotent'
);
SELECT throws_ok(
  $$SELECT public.set_invitation_move_done('i_statement', (now() AT TIME ZONE 'America/New_York')::date - 5, true)$$,
  '22023', 'invalid_local_date', 'moves are logged for today only'
);
SELECT throws_ok(
  $$SELECT public.set_invitation_move_done('DROP TABLE', (now() AT TIME ZONE 'America/New_York')::date, true)$$,
  '22023', 'invalid_move', 'move ids are validated'
);
SELECT throws_ok(
  $$SELECT public.set_invitation_move_done('not_a_real_move', (now() AT TIME ZONE 'America/New_York')::date, true)$$,
  '22023', 'invalid_move', 'only moves from the app''s library can be logged'
);
SELECT is(
  public.set_invitation_check((now() AT TIME ZONE 'America/New_York')::date, 'calm'),
  'calm',
  'the quick check is stored'
);
SELECT lives_ok(
  $$SELECT public.record_invitation_forecast((now() AT TIME ZONE 'America/New_York')::date, 'good', 70, ARRAY['calm', 'bogus'])$$,
  'a forecast snapshot is recorded'
);
SELECT is(
  (SELECT sources FROM public.invitation_forecasts),
  ARRAY['calm'],
  'unknown forecast sources are dropped'
);
SELECT lives_ok(
  $$SELECT public.record_invitation_forecast((now() AT TIME ZONE 'America/New_York')::date, 'low', 30, ARRAY['trend'])$$,
  'a later, lower forecast is accepted'
);
SELECT is(
  (SELECT row(level, score, sources)::text FROM public.invitation_forecasts),
  row('good', 70, ARRAY['calm'])::text,
  'the day keeps its best window'
);
SELECT is(
  (SELECT row(
     e#>>'{today,moves_done,0}', e#>>'{today,check}', e#>>'{inputs,move_days_7}',
     e#>>'{plan,scope}', e#>>'{plan,seed}', e#>>'{plan,members}', e#>>'{plan,signals,sober_times,0}')::text
   FROM public.my_invitation_engine() e),
  row('i_statement', 'calm', '1', 'family', '73000000-0000-0000-0000-000000000001', '2', 'evening')::text,
  'the snapshot carries today, the inputs and the shared family plan'
);
SELECT is(
  (SELECT count(*)::integer FROM public.loved_one_profiles),
  1,
  'members only ever read their own pattern map'
);

-- ─── Dad: same plan, but safety is per member and never shared ─────────────
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000003","email":"invite-dad@example.com","role":"authenticated"}', true);

SELECT is(
  public.my_invitation_engine()#>>'{plan,seed}',
  '73000000-0000-0000-0000-000000000001',
  'family members share one plan seed, so they see the same two moves'
);
SELECT lives_ok(
  $$SELECT public.save_loved_one_profile('{"name":"Mike","safetyConcern":"serious"}'::jsonb, true)$$,
  'dad flags a serious safety concern'
);
SELECT is(
  (public.save_loved_one_profile('{"name":"Mike","useTriggers":["after work"],"safetyConcern":""}'::jsonb, false)).safety_concern,
  'serious',
  'a draft without a safety answer never erases a stored serious concern'
);

SELECT is(
  public.my_invitation_engine()->>'safety_first',
  'true',
  'dad''s own plan switches to safety-first'
);
SELECT throws_ok(
  $$SELECT public.set_invitation_window_push(true)$$,
  '22023', 'safety_first', 'window alerts cannot be turned on in safety-first mode'
);

SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000002","email":"invite-mom@example.com","role":"authenticated"}', true);
SELECT is(
  (SELECT row(e->>'safety_first', (e #> '{plan,signals}') ? 'safety_serious', e::text LIKE '%serious%')::text
   FROM public.my_invitation_engine() e),
  row('false', false, false)::text,
  'a relative''s serious answer never changes her plan or reaches her snapshot'
);
SELECT is(
  public.set_invitation_window_push(true),
  true,
  'she can keep window alerts; his answer is his alone'
);

-- ─── Outcome loop and admin alert ────────────────────────────────────────────
SELECT is(
  public.log_invitation_attempt('yes', (now() AT TIME ZONE 'America/New_York')::date, 'He said yes!', 'good', ARRAY['calm','sober_time'], 'warm', (now() AT TIME ZONE 'America/New_York')::date + 3)->>'coach_alerted',
  'true',
  'mom logs a yes and learns Matt was alerted'
);
SELECT is(
  public.log_invitation_attempt('yes', (now() AT TIME ZONE 'America/New_York')::date)->>'coach_alerted',
  'true',
  'a duplicate yes is recorded; the earlier alert still counts'
);
SELECT lives_ok(
  $$SELECT public.log_invitation_attempt('not_yet', (now() AT TIME ZONE 'America/New_York')::date, NULL, 'possible', ARRAY['trend'], 'nonsense', (now() AT TIME ZONE 'America/New_York')::date + 3)$$,
  'mom logs a not yet with a next window'
);
SELECT is(
  (SELECT row(count(*) FILTER (WHERE outcome = 'yes' AND next_window_date IS NULL),
              count(*) FILTER (WHERE outcome = 'not_yet' AND next_window_date IS NOT NULL AND line_style IS NULL))::text
   FROM public.invitation_attempts),
  row(2, 1)::text,
  'a yes never carries a next window; unknown line styles are dropped'
);
SELECT is(
  (SELECT row(forecast_level, window_sources)::text FROM public.invitation_attempts WHERE outcome = 'not_yet'),
  row('good', ARRAY['calm'])::text,
  'attempts take the ask day''s recorded forecast, not the client''s value at logging time'
);
SELECT lives_ok(
  $$SELECT public.log_invitation_attempt('didnt_get_to_it', (now() AT TIME ZONE 'America/New_York')::date - 1, NULL, 'possible', ARRAY['trend'])$$,
  'an attempt can be logged for yesterday'
);
SELECT is(
  (SELECT row(local_date, forecast_level, window_sources)::text FROM public.invitation_attempts WHERE outcome = 'didnt_get_to_it'),
  row((now() AT TIME ZONE 'America/New_York')::date - 1, 'possible', ARRAY['trend'])::text,
  'with no recorded forecast that day, the client fallback is used'
);
SELECT throws_ok(
  $$SELECT public.admin_invitation_stats()$$,
  '42501', 'not authorized', 'members cannot read engine-wide stats'
);

SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000003","email":"invite-dad@example.com","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_learning() WHERE NOT mine),
  4,
  'family learning includes attempts logged by others in the space'
);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000005","email":"invite-solo@example.com","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_learning()),
  0,
  'families never see each other''s attempts'
);
SELECT lives_ok(
  $$SELECT public.log_invitation_attempt('angry', (now() AT TIME ZONE 'America/New_York')::date)$$,
  'a solo member logs an attempt before joining a family'
);
RESET ROLE;
INSERT INTO public.family_members (family_space_id, account_id, role)
VALUES ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000005', 'member');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000003","email":"invite-dad@example.com","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_learning() WHERE NOT mine),
  4,
  'a member''s history from before they joined does not follow them into the family'
);

SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000004","email":"matt@soberhelpline.com","role":"authenticated"}', true);
SELECT is(
  (SELECT row((s->>'families_using')::integer >= 1, (s#>>'{outcomes,yes}')::integer >= 2, jsonb_array_length(s->'weekly'),
              (s->'recent_yes'->0->>'email') IS NOT NULL)::text
   FROM public.admin_invitation_stats() s),
  row(true, true, 5, true)::text,
  'admins see families, outcomes, the weekly trend and who to call'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM public.push_outbox
   WHERE kind = 'admin_invitation_yes' AND account_id = '72000000-0000-0000-0000-000000000004'
     AND metadata->>'kind' = 'admin_invitation_yes'),
  1,
  'a yes alerts each admin device once (no repeat within six hours)'
);

UPDATE public.accounts SET push_token = NULL WHERE id = '72000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000005","email":"invite-solo@example.com","role":"authenticated"}', true);
SELECT is(
  public.log_invitation_attempt('yes', (now() AT TIME ZONE 'America/New_York')::date)->>'coach_alerted',
  'false',
  'with no admin device the app is told nobody was alerted'
);
RESET ROLE;

-- ─── Tracker trend inputs: this week so far vs last week to the same weekday ─
-- Wednesday 7 Oct 2026; last week began Monday 28 Sep.
INSERT INTO public.tracker_logs (account_id, sign_key, kind, week, created_at) VALUES
  ('72000000-0000-0000-0000-000000000002', 'w-friends', 'warning', '2026-09-28', '2026-09-29 15:00:00+00'),
  ('72000000-0000-0000-0000-000000000002', 'w-money', 'warning', '2026-09-28', '2026-10-03 15:00:00+00'),
  ('72000000-0000-0000-0000-000000000002', 'r-meetings', 'recovery', '2026-09-28', '2026-09-30 15:00:00+00');
SELECT is(
  (SELECT row(s#>>'{inputs,warning_this_week}', s#>>'{inputs,warning_last_week}', s#>>'{inputs,recovery_last_week}')::text
   FROM public._invitation_snapshot('72000000-0000-0000-0000-000000000002', '2026-10-07') s),
  row('0', '1', '1')::text,
  'last week''s signs count only up to the same weekday'
);

-- ─── Evening window push ─────────────────────────────────────────────────────
-- Start the push scenarios from a known outcome history (fixed dates below).
-- (Outcome pauses are family-level, so clear every member of Mom's space —
-- including the solo member who joined and logged a yes above.)
DELETE FROM public.invitation_attempts WHERE account_id IN (
  '72000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000005'
);

SELECT is(
  ARRAY[
    public._invitation_recovery_phase('in_treatment', 'using'),
    public._invitation_recovery_phase('returning_home', NULL),
    public._invitation_recovery_phase('recovery', 'stable'),
    public._invitation_recovery_phase('recovery', 'escalating'),
    public._invitation_recovery_phase('seeking_help', 'in_treatment'),
    public._invitation_recovery_phase(NULL, 'in_treatment'),
    public._invitation_recovery_phase('legacy', 'crisis'),
    public._invitation_recovery_phase(NULL, NULL)
  ],
  ARRAY['in_treatment', 'returning_home', 'early_recovery_30', 'return_to_use', 'considering_treatment',
        'in_treatment', 'active_use', 'unsure'],
  'the effective phase mirrors the Today pathway card (stage wins; status only for legacy stages)'
);

SELECT is(
  ARRAY[
    public._invitation_window_blocked('{"safety_first":false,"profile":{"completed":true}}', '2026-10-02'),
    public._invitation_window_blocked('{"profile":{"completed":true}}', '2026-10-02'),
    public._invitation_window_blocked('{"safety_first":false,"profile":{"completed":true},"recovery_phase":"in_treatment"}', '2026-10-02'),
    public._invitation_window_blocked('{"safety_first":false,"profile":{"completed":true},"recovery_phase":"returning_home"}', '2026-10-02'),
    public._invitation_window_blocked('{"safety_first":false,"profile":{"completed":true},"recovery_phase":"ongoing_recovery"}', '2026-10-02'),
    public._invitation_window_blocked('{"safety_first":false,"profile":{"completed":true},"recovery_phase":"return_to_use"}', '2026-10-02'),
    public._invitation_window_blocked('{"safety_first":false,"profile":{"completed":true},"outcome_gate":{"outcome":"yes","local_date":"2026-09-20"}}', '2026-10-02'),
    public._invitation_window_blocked('{"safety_first":false,"profile":{"completed":true},"outcome_gate":{"outcome":"yes","local_date":"2026-08-20"}}', '2026-10-02'),
    public._invitation_window_blocked('{"safety_first":false,"profile":{"completed":true},"outcome_gate":{"outcome":"angry","local_date":"2026-10-01","next_window_date":"2026-10-08"}}', '2026-10-02'),
    public._invitation_window_blocked('{"safety_first":false,"profile":{"completed":true},"outcome_gate":{"outcome":"not_yet","local_date":"2026-09-29","next_window_date":"2026-10-02"}}', '2026-10-02')
  ],
  ARRAY[NULL, 'safety', 'in_treatment', 'returning_home', 'in_recovery', NULL, 'after_yes', NULL, 'resting', NULL]::text[],
  'push rules: own safety (unknown = safety), after-yes phases, 30 days after a yes, rest until the next window'
);

-- 21:30 UTC on 2 Oct 2026 is 5:30 PM in New York. Dad is still 'serious'.
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'),
  1,
  'a relative''s safety answer does not stop her window push'
);

-- The app writes the pathway STAGE (the status picker never offers in_treatment).
INSERT INTO public.loved_ones (account_id, status, stage) VALUES ('72000000-0000-0000-0000-000000000002', 'using', 'in_treatment')
ON CONFLICT (account_id) DO UPDATE SET status = 'using', stage = 'in_treatment';
SELECT is(
  (SELECT row(s->>'recovery_phase', (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'))::text
   FROM public._invitation_snapshot('72000000-0000-0000-0000-000000000002', '2026-10-02') s),
  row('in_treatment', 0)::text,
  'stage in_treatment pauses her window push even though status says using'
);
UPDATE public.loved_ones SET stage = 'returning_home' WHERE account_id = '72000000-0000-0000-0000-000000000002';
SELECT is((SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'), 0, 'no window push while they are coming home');
UPDATE public.loved_ones SET stage = 'early_recovery_90' WHERE account_id = '72000000-0000-0000-0000-000000000002';
SELECT is((SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'), 0, 'no window push while they are in recovery');
UPDATE public.loved_ones SET stage = 'return_to_use' WHERE account_id = '72000000-0000-0000-0000-000000000002';
SELECT is((SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'), 1, 'a return to use reopens the window push');
UPDATE public.loved_ones SET stage = 'considering_treatment' WHERE account_id = '72000000-0000-0000-0000-000000000002';

-- Outcome pauses are family-level: Dad's yes / angry gate Mom too.
INSERT INTO public.invitation_attempts (account_id, family_space_id, outcome, note, local_date)
VALUES ('72000000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000001', 'yes', 'dad private note', '2026-10-01');
SELECT is(
  (SELECT row(s#>>'{outcome_gate,outcome}', s::text LIKE '%dad private note%', (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'))::text
   FROM public._invitation_snapshot('72000000-0000-0000-0000-000000000002', '2026-10-02') s),
  row('yes', false, 0)::text,
  'Dad logs yes: Mom is paused and not a push candidate (outcome only, never his note)'
);
UPDATE public.invitation_attempts SET outcome = 'angry', next_window_date = '2026-10-05'
WHERE account_id = '72000000-0000-0000-0000-000000000003';
SELECT is(
  (SELECT row(s#>>'{outcome_gate,outcome}', (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'))::text FROM public._invitation_snapshot('72000000-0000-0000-0000-000000000002', '2026-10-02') s),
  row('angry', 0)::text,
  'Dad logs angry: Mom rests until the suggested window'
);
UPDATE public.invitation_attempts SET family_space_id = NULL WHERE account_id = '72000000-0000-0000-0000-000000000003';
SELECT is((SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'), 1, 'an attempt he logged outside this family space does not gate her');
DELETE FROM public.invitation_attempts WHERE account_id = '72000000-0000-0000-0000-000000000003';

-- Treatment/recovery pauses are family-level too: the most recently updated
-- loved-one record in the space decides. Dad's own (older) record says "using";
-- no yes is in the last 30 days, so only the phase can pause him. (Dad's own
-- safety answer is set aside here to isolate the phase rule.)
INSERT INTO public.loved_ones (account_id, status, stage, updated_at)
VALUES ('72000000-0000-0000-0000-000000000003', 'using', 'using', now() - interval '40 days')
ON CONFLICT (account_id) DO UPDATE SET status = 'using', stage = 'using', updated_at = now() - interval '40 days';
UPDATE public.loved_ones SET stage = 'in_treatment', updated_at = now() - interval '35 days' WHERE account_id = '72000000-0000-0000-0000-000000000002';
SELECT is(
  (SELECT row(s->>'recovery_phase',
              public._invitation_window_blocked(s || '{"safety_first":false,"profile":{"completed":true,"safety_concern":"none"}}'::jsonb, '2026-10-02'),
              s::text LIKE '%dad private note%')::text
   FROM public._invitation_snapshot('72000000-0000-0000-0000-000000000003', '2026-10-02') s),
  row('in_treatment', 'in_treatment', false)::text,
  'Mom set in_treatment: Dad is paused too, after the 30-day yes pause (phase only is shared)'
);
UPDATE public.loved_ones SET stage = 'return_to_use', updated_at = now() WHERE account_id = '72000000-0000-0000-0000-000000000002';
SELECT is(
  (SELECT row(s->>'recovery_phase',
              coalesce(public._invitation_window_blocked(s || '{"safety_first":false,"profile":{"completed":true,"safety_concern":"none"}}'::jsonb, '2026-10-02'), 'open'))::text
   FROM public._invitation_snapshot('72000000-0000-0000-0000-000000000003', '2026-10-02') s),
  row('return_to_use', 'open')::text,
  'Mom set return to use: Dad reopens'
);
UPDATE public.loved_ones SET stage = 'considering_treatment', updated_at = now() WHERE account_id = '72000000-0000-0000-0000-000000000002';
UPDATE public.loved_ones SET stage = 'early_recovery_30', updated_at = now() + interval '1 minute' WHERE account_id = '72000000-0000-0000-0000-000000000003';
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'),
  0,
  'Dad set early recovery: Mom gets no window push either'
);
UPDATE public.loved_ones SET stage = 'using', updated_at = now() - interval '40 days' WHERE account_id = '72000000-0000-0000-0000-000000000003';

-- The family phase follows STAGE changes only: Dad's status-only update (the
-- Tracker's automatic warning-spike update) must not reopen windows.
UPDATE public.loved_ones SET stage = 'in_treatment' WHERE account_id = '72000000-0000-0000-0000-000000000002';
UPDATE public.loved_ones SET status = 'escalating', updated_at = now() + interval '1 hour' WHERE account_id = '72000000-0000-0000-0000-000000000003';
SELECT is(
  (SELECT row(public._invitation_snapshot('72000000-0000-0000-0000-000000000003', '2026-10-02')->>'recovery_phase',
              public._invitation_snapshot('72000000-0000-0000-0000-000000000002', '2026-10-02')->>'recovery_phase')::text),
  row('in_treatment', 'in_treatment')::text,
  'Mom set in_treatment, then Dad''s status went to escalating without a stage change: the family stays paused'
);
-- Clients write loved_ones directly (useLovedOne.save); stage_changed_at is
-- trigger-maintained and a client-sent value is ignored.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000002","email":"invite-mom@example.com","role":"authenticated"}', true);
SELECT lives_ok(
  $$UPDATE public.loved_ones SET first_name = 'Mike', stage_changed_at = '2000-01-01' WHERE account_id = '72000000-0000-0000-0000-000000000002'$$,
  'the client update path still works with the new trigger'
);
SELECT is(
  (SELECT stage_changed_at > '2000-01-02'::timestamptz FROM public.loved_ones WHERE account_id = '72000000-0000-0000-0000-000000000002'),
  true,
  'a client-sent stage_changed_at is ignored'
);
RESET ROLE;
UPDATE public.loved_ones SET stage = 'considering_treatment' WHERE account_id = '72000000-0000-0000-0000-000000000002';

INSERT INTO public.invitation_attempts (account_id, outcome, local_date, next_window_date)
VALUES ('72000000-0000-0000-0000-000000000002', 'angry', '2026-10-01', '2026-10-05');
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'),
  0,
  'no window push while resting after anger'
);
SELECT is(
  public.enqueue_invitation_window_push('72000000-0000-0000-0000-000000000002', '2026-10-02', 72,
    ARRAY['calm'], 'Sober Helpline', 'You have a note for today.', '2026-10-02 21:30:00+00'),
  false,
  'and the enqueue re-check refuses it too'
);
UPDATE public.invitation_attempts SET outcome = 'yes', next_window_date = NULL
WHERE account_id = '72000000-0000-0000-0000-000000000002';
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'),
  0,
  'no window push right after a yes'
);
DELETE FROM public.invitation_attempts WHERE account_id = '72000000-0000-0000-0000-000000000002';

SELECT is(
  (SELECT row(locale, local_date, local_hour)::text FROM public.invitation_window_push_candidates('2026-10-02 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'),
  row('es', '2026-10-02'::date, 17)::text,
  'an opted-in member is a candidate in her own evening hour'
);
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-02 14:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'),
  0,
  'members are not candidates outside their evening hour'
);
SELECT is(
  public.enqueue_invitation_window_push('72000000-0000-0000-0000-000000000002', '2026-10-02', 72,
    ARRAY['consequence', 'sober_time'], 'Sober Helpline', 'Tienes una nota para hoy.', '2026-10-02 21:30:00+00'),
  true,
  'a good window is enqueued'
);
SELECT is(
  (SELECT row(count(*), min(metadata->>'kind'))::text FROM public.push_outbox
   WHERE account_id = '72000000-0000-0000-0000-000000000002' AND kind = 'invitation_window'),
  row(1, 'invitation_window')::text,
  'the push carries only its routing kind'
);
SELECT is(
  public.enqueue_invitation_window_push('72000000-0000-0000-0000-000000000002', '2026-10-03', 72,
    ARRAY['consequence'], 'Sober Helpline', 'Tienes una nota para hoy.', '2026-10-03 21:30:00+00'),
  false,
  'at most one window push per 48 hours'
);
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-03 21:30:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'),
  0,
  'a recently pushed member is not a candidate'
);
SELECT is(
  (SELECT row(level, pushed_at IS NOT NULL)::text FROM public.invitation_forecasts
   WHERE account_id = '72000000-0000-0000-0000-000000000002' AND local_date = '2026-10-02'),
  row('good', true)::text,
  'the pushed window is kept in forecast history'
);
-- The cron fires at the same local hour each evening (~47h50m later here):
-- the throttle counts local days, so two evenings later is allowed again.
SELECT is(
  (SELECT count(*)::integer FROM public.invitation_window_push_candidates('2026-10-04 21:20:00+00', 17)
   WHERE account_id = '72000000-0000-0000-0000-000000000002'),
  1,
  'the 48-hour throttle counts local days, so the evening two days later qualifies'
);
SELECT is(
  public.enqueue_invitation_window_push('72000000-0000-0000-0000-000000000002', '2026-10-04', 70,
    ARRAY['calm'], 'Sober Helpline', 'You have a note for today.', '2026-10-04 21:20:00+00'),
  true,
  'and the push two evenings later is enqueued'
);

UPDATE public.invitation_engine_state SET window_push_opt_in = false
WHERE account_id = '72000000-0000-0000-0000-000000000002';
UPDATE public.invitation_engine_state SET last_window_push_at = NULL
WHERE account_id = '72000000-0000-0000-0000-000000000002';
SELECT is(
  public.enqueue_invitation_window_push('72000000-0000-0000-0000-000000000002', '2026-10-05', 72,
    ARRAY['calm'], 'Title', 'Body', '2026-10-05 21:30:00+00'),
  false,
  'opting out stops the push even at enqueue time'
);

SELECT * FROM finish();
ROLLBACK;
