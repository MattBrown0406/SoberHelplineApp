BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(9);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES
('53000000-0000-0000-0000-000000000001','no-consent@example.com','{}','{}','authenticated','authenticated'),
('53000000-0000-0000-0000-000000000002','explicit-consent@example.com','{}',jsonb_build_object('terms_version','1.0','terms_accepted_at','2026-07-13T00:00:00Z'),'authenticated','authenticated');

SELECT ok(has_function_privilege('authenticated','public.record_signup_terms_consent()','EXECUTE'), 'authenticated can record signed signup consent evidence');
SELECT ok(NOT has_function_privilege('anon','public.record_signup_terms_consent()','EXECUTE'), 'anonymous role cannot execute consent recorder');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"53000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT is(public.record_signup_terms_consent(), false, 'missing affirmative signup metadata is rejected');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.consents c JOIN public.accounts a ON a.id=c.account_id WHERE a.user_id='53000000-0000-0000-0000-000000000001'), 0, 'missing evidence creates no consent row');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"53000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT is(public.record_signup_terms_consent(), true, 'explicit signup metadata records consent');
RESET ROLE;
SELECT is((SELECT version FROM public.consents c JOIN public.accounts a ON a.id=c.account_id WHERE a.user_id='53000000-0000-0000-0000-000000000002' AND consent_key='1'), '1.0', 'recorded consent preserves accepted version');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"53000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT is(public.record_signup_terms_consent(), true, 'repeated recording is idempotent');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.consents c JOIN public.accounts a ON a.id=c.account_id WHERE a.user_id='53000000-0000-0000-0000-000000000002' AND consent_key='1'), 1, 'idempotent retry creates one row');

UPDATE public.consents SET revoked_at=now() WHERE account_id=(SELECT id FROM public.accounts WHERE user_id='53000000-0000-0000-0000-000000000002') AND consent_key='1';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"53000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT is(public.record_signup_terms_consent(), false, 'revoked consent is not silently reactivated');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
