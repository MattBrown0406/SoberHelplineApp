BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(4);

SELECT has_column('public', 'wavering_events', 'notification_claimed_at',
  'notify-family-backup and the retry sweep can claim a wavering event');
SELECT lives_ok($$SELECT public.retry_notification_deliveries()$$,
  'the per-minute retry sweep runs');
SELECT ok(
  (SELECT pg_get_expr(polwithcheck, polrelid) LIKE '%is_family_member(family_space_id)%'
   FROM pg_policy WHERE polrelid = 'public.wall_hold_logs'::regclass AND polname = 'wall_hold_logs: self insert'),
  'hold logs can only be shared into a family space she belongs to (insert)'
);
SELECT ok(
  (SELECT pg_get_expr(polwithcheck, polrelid) LIKE '%is_family_member(family_space_id)%'
   FROM pg_policy WHERE polrelid = 'public.wall_hold_logs'::regclass AND polname = 'wall_hold_logs: self update'),
  'hold logs can only be shared into a family space she belongs to (update)'
);

SELECT * FROM finish();
ROLLBACK;
