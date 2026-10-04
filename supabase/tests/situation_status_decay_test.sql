BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

SELECT ok(NOT has_function_privilege('authenticated','public._loved_one_status_weight(text,text,timestamptz,timestamptz,integer,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('anon','public._loved_one_effective_status(text,text,timestamptz,timestamptz,integer,timestamptz)','EXECUTE'),
  'weight helpers are internal');

-- ── Pure weights ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE w(label text, stage text, status text, stage_at timestamptz, status_at timestamptz, warn integer, weight integer, eff text);
INSERT INTO w VALUES
 ('no stage, stable',                         NULL,           'stable',     NULL, now()-interval '1 day',   0,  0, 'stable'),
 ('no stage, unknown',                        NULL,           'unknown',    NULL, now()-interval '1 day',   0,  5, 'unknown'),
 ('no stage, using',                          NULL,           'using',      NULL, now()-interval '1 day',   0, 15, 'using'),
 ('no stage, fresh escalation',               NULL,           'escalating', NULL, now()-interval '2 days',  0, 25, 'escalating'),
 ('no stage, escalation 20 days old fades',   NULL,           'escalating', NULL, now()-interval '20 days', 0, 15, 'using'),
 ('old escalation kept by a new spike',       NULL,           'escalating', NULL, now()-interval '20 days', 3, 25, 'escalating'),
 ('no stage, crisis',                         NULL,           'crisis',     NULL, now()-interval '60 days', 0, 35, 'crisis'),
 ('treatment saved after escalation',         'in_treatment', 'escalating', now()-interval '1 day', now()-interval '5 days', 0, 0, 'in_treatment'),
 ('recovery saved after crisis',              'early_recovery_90','crisis', now()-interval '1 day', now()-interval '5 days', 0, 0, 'stable'),
 ('escalation after treatment stage counts',  'in_treatment', 'escalating', now()-interval '5 days', now()-interval '1 day', 0, 25, 'escalating'),
 ('active use stage + fresh escalation',      'active_use',   'escalating', now()-interval '1 day', now()-interval '2 days', 0, 25, 'escalating'),
 ('active use stage, stale escalation',       'active_use',   'escalating', now()-interval '30 days', now()-interval '20 days', 0, 15, 'using'),
 ('active use stage, stable status',          'active_use',   'stable',     now()-interval '1 day', now()-interval '30 days', 0, 15, 'stable'),
 ('considering treatment',                    'considering_treatment','using', now()-interval '1 day', now()-interval '30 days', 0, 10, 'using'),
 ('returning home',                           'returning_home','stable',    now()-interval '1 day', now()-interval '30 days', 0, 5, 'stable'),
 ('ongoing recovery, old using status',       'ongoing_recovery','using',   now()-interval '1 day', now()-interval '30 days', 0, 0, 'using'),
 ('unsure stage keeps status weight',         'unsure',       'using',      now()-interval '1 day', now()-interval '30 days', 0, 15, 'using'),
 ('no loved one',                             NULL,           NULL,         NULL, NULL,                     0,  5, NULL);
SELECT is(_loved_one_status_weight(stage,status,stage_at,status_at,warn,now()), weight, 'weight: '||label) FROM w;
SELECT is(_loved_one_effective_status(stage,status,stage_at,status_at,warn,now()), eff, 'status: '||label) FROM w;

-- ── my_situation() bands ─────────────────────────────────────────────────────
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES('a9000000-0000-0000-0000-000000000001','decay@example.invalid','{}','{}','authenticated','authenticated');
UPDATE accounts SET id='a9100000-0000-0000-0000-000000000001' WHERE user_id='a9000000-0000-0000-0000-000000000001';
INSERT INTO checkins(account_id,mood,checkin_date) VALUES('a9100000-0000-0000-0000-000000000001',2,current_date);
INSERT INTO loved_ones(account_id,status) VALUES('a9100000-0000-0000-0000-000000000001','escalating');
CREATE FUNCTION pg_temp.sit() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims','{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
  r := my_situation();
  RESET ROLE;
  RETURN r;
END $$;

SELECT is(pg_temp.sit()->>'band', 'elevated', 'fresh tracker escalation + a low day: elevated (35)');
UPDATE loved_ones SET status_changed_at=now()-interval '20 days' WHERE account_id='a9100000-0000-0000-0000-000000000001';
SELECT is(pg_temp.sit()->>'score', '25', 'the escalation fades after 14 quiet days (low day 10 + active use 15)');
SELECT is(pg_temp.sit()->>'band', 'watch', '…so the band comes down');
SELECT is(pg_temp.sit()->'drivers'->>'loved_one_status', 'using', 'drivers report the status that still applies');

INSERT INTO tracker_logs(account_id,sign_key,kind,week)
SELECT 'a9100000-0000-0000-0000-000000000001','sign-'||i,'warning',current_date FROM generate_series(1,3) i;
SELECT is(pg_temp.sit()->>'score', '65', 'a new warning spike keeps the escalation current (10 + 30 + 25)');
DELETE FROM tracker_logs WHERE account_id='a9100000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT lives_ok($$SELECT set_loved_one_status('escalating')$$, 'the tracker re-asserts an escalation');
RESET ROLE;
SELECT is(pg_temp.sit()->>'score', '35', 're-asserting the same status makes it current again');

UPDATE loved_ones SET stage='in_treatment' WHERE account_id='a9100000-0000-0000-0000-000000000001';
SELECT is(pg_temp.sit()->>'score', '10', 'a treatment stage saved after the escalation replaces it');
SELECT is(pg_temp.sit()->>'band', 'watch', 'treatment + one low day is watch, not elevated');
SELECT is(pg_temp.sit()->'drivers'->>'loved_one_phase', 'in_treatment', 'drivers report the recovery phase');

UPDATE loved_ones SET stage='early_recovery_30', status='stable' WHERE account_id='a9100000-0000-0000-0000-000000000001';
DELETE FROM checkins WHERE account_id='a9100000-0000-0000-0000-000000000001';
SELECT is(pg_temp.sit()->>'band', 'calm', 'early recovery with no low days is calm');

UPDATE loved_ones SET stage='active_use', status='crisis' WHERE account_id='a9100000-0000-0000-0000-000000000001';
INSERT INTO checkins(account_id,mood,checkin_date,created_at)
SELECT 'a9100000-0000-0000-0000-000000000001',1,current_date-i,now()-make_interval(days=>i) FROM generate_series(0,2) i;
SELECT is(pg_temp.sit()->>'band', 'crisis', 'crisis status + three low days is still crisis (30 + 35)');

SELECT * FROM finish();
ROLLBACK;
