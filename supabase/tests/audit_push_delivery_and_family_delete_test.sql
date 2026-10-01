-- Transaction-only synthetic fixtures; requires a full isolated migration replay.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('c1000000-0000-0000-0000-000000000001','audit-owner@example.invalid','{}','{}','authenticated','authenticated'),
 ('c1000000-0000-0000-0000-000000000002','audit-member@example.invalid','{}','{}','authenticated','authenticated');
UPDATE accounts SET id = 'c3000000-0000-0000-0000-000000000001', timezone = 'UTC',
 push_token = 'ExponentPushToken[synthetic]'
WHERE user_id = 'c1000000-0000-0000-0000-000000000001';
UPDATE accounts SET id = 'c3000000-0000-0000-0000-000000000002'
WHERE user_id = 'c1000000-0000-0000-0000-000000000002';
INSERT INTO entitlements(account_id,source,tier,expires_at) VALUES
 ('c3000000-0000-0000-0000-000000000001','scholarship','essential',now()+interval '30 days');
INSERT INTO family_spaces(id,name,created_by,invite_code) VALUES
 ('c2000000-0000-0000-0000-000000000001','Synthetic family','c3000000-0000-0000-0000-000000000001','C101-C102');
INSERT INTO family_members(family_space_id,account_id,role) VALUES
 ('c2000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001','owner'),
 ('c2000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000002','member');
INSERT INTO shared_walls(id,family_space_id,text,proposed_by) VALUES
 ('c4000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001','Synthetic wall','c3000000-0000-0000-0000-000000000001');
INSERT INTO wall_commitments(shared_wall_id,account_id) VALUES
 ('c4000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001');
INSERT INTO wavering_events(shared_wall_id,account_id,shared_with_family) VALUES
 ('c4000000-0000-0000-0000-000000000001','c3000000-0000-0000-0000-000000000001',true);
INSERT INTO wall_hold_logs(account_id,family_space_id,week_start,result,shared_with_family) VALUES
 ('c3000000-0000-0000-0000-000000000001','c2000000-0000-0000-0000-000000000001',current_date,'held',true);

SELECT ok(NOT has_table_privilege('authenticated','public.family_members','DELETE')
 AND NOT has_table_privilege('anon','public.family_members','DELETE'), 'client DELETE privileges revoked');
SELECT ok(has_table_privilege('service_role','public.family_members','DELETE'), 'trusted service deletion retained');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='family_members' AND cmd IN ('DELETE','ALL')), 'no direct DELETE policy survives the full chain');
SELECT ok(has_function_privilege('authenticated','public.leave_family_space()','EXECUTE')
 AND NOT has_function_privilege('anon','public.leave_family_space()','EXECUTE'), 'departure RPC remains authenticated only');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($$DELETE FROM family_members WHERE account_id=public.my_account_id()$$,
 '42501','permission denied for table family_members','raw self-delete cannot bypass succession/privacy');
SELECT lives_ok($$SELECT leave_family_space()$$,'owner departs through unchanged RPC');
SELECT is((SELECT count(*)::integer FROM family_spaces WHERE id='c2000000-0000-0000-0000-000000000001'),0,'departed creator loses family SELECT access');
RESET ROLE;
SELECT is((SELECT created_by FROM family_spaces WHERE id='c2000000-0000-0000-0000-000000000001'),
 'c3000000-0000-0000-0000-000000000002'::uuid,'creator ownership transferred');
SELECT is((SELECT role FROM family_members WHERE account_id='c3000000-0000-0000-0000-000000000002'),'owner','successor membership promoted');
SELECT is((SELECT count(*)::integer FROM wall_commitments WHERE account_id='c3000000-0000-0000-0000-000000000001'),0,'departing commitments removed');
SELECT ok((SELECT NOT shared_with_family FROM wavering_events WHERE account_id='c3000000-0000-0000-0000-000000000001'),'wavering event sharing withdrawn');
SELECT ok((SELECT NOT shared_with_family AND family_space_id IS NULL FROM wall_hold_logs WHERE account_id='c3000000-0000-0000-0000-000000000001'),'hold-log sharing withdrawn');
SET LOCAL ROLE service_role;
SELECT lives_ok($$DELETE FROM family_members WHERE account_id='c3000000-0000-0000-0000-000000000002'$$,'trusted cleanup may still delete directly');
RESET ROLE;

-- Actual setup/enqueue RPC exercises the additive expiry trigger.
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT save_loved_one_profile('{"safetyConcern":"none","soberTimes":["evening"]}'::jsonb,true)$$,'member completes a safe map');
SELECT lives_ok($$SELECT complete_invitation_setup(true)$$,'member opts in');
RESET ROLE;
SELECT ok(NOT has_function_privilege('authenticated','public.invitation_push_delivery_ttl(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.invitation_push_delivery_ttl(uuid,uuid)','EXECUTE')
 AND has_function_privilege('service_role','public.invitation_push_delivery_ttl(uuid,uuid)','EXECUTE'),'delivery gate is service-only');
SET LOCAL ROLE service_role;
SELECT ok(enqueue_invitation_window_push('c3000000-0000-0000-0000-000000000001',
 (now() AT TIME ZONE 'UTC')::date,72,ARRAY['calm'],'Synthetic','Synthetic',now()),'valid invitation enqueues');
RESET ROLE;
SELECT ok((SELECT expires_at = least(scheduled_for + interval '4 hours',
 (((scheduled_for AT TIME ZONE 'UTC')::date + 1)::timestamp AT TIME ZONE 'UTC'))
 AND metadata->>'local_date' = (now() AT TIME ZONE 'UTC')::date::text
 FROM push_outbox WHERE kind='invitation_window' AND account_id='c3000000-0000-0000-0000-000000000001'), 'enqueue persists absolute deadline and original local day');
