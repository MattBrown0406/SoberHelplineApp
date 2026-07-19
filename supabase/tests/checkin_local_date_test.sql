BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(8);

INSERT INTO auth.users (id, email) VALUES
  ('77777777-7777-4777-8777-777777777777', 'local-day@example.com');
UPDATE public.accounts
SET timezone = 'America/Los_Angeles'
WHERE user_id = '77777777-7777-4777-8777-777777777777';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);

SELECT lives_ok(
  $$
    INSERT INTO public.checkins (account_id, mood, created_at, checkin_date) VALUES
      (public.my_account_id(), 3, '2026-07-20T01:00:00Z', '2026-07-19'),
      (public.my_account_id(), 4, '2026-07-20T23:00:00Z', '2026-07-20')
  $$,
  'two account-local dates may coexist even when UTC dates overlap'
);

SELECT throws_ok(
  $$
    INSERT INTO public.checkins (account_id, mood, created_at, checkin_date)
    VALUES (public.my_account_id(), 5, '2026-07-21T02:00:00Z', '2026-07-20')
  $$,
  '23505',
  NULL,
  'only one check-in is allowed per account-local date'
);

SELECT lives_ok(
  $$
    INSERT INTO public.checkins (account_id, mood, created_at)
    VALUES (public.my_account_id(), 4, '2026-07-22T07:00:00Z')
  $$,
  'older clients may omit checkin_date'
);

SELECT is(
  (
    SELECT checkin_date
    FROM public.checkins
    WHERE account_id = public.my_account_id()
      AND created_at = '2026-07-22T07:00:00Z'
  ),
  DATE '2026-07-22',
  'server derives the account-local date for older clients'
);

SELECT lives_ok(
  $$
    INSERT INTO public.checkins (account_id, mood, created_at, checkin_date)
    VALUES (public.my_account_id(), 2, '2026-07-23T07:00:00Z', '2000-01-01')
  $$,
  'a mismatched client-supplied date is replaced rather than trusted'
);
SELECT is(
  (SELECT checkin_date FROM public.checkins WHERE created_at = '2026-07-23T07:00:00Z'),
  DATE '2026-07-23',
  'client-supplied check-in dates cannot disagree with the account-local date'
);

UPDATE public.accounts SET timezone = 'Not/A_Timezone' WHERE user_id = auth.uid();
SELECT lives_ok(
  $$
    INSERT INTO public.checkins (account_id, mood, created_at)
    VALUES (public.my_account_id(), 3, '2026-07-24T01:00:00Z')
  $$,
  'a malformed stored timezone falls back safely instead of aborting writes'
);
SELECT is(
  (SELECT checkin_date FROM public.checkins WHERE created_at = '2026-07-24T01:00:00Z'),
  DATE '2026-07-24',
  'malformed timezones use UTC as a safe fallback'
);

ROLLBACK;