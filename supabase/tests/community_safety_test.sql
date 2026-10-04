BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- ── Crisis screen ────────────────────────────────────────────────────────────
SELECT is(public._community_post_crisis(x), 'block', 'blocked: ' || x) FROM unnest(ARRAY[
  'My son overdosed and he is not breathing',
  'Mi hijo tuvo una sobredosis y no respira',
  'I don''t want to live anymore',
  'I don’t want to live anymore',
  'I want to die',
  'I''m going to kill myself',
  'I feel suicidal',
  'I keep thinking about suicide',
  'He is overdosing right now',
  'She''s not breathing',
  'He''s unresponsive and his lips are blue',
  'I just took all my pills',
  'Me quiero morir',
  'Quiero morirme',
  'No quiero vivir más',
  'Me tomé todas mis pastillas',
  'Tengo pensamientos suicidas',
  'Estoy pensando en suicidarme',
  'Mi hija dejó de respirar',
  'Está teniendo una sobredosis',
  -- Round 2: emergencies that used to post with nothing.
  'I''m going to take all my pills tonight',
  'Tonight I''m going to take all my pills',
  'I''m going to end it tonight',
  'I have a plan to end things tonight',
  'I can''t wake him up',
  'My daughter is passed out and I can''t wake her',
  'My daughter took a bunch of pills and won''t wake up',
  'My husband just swallowed a whole bottle of pills',
  'I''ve taken all my pills',
  'I just took 30 pills',
  'He stopped breathing, what do I do',
  'He''s overdosing',
  'No puedo despertarlo',
  'Mi hijo no despierta y creo que tomó algo',
  'Mi hijo tomó todas sus pastillas',
  -- Round 3: phone-style typing (no apostrophes, emoji, trailing words).
  'hes not breathing',
  'MY SON ISNT BREATHING!!! 😭😭',
  'hes overdosing',
  'i dont want to live anymore 😭',
  'i dont wanna live anymore',
  'i dont want to live anymore please help',
  'im having suicidal thoughts',
  'i want to commit suicide',
  'im going to commit suicide tonight',
  'i am considering suicide',
  'my son is not responding',
  'hes not responding to anything',
  'my son just overdosed',
  'my son just hung himself',
  'i found my son hanging in the garage',
  'my daughter cut her wrists and theres blood everywhere',
  'i have a gun to my head',
  'i took like 20 pills',
  'my son took like 20 xanax',
  'everyone would be better off if i was gone',
  'theres no reason for me to live',
  'i want to go to sleep and never wake up',
  'mi hijo no responde',
  'me quiero quitar la vida',
  'todos estarian mejor sin mi',
  'no quiero vivir mas 😭',
  'ya no aguanto mas quiero morir',
  'My husband told me he is going to kill himself tonight',
  'My son said tonight he wants to die and he has a gun',
  'He''s unconscious and barely breathing',
  'he''s not responsive',
  'he is passed out and won''t respond',
  'my son is dying please help',
  'Mi hijo se está muriendo',
  'I''m done. I''m ending it tonight.',
  'Tonight I end it',
  'Voy a terminar con todo esta noche',
  'I have pills saved up and I''m ready',
  'mi hija se cortó y está sangrando mucho',
  'Mi hijo tomó muchas pastillas',
  'my husband is beating me right now',
  'he has a knife and is threatening us',
  'my son is trying to kill himself right now',
  'my daughter just tried to kill herself',
  'my son is od-ing right now',
  -- Round 4.
  'i''m holding a gun to my head',
  'ive got a knife to my throat',
  'i''ve been saving my pills',
  'i took 30 sleeping pills an hour ago',
  'my son took a bottle of pills 10 minutes ago',
  'he stopped breathing a minute ago im doing cpr',
  'mi hijo se tomo un frasco de pastillas hace 10 minutos',
  'my son was 6 months clean and now he wont wake up',
  'my son swallowed a bottle of pills this morning',
  'its 3am and i cant wake him up',
  'HELP my daughter not breathing',
  'i just slit my wrists',
  'my son took the whole bottle of tylenol',
  'i cant wake up my son',
  'my son just ODed',
  'my son is having an overdose',
  'mi hijo tiene una sobredosis',
  'my son is on the roof threatening to jump',
  'my son has a gun to his head right now',
  'i''m going to drive my car off the bridge',
  'id be better off dead',
  'my husband is threatening to kill me',
  'he''s pointing a gun at me',
  'mi esposo me esta golpeando',
  'my son is having a seizure',
  'he''s choking on his own vomit',
  'my son cant breathe',
  'mi hijo esta convulsionando',
  'i''m tired of living',
  'he took 8 xanax bars',
  'i found my son unresponsive, waiting for the paramedics',
  'me corté las venas',
  -- Round 5.
  'he''s threatening to kill me',
  'my husband''s threatening to kill us',
  'i have a gun and i''m going to end it',
  'got my dads gun. im going to end it',
  'wanna die',
  'so done. wanna die',
  'want to end it all',
  'no reason to live anymore',
  'dont want to live anymore',
  'gonna take all my pills tonight',
  'i''m done. ending it tonight',
  'ill end it tonight',
  'i''m done living',
  'i''m on the roof and i''m going to jump',
  'standing on the bridge rn',
  'me voy a tirar del puente',
  'tengo ganas de morirme',
  'no quiero vivir anymore',
  'i just took a bottle of pills',
  'just took all my klonopin',
  'acabo de tomar un frasco de pastillas',
  'he said hes gonna kill me',
  'mi esposo dice que me va a matar',
  'he has his hands around my neck',
  'he just punched me in the face',
  'he''s chasing me with a bat',
  'he''s trying to break in right now',
  'he has no pulse',
  'he''s foaming at the mouth',
  'my daughter is cutting rn and wont open the door',
  'mi hija se esta cortando ahorita',
  'pls help hes not breathin',
  'im sucidal',
  'i want to kms',
  'i dont want to' || chr(10) || 'live anymore',
  'gun in my lap rn. cant do this',
  'he grabbed a knife and is coming at me',
  -- Round 6.
  'i took a lot of pills',
  'i took all my husbands xanax',
  'i dont want to exist anymore',
  'i want 2 die tonight',
  'ima end it tonight',
  'im going to blow my brains out',
  'gonna put a bullet in my head tonight',
  'im gonna jump in front of a train',
  'i just drank bleach',
  'he stabbed me',
  'help hes going to shoot me',
  'hes beating me up right now',
  'my son is threatening to kill my husband right now',
  'i''m holding a gun to my head',
  'im overdosing rn',
  'i think im oding',
  'my son aint breathing',
  'mi hijo no se mueve',
  'me voy a colgar',
  'me tome toda la caja de pastillas',
  'mi esposo me quiere matar',
  'i wrote my suicide note',
  'my son just pulled a knife on me',
  'got the rope. i''m going to do it tonight',
  'i want to die. i survived an overdose last year and i want to die now',
  'my son overdosed and hes not breathing, he was 2 years sober',
  -- Round 7.
  'my kids are better off without me',
  'i''m better off dead',
  'life isn''t worth living anymore',
  'i have nothing to live for',
  'no tengo razón para vivir',
  'ya no quiero despertar',
  'no puedo despertar a mi hijo',
  'he is beating me up',
  'mi esposo me esta choking',
  'the gun is in my lap',
  'doing cpr on my son now',
  'le dieron narcan y sigue sin respirar',
  'me estoy desangrando',
  'mi hijo me está atacando con un cuchillo',
  'hes pounding on the door and screaming hes going to hurt me'
]) x;

