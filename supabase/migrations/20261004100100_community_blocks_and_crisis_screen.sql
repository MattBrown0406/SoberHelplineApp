-- Community safety (App Store guideline 1.2) and a fairer crisis screen.
--
-- 1. A post a member reported stays out of HER feed (it used to come back on
--    the next load). Restoring a post after review now clears its reports
--    instead of deleting them, so the reporter keeps it hidden.
-- 2. Members can block a person: member_blocks (owner-only), block/unblock/list
--    RPCs. Blocked authors' posts never reach the blocker's feed.
--    Both are enforced in the community_posts read policy, so every app
--    version gets them.
-- 3. The post crisis screen blocked any mention of suicide or overdose ("My
--    daughter attempted suicide last year…", "He keeps talking about suicide
--    when he drinks") yet let "My son overdosed and he is not breathing" and
--    "I don't want to live anymore" through. Now only first-person current
--    danger and emergencies happening now (EN+ES) are refused (the app routes
--    the author to 988/911); third-person or dated past mentions post, and the
--    author is shown 988/911 resources (community_posts.safety_resources). If
--    a refused post is about the past, she can say so and post it with the
--    resources (create_community_post p_past). Every post that carries the
--    resources note also sends an admin push so someone checks on the author.
-- Re-runnable.

-- ── 1. Reports outlive a restore ─────────────────────────────────────────────
ALTER TABLE public.community_reports ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
-- A post that mentions a crisis stays on the admin card until reviewed (§3).
ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS safety_resources boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crisis_reviewed_at timestamptz;

CREATE OR REPLACE FUNCTION public.report_community_post(p_post_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
  v_count   int;
  v_new     int;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;

  -- A report on a post restored after review counts again as a new report.
  INSERT INTO community_reports (post_id, reporter_account_id, reason)
  VALUES (p_post_id, v_account, nullif(btrim(p_reason), ''))
  ON CONFLICT (post_id, reporter_account_id) DO UPDATE
    SET cleared_at = NULL, reason = EXCLUDED.reason, created_at = now()
    WHERE community_reports.cleared_at IS NOT NULL;
  GET DIAGNOSTICS v_new = ROW_COUNT;

  -- Every new report reaches an admin; the 3-report hold is only a backstop.
  IF v_new > 0 THEN
    INSERT INTO push_outbox (account_id, kind, title, body, metadata)
    SELECT a.id, 'admin_community_report', '🚩 Community post reported',
           'A member reported a community post. Please review it.',
           jsonb_build_object('kind', 'admin_community_report', 'post_id', p_post_id)
    FROM accounts a
    JOIN auth.users u ON u.id = a.user_id
    WHERE lower(coalesce(u.email, '')) = ANY (admin_email_list())
      AND a.push_token IS NOT NULL;
  END IF;

  UPDATE community_posts
  SET report_count = (SELECT count(*) FROM community_reports
                      WHERE post_id = p_post_id AND cleared_at IS NULL)
  WHERE id = p_post_id
  RETURNING report_count INTO v_count;

  -- Hold the post pending admin review once enough members flag it.
  IF v_count >= 3 THEN
    UPDATE community_posts SET status = 'held'
    WHERE id = p_post_id AND status = 'visible';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_community_post(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_community_post(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.moderate_community_post(p_post_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin_jwt() OR public.is_video_owner()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_status NOT IN ('visible', 'held', 'removed') THEN
    RAISE EXCEPTION 'bad_status';
  END IF;
  UPDATE public.community_posts SET status = p_status WHERE id = p_post_id;
  -- Keeping or removing a post is the admin's review of it.
  IF p_status IN ('visible', 'removed') THEN
    UPDATE public.community_posts SET crisis_reviewed_at = coalesce(crisis_reviewed_at, now())
    WHERE id = p_post_id;
  END IF;
  IF p_status = 'visible' THEN
    -- Cleared, not deleted: the next report re-holds nothing, but each
    -- reporter keeps the post out of her own feed.
    UPDATE public.community_reports SET cleared_at = now()
    WHERE post_id = p_post_id AND cleared_at IS NULL;
    UPDATE public.community_posts SET report_count = 0 WHERE id = p_post_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.moderate_community_post(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_community_post(uuid, text) TO authenticated;

-- The admin card: reported or held posts, and (newest first) posts that
-- mentioned a crisis and haven't been reviewed, with who wrote them so the
-- admin can reach out. New columns are additive (older app versions ignore them).
DROP FUNCTION IF EXISTS public.admin_get_reported_community_posts();
CREATE FUNCTION public.admin_get_reported_community_posts()
RETURNS TABLE (
  post_id uuid,
  body text,
  status text,
  report_count integer,
  reasons text[],
  author_name text,
  created_at timestamptz,
  crisis boolean,
  author_account_id uuid,
  author_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY
  SELECT p.id, p.body, p.status, p.report_count,
         coalesce((SELECT array_agg(r.reason ORDER BY r.created_at DESC) FILTER (WHERE r.reason IS NOT NULL)
                   FROM public.community_reports r WHERE r.post_id = p.id AND r.cleared_at IS NULL), '{}'),
         nullif(btrim(concat_ws(' ', a.first_name, a.last_name)), ''),
         p.created_at,
         (p.safety_resources AND p.crisis_reviewed_at IS NULL),
         p.account_id,
         u.email::text
  FROM public.community_posts p
  LEFT JOIN public.accounts a ON a.id = p.account_id
  LEFT JOIN auth.users u ON u.id = a.user_id
  WHERE p.status = 'held'
     OR (p.status = 'visible' AND p.report_count > 0)
     OR (p.status <> 'removed' AND p.safety_resources AND p.crisis_reviewed_at IS NULL
         AND p.created_at > now() - interval '14 days')
  ORDER BY (p.safety_resources AND p.crisis_reviewed_at IS NULL) DESC,
           (p.status = 'held') DESC, p.report_count DESC, p.created_at DESC
  LIMIT 100;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_reported_community_posts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_reported_community_posts() TO authenticated;

-- ── 2. Blocking a person ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.member_blocks (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_account_id uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  blocked_account_id uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_blocks_unique UNIQUE (blocker_account_id, blocked_account_id),
  CONSTRAINT member_blocks_not_self CHECK (blocker_account_id <> blocked_account_id)
);
CREATE INDEX IF NOT EXISTS member_blocks_blocked_idx ON public.member_blocks (blocked_account_id);

ALTER TABLE public.member_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_blocks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.member_blocks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_blocks TO service_role;

DROP POLICY IF EXISTS "member_blocks: owner select" ON public.member_blocks;
CREATE POLICY "member_blocks: owner select" ON public.member_blocks
  FOR SELECT TO authenticated
  USING (blocker_account_id = public.my_account_id());

-- Block the author of a post the member can see. Idempotent.
CREATE OR REPLACE FUNCTION public.block_community_author(p_post_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
  v_author  uuid;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;
  SELECT p.account_id INTO v_author
  FROM community_posts p
  WHERE p.id = p_post_id AND (p.status = 'visible' OR p.account_id = v_account);
  IF v_author IS NULL THEN RAISE EXCEPTION 'post_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_author = v_account THEN RAISE EXCEPTION 'cannot_block_self' USING ERRCODE = '22023'; END IF;

  INSERT INTO member_blocks (blocker_account_id, blocked_account_id)
  VALUES (v_account, v_author)
  ON CONFLICT (blocker_account_id, blocked_account_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.block_community_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.block_community_author(uuid) TO authenticated;

-- The member's blocks, newest first, with the name the feed showed (never an
-- account id or contact detail).
CREATE OR REPLACE FUNCTION public.my_community_blocks()
RETURNS TABLE (block_id uuid, display_name text, blocked_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id,
         coalesce((SELECT p.author_display FROM community_posts p
                   WHERE p.account_id = b.blocked_account_id
                   ORDER BY p.created_at DESC LIMIT 1), 'A family member'),
         b.created_at
  FROM member_blocks b
  WHERE b.blocker_account_id = my_account_id()
  ORDER BY b.created_at DESC
  LIMIT 200
$$;

REVOKE ALL ON FUNCTION public.my_community_blocks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_community_blocks() TO authenticated;

CREATE OR REPLACE FUNCTION public.unblock_community_author(p_block_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;
  DELETE FROM member_blocks WHERE id = p_block_id AND blocker_account_id = v_account;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.unblock_community_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unblock_community_author(uuid) TO authenticated;

-- RLS helper: true when the signed-in member reported this post or blocked
-- its author. Reads tables members cannot read directly.
CREATE OR REPLACE FUNCTION public.community_post_hidden_for_me(p_post_id uuid, p_author uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM community_reports r
                 WHERE r.post_id = p_post_id AND r.reporter_account_id = my_account_id())
      OR EXISTS (SELECT 1 FROM member_blocks b
                 WHERE b.blocker_account_id = my_account_id() AND b.blocked_account_id = p_author)
$$;

REVOKE ALL ON FUNCTION public.community_post_hidden_for_me(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_post_hidden_for_me(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "community_posts: read" ON public.community_posts;
CREATE POLICY "community_posts: read" ON public.community_posts
  FOR SELECT
  USING (
    (status = 'visible' AND NOT public.community_post_hidden_for_me(id, account_id))
    OR account_id = public.my_account_id()
    OR public.is_admin_jwt()
  );

-- ── 3. Crisis screen ─────────────────────────────────────────────────────────
-- (community_posts.safety_resources and crisis_reviewed_at are added in §1.)

-- Lower-cased; accents and curly quotes folded; emoji and other symbols become
-- sentence breaks and (by default) line breaks clause breaks, so "…anymore 😭
-- he relapsed" still ends the thought; phone-style contractions and common
-- typos restored ("im", "imma", "hes", "dont", "id be", "ill end", "ODed",
-- "breathin", "myslef", "sucidal", "kms" (not "10 kms"), "want 2 die");
-- "my self" joined (not "my self-esteem"); a sentence that starts
-- without its subject gets it back ("wanna die" → "i wanna die", "gonna take
-- all my pills" → "i'm gonna take…"); whitespace collapsed.
DROP FUNCTION IF EXISTS public._community_screen_text(text);
CREATE OR REPLACE FUNCTION public._community_screen_text(p_body text, p_line_breaks boolean DEFAULT true)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(regexp_replace(regexp_replace(regexp_replace(
            translate(lower(coalesce(p_body, '')), 'áàäâéèëêíìïîóòöôúùüûñ’‘`´', 'aaaaeeeeiiiioooouuuun'''''''''),
            '💊+', ' pills ', 'g'), '🔫+', ' gun ', 'g'), '🔪+', ' knife ', 'g'), '🩸+', ' blood ', 'g'),
          '[\r\n]+', CASE WHEN p_line_breaks THEN ' , ' ELSE ' ' END, 'g'),
        '[^a-z0-9[:space:].,!?;:''-]+', ' . ', 'g'),
      '\mimm?a\M', 'i''m gonna', 'g'),
      '\main''?t\M', 'isn''t', 'g'),
      '\m(want to|wanna) morir\M', '\1 die', 'g'),
      '\mim\M', 'i''m', 'g'),
      '\mive\M', 'i''ve', 'g'),
      '\mid (be|rather|better|sooner)\M', 'i''d \1', 'g'),
      '\mill (end|kill|jump|take|be|never|just)\M', 'i''ll \1', 'g'),
      '\m(he|she|there)s\M', '\1''s', 'g'),
      '\mhed\M', 'he''d', 'g'),
      '\m(don|won|can|isn|aren|wasn|didn|doesn|couldn|wouldn|haven|hasn)t\M', '\1''t', 'g'),
      '\m(you|they)re\M', '\1''re', 'g'),
      '\mo\.?d\.?(-|'')?ed\M|\mo\.?d\.?''d\M', 'od''d', 'g'),
      '\mmy self\M(?![- ]?(esteem|worth|respect|confidence|care|image|love|doubt|harm|help|control|awareness)\M)|\mmyslef\M|\mmyselfe\M', 'myself', 'g'),
      '\m(breathin|breating|breathng|brething|breahting)\M', 'breathing', 'g'),
      '\m(sucidal|suicidial|suicdal|sucidial|suisidal)\M', 'suicidal', 'g'),
      '(?<![0-9] )(?<![0-9])\mkms\M|\munalive myself\M', 'kill myself', 'g'),
      '\m(want|wanna|going|gonna|need|have|try|trying) 2\M', '\1 to', 'g'),
      '(^|[.!?,;] )(gonna|going to|about to|ready to|so tired|tired of|so done|done|thinking|feeling|ending|planning|scared)\M', '\1i''m \2', 'g'),
      '(^|[.!?,;] )(want|wanna|don''t|do not|just|took|swallowed|feel|have|can''t|wish|need|kinda|lowkey|honestly|really|literally|so)\M', '\1i \2', 'g')
  , '\s+', ' ', 'g'))