UPDATE push_outbox SET id='c5000000-0000-0000-0000-000000000001',
 processing_token='c6000000-0000-0000-0000-000000000001',processing_at=now()
WHERE kind='invitation_window' AND account_id='c3000000-0000-0000-0000-000000000001';
CREATE FUNCTION pg_temp.delivery_ttl() RETURNS integer LANGUAGE sql AS $$
 SELECT public.invitation_push_delivery_ttl('c5000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001')
$$;
SELECT ok(pg_temp.delivery_ttl() BETWEEN 1 AND 14400,'current claimed invitation remains eligible despite enqueue cooldown');
SELECT ok(dispatcher_outbox_delivery('c5000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001') IS NOT NULL,'unified invitation boundary preserves valid delivery');
SELECT is(invitation_push_delivery_ttl('c5000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000002'),NULL,'stale lease cannot authorize delivery');
-- Construct historical malformed/expired rows as superuser fixtures. The new
-- immutable-write contract is exercised independently in dispatcher_delivery_contract_test.
ALTER TABLE push_outbox DISABLE TRIGGER zz_dispatcher_outbox_snapshot;
UPDATE push_outbox SET expires_at=now()-interval '1 second' WHERE id='c5000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery_ttl(),NULL,'expired backlog cannot deliver');
UPDATE push_outbox SET expires_at=now()+interval '15 minutes', metadata='{"kind":"invitation_window","local_date":"2000-01-01"}'
WHERE id='c5000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery_ttl(),NULL,'a new local day cannot reuse yesterday window');
UPDATE push_outbox SET metadata=jsonb_build_object('kind','invitation_window','local_date',(now() AT TIME ZONE 'UTC')::date)
WHERE id='c5000000-0000-0000-0000-000000000001';
ALTER TABLE push_outbox ENABLE TRIGGER zz_dispatcher_outbox_snapshot;
SELECT is(pg_temp.delivery_ttl(),900,'TTL is remaining lifetime, not fresh four hours');
UPDATE entitlements SET expires_at=now()-interval '1 day' WHERE account_id='c3000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery_ttl(),NULL,'revoked entitlement blocks queued invitation');
UPDATE entitlements SET expires_at=now()+interval '30 days' WHERE account_id='c3000000-0000-0000-0000-000000000001';
INSERT INTO invitation_attempts(account_id,outcome,local_date,next_window_date) VALUES
 ('c3000000-0000-0000-0000-000000000001','angry',(now() AT TIME ZONE 'UTC')::date,(now() AT TIME ZONE 'UTC')::date+3);
SELECT is(pg_temp.delivery_ttl(),NULL,'new resting outcome blocks queued invitation');
DELETE FROM invitation_attempts WHERE account_id='c3000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery_ttl(),900,'eligible control recovers after outcome removed');
SET LOCAL ROLE authenticated;
SELECT is(set_invitation_window_push(false),false,'member withdraws consent through RPC');
RESET ROLE;
SELECT ok((SELECT failed_at IS NOT NULL AND processing_token IS NULL AND last_error='invitation_withdrawn'
 FROM push_outbox WHERE id='c5000000-0000-0000-0000-000000000001'),'withdrawal cancels even a claimed queue row');
SET LOCAL ROLE authenticated;
SELECT is(set_invitation_window_push(true),true,'member may opt back in');
RESET ROLE;
SELECT is(pg_temp.delivery_ttl(),NULL,'re-opt-in never resurrects withdrawn work');
SELECT is(dispatcher_outbox_delivery('c5000000-0000-0000-0000-000000000001','c6000000-0000-0000-0000-000000000001'),NULL,'unified invitation boundary rejects withdrawn claim');
INSERT INTO push_outbox(id,account_id,kind,title,body,scheduled_for,processing_at,processing_token) VALUES
 ('c5000000-0000-0000-0000-000000000002','c3000000-0000-0000-0000-000000000001','invitation_window','Synthetic','Synthetic',now(),now(),'c6000000-0000-0000-0000-000000000002');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT save_loved_one_profile('{"safetyConcern":"serious"}'::jsonb,true)$$,'member reports serious safety after enqueue');
RESET ROLE;
SELECT ok((SELECT failed_at IS NOT NULL AND processing_token IS NULL AND last_error='invitation_withdrawn'
 FROM push_outbox WHERE id='c5000000-0000-0000-0000-000000000002'),'serious safety cancels queued invitation');
SELECT is(invitation_push_delivery_ttl('c5000000-0000-0000-0000-000000000002','c6000000-0000-0000-0000-000000000002'),NULL,'serious safety blocks the previously claimed delivery');
-- Check safety gate independently of cancellation by simulating a trusted
-- insertion after the safety update (no client can insert these queue rows).
INSERT INTO push_outbox(id,account_id,kind,title,body,scheduled_for,processing_at,processing_token) VALUES
 ('c5000000-0000-0000-0000-000000000003','c3000000-0000-0000-0000-000000000001','invitation_window','Synthetic','Synthetic',now(),now(),'c6000000-0000-0000-0000-000000000003');
UPDATE invitation_engine_state SET window_push_opt_in=true WHERE account_id='c3000000-0000-0000-0000-000000000001';
SELECT is(invitation_push_delivery_ttl('c5000000-0000-0000-0000-000000000003','c6000000-0000-0000-0000-000000000003'),NULL,'delivery snapshot independently rechecks serious safety');
SELECT * FROM finish();
ROLLBACK;