SELECT is(public._community_post_crisis(x), 'resources', 'posts with resources: ' || x) FROM unnest(ARRAY[
  'My daughter attempted suicide last year…',
  'He keeps talking about suicide when he drinks',
  'My son OD''d twice last year and I still jump at every phone call',
  'He says he wants to die when he''s drunk',
  'Mi hijo tuvo una sobredosis el año pasado',
  'Mi hijo habla de suicidio cuando bebe',
  'He threatened to kill himself if I called the police',
  'I found him unresponsive. The paramedics gave him Narcan and he is in the hospital now.',
  'My son stopped breathing last night. Narcan brought him back.',
  -- Round 2: recovery stories that used to be refused.
  'Two years ago my son stopped breathing and I gave him Narcan. He is 18 months sober now.',
  'Narcan saved my daughter''s life last year when she stopped breathing',
  'He was unresponsive for 10 minutes before EMS got there. He survived.',
  'I found him unresponsive on the bathroom floor last spring and called 911',
  'The night he OD''d he was turning blue… He is in recovery now.',
  'Hace dos años mi hijo dejó de respirar, hoy está sobrio',
  'the night i found him unresponsive changed everything for me',
  'when my son stopped breathing i learned how to use narcan',
  'i want to die of embarrassment',
  -- Not refused, but a human glance: denials and jokes about it.
  'i''m not going to hurt myself, i just need to vent',
  'I want to kill myself for forgetting my keys lol',
  'my son is choking on his vomit in my dreams every night'
]) x;