$$;

-- The screen, in detail (on one normalised text):
-- 'firm' — current danger in so many words: she says she will / is about to
--          end her life or just took an overdose, or someone is not breathing /
--          has no pulse / is overdosing / is being attacked right now. Refused
--          on every app version (the app shows 988/911 and her coach).
-- 'told' — emergencies in words a recovery story or a chronic illness also
--          uses ("he stopped breathing", "I can't wake him", "she's having
--          seizures", "he's unresponsive", "my son is dying"), with nothing
--          dating them ("two years ago", "18 months sober", "the night I found
--          him…", "hace dos años"). App 4.1 refuses it but offers "This isn't
--          happening right now — post it"; app 4.0 (2), which has no such
--          option, posts it with resources.
-- 'resources' — the same forms dated, or any other mention of suicide, an
--          overdose, self-harm, a weapon, violence or an emergency: posted,
--          the author is shown 988/911 and an admin is asked to check on her.
-- NULL — nothing to screen.
CREATE OR REPLACE FUNCTION public._community_post_screen_core(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  -- End of the thought: "I don't want to live anymore." / "…anymore please
  -- help" — not "I don't want to live in fear / like this / with an addict".
  clause_end constant text := '(?=\s*$|\s*[.!?,;:-]|\s+(and|but|so|because|or|please|pls|plz|help|rn|tbh|honestly|anymore|any more|i|i''m|y|pero|porque|ya|de verdad|en serio|por favor|ayuda)\M)';
  drugs constant text := '(pills|meds|medication|medications|tablets|capsules|sleeping pills|pain pills|painkillers|pain killers|antidepressants|tylenol|advil|ibuprofen|aspirin|xanax|xannies|bars|ambien|oxy|oxys|oxycodone|oxycontin|percocet|percocets|percs|vicodin|valium|klonopin|insulin|benadryl|fentanyl|heroin|opioids|opiates|adderall|ativan|lorazepam|seroquel|trazodone|morphine|tramadol|suboxone|subs|subutex|methadone|gabapentin|norco|dilaudid|hydrocodone|codeine|benzos|pastillas)';
  -- An amount no daily routine explains.
  big_amount constant text := '((like|about|around|maybe|over|almost|at least|nearly) )?((a|the|his|her|their|my) )?((whole|entire) )?(bottle of|bottles of|([0-9]+|two|three|four|five|several|a few) bottles of|bunch of|handful of|lot of|lots of|whole lot of|alot of|ton of|so many|too many|way too many|rest of|[0-9]{2,}|twenty|thirty|forty|fifty|a hundred)( of)?( my| his| her| their| the| my [a-z]+s| my [a-z]+''s)?';
  ailment constant text := '(?![^.!?]{0,30}\mfor (my|his|her|the|a|this|that) (headache|back|pain|migraine|cramps|cold|flu|toothache|period|tooth|fever)\M)';
  -- "all my/his/her …": also how a daily routine is described.
  all_amount constant text := '((like|about|maybe) )?all (of )?(my|his|her|their|the)( [a-z]+s)?';
  routine constant text := '(?![^.!?]{0,40}\m(today|this morning|this evening|this week|on time|as prescribed|prescribed|for once|like (he''s|she''s|he is|she is|they''re|i''m|i am|he was|she was) supposed to|like the doctor|doctor said|for (my|his|her) (headache|back|pain)|and (went|ate|got|headed|then)|before bed|with (breakfast|dinner|food)|ready for the day|feel(ing)? (good|better|great|fine)|coffee|breakfast)\M)';
  person constant text := '(he|she|they|son|daughter|husband|wife|boyfriend|girlfriend|partner|fiance|brother|sister|dad|father|mom|mother|kid|child|grandson|granddaughter|nephew|niece|friend|yo|teen|teenager|hijo|hija|esposo|esposa|novio|novia|hermano|hermana|[a-z]+''s)';
  -- Who is "dying" in a crisis post (not a parent with an illness).
  kin constant text := '(he|she|son|daughter|husband|wife|boyfriend|girlfriend|partner|fiance|brother|sister|kid|child|yo|teen|[a-z]+''s)';
  -- Long-term illness: seizures / breathing trouble / unresponsiveness that
  -- isn't an overdose.
  chronic constant text := '\m(epilepsy|epileptic|seizure disorder|neuro|neurologist|copd|asthma|cpap|apnea|stroke|icu|hospice|dialysis|doctors? said|dementia|alzheimer''?s|cancer|ventilator|life support|als|parkinson''?s|on (his|her) own|since the accident|withdrawal meds)\M';
  -- Figurative "on …" uses of overdose.
  od_figurative constant text := '(?! on (video games|games|chocolate|coffee|caffeine|sugar|candy|cake|cookies|christmas|tiktok|netflix|tv|youtube|love|work|shopping|food|pizza|ice cream|movies|shows|social media|instagram|facebook|drama|feelings|cuteness|nostalgia)\M)';
  dated constant text := '\m(survived|in recovery|recovering|anniversary|back then|back when|years later|learned|used to|there were (days|times|nights)|in (19|20)[0-9]{2}|when i was (a kid|little|young|a teen|a teenager|growing up))\M'
    || '|\m([0-9]+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|few|couple of|several|many) (years?|yrs?|months?|mos?|weeks?|wks?|days?) ago\M|\m(years|yrs) ago\M|\mlong time ago\M'
    || '|\m(he|she|they)(''s| is| are|''re) (ok|okay|fine|alive|stable|safe|home|doing better)\M'
    || '|\mlast (year|month|week|spring|summer|fall|autumn|winter|christmas|thanksgiving|easter)\M'
    || '|\msaved (his|her|their|my) life\M|\msaved (him|her|them)\M|\mchanged (everything|my life|our lives)\M'
    || '|\mbrought (him|her|them) back\M|\mrevived\M|\m(in|at) the (hospital|er|icu)\M|\min (the )?icu\M|\m(ems|the ambulance|the paramedics|paramedics) (came|got there|arrived|took|gave|saved|revived)\M'
    || '|\m(the|that) (night|day|morning|time) (i|he|she|they|my|when|we)\M'
    || '|\mwhen (my [a-z]+|he|she|they) (stopped|was|went|turned|overdosed|od''d)\M'
    || '|\m([0-9]+|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen) (days?|weeks?|wks?|months?|mos?|years?|yrs?) (clean|sober)\M'
    || '|\m(clean|sober) (for|since)\M|(\m(is|has been|been|got|stayed|staying|now)|''s been) (clean|sober)\M'
    || '|\mhace (un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|unos|unas|muchos|muchas|[0-9]+) (anos?|meses|mes|semanas?|dias?)\M|\mhace mucho( tiempo)?\M'
    || '|\m(el|la) (ano|semana|mes|navidad) pasad[oa]\M|\msobreviv|\msobri[oa]\M|\mrecuperacion\M|\maquella (noche|vez)\M|\msalvo la vida\M'
    || '|\men el hospital\M|\mparamedicos\M|\mla ambulancia (llego|se lo llevo|se la llevo)\M|\mlo (revivieron|reanimaron)\M|\mla (revivieron|reanimaron)\M';
  -- …unless it is happening again now.
  now_again constant text := '\mtoo\M(?=\s*([.!?,;]|$))'
    -- her own intent now, or an emergency in the present tense
    || '|\mi( really| just| still| honestly| seriously)* (want|wanna) (to )?(just )?(die|be dead|kill myself)\M|\mi(''m| am) (going to|gonna|about to) (kill myself|end it|end my life)\M|\mi(''m| am)( still| so)? suicidal\M'
    || '|(\m(is|isn''t)|''s) (still )?not breathing\M|\mnot breathing (right )?now\M|(\mis|''s) (overdosing|having an overdose)\M|\m(he|she|they) (was|were) [^.!?]{0,15}(sober|clean)\M'
    || '|\m(relapsed|using again|again|just found|i just|right now|rn|tonight|doing cpr|what do i do|please help|pls help|help me|hurry|waiting for|on (the|their) way|(is|are) coming|ahorita|ayudenme|ayudame|que hago|acaba de|acabo de)\M'
    || '|\mand now\M(?! (he|she|they)(''s| is| are|''re) (sober|clean|doing|in recovery|okay|ok|fine|alive|thriving|home|happy|healthy)\M)';
  -- A teenager who won't get up, not an emergency — when nothing in the post
  -- points to drugs.
  teen constant text := '\m(for (school|work|class|church)|in the mornings?|every (single )?(morning|day)|mornings|on time|on weekends|gaming|plays? video games|stays up|up all night|sleeps (all day|in|late|till|til|until|through)|heavy sleeper|deep sleeper|partied|partying all night|hungover|such a (teen|teenager)|teenagers?|early|temprano|para (la escuela|el trabajo|ir a)|por las mananas|todas las mananas)\M'
    || '|\mwak(e|ing)( (him|her|them))?( up)? (until|til|till|before|by|on time)\M|\mdespierta(r)? (hasta|antes)\M';
  drug_context constant text := '\m(pills?|took|swallowed|od|od''d|overdos[a-z]*|narcan|naloxone|fentanyl|heroin|meth|drunk|drank|high|using|used|blue|breathing|breathe|vomit|seizure|pastillas|sobredosis|droga|drogas)\M';
  -- Words she might use about the threat that aren't about violence.
  -- People who might be doing it, for "… is going to kill me" (not "this job").
  who constant text := '(he|she|they|son|daughter|husband|wife|boyfriend|girlfriend|bf|gf|partner|fiance|ex|brother|sister|dad|father|hubby|stepson|stepdad|man|guy|[a-z]+''s (son|husband|boyfriend|dad|ex|brother))';
  -- Teaching / what-if talk, not something happening.
  hypothetical constant text := '\m(if (someone|somebody|a person|your|you|they|he|she|a loved one|anyone|my [a-z]+|our [a-z]+|a [a-z]+)|want to be prepared|be prepared|in case|signs? of|how (do|can|would) (you|i|we) (know|tell)|what to do (if|when)|narcan training|training|learned (that|how|to))\M';
  not_violence constant text := '(?! (up (for|about|on|with|over|every|nonstop|at|asking|again)|verbally|emotionally|online|at|about|to (see|watch|hear|know)|with (his|her) (addiction|drinking|using|words)|for (setting|my|having|not|being|the|trying)|on (facebook|social media|text|the phone|instagram|twitter|tiktok)|in (the|our|a) ((family|group) )?(group )?chat|in (a|the|every) (game|race|argument|card game)|to (the punch|it)|with (guilt|guilt trips|words|questions|texts?|messages|demands|requests|lies|accusations|excuses|the same excuses|(his|her|their) (guilt|words|lies|drama|excuses|questions)))\M)';
  wake_now boolean;
  told_now boolean;
  my_ingest boolean;
  medical_now boolean;
BEGIN
  -- First-person overdose just taken: firm unless the post dates it.
  my_ingest :=
       t ~ ('\mi(''ve| have)? just (took|swallowed|ate|taken|popped) ' || big_amount || ' ' || drugs || '\M' || ailment)
    OR t ~ ('\mi(''ve| have)? just (took|swallowed|ate|taken|popped) ' || all_amount || ' ' || drugs || '\M' || routine)
    OR t ~ ('\mi(''ve| have)? (took|swallowed|ate|taken|popped) ' || big_amount || ' ' || drugs || '\M' || ailment)
    OR t ~ ('\mi(''ve| have)? (took|swallowed|ate|taken) ' || all_amount || ' ' || drugs || '\M' || routine)
    OR t ~ '\mi(''ve| have)? (just )?(took|taken|swallowed) an overdose\M'
    OR t ~ ('\mi(''ve| have)? (just )?(taken|swallowed) all (of )?my\M' || routine)
    OR t ~ '\mi (just )?(overdosed|od''d)\M(?! (in|back|years|when|last)\M)' AND t ~ ('\mi (just )?(overdosed|od''d)\M' || od_figurative)
    OR t ~ '\mi think i (took too (many|much)|overdosed|od''d)\M'
    OR t ~ '\m(i think )?(i''m|i am) (overdosing|having an overdose|od''ing|od-ing|oding)\M|\mcreo que (tengo|estoy teniendo) una sobredosis\M'
    OR t ~ '\mi(''ve| have)? (just )?(took|swallowed|popped) ([5-9]|[0-9]{2,})( of)?( my| his| her)? (xanax|bars|xannies|percs|percocets|oxys?|oxycodone|vicodin|valium|klonopin|ativan|ambien|fentanyl|morphine|benzos|sleeping pills|sleeping meds)\M'
    OR t ~ '\mi (just )?(did|took|used|snorted|smoked) (way )?too much (fentanyl|heroin|dope|meth|coke|xanax|of (it|that|my|his))\M|\mi (just )?shot up( way)? too much\M'
    OR (t ~ '\mi (just )?(took|swallowed) (them|it) all\M|\mi (just )?(took|swallowed) all of them\M' AND t ~ '\m(pills|meds|pastillas)\M')
    OR t ~ '\mpills\M[^.!?]{0,10}\m(took|swallowed) (them|it) all\M'
    OR t ~ ('\m(drank|i drank)[^.!?]{0,40}\mand (took|swallowed|popped) ' || big_amount || ' ' || drugs || '\M')
    OR t ~ '\mi (took|swallowed) (todas mis pastillas|todas las pastillas)\M|\mme tome (all my pills|like [0-9]+ pills)\M'
    OR t ~ '\mi (just )?(drank|swallowed) (bleach|antifreeze|rat poison|poison)\M'
    OR (t ~ '\m(me tome|acabo de tomar(me)?|me acabo de tomar)( como| unas| mas de)? (todas (mis|las|sus) pastillas|un frasco( entero)?( de pastillas)?|el frasco entero|todo el frasco|toda la caja( de pastillas)?|un bote( de pastillas)?|demasiadas pastillas|muchas pastillas|un monton de pastillas|un punado de pastillas|diez pastillas|[0-9]{2,} pastillas|veinte pastillas|treinta pastillas)\M'
        AND t !~ '\mhoy (me )?tome todas (mis|las) pastillas\M|\mtodas (mis|las) pastillas (de hoy|del dia|de la manana|de la noche|a tiempo|como me)')
    OR t ~ '\mtome( como| unas| mas de)? (demasiadas pastillas|muchas pastillas|un frasco( entero)?( de pastillas)?|un monton de pastillas|[0-9]{2,} pastillas)\M';
  -- A few over-the-counter pills as part of the day isn't an overdose.
  my_ingest := my_ingest AND t !~ '\m(bunch|handful|couple|few) of (advil|ibuprofen|aspirin|tylenol|motrin|aleve)\M[^.!?]{0,40}\m(this morning|today|last night|for (my|a|the|this|that))\M';
  IF my_ingest AND (t !~ dated OR t ~ now_again) THEN
    RETURN 'firm';
  END IF;

  -- Medical emergencies now, unless the post is about a long-term illness.
  medical_now :=
       t ~ '(\m(is|isn''t|are|aren''t)|''s|''re) (still )?not breathing\M(?! (right|well|properly|normally|through|at night|when|on (his|her) own|in (his|her) sleep|a word)\M)'
    OR t ~ '\m(isn''t|aren''t) breathing\M(?! (right|well|properly|normally|through|at night|when|on (his|her) own|a word)\M)'
    OR t ~ '\mnot breathing (right )?now\M'
    OR t ~ ('\m' || person || '( is|''s| are|''re) (still )?(barely breathing|turning blue|overdosing|od-?ing|od''ing|convulsing|choking on (his|her|their|it) (own )?vomit)\M(?! (financially|lol|lmao|haha)\M)(?![^.!?]{0,30}\m(dreams?|nightmares?|cold|popsicle|screaming|crying|holding (his|her) breath|lol|paint|marker|dye)\M)' || od_figurative)
    OR t ~ '(\m(is|are)|''s|''re) (still )?barely breathing\M(?! (financially|lol|lmao|haha)\M)'
    OR t ~ ('\m' || person || '( can''t| cannot| can not) breathe\M(?! (well|right|at night|without|with the|through|when)\M)')
    OR t ~ '\m(seizing|convulsing) on the (floor|ground|bed)\M'
    OR t ~ '\mchoking on (it|his vomit|her vomit|vomit|(his|her|their) own vomit|throw up)\M(?![^.!?]{0,30}\m(dreams?|nightmares?)\M)'
    OR t ~ '\mfoaming at the mouth\M|\m(has|''s got) no pulse\M|\mno pulse\M|\m(his|her|their) heart (stopped|isn''t beating|is not beating)\M|\mcold and blue\M|\mblue and cold\M'
    OR t ~ '\mlips (are|''re) (turning )?(blue|purple|gray|grey)\M(?![^.!?]{0,30}\m(cold|popsicle|candy|freezing|pool|lol|marker|dye)\M)'
    OR t ~ ('(\m(is|are)|''s|''re) (overdosing|od-?ing|od''ing)\M' || od_figurative)
    OR t ~ '(\m(is|are)|''s|''re) having (an? )?(overdose|od)\M|\moverdosing (right )?now\M'
    OR t ~ '(\m(is|are)|''s|''re) having (a )?seizures? (right now|rn)\M'
    OR t ~ '\m(no respira|no esta respirando|ya no respira|no puede respirar)\M(?! (bien|por|sin|cuando)\M)'
    OR t ~ '\m(esta|estan|tiene|tienen) (teniendo )?una sobredosis\M'
    OR t ~ '\mesta inconsciente\M(?! de\M)|\mlabios morados\M|\m(hijo|hija|esposo|esposa|marido|novio|novia|bebe)( [a-z]+){0,2} (esta|se esta poniendo|se puso) (azul|morado|morada)\M|\mse (esta|estan) poniendo (azul|morado|morada)\M'
    OR t ~ '\mse (esta|estan) ahogando (con|en) (su |el )?vomito\M|\mle (dejo de latir|paro) el corazon\M|\mno tiene pulso\M';
  IF medical_now AND t !~ chronic AND t !~ hypothetical AND (t !~ dated OR t ~ now_again) THEN
    RETURN 'firm';
  END IF;

  -- ── 'firm': first person, or happening right now ──
  IF t ~ ('(?<!not going to )(?<!not gonna )(?<!never )(?<!won''t )(?<!wouldn''t )(?<!not )(?<!don''t want to )(?<!do not want to )(?<!wouldn''t ever )'
          || '\m(kill|killing|hang|hanging|shoot|shooting|hurt|hurting|harm|harming|cut|cutting|stab|stabbing|poison|poisoning|drown|drowning) myself\M'
          || '(?! (off|by|over|out|working|trying|to|for|enabling|helping|worrying|doing|covering|paying|at work|with work|here|some slack|slack|shaving|at the gym|working out|cooking|by accident|accidentally|on (a|the|my)|lol|lmao|haha|jk|if|when|[a-z]+ing)\M)')
     OR t ~ '(?<!is )(?<!was )(?<!it''s )(?<!that''s )(?<!this )(?<!disease )\m(end|ending|take|taking) my (own )?life\M(?! back\M)'
     OR t ~ '\mi( really| just| honestly| sometimes| still| kind of| kinda| seriously| lowkey| literally| so)* (want|wanna) (to )?(just )?(die|be dead)\M(?! (of|laughing|a little|inside|my|her|his|it|them)\M)'
     OR t ~ '\mi( really| just)? wish (i could (just )?die|i (was|were) dead|i wasn''t alive|i had never been born|i (was|were) never born)\M'
     OR t ~ '\m(wrote|writing|written|finished|left) (my|a) (suicide|goodbye) (note|letter)\M|\mi(''m| am)? (sitting|alone|here) (in|at) [^.!?]{0,20}with (a|the|my) (gun|pistol|pills|noose)\M'
     OR t ~ '\mi(''m| am) bleeding out\M|\mpulled (a|the|his|her) (knife|gun|pistol) on (me|us)\M|\mhelp\M[^.!?]{0,20}\m(has|got) (a|the) (gun|knife)\M'
     OR t ~ '\m(drink|drinking) myself to death (tonight|today|right now)\M'
     OR t ~ ('\mi( just| really| honestly)? (do not|don''t|no longer) (want to|wanna) (live|be alive|exist)( (anymore|any more|ever again|again|tomorrow))?(?! and (die by|let|watch))' || clause_end)
     OR t ~ ('\mi (do not|don''t|no longer) (want to|wanna) wake up( (anymore|any more|ever again|again|tomorrow))?(?! and (find|get|see|hear|learn|realize|have|deal|do|face|go|start))' || clause_end)
     OR t ~ '\mi (do not|don''t) (want to|wanna) be here (anymore|any more)\M(?! at\M)(?![^.!?]{0,30}\m(this|the|that) (group|app|forum|chat|place|house|marriage|relationship|town|city|job)\M)'
     OR t ~ ('\mi (can''t|cannot) go on (anymore|any more|living)' || clause_end)
     OR t ~ '\m(i''m|i am|i feel|i''ve been|i have been|i''ve been feeling|i have been feeling|feeling)( so| really| very| kind of| pretty)? suicidal\M'
     OR t ~ '\mi(''m| am|''ve| have| keep| can''t stop)?( been)?( having)? (suicidal (thoughts|urges|feelings)|(thinking|think|thoughts) (about|of) (suicide|killing myself|ending (it all|my life)))\M'
     OR t ~ '\mi(''m| am| was)?( really| seriously| just)? (want to|wanna|going to|gonna|might|may|could|will|''ll|about to|plan to|planning to|ready to|thinking about|thinking of|considering|contemplating|feel like) (commit(ting)? )?suicide\M'
     OR t ~ '\mi( just)? feel like (committing suicide|killing myself|dying|ending it all|ending my life)\M'
     OR t ~ '\msuicide is all i (can )?think about\M'
     OR t ~ '(?<!not )(?<!never )\mi(''m| am|''ll| will)? (just )?(going to|gonna|want to|wanna|about to|ready to|planning to|plan to|need to) (kill myself|end it all|end my life|overdose|od|jump off (a|the) (bridge|building|roof|cliff))\M(?! (for|over|lol|lmao|haha|jk|if|when|on|[a-z]+ing)\M)'
     OR t ~ ('\mi(''m| am)?( so)? (tired of|done with) (living|life)' || clause_end)
     OR t ~ ('\mi(''m| am)( so)? done living' || clause_end)
     OR t ~ ('\mi(''m| am) ready to die' || clause_end)
     OR t ~ '\mi(''m| am|''ll| will)?( just)?( (going to|gonna|want to|wanna|about to|ready to|planning to|plan to))? end (it|things|everything)( all)? (tonight|today|right now|now)\M(?! with\M)(?![^.!?]{0,40}\m(him|her|cheating|texts?|relationship|marriage|divorce|lease|job)\M)'
     OR t ~ '\mi(''m| am|''ll| will)?( just)?( (going to|gonna|want to|wanna|about to|ready to|planning to|plan to))? end it all\M(?! (with|for)\M)'
     OR t ~ ('\mtonight,? i(''m going to|''m gonna| am going to|''ll| will)? end (it|everything)( all)?' || clause_end)
     OR t ~ '\mi(''m| am) ending (it|things|everything)( all)? (tonight|today|right now|now)\M(?! with\M)(?![^.!?]{0,40}\m(divorce|marriage|relationship|lawyer|separat[a-z]*|lease|contract|job)\M)|\mi(''m| am) ending it all\M(?! (tonight |today )?(with|for)\M)'
     OR t ~ '\mi(''ve| have)?( got| made)? a plan to (end (it|things|everything|my life)|kill myself|die|overdose)\M(?! with\M)'
     OR t ~ ('\mi(''m| am)?( just| really)? (going to|gonna|want to|wanna|about to|ready to|planning to|plan to|thinking about|thinking of) (take|taking|swallow|swallowing|down) (all|every one|the rest|a (whole )?bottle|the (whole|entire) bottle|a bunch|a handful)( of)?( my| the| these| those)? ' || drugs || '\M(?![^.!?]{0,40}\m(to (the )?(drop box|pharmacy|cvs|walgreens|police|take ?back)|drop box|take ?back|away|out of the house|and (flush|throw|hide|lock|get rid))\M)')
     OR t ~ '\mi(''m| am|''ll| will)?( just)? (going to|gonna|about to) (take|swallow) the (whole|entire) bottle\M(?![^.!?]{0,30}\m(to|away|back)\M)'
     OR t ~ '\mi(''m| am)?( just)? (going to|gonna|about to|want to|wanna|plan to|planning to) (take|swallow) every (single )?pill\M'
     OR t ~ '\mi (have|''ve got|got) (the|my|all (my|the)) pills\M[^.!?]{0,40}\m(take|swallow) (them|it) all\M|\mpills (in my hand|right here|ready|lined up)\M'
     OR t ~ '\mi(''ve been| have been|''ve| have| got|''m| am)? (saving|saved|stockpiling|stockpiled|hoarding|hoarded) (up )?(my |all my |the )?(pills|meds|medication)\M|\mpills saved up\M'
     OR t ~ '\mi(''m holding| am holding| have|''ve got| got| put|''m putting| am putting|''m pointing| am pointing) (a|the|my|my [a-z]+) (gun|pistol|revolver|knife|razor|blade) (to|against|at) my (head|temple|throat|neck|chest|wrists?)\M'
     OR t ~ '\m(going to|gonna|about to|want to|wanna) (use it|shoot) on myself\M|\muse it on myself\M'
     OR t ~ '\m(gun|pistol|blade|razor|noose)\M[^!?]{0,60}\mi( want to| wanna| am going to|''m going to|''m gonna| will|''ll) (end it|end it all|end my life|kill myself|die|use it|do it)\M'
     OR t ~ '\m(gun|pistol|noose|blade|razor)\M(?! (is )?(locked|safe|in the safe|away|put away))[^!?]{0,60}\mi(''m| am)( just)? (done|ready)\M'
     OR t ~ '\m(gun|pistol) (is )?(in my (lap|hand|mouth)|to my (head|temple))\M'
     OR t ~ '\mdoing cpr\M|\m(is|''s) suicidal (right now|rn|tonight)\M|\msuicidal right now\M|\msigue sin respirar\M|\m(me estoy|se esta|se estan) desangrando\M'
     OR t ~ '\m(tiene|esta teniendo) (una )?sobredosis\M|\mme (esta|estan) atacando\M|\mme (esta|estan) (choking|hitting|beating|strangling|attacking)\M'
     OR t ~ '\m(gun|pistola|pistol|knife|cuchillo)\M[^.!?]{0,40}\m(threatening|amenazando) (me|us)\M'
     OR t ~ '\mthis is my goodbye\M(?! (post|message|to (this|the) (group|app|forum|community|page)|to (facebook|social media|instagram|twitter|tiktok))\M)(?![^!?]{0,40}\m(leaving|log(ging)? off|deleting|break from)\M)[^!?]{0,60}\m(love you all|love you guys|take care of (my|the) (kids|babies|children)|tell my (kids|son|daughter|husband)|forgive me|i''m sorry for everything)\M'
     OR t ~ ('\mi won''t be (here|alive|around) (tomorrow|much longer|anymore)' || clause_end || '(?![^.!?]{0,30}\m(appt|appointment|work|trip|travel|vacation|out of town|meeting|doctor|class|court|visit|flight|have to|drive|driving|taking|rehab)\M)')
     OR t ~ '\mi(''m| am)?( just)? (going to|gonna|about to|want to|wanna) (drive|crash) (my car )?(off|into) (a|the) (bridge|cliff|tree|wall|traffic|river|lake|ocean|truck|pole)\M'
     OR t ~ '\mi( just)? (want|wanna|wish i could|would like) (to )?(go to sleep|fall asleep|sleep) and (never|not) wake up\M(?! (until|till|til|for (a|the|like) (week|day|month|while|year|few days))\M)(?![^.!?]{0,30}\mlol\M)'
     OR t ~ '\mi(''ve| have)?( just)? (slit|slashed|sliced) my wrists?\M|\mi(''ve| have)?( just)? cut my wrists\M'
     OR t ~ '\mi(''m| am)?( just)? (going to|gonna|about to|want to|wanna) (slit|cut|slash) my wrists?\M'
     OR t ~ '\mi(''ve been| have been|''m| am) cutting( myself)? (again|tonight|right now|rn)\M|\mi cut too deep\M|(?<!nose )\m(won''t|can''t) stop (the )?bleeding\M(?![^.!?]{0,30}\m(nose|nosebleed|period|lol)\M)'
     OR t ~ '\mno reason (for me )?to live\M(?! (in|like|with|this|that|under|for (him|her|them))\M)'
     OR t ~ '\m(everyone|everybody|my family|my kids|my children|my husband|my son|my daughter|my sons|my daughters|they|people|the world|he|she)( would| wud|''d| is| are|''re)( all)?( be)? better off (without me|if i (was|were) (gone|dead|not here|not around))\M(?! [a-z]+ing\M)'
     OR t ~ '\mi(''m| am|''d| would)( be)?( so much| just| probably| honestly)? better off (dead|gone)\M'
     OR t ~ '\m(life|my life) (is not|isn''t|ain''t) worth living\M|\m(i don''t see the|i see no|what''s the|whats the|there''s no) point (in|of) (living|going on|being alive)\M|\mi have nothing (left )?to live for\M'
     OR t ~ '\m(nobody|no one) (would|will) (miss|care|notice)( me)?( if i (died|was gone|were gone|wasn''t here))?\M(?! (my|the|his|her)\M)'
     OR t ~ '\mi wish i could (just )?(sleep|go to sleep) forever\M'
     OR t ~ '\mi(''m| am|''m standing| am standing|''m sitting| am sitting) (on|at) (the|a) (bridge|ledge|overpass|cliff)\M(?! of\M)(?![^.!?]{0,25}\m(driving|drive|car|traffic|commute|on my way|walking|walk|bike)\M)|\mi(''m| am)( just)? (going to|gonna|about to) jump\M(?! (into|on|at|through|to|ship|the gun|for joy|out of|up|over|right in|in (the|a) (pool|lake|car|shower|ocean))\M)'
     OR t ~ '\mi(''m| am|''m standing| am standing|''m sitting| am sitting) (on|at) (the|a) (roof|balcony|edge)\M[^.!?]{0,40}\m(jump|jumping|end it|let go)\M'
     OR t ~ '(^|[.!?,;] )(i''m |i am )?(on|at|standing on) (the|a) (bridge|ledge|overpass) (rn|right now|now)\M'
     OR t ~ '\mi(''m| am|''ll| will)?( just)? (going to|gonna|about to|want to|wanna) (blow my brains out|put a bullet in my (head|brain)|slit my (throat|wrists?)|jump in front of (a|the) (train|car|bus|truck)|walk into traffic|throw myself (off|in front of|from|under)|hang myself|shoot myself|drink bleach)\M'
     OR t ~ '\m(sitting|in|inside) (in )?the garage with the (car|engine) running\M|\mcar running in the garage\M'
     OR t ~ '\m(noose|gun|pistol)\M[^!?]{0,60}\m(going to|gonna) do it( tonight| today| now)?\M|\mgot the rope\M|(?<!jump )(?<!of my )(?<!of the )\mrope\M[^!?]{0,60}\m(going to|gonna) do it( tonight| today| now)?\M'
     -- Someone else, happening now.
     OR t ~ '(?<!like )(\m(is|are)|''s|''re) (trying|attempting) to (kill|hang|shoot|hurt|cut) (him|her|them)sel(f|ves)\M(?! (with|slowly|one))'
     OR t ~ '\mjust (tried|attempted) (to (kill|hang|shoot) (him|her|them)sel(f|ves)|suicide)\M'
     OR t ~ '\m(on|at|standing on) (the|a) (roof|bridge|ledge|balcony|overpass)\M[^.!?]{0,40}\m(jump|jumping)\M(?! (for joy|out of))|\mthreatening to jump\M|\mstanding on (the|a) (bridge|ledge|overpass)\M(?! of\M)'
     OR t ~ '(\m(has|got|is holding|put|is pointing)|''s got|''s holding|''s pointing) (a|the|his|her|their|my|my [a-z]+) (gun|pistol|knife|blade) (to|against|at) (his|her|their) (head|temple|throat|neck|chest|wrists?)\M'
     OR (t !~ chronic AND t ~ '(\m(going to|gonna|about to|plans to|planning to|threatening to|wants to|will)|''ll) (kill (him|her|them)sel(f|ves)|end (his|her|their) (own )?life|shoot (him|her|them)sel(f|ves)|hang (him|her|them)sel(f|ves)|die) (tonight|today|right now|now)\M')
     OR t ~ '\m(kill (him|her|them)sel(f|ves)|wants? to die|end (his|her|their) (own )?life|suicid[a-z]*)\M[^.!?]{0,80}\m(has|have|got|with|holding|bought|grabbed) (a|his|her|their|my|the)( [a-z]+s)? (gun|pistol|rifle|shotgun|knife|rope|razor)\M'
     OR t ~ '\m(has|have|got|with|holding|bought|grabbed) (a|his|her|their|my|the)( [a-z]+s)? (gun|pistol|rifle|shotgun|knife|rope|razor)\M[^.!?]{0,80}\m(kill (him|her|them)sel(f|ves)|wants? to die|end (his|her|their) (own )?life|suicid[a-z]*)\M'
     OR t ~ '\mlocked (him|her|them)sel(f|ves) in\M[^.!?]{0,40}\m(razor|knife|gun|pills|rope|blade)\M'
     OR t ~ '(\m(is|are)|''s|''re) cutting( (herself|himself|themselves))? (right now|rn)\M|\mcutting (herself|himself|themselves) (right now|rn)\M'
     -- Violence happening now.
     OR t ~ ('(?<!it )(?<!this )(?<!that )(?<!it''s )(?<!addiction )(?<!lies )(?<!addiction is )(?<!lies are )(?<!jail is )(\m(is|are|keeps)|''s|''re) (beating|strangling|attacking|stabbing|hurting|choking(?! (me|us) up\M)) (me|us|(his|her|their|our|my) (son|daughter|girlfriend|boyfriend|gf|bf|wife|husband|mom|mother|dad|father|kids?|children|brother|sister|baby|grandma|grandpa))\M' || not_violence)
     OR t ~ ('(\m(is|are|keeps)|''s|''re) hitting (me|us|(his|her|their|our|my) (son|daughter|girlfriend|boyfriend|gf|bf|wife|husband|mom|mother|dad|father|kids?|children|brother|sister|baby))\M(?! up\M)' || not_violence)
     OR t ~ ('\m(dad|father|mom|mother|husband|wife|son|daughter|he|she|bf|gf|boyfriend|girlfriend) (is|''s) (hitting|beating|choking|strangling|attacking) (mom|dad|my [a-z]+|his [a-z]+|her [a-z]+|our [a-z]+)\M' || not_violence)
     OR t ~ '\mbeating the (crap|shit|hell|living daylights|life) out of (me|us)\M|\m(beating|hitting|hurting|choking) (me|us)( up)? (right now|rn)\M'
     OR t ~ '\m(drunk|high|wasted|raging) and (hitting|beating|choking|attacking) (me|us)\M|\m(hitting|beating|choking|attacking) (me|us) (right now|rn)\M'
     OR t ~ ('\m' || who || '( just| literally just) (hit|punched|kicked|slapped|choked|strangled|stabbed|shot|attacked|beat) (me|us)\M' || not_violence)
     OR t ~ ('\m' || who || ' (stabbed|shot) (me|us)\M(?! (a|an|the) (look|text|glance|message|dm|email|smile|picture|photo)\M)(?! (in the back|down)\M)')
     OR t ~ ('\m' || who || '(''s| is| are|''re)? (going to|gonna|trying to|about to) (kill|shoot|stab|strangle|choke) (me|us)\M(?![^.!?]{0,40}\m(when|if|once|for|lol|lmao|haha|spent|bought|posted|with (worry|stress|his|her)|because|bc|cuz|finds out|sees)\M)')
     OR t ~ '\mthreatening to kill (me|us|my [a-z]+|his [a-z]+|her [a-z]+|our [a-z]+)\M|\mthreatening (me|us) with (a|the|his|her) (gun|knife|pistol|rifle)\M'
     OR t ~ '\m(gun|knife|pistol|rifle) (pointed|aimed) at (me|us)\M'
     OR t ~ '\mwon''t let (me|us) leave\M[^!?]{0,60}\m(gun|knife|pistol|weapon)\M|\m(gun|knife|pistol|weapon)\M[^!?]{0,60}\mwon''t let (me|us) leave\M'
     OR t ~ '\m(pointing|aiming) (a|the|his|her) (gun|pistol|knife|rifle) at (me|us|my|our|him|her)\M'
     OR t ~ ('\m' || who || '(''s| is|''ll| will)? (going to |gonna )?kill (me|us)( tonight| right now| now)?\M(?![^.!?]{0,40}\m(when|if|once|for|lol|lmao|haha|spent|bought|posted|with (worry|stress|his|her)|because|bc|cuz|finds out|sees)\M)')
     OR t ~ '\m(going to|gonna) kill (me|us)\M[^!?]{0,60}\m(has|got) (a|his|the) (gun|knife|pistol|rifle)\M'
     OR t ~ '(\m(has|have|got|is holding)|''s got|''s holding) (a|his|her|their|the) (knife|gun|pistol|rifle|weapon)\M[^.!?]{0,60}\m(threatening|threatens|won''t let (me|us) leave|pointing it|coming at me)\M'
     OR t ~ '\m(grabbed|has|got|picked up) (a|the|his|her) (knife|gun|bat|hammer|axe|machete|crowbar|pipe)\M[^.!?]{0,40}\m(coming at|coming after|chasing) (me|us)\M'
     OR t ~ '\m(chasing|coming at|coming after) (me|us) with (a|the|his|her) (bat|knife|gun|hammer|axe|machete|crowbar|pipe|bottle)\M|\mswinging (a|the|his|her) (bat|knife|hammer|axe|machete|crowbar|pipe|bottle) at (me|us)\M'
     OR t ~ '\m(trying to get in|pounding on the door|banging on the door)\M|\m(going to|gonna|about to) hurt (me|us)\M(?![^.!?]{0,30}\m(when|if|feelings|lol|haha|lmao)\M)'
     OR t ~ '\m(hands|hand) (around|on) my (neck|throat)\M|\mtrying to break (in|the door)\M|\mbreaking (down )?the door\M|(\m(is|are)|''s|''re) breaking in\M(?! (my|the|a|new|his|her|our)\M)'
     OR t ~ '\mhiding (in|from)\M[^.!?]{0,60}\m(knife|gun)\M|\mlooking for (me|us) with (a|the|his|her) (knife|gun)\M'
     OR t ~ '\m(punched|hit|stabbed|cut) me\M[^.!?]{0,30}\mi(''m| am) bleeding\M|\mi(''m| am) bleeding (a lot|badly|everywhere|so much)\M'
     OR (t !~ '\m(nosebleed|nose bleed|my nose|his nose|her nose|period|lol)\M' AND t ~ '(\mis|''s) bleeding (a lot|badly|everywhere|so much|heavily)\M|\mblood everywhere\M')
     -- Spanish (accents folded).
     OR t ~ '(?<!busca )(?<!quiere )(?<!quieren )(?<!intenta )(?<!va a )(?<!van a )\m(matarme|suicidarme|quitarme la vida|cortarme las venas)\M(?! de (un susto|risa|coraje|la risa))|\m(quiero|voy a|pienso|me voy a) hacerme dano\M'
     OR t ~ '\m(ya )?no quiero existir\M|\m(voy a|quiero) (acabar|terminar) con mi vida\M'
     OR t ~ '\mme (voy a|quiero) (colgar|ahorcar|disparar|pegar un tiro|dar un tiro)\M|\mme voy a tirar (al|a la|a las) (rio|vias|tren|mar|carretera)\M|\mestoy (en|sobre) el puente\M|\mon the bridge\M[^.!?]{0,30}\m(saltar|jump)\M'
     OR t ~ '\mme (acabo de cortar|estoy cortando)( las venas)?\M|\mme corte las venas (ahorita|ahora)\M|\m(estoy|ando) sangrando (mucho|demasiado)\M'
     OR t ~ '\mle (esta|estan) (pegando|golpeando) a\M|\mme (pega|golpea|pego|golpeo) (ahorita|ahora mismo)\M'
     OR t ~ '(?<!no )(?<!nunca )\m(me quiero morir|me voy a (matar|suicidar|quitar la vida)|me quiero (matar|suicidar|quitar la vida))\M(?! [a-z]+(ando|iendo)\M)(?! de (la |los |las )?(verguenza|risa|pena|ganas|hambre|sueno|aburrimiento|calor|frio|amor|celos|envidia|nervios)\M)'
     OR t ~ '(?<!no )(?<!no me )(?<!nunca )\m(quiero|quisiera) morir(me)?\M(?! de (la |los |las )?(verguenza|risa|pena|ganas|hambre|sueno|aburrimiento|calor|frio|amor|celos|envidia|nervios)\M)'
     OR t ~ '\mtengo ganas de (morir(me)?|matarme|suicidarme)\M|\m(me quiero ir|irme) de este mundo\M'
     OR t ~ '\mno tengo (razon|motivo|motivos|razones) (para|de) vivir\M|\m(ya )?no quiero despertar( manana| nunca( mas)?| mas)?\M(?! (temprano|tarde|a las)\M)|\m(estoy|estaria) mejor muert[ao]\M|\mmejor me muero\M|\mcansad[ao] de vivir\M|\mno le (veo|encuentro) (sentido|caso) a (la vida|vivir|seguir)\M'
     OR t ~ '\mtengo las pastillas (en la mano|listas|aqui)\M'
     OR t ~ ('\m(ya )?no quiero (seguir )?(vivir|viviendo)( mas| ya)?' || clause_end)
     OR t ~ ('\m(ya )?no quiero estar aqui( ya| mas)?' || clause_end || '(?![^.!?]{0,30}\m(casa|trabajo|ciudad|pueblo|relacion|matrimonio|lugar|grupo)\M)')
     OR t ~ '\mno quiero estar viva\M|\m(quiero|quisiera) estar muerta\M'
     OR t ~ '\mojala (estuviera muerta|me muriera|no despertara)\M'
     OR t ~ '\m(pienso|estoy pensando|he pensado|he estado pensando) en (suicidarme|matarme|quitarme la vida|el suicidio)\M'
     OR t ~ '\m(tengo|he tenido) pensamientos suicidas\M'
     OR t ~ '\m(todos|todo el mundo|mi familia|mis hijos) (estarian|estaria|estara) mejor sin mi\M'
     OR t ~ '\m(me voy a tomar|voy a tomarme|me quiero tomar|quiero tomarme) (todas (mis|las) pastillas|un frasco( entero)?( de pastillas)?|demasiadas pastillas|muchas pastillas)\M'
     OR t ~ '\mme (voy a|quiero|pienso|estoy por) (tirar|aventar|lanzar) (del|de (un|el|este|una|la)|desde (un|el|este|una|la)|por (un|el|este|una|la)) (puente|edificio|techo|azotea|balcon|ventana)\M'
     OR t ~ ('\m(voy a|quiero|me voy a) (terminar|acabar) con todo( esta noche| hoy| ya| ahora)?' || clause_end)
     OR t ~ '\m(esta|estan) convulsionando\M(?! (de|por) (risa)\M)'
     OR t ~ '\mse (esta|estan) cortando\M'
     OR t ~ '\m(me|nos) (esta|estan) (golpeando|pegando|ahorcando|apunalando|estrangulando|asfixiando)\M|\m(me|nos) (esta|estan) ahogando\M(?! (con|en) (sus|tanto|los|las|esto|deudas|problemas)\M)'
     OR t ~ '\m(me|nos) (esta|estan) amenazando con (un|una|el|la|su) (cuchillo|pistola|arma)\M|\m(me|nos) (esta|estan) amenazando con matar'
     OR t ~ '\m(mi )?(esposo|marido|hijo|hija|novio|pareja|ex)( [a-z]+)? (dice que |dijo que )?me (va a|quiere) (matar|apunalar|ahorcar|estrangular|disparar)\M(?! (cuando|si|de)\M)|\mme (quiere|va a) (apunalar|estrangular|disparar)\M'
     OR t ~ '\m(esta|estan) (golpeando|pegando|ahorcando|apunalando) a\M'
     OR t ~ '\mtiene (un|una) (cuchillo|arma|pistola)\M[^.!?]{0,40}\m(amenaza|amenazando|no me deja (salir|irme)|se va a matar|se quiere matar|me quiere matar|me va a matar)\M'
     OR t ~ '\m(esta|estan) sangrando (mucho|demasiado|un monton)\M'
  THEN
    -- A dated story ("two years ago he was threatening to kill us. today
    -- he's sober") posts with resources instead of being refused.
    RETURN CASE WHEN t ~ dated AND t !~ now_again THEN 'resources' ELSE 'firm' END;
  END IF;

  -- ── 'told': could be now, a story, or an illness ──
  wake_now := (
       t ~ '\m(can''t|cannot|can not|couldn''t) (get (him|her|them|my [a-z]+) to wake( up)?|wake (him|her|them|my\M)|wake up (him|her|them|my\M|a mi\M))'
    OR t ~ '\m(won''t|will not|isn''t|is not|not) (waking|wake)( up)?\M(?! (up )?(to|and (see|realize|smell|face|notice|look))\M)'
    OR t ~ '\mno (puedo |logro )?despertarl(o|a|os|as)\M|\mno (puedo|logro) despertar a (mi|su) [a-z]+\M|\mno (lo|la|los|las) (puedo|logro) despertar\M'
    OR t ~ '\mno (se )?despierta\M'
  ) AND NOT (t ~ teen AND t !~ drug_context)
    AND t !~ '\mwak(e|ing) up (to|and (see|realize|smell|face|notice|look))\M';
  told_now := wake_now
    OR my_ingest
    OR (medical_now AND t !~ hypothetical)
    OR (t !~ '\mapnea\M' AND (
         t ~ '(?<!\mi )\m(stopped|has stopped|no longer) breathing\M|''s stopped breathing\M'
      OR t ~ '(?<!was )(?<!were )(?<!wasn''t )\mnot breathing\M(?! (well|right|properly|through|correctly|deeply|normally|at night|when|on (his|her) own|a word)\M)'))
    OR (t !~ chronic AND t ~ '(?<!emotionally )\m(unresponsive|unconscious|not responsive)\M(?! (to (every|any|all|consequences?|treatment|medication|therapy|counseling|reason|calls?|texts?|anything (i|we)|my|our|us|me)|when|in the mornings?|emotionally|every (night|morning)|since)\M)')
    OR (t !~ chronic AND t ~ ('\m' || person || '( is|''s| are|''re) (still )?having (a )?seizures?\M'))
    OR t ~ ('\m' || person || '( is|''s| are|''re) seizing\M(?! (every|the|an|this|on (the|every|any) (opportunity|chance|moment))\M)')
    OR (t !~ chronic AND t ~ ('(?<!feel like )(?<!feels like )(?<!like )\m' || kin || '( is|''s| are|''re) dying\M(?! (to|of|for|from|inside|laughing|slowly|a slow death|from embarrassment)\M)(?![^.!?]{0,30}\m(still|and (i|my|we)|disease|addiction|alcoholism|drinking)\M)'))
    OR t ~ ('\m' || person || '( is|''s| are|''re) (blue|gray|grey|purple)\M(?! (about|since|today|lately|because|over|that|these days|after|from)\M)')
    OR t ~ '(?<!i''m )(?<!i am )\mnot responding\M(?! (to (me|us|my|our|her|his|their|the|treatment|medication|therapy|suboxone|methadone|counseling|texts?|calls?|messages?|emails?|letters?|consequences?|anything (i|we) (say|do|try))|well|when)\M)'
    OR (t !~ '\m(texted|called|messaged|texts?|calls?|messages?|on read|ignoring|ignores|ghost(ing|ed)?|voicemail)\M' AND t ~ '\m(won''t|will not|doesn''t|does not) respond\M(?! (to|when|well|anymore|lately|since|unless|if|at all to)\M)')
    OR t ~ '(?<!me )(?<!nos )(?<!te )\mno responde\M(?! (a|al|el|la|los|las|mis|sus|mi|su|por|cuando|con|nada de)\M)'
    OR t ~ '\m(turning|turned|went) (blue|gray|grey)\M(?![^.!?]{0,30}\m(cold|popsicle|screaming|crying|holding|lol|freezing|paint|marker|dye)\M)|\mfound (him|her|them|my [a-z]+) (blue|cold|not breathing|unresponsive|not moving)\M'
    OR t ~ '(\m(found|is|isn''t|lying|laying)|''s)\M[^.!?]{0,40}\m(not moving|isn''t moving)\M(?! (forward|on|out|in|away|fast)\M)|\mfound (him|her|them|my [a-z]+( [a-z]+)?) dead\M|\mnot moving or breathing\M|\m(throwing up|threw up|vomiting)\M[^.!?]{0,30}\mpassed out\M|\mpassed out\M[^.!?]{0,30}\m(throwing up|vomit)'
    OR (t ~ '(\m(just|has)|''s) (overdosed|od''d)\M'
        AND t !~ '\m(afraid|scared|terrified|worried|worry|fear|dread|find out|hear|get the call)\M[^.!?]{0,25}(overdosed|od''d)\M')
    OR t ~ '\m(hung|hanged|shot|stabbed|cut|slit) (him|her|them)sel(f|ves)\M(?! (in the (foot|leg)|shaving|cooking|on|by accident|accidentally|while)\M)'
    OR t ~ '\mfound (him|her|them|my [a-z]+( [a-z]+)?) hanging\M'
    OR t ~ '\m(cut|slit|slashed) (his|her|their) wrists\M'
    OR t ~ ('\m(says|said|told me) (he''s|she''s|he is|she is|they''re|he was|she was) (going to|gonna) (kill (him|her|them)sel(f|ves)|jump|end (his|her|their) life)\M(?! if\M)')
    OR t ~ ('\mi(''m| am|''ll| will)?( just)?( (going to|gonna|want to|wanna|about to|ready to))? end it' || clause_end)
    OR t ~ '\mi(''m| am|''ll| will)? (just )?(going to|gonna|about to) (take|swallow) (all of them|them all)\M'
    OR t ~ ('\mthis is my goodbye\M(?! (post|message|to (this|the) (group|app|forum|community|page)|to (facebook|social media|instagram|twitter|tiktok))\M)(?![^!?]{0,40}\m(leaving|log(ging)? off|deleting|break from)\M)')
    OR t ~ ('\m' || person || '( just)? (took|has taken|''s taken|swallowed|has swallowed|''s swallowed|ate) ' || big_amount || ' ' || drugs || '\M' || ailment)
    OR t ~ ('\m' || person || '( just)? (took|has taken|''s taken|swallowed|has swallowed|''s swallowed|ate) ' || all_amount || ' ' || drugs || '\M' || routine)
    OR t ~ '\mdejo de respirar\M'
    OR t ~ '\mno reacciona\M(?! (a|ante|cuando|con)\M)'
    OR t ~ '\mse (va a|quiere|piensa) (matar|suicidar|quitar la vida|tirar|aventar)\M(?! si\M)'
    OR t ~ '\m(isn''t|is not|''s not|aren''t) moving\M(?! (forward|on|out|in|away|fast|back|here|there|anywhere)\M)|\m(won''t|will not|can''t) move\M(?! (on|out|forward|in|back|away|here|there|his|her|it)\M)'
    OR t ~ ('\m' || person || '( is|''s| are|''re) (going to|gonna|about to|trying to) (kill|stab|shoot|strangle|hurt) (his|her|my|our|their) [a-z]+\M(?![^.!?]{0,30}\m(lol|lmao|haha|when|if|liver|career|chances|grades)\M)')
    OR t ~ '\mse puso (azul|morado|morada)\M|\m(creo que )?(mi )?[a-z]+ (esta) muert[oa]\M|\mestoy sangrando\M|\mi think i''m dying\M|\mi''m dying\M(?! (to|of|for|laughing|inside|here|lol|lmao|haha)\M)(?![^.!?]{0,6}\m(lol|lmao|haha)\M)'
    OR t ~ ('\m' || person || '( is|''s) (on|at) (the|a) (bridge|ledge|roof|overpass)\M(?![^.!?]{0,25}\m(driving|drive|car|traffic|commute|way|walking|fixing|working|hanging|lights|gutters)\M)')
    OR t ~ '\m(going to|gonna|about to|threatening to|threatens to|wants to) (shoot|kill|hang) (him|her|them)sel(f|ves)\M(?! (with|slowly)\M)|\m(drank|swallowed) (bleach|antifreeze|poison|rat poison)\M|\m(overdosed|od''d) (tonight|today|just now|right now|this morning)\M'
    OR t ~ '\mtuvo una sobredosis\M|\mintento (quitarse la vida|matarse|suicidarse)\M'
    OR t ~ '\mse (mato|ahorco|colgo|disparo|suicido)\M|\mencontre a (mi|su) [a-z]+ (muerto|muerta|colgado|colgada|inconsciente)\M|\mno se mueve\M'
    OR t ~ '\m(me|se) (corte|corto) (las venas|los brazos|las munecas|la muneca)\M'
    OR (t !~ '\m(scared|afraid|for all i know|imagine|assume|what if|every time|whenever|worry|worried|terrified|fear)\M' AND t ~ ('(\mi (think|found|just found) )?\m(my (son|daughter|husband|wife|boyfriend|girlfriend|partner|brother|sister|kid|child|baby)|he|she)( is|''s) dead\M(?! (to|inside|tired|set|serious|wrong|last|on|because|and i miss)\M)'))
    OR t ~ '\m(took|swallowed|ate|popped) ([5-9]|[0-9]{2,})( of)?( my| his| her)? (xanax|bars|xannies|percs|percocets|oxys?|oxycodone|vicodin|valium|klonopin|ativan|ambien|fentanyl|morphine)\M'
    OR t ~ '\m(se )?tomo (todas (sus|las) pastillas|un frasco( entero)?( de pastillas)?|demasiadas pastillas|muchas pastillas|un monton de pastillas|un punado de pastillas)\M'
    OR t ~ '(?<!mama )(?<!mami )(?<!papa )(?<!madre )(?<!padre )(?<!abuela )(?<!abuelo )(?<!abuelita )(?<!abuelito )(?<!suegra )(?<!suegro )\mse (esta|estan) muriendo\M(?! (de|por) (risa|verguenza|hambre|sueno|frio|calor|ganas|aburrimiento|cancer|una enfermedad|vejez|la droga|las drogas|el alcohol)\M)';
  -- Teaching / what-if talk ("if someone is not breathing, give Narcan") is
  -- left to the resources check.
  IF told_now AND t !~ hypothetical THEN
    RETURN CASE WHEN t ~ dated AND t !~ now_again THEN 'resources' ELSE 'told' END;
  END IF;

  -- ── 'resources': any other mention ──
  IF t ~ '(suicid|sobredosis|autolesi|self.?harm|matarse|quitarse la vida|quiere morir|wants? to die(?! (my|her|his|it|them) )|kill (him|her|them)sel(f|ves)|end (his|her|their) (own )?life|cutting (him|her|them)sel(f|ves)|(hung|hanged|shot) (him|her|them)sel|wrists|stopped breathing|unconscious|dejo de respirar|narcan|naloxone|seizure|convuls|vomit|noose|bleeding|sangrando|no pulse|foaming)'
    OR t ~ ('\moverdos[a-z]*\M' || od_figurative) OR t ~ ('\m(od|od''d|ods)\M' || od_figurative)
    OR t ~ '\mnot breathing\M(?! (on (his|her) own|well|right|properly|normally|a word|at night)\M)'
    OR t ~ '\mseizing\M(?! (every|the|an|this|on (the|every|any) (opportunity|chance|moment))\M)'
    OR t ~ '(?<!emotionally )\munresponsive\M(?! to (every|any|consequences?|treatment|medication|therapy|counseling|reason|anything (i|we)|my|our|us|me)\M)'
    OR t ~ '\m(988|911|cpr|ambulance|paramedics|gun|pistol|rifle|shotgun|knife|razor|cuchillo|pistola|arma)\M'
    OR t ~ '\m(bleach|bullet|brains out|slit (my|his|her) throat|walk into traffic|hang (myself|himself|herself)|ahorcar(me|se)?|colgar(me|se)|pegarme un tiro|dispararme|stabbed|shot (me|him|her))\M|\min front of (a|the) (train|car|bus|truck)\M'
    OR t ~ '\mnoose\M|\m(rope)\M[^.!?]{0,30}\m(neck|hang|tie|beam)\M'
    OR t ~ '\mshoot (him|her|them)sel(f|ves)\M|\m(threatening|threatened|threatens) to (shoot|kill|hang|hurt)\M'
    OR t ~ '\m(attacked|assaulted) (me|us)\M|\mgrabbed (me|us) by the (throat|neck|hair)\M|\m(threw|slammed|pushed|shoved) (me|us) (against|into)\M|\mdragged (me|us)\M|\mbroke my (nose|arm|jaw|ribs?|wrist|hand|finger)\M|\mme (ataco|agredio|ahorco)\M'
    OR t ~ '\mi(''m| am) (hiding|locked) in (the|my) (bathroom|closet|room|car|bedroom)\M'
    OR t ~ '\mi (just )?(took|swallowed) (them|it) all\M|\mi (just )?(took|swallowed) all of them\M|\m(rather die|rather be dead)\M|\mi can''t breathe\M(?! (when|around|in|with)\M)'
    OR t ~ '\m(raped|rape|violo|violada|sexually assaulted|molested)\M|\m(pushed|shoved|threw|kicked) (me|us) down\M(?! (the (list|road)))|\mthrowing [a-z]+ at (me|us)\M|\mlocked (me|us) in\M'
    OR t ~ '\m(want to|wanna) disappear( forever)?\M|\mwant it (all )?to end\M|\mmake it (all )?stop\M|\m(drink|drinking) (myself|himself|herself) to death\M|\mthinking about ending it\M'
    OR t ~ '\mme (quiere|va a) (pegar|golpear|matar)\M|\m(his|her|my) suicide note\M' OR t ~ ('\m(son|daughter|husband|wife|he|she)( is)? overdosing\M' || od_figurative)
    OR t ~ '\m(kill|hurt|harm|cut) myself\M(?! (some slack|slack|shaving|cooking|at the gym|working out|by accident|accidentally|lifting|on (a|the|my)|[a-z]+ing)\M)'
    -- Everything the 4.0 (2) screen refused gets at least a human look in 4.1.
    OR t ~ '\m(want to die|wanna die)\M(?! (my|her|his|it|them)\M)|\m(end my life|end it all|take my life|no reason to live|tired of living|done living|matarme|quitarme la vida|acabar con mi vida)\M'
    OR t ~ ('\m(took|swallowed) all (of )?(my|his|her|their) pills\M' || routine)
    OR t ~ ('\m(beat|beats|beating|punched|kicked|slapped|strangled) (me|us)\M' || not_violence)
    OR t ~ ('\m(choked|chokes|choking) (me|us)\M(?! up\M)' || not_violence)
    OR t ~ ('(?<!it just )(?<!it )(?<!reality just )(?<!reality )(?<!that )(?<!this )(?<!grief just )\m(hit|hits|hitting) (me|us)\M(?! up\M)' || not_violence)
    OR t ~ ('\m' || who || '\M[^.!?]{0,20}\mkill (me|us)\M') OR t ~ '\mthreatening (me|us)\M'
    OR t ~ '\m(me|nos) (pego|pega|golpeo|golpea|ahorco|amenazo|amenaza)\M|\mme va a matar\M' THEN
    RETURN 'resources';
  END IF;
  RETURN NULL;
END;
$$;

-- The whole screen: line breaks first count as sentence breaks; if the post
-- has line breaks, it is also read as one line ("i dont want to / live
-- anymore") and the stronger result wins.
CREATE OR REPLACE FUNCTION public._community_post_screen(p_body text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  a text := public._community_post_screen_core(public._community_screen_text(p_body, true));
  b text;
BEGIN
  IF a = 'firm' OR coalesce(p_body, '') !~ '[\r\n]' THEN
    RETURN a;
  END IF;
  b := public._community_post_screen_core(public._community_screen_text(p_body, false));
  RETURN CASE
    WHEN 'firm' IN (a, b) THEN 'firm'
    WHEN 'told' IN (a, b) THEN 'told'
    WHEN 'resources' IN (a, b) THEN 'resources'
    ELSE NULL
  END;
END;
$$;

-- What the 4.1 app and older callers see: 'block' | 'resources' | NULL.
CREATE OR REPLACE FUNCTION public._community_post_crisis(p_body text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE s WHEN 'firm' THEN 'block' WHEN 'told' THEN 'block' ELSE s END
  FROM (SELECT public._community_post_screen(p_body) AS s) x
$$;

REVOKE ALL ON FUNCTION public._community_screen_text(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._community_post_screen_core(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._community_post_screen(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._community_post_crisis(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._community_screen_text(text, boolean), public._community_post_screen_core(text),
  public._community_post_screen(text), public._community_post_crisis(text) TO service_role;

-- p_past: the author confirmed a refused post isn't happening right now (the
-- app offers this on the crisis sheet, after 988/911). It then posts with the
-- 988/911 note instead of being refused. App 4.1+ always sends it (false or
-- true). App 4.0 (2) sends only p_body (p_past NULL), has no such option and
-- never shows the 988/911 note after posting: it refuses exactly what it
-- refused before this migration, and posts the rest (with the admin check-in
-- whenever the new screen flags it).
DROP FUNCTION IF EXISTS public.create_community_post(text);
DROP FUNCTION IF EXISTS public.create_community_post(text, boolean);
CREATE OR REPLACE FUNCTION public.create_community_post(p_body text, p_past boolean DEFAULT NULL)
RETURNS public.community_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
  v_name    text;
  v_clean   text := btrim(p_body);
  v_detail  text;
  v_screen  text;
  v_post    community_posts;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;
  IF char_length(coalesce(v_clean, '')) = 0 THEN RAISE EXCEPTION 'empty'; END IF;
  -- Current danger is never posted to a peer feed unasked: refuse it and the
  -- app routes the author to 988/911 and her coach (docs/legal/crisis-protocol.md).
  v_detail := public._community_post_screen(left(v_clean, 500));
  v_screen := CASE WHEN v_detail IN ('firm', 'told') THEN 'block' ELSE v_detail END;
  IF p_past IS NULL THEN
    -- App 4.0 (2) has no "post it anyway": it refuses exactly what it always
    -- refused (its own screen, on the raw text), so no post is newly stuck.
    -- Everything the new screen flags still posts, with the admin check-in.
    IF lower(v_clean) ~ '(kill myself|killing myself|want to die|wanna die|end my life|end it all|suicide|suicidal|hurt myself|harm myself|overdosing|take my life|no reason to live|matarme|quitarme la vida|suicid|acabar con mi vida)' THEN
      RAISE EXCEPTION 'crisis_content';
    END IF;
    IF v_detail IN ('firm', 'told') THEN
      v_screen := 'resources';
    END IF;
  ELSIF v_screen = 'block' THEN
    IF p_past THEN
      v_screen := 'resources';
    ELSE
      RAISE EXCEPTION 'crisis_content';
    END IF;
  END IF;

  -- After the crisis screen, so someone in crisis always gets the crisis sheet.
  IF (SELECT count(*) FROM community_posts
      WHERE account_id = v_account AND created_at > now() - interval '1 hour') >= 10 THEN
    RAISE EXCEPTION 'rate_limited';
  END IF;

  SELECT first_name INTO v_name FROM accounts WHERE id = v_account;

  INSERT INTO community_posts (account_id, author_display, body, safety_resources)
  VALUES (
    v_account,
    coalesce(nullif(btrim(v_name), ''), 'A family member'),
    left(v_clean, 500),
    coalesce(v_screen = 'resources', false)
  )
  RETURNING * INTO v_post;

  -- Community posts have no model behind the screen: when one mentions
  -- suicide, an overdose or self-harm, an admin checks on the author.
  -- At most one alert per author per hour (the card lists every post).
  IF v_post.safety_resources THEN
    INSERT INTO push_outbox (account_id, kind, title, body, metadata, idempotency_key)
    SELECT a.id, 'admin_community_report', '🆘 Community post mentions a crisis',
           'A member''s post mentions suicide, an overdose or self-harm. Please check on them (Admin → Community).',
           jsonb_build_object('kind', 'admin_community_report', 'post_id', v_post.id, 'reason', 'crisis'),
           'community-crisis:' || a.id || ':' || v_account || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24')
    FROM accounts a
    JOIN auth.users u ON u.id = a.user_id
    WHERE lower(coalesce(u.email, '')) = ANY (admin_email_list())
      AND a.push_token IS NOT NULL
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;

  RETURN v_post;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_community_post(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_community_post(text, boolean) TO authenticated;
