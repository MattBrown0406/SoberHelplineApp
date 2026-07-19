BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(11);

WITH required(table_name, privilege) AS (
  VALUES
    ('accounts','SELECT'),
    ('checkins','SELECT'), ('checkins','INSERT'), ('checkins','UPDATE'), ('checkins','DELETE'),
    ('walls','SELECT'), ('walls','INSERT'), ('walls','UPDATE'), ('walls','DELETE'),
    ('tracker_logs','SELECT'), ('tracker_logs','INSERT'), ('tracker_logs','UPDATE'), ('tracker_logs','DELETE'),
    ('consents','SELECT'), ('consents','INSERT'), ('consents','UPDATE'),
    ('loved_ones','SELECT'), ('loved_ones','INSERT'), ('loved_ones','UPDATE'), ('loved_ones','DELETE'),
    ('sessions','SELECT'),
    ('session_rsvps','SELECT'), ('session_rsvps','INSERT'), ('session_rsvps','UPDATE'), ('session_rsvps','DELETE'),
    ('threads','SELECT'), ('threads','INSERT'),
    ('messages','SELECT'), ('messages','INSERT'),
    ('message_attachments','SELECT'), ('message_attachments','INSERT'),
    ('rehearsal_sessions','SELECT'), ('rehearsal_sessions','INSERT'), ('rehearsal_sessions','DELETE')
)
SELECT ok(
  bool_and(has_table_privilege('authenticated', 'public.' || quote_ident(table_name), privilege)),
  'authenticated has every table privilege required by direct app flows'
) FROM required;

SELECT ok(
  has_column_privilege('authenticated','public.accounts','language','UPDATE')
  AND has_column_privilege('authenticated','public.accounts','push_token','UPDATE'),
  'members can update narrow profile and device columns'
);
SELECT ok(
  NOT has_column_privilege('authenticated','public.accounts','type','UPDATE')
  AND NOT has_column_privilege('authenticated','public.accounts','org_id','UPDATE')
  AND NOT has_column_privilege('authenticated','public.accounts','user_id','UPDATE'),
  'members cannot self-attach, choose an organization, or reassign account ownership'
);
SELECT ok(
  NOT has_table_privilege('authenticated','public.family_members','INSERT'),
  'family membership cannot be inserted directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated','public.consents','DELETE'),
  'consent ledger cannot be hard-deleted by members'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.plan_review_admin_preparation', 'SELECT'),
  'members cannot read private plan-review preparation'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.is_video_staff(uuid)', 'EXECUTE'),
  'video RLS helper is executable by authenticated members'
);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES ('19000000-0000-0000-0000-000000000001','privilege-member@example.com','{}','{"first_name":"Privilege"}','authenticated','authenticated');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-0000-0000-000000000001","email":"privilege-member@example.com","role":"authenticated"}',true);

SELECT lives_ok(
  $$SELECT id, first_name FROM public.accounts WHERE user_id=auth.uid()$$,
  'a newly signed-in member can load their account'
);
SELECT lives_ok(
  $$UPDATE public.accounts SET language='es' WHERE user_id=auth.uid()$$,
  'a member can update their own account'
);
SELECT throws_ok(
  $$UPDATE public.accounts SET type='attached' WHERE user_id=auth.uid()$$,
  '42501',
  'permission denied for table accounts',
  'a member cannot self-upgrade to attached access'
);
SELECT lives_ok(
  $$INSERT INTO public.checkins(account_id,mood,checkin_date) VALUES(public.my_account_id(),3,current_date)$$,
  'a member can create an RLS-protected check-in'
);

SELECT * FROM finish();
ROLLBACK;