SELECT is(public._community_post_crisis(x), NULL, 'posts plainly: ' || x) FROM unnest(ARRAY[
  'Today was a good day — he went to his first meeting',
  'I''m killing myself working two jobs to pay his rent',
  'I am cutting myself off from his drama',
  'No me quiero morir sin verlo sano',
  'He sleeps all day and won''t wake up for school',
  'I feel like I can''t breathe when he yells',
  -- Round 2: everyday sentences that used to be refused.
  'Some days I feel like I am barely breathing',
  'I don''t want to live in fear anymore',
  'I don''t want to live with an addict anymore',
  'I don''t want to wake up to another night of this',
  'No quiero vivir con miedo',
  'I''m going to end things with my husband tonight',
  'I can''t wake him up in the mornings for work',
  'Hoy tomé todas mis pastillas',
  'Mi hijo no reacciona a mis mensajes',
  -- Round 3.
  'my 17 yo wont wake up until 1pm',
  'he sleeps all day and wont wake up till dinner',
  'my husband wont wake up and see what hes doing to us',
  'he just wont wake up to reality',
  'my husband is not waking up to the damage hes doing',
  'he took all his pills today like hes supposed to',
  'my husband took all his medication like the doctor said',
  'i''m killing myself here',
  'hes killing himself with drugs and i cant stop it',
  'he isnt responding to my texts',
  'mi hijo no me responde los mensajes',
  'me quiero morir de la vergüenza',
  'quiero morirme de la verguenza',
  'mi hijo no se despierta hasta el mediodia',
  'i don''t want to live like this anymore',
  'he won''t respond to my texts',
  'my son is dying to go back to college',
  'he''s beating me at chess again lol',
  'he keeps hitting me up for money',
  'mi hijo se esta muriendo de risa',
  'I''m ending things with him tonight',
  -- Round 4.
  'i dont want to wake up and find my son dead',
  'I''m learning to cut myself some slack',
  'my son cut himself shaving',
  'he won''t respond when i talk to him',
  'he''s not responding to treatment',
  'my husband is emotionally unresponsive',
  'my son is unresponsive to every consequence we try',
  'my mom is dying, i''m her caregiver and my son is using again',
  'mi papa se esta muriendo de cancer y mi hijo sigue tomando',
  'my son won''t wake up, he stays up gaming all night',
  'i took a bunch of advil for my headache',
  'my husband stops breathing at night, sleep apnea',
  'i dont want to be here anymore, this group is toxic',
  'mi mamá se está muriendo',
  'my husband sleeps through everything, i literally can''t wake him',
  'this is so odd',
  -- Round 5.
  'he keeps hitting me up all day',
  'he keeps hitting me with guilt trips',
  'my husband is attacking me verbally every night',
  'i just want to sleep and not wake up until this is over',
  'my dad is in the hospital, he''s not breathing on his own',
  'my mom isnt breathing well, copd',
  'my husband can''t breathe at night without his cpap',
  'my kid is blue about his dad leaving',
  'my daughter is seizing every opportunity to lie',
  'i am ending it all tonight with him, the lies, the money, everything',
  'my son is overdosing on video games lol',
  'i''m going to od on chocolate tonight',
  'my son is not breathing a word to us about rehab',
  'he''s barely breathing financially lol',
  'he''s beating me to the punch',
  'i took a bunch of advil this morning',
  'i took all my pills this morning',
  -- Round 6.
  'it just hit me that he''s really gone',
  'im at the end of my rope with him. im done.',
  'i''m finally taking my life back',
  'his drinking has really hurt my self-esteem',
  'ran 10 kms this morning',
  'sitting on the balcony with my coffee praying for my son',
  'he''d be better off without me rescuing him every time',
  'my ex is attacking me in the family group chat',
  'took all my meds and went to bed early',
  'im going to take all the pills in the house to the drop box at cvs',
  'i''m on the roof hanging christmas lights lol',
  'this job''s going to kill me',
  'gonna jump for joy, he got his 30 day chip!!',
  'el cielo esta azul',
  'this disease is taking my life',
  'i want to die my hair purple for my birthday',
  'im on the bridge driving home and he keeps calling',
  -- Round 7.
  'it''s hurting me to watch him destroy himself',
  'his lies are hurting me',
  'it''s choking me up just writing this',
  'my phone is dead',
  'im so scared hes dead somewhere',
  'every time the phone rings i think hes dead',
  'im dying lmao',
  'i texted him 10 times and he won''t respond'
]) x;

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
  ('a5000000-0000-0000-0000-000000000001','community-a@example.invalid','{}','{"first_name":"Ana"}','authenticated','authenticated'),
  ('a5000000-0000-0000-0000-000000000002','community-b@example.invalid','{}','{"first_name":"Bea"}','authenticated','authenticated'),
  ('a5000000-0000-0000-0000-000000000003','community-c@example.invalid','{}','{"first_name":"Cris"}','authenticated','authenticated');
CREATE FUNCTION pg_temp.aid(n integer) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.accounts WHERE user_id=('a5000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid
$$;
INSERT INTO community_posts(id, account_id, author_display, body) VALUES
  ('a5100000-0000-0000-0000-000000000001', pg_temp.aid(2), 'Bea', 'post one by Bea'),
  ('a5100000-0000-0000-0000-000000000002', pg_temp.aid(2), 'Bea', 'post two by Bea'),
  ('a5100000-0000-0000-0000-000000000003', pg_temp.aid(3), 'Cris', 'post by Cris');

SELECT ok(has_table_privilege('authenticated','public.member_blocks','SELECT')
  AND NOT has_table_privilege('authenticated','public.member_blocks','INSERT')
  AND NOT has_table_privilege('authenticated','public.member_blocks','DELETE')
  AND NOT has_table_privilege('anon','public.member_blocks','SELECT'),
  'blocks are written only through the RPCs');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.member_blocks'::regclass), 'member_blocks has RLS');
SELECT ok(NOT has_function_privilege('anon','public.block_community_author(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.community_post_hidden_for_me(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._community_post_crisis(text)','EXECUTE'),
  'anon cannot block; the screen is internal');

-- ── Member A ─────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a5000000-0000-0000-0000-000000000001","email":"community-a@example.invalid","role":"authenticated"}',true);

SELECT is((SELECT count(*)::integer FROM community_posts WHERE id::text LIKE 'a5100000-%'), 3, 'member sees every visible post');
SELECT lives_ok($$SELECT report_community_post('a5100000-0000-0000-0000-000000000003','spam')$$, 'member reports a post');
SELECT is((SELECT count(*)::integer FROM community_posts WHERE id='a5100000-0000-0000-0000-000000000003'), 0, 'a reported post stays out of her feed after reload');

SELECT throws_ok($$SELECT block_community_author('a5100000-0000-0000-0000-000000000099')$$, 'P0002', 'post_not_found', 'cannot block an unknown post');
SELECT lives_ok($$SELECT block_community_author('a5100000-0000-0000-0000-000000000001')$$, 'member blocks an author');
SELECT lives_ok($$SELECT block_community_author('a5100000-0000-0000-0000-000000000002')$$, 'blocking again is harmless');
SELECT is((SELECT count(*)::integer FROM community_posts WHERE id IN ('a5100000-0000-0000-0000-000000000001','a5100000-0000-0000-0000-000000000002')), 0, 'every post by a blocked person is hidden');
SELECT is((SELECT count(*)::integer FROM member_blocks), 1, 'one block row, visible to its owner');
SELECT is((SELECT display_name FROM my_community_blocks()), 'Bea', 'block list shows the feed name');

CREATE TEMP TABLE my_post AS SELECT * FROM create_community_post('My son OD''d last year. Today he is 90 days clean.');
SELECT ok((SELECT safety_resources FROM my_post), 'a past overdose mention posts with resources for the author');
CREATE TEMP TABLE plain_post AS SELECT * FROM create_community_post('Small win: I held my boundary today.');
SELECT ok((SELECT NOT safety_resources FROM plain_post), 'an ordinary post carries no resource note');
SELECT throws_ok($$SELECT create_community_post('I don''t want to live anymore', false)$$, 'P0001', 'crisis_content', 'first-person current danger is refused');
SELECT throws_ok($$SELECT create_community_post('He stopped breathing and I gave him Narcan', false)$$, 'P0001', 'crisis_content', 'an undated emergency is refused');
CREATE TEMP TABLE past_post AS SELECT * FROM create_community_post('He stopped breathing and I gave him Narcan', true);
SELECT ok((SELECT safety_resources FROM past_post), 'when she says it is about the past, it posts with the 988/911 note');
-- App 4.0 (2) sends only p_body and never shows the note after posting: it
-- keeps its old screen (any mention of suicide is refused) plus the new one.
SELECT throws_ok($$SELECT create_community_post('My daughter is suicidal and I don''t know what to do')$$, 'P0001', 'crisis_content', '4.0 (2): a suicide mention is still refused (its only route to 988/911)');
SELECT throws_ok($$SELECT create_community_post('hes suicidal and i dont know what to do')$$, 'P0001', 'crisis_content', '4.0 (2): what its old screen refused is still refused');
CREATE TEMP TABLE legacy_firm AS SELECT * FROM create_community_post('hes not breathing');
SELECT ok((SELECT safety_resources FROM legacy_firm), '4.0 (2): refuses nothing new; an emergency it used to post plainly now posts with the admin check-in');
-- 4.0 (2) has no "post it anyway": words a story also uses post, with the
-- admin check-in, instead of being refused; 4.1 refuses them with that option.
CREATE TEMP TABLE legacy_told AS SELECT * FROM create_community_post('my son won''t wake up and i''m scared');
SELECT ok((SELECT safety_resources FROM legacy_told), '4.0 (2): an ambiguous emergency posts with resources');
SELECT throws_ok($$SELECT create_community_post('my son won''t wake up and i''m scared', false)$$, 'P0001', 'crisis_content', '4.1: the same post is refused with the post-it-anyway option');
CREATE TEMP TABLE new_app_post AS SELECT * FROM create_community_post('My daughter is suicidal and I don''t know what to do', false);
SELECT ok((SELECT safety_resources FROM new_app_post), '4.1: the same post goes up with the 988/911 note shown to her');
SELECT ok(NOT has_function_privilege('anon','public.create_community_post(text,boolean)','EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='create_community_post' AND pronargs=1),
  'one create_community_post (4.0 (2) calls it with p_body only); anon cannot post');
SELECT throws_ok($$SELECT block_community_author((SELECT id FROM my_post))$$, '22023', 'cannot_block_self', 'cannot block yourself');

-- ── Member B cannot see or undo A's blocks ───────────────────────────────────
SELECT set_config('request.jwt.claims','{"sub":"a5000000-0000-0000-0000-000000000002","email":"community-b@example.invalid","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM member_blocks), 0, 'other members cannot read the block list');
SELECT is((SELECT count(*)::integer FROM my_community_blocks()), 0, 'other members have their own (empty) list');
SELECT is(unblock_community_author((SELECT id FROM member_blocks LIMIT 1)), false, 'nothing to unblock for someone else');
SELECT is((SELECT count(*)::integer FROM community_posts WHERE id='a5100000-0000-0000-0000-000000000003'), 1, 'a report only hides the post for the reporter');

-- ── Admin restores the reported post; the reporter keeps it hidden ───────────
RESET ROLE;
UPDATE auth.users SET email='matt@soberhelpline.com' WHERE id='a5000000-0000-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a5000000-0000-0000-0000-000000000003","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT moderate_community_post('a5100000-0000-0000-0000-000000000003','visible')$$, 'admin restores the post');
SELECT is((SELECT report_count FROM community_posts WHERE id='a5100000-0000-0000-0000-000000000003'), 0, 'restore resets the count');
SELECT is((SELECT count(*)::integer FROM admin_get_reported_community_posts() WHERE post_id='a5100000-0000-0000-0000-000000000003'), 0, 'cleared reports leave the review queue');

SELECT set_config('request.jwt.claims','{"sub":"a5000000-0000-0000-0000-000000000001","email":"community-a@example.invalid","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM community_posts WHERE id='a5100000-0000-0000-0000-000000000003'), 0, 'the reporter still never sees it');
SELECT ok(unblock_community_author((SELECT block_id FROM my_community_blocks())), 'member unblocks');
SELECT is((SELECT count(*)::integer FROM community_posts WHERE id IN ('a5100000-0000-0000-0000-000000000001','a5100000-0000-0000-0000-000000000002')), 2, 'unblocked author''s posts return');

-- ── A post that mentions a crisis alerts the admin ───────────────────────────
RESET ROLE;
UPDATE accounts SET push_token = 'ExponentPushToken[community-admin]' WHERE id = pg_temp.aid(3);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a5000000-0000-0000-0000-000000000001","email":"community-a@example.invalid","role":"authenticated"}',true);
CREATE TEMP TABLE crisis_post AS SELECT * FROM create_community_post('My son tried to kill himself last year and I still can''t sleep', false);
CREATE TEMP TABLE calm_post AS SELECT * FROM create_community_post('We had a good family dinner tonight.', false);
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE kind = 'admin_community_report'
             AND metadata->>'post_id' = (SELECT id::text FROM crisis_post) AND metadata->>'reason' = 'crisis'
             AND account_id = pg_temp.aid(3)), 1, 'the admin is asked to check on the author of a crisis-mention post');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE metadata->>'post_id' = (SELECT id::text FROM calm_post)), 0,
  'an ordinary post sends no admin push');

SELECT * FROM finish();
ROLLBACK;
