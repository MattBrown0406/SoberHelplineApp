import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { getPushDestination } from '../src/lib/pushRouting';
import { entitlementsForAccountState } from '../src/lib/featureAccess';
import { freeTrialOffer, INTRO_ELIGIBLE, trialLabelKey } from '../src/lib/subscriptionTrial';
import { USAGE_TOOLS, toolUsageKey } from '../src/lib/toolUsageNames';
import { parseFamilyCallTakeaway } from '../src/lib/familyCallTakeaway';
import { COMMUNITY_FEED_VISIBLE } from '../src/lib/communityFeed';

const SESSION = '123e4567-e89b-42d3-a456-426614174222';
const ESSENTIAL = entitlementsForAccountState('direct-essential');

const followupSql = readFileSync('supabase/migrations/20261104100000_monday_call_followup.sql', 'utf8');
const usageSql = readFileSync('supabase/migrations/20261104120000_tool_usage_events.sql', 'utf8');

test('the Tuesday follow-up opens Today; the hour-before reminder opens the question sheet', () => {
  assert.deepEqual(getPushDestination({ kind: 'family_call_followup', meeting_date: '2026-11-09' }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 'session_reminder', session_id: SESSION, ask: 'question' }),
    { pathname: '/(tabs)/support', params: { sessionId: SESSION, ask: 'question' } });
  assert.deepEqual(getPushDestination({ kind: 'session_reminder', session_id: SESSION }),
    { pathname: '/(tabs)/support', params: { sessionId: SESSION } });
  assert.deepEqual(getPushDestination({ kind: 'session_reminder', session_id: SESSION, ask: 'anything' }),
    { pathname: '/(tabs)/support', params: { sessionId: SESSION } }, 'only ask=question is honored');
  assert.deepEqual(getPushDestination({ kind: 'session_reminder', ask: 'question' }), { pathname: '/(tabs)/support' },
    'no question sheet without a session');
});

test('the SQL producer enqueues exactly the routed follow-up kind and payload', () => {
  assert.match(followupSql, /jsonb_build_object\('kind', 'family_call_followup', 'meeting_date', v_meeting::text\)/);
  assert.match(followupSql, /'shl-family-call-followup', '10 8,9 \* \* 2'/);
  // Only the 1 AM Pacific Tuesday run enqueues, before the 2 AM RSVP reset.
  assert.match(followupSql, /extract\(isodow FROM v_local\) <> 2 OR extract\(hour FROM v_local\) <> 1/);
  assert.match(followupSql, /ON CONFLICT \(idempotency_key\) WHERE idempotency_key IS NOT NULL DO NOTHING/);
  // Delivery re-checks the reminder switch, language and her daytime.
  assert.match(followupSql, /WHEN 'family_call_followup' THEN[\s\S]*?family_call_reminders[\s\S]*?time '21:00'/);
  assert.match(followupSql, /WHEN 'admin_session_question' THEN/);
  // Unknown kinds still fail loudly.
  assert.match(followupSql, /RAISE EXCEPTION 'unsupported_push_kind: %',o\.kind;/);
});

test('questions are screened server-side and a crisis question alerts admins', () => {
  assert.match(followupSql, /NEW\.crisis_tier := public\._community_post_screen\(NEW\.question\);/);
  assert.match(followupSql, /BEFORE INSERT OR UPDATE OF question, crisis_tier ON public\.session_questions/);
  assert.match(followupSql, /'admin_session_question', '🆘 A question for Monday mentions a crisis'/);
  const support = readFileSync('app/(tabs)/support.tsx', 'utf8');
  assert.match(support, /\.select\('crisis_tier'\)\.single\(\)/);
  assert.match(support, /\{questionCrisis \? \([\s\S]*?<EmergencyActions prominent offline=\{questionCrisis === 'unsent'\} \/>/);
  // A failed send keeps her words for a retry with 911/988 on screen, never only an error alert.
  assert.match(support, /\} catch \{\n\s+if \(!current\(\)\) return;[\s\S]*?setQuestionCrisis\('unsent'\);/);
  // A reply after the sheet closed is ignored.
  assert.match(support, /questionSheetGeneration\.current \+= 1;/);
});

test('the hour-before reminder asks for a question only on builds that open the sheet', () => {
  const push = readFileSync('supabase/functions/send-engagement-push/index.ts', 'utf8');
  assert.match(push, /sessionReminderData\(target\.session_id, \{ askQuestion: !halfHour && asksQuestion\.has\(target\.account_id\) \}\)/);
  assert.match(push, /asksQuestion\.has\(target\.account_id\)\n\s+\? \(es \? "Empieza[^]*?Tap to send a question\."\)\n\s+: \(es \? "Tu grupo comienza[^]*?come as you are\."\)/);
  assert.match(push, /\.select\("id, push_app_contract"\)/);
  // The app tells the server it understands these pushes, with a fallback for an older backend.
  const hook = readFileSync('src/hooks/usePushNotifications.ts', 'utf8');
  assert.match(hook, /p_app_contract: PUSH_APP_CONTRACT/);
  assert.match(hook, /result\.error\?\.code === 'PGRST202'/);
  assert.match(followupSql, /WHEN coalesce\(s\.push_app_contract, 0\) >= 1 THEN/);
});

test('free trials show only when the store says she is eligible', () => {
  const week = { price: 0, cycles: 1, periodUnit: 'WEEK', periodNumberOfUnits: 1 };
  assert.deepEqual(freeTrialOffer(week, INTRO_ELIGIBLE), { unit: 'day', count: 7 });
  assert.deepEqual(freeTrialOffer({ ...week, periodUnit: 'DAY', periodNumberOfUnits: 7 }, INTRO_ELIGIBLE), { unit: 'day', count: 7 });
  assert.deepEqual(freeTrialOffer({ ...week, periodUnit: 'MONTH' }, INTRO_ELIGIBLE), { unit: 'month', count: 1 });
  assert.equal(freeTrialOffer(week, 1), null, 'ineligible (already used a trial)');
  assert.equal(freeTrialOffer(week, 0), null, 'unknown eligibility');
  assert.equal(freeTrialOffer(week, undefined), null);
  assert.equal(freeTrialOffer({ ...week, price: 0.99 }, INTRO_ELIGIBLE), null, 'a paid intro price is not a free trial');
  assert.equal(freeTrialOffer(null, INTRO_ELIGIBLE), null);
  assert.equal(freeTrialOffer({ ...week, periodUnit: 'YEAR' }, INTRO_ELIGIBLE), null);
  assert.deepEqual(trialLabelKey({ unit: 'day', count: 7 }), { key: 'paywall.trialDays', count: 7 });
});

test('members who already have a plan are never promised a trial', () => {
  const support = readFileSync('app/(tabs)/support.tsx', 'utf8');
  assert.match(support, /if \(!trial \|\| !subscriptionPrices\[tier\] \|\| entitlements\.canAccessGroups\) return null;/);
});

test('trial copy keeps the price and the cancel terms next to the trial', () => {
  for (const lang of ['en', 'es']) {
    const support = JSON.parse(readFileSync(`src/locales/${lang}/support.json`, 'utf8'));
    assert.match(support.paywall.trialThen, /\{\{trial\}\}[\s\S]*\{\{price\}\}/, lang);
    assert.match(support.paywall.startTrial, /\{\{price\}\}/, lang);
    assert.match(support.upgradeSheet.trialRenewalNote, /\{\{price\}\}[\s\S]*24/, lang);
  }
});

test('usage events: the client tool names are exactly the server allowlist, one per day', () => {
  const sqlList = /SELECT ARRAY\[([\s\S]*?)\]::text\[\]/.exec(usageSql)?.[1] ?? '';
  const serverTools = [...sqlList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...USAGE_TOOLS].sort(), serverTools);
  assert.equal(toolUsageKey('letter', 'opened', Date.parse('2026-11-04T01:00:00Z')),
    toolUsageKey('letter', 'opened', Date.parse('2026-11-04T23:59:00Z')));
  assert.notEqual(toolUsageKey('letter', 'opened', Date.parse('2026-11-04T23:59:00Z')),
    toolUsageKey('letter', 'opened', Date.parse('2026-11-05T00:01:00Z')));
  // The server keeps only the tool name.
  assert.match(usageSql, /v_metadata := jsonb_build_object\('tool', v_tool\);/);
  assert.match(usageSql, /RAISE EXCEPTION 'bad_tool'/);
});

test('every screen that records usage names an allowlisted tool', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith('.tsx')) files.push(path);
    }
  };
  walk('app');
  let uses = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:useToolOpened|logToolUsage)\('([a-z_]+)'/g)) {
      uses += 1;
      assert.ok((USAGE_TOOLS as readonly string[]).includes(m[1]), `${file}: ${m[1]}`);
    }
  }
  assert.ok(uses >= 26, `expected every tool screen to record usage (${uses})`);
});

test('this week\'s one thing: only a well-formed reply counts', () => {
  assert.deepEqual(parseFamilyCallTakeaway({ meeting_date: '2026-11-09', body: '  Hold one limit.  ' }),
    { meetingDate: '2026-11-09', body: 'Hold one limit.' });
  assert.equal(parseFamilyCallTakeaway(null), null);
  assert.equal(parseFamilyCallTakeaway({ meeting_date: '2026-11-09', body: '   ' }), null);
  assert.equal(parseFamilyCallTakeaway({ meeting_date: 'Monday', body: 'x' }), null);
  assert.equal(parseFamilyCallTakeaway({ meeting_date: '2026-11-09', body: 'x'.repeat(400) })?.body.length, 150);
});

test('Today leads with the Monday card, with the question link and this week\'s one thing', () => {
  const card = readFileSync('src/components/today/SituationCard.tsx', 'utf8');
  assert.match(card, /isFamilySquares && nextFreeCall\?\.rsvped && \(/);
  assert.match(card, /params: \{ sessionId: nextFreeCall\.id, ask: 'question' \}/);
  const today = readFileSync('app/(tabs)/index.tsx', 'utf8');
  // Matt's line is from the English call; Spanish members see their own practice.
  assert.match(today, /takeaway && !i18n\.language\.startsWith\('es'\)/);
});

test('the community feed is hidden everywhere it could be reached', () => {
  assert.equal(COMMUNITY_FEED_VISIBLE, false);
  assert.deepEqual(getPushDestination({ kind: 'community_support', post_id: SESSION }, { entitlements: ESSENTIAL }),
    { pathname: '/(tabs)/support' });
  const support = readFileSync('app/(tabs)/support.tsx', 'utf8');
  assert.match(support, /\{COMMUNITY_FEED_VISIBLE && \(\s*<TouchableOpacity[\s\S]*?router\.push\('\/community'\)/);
  assert.equal((support.match(/router\.push\('\/community'\)/g) ?? []).length, 1);
  const screen = readFileSync('app/community.tsx', 'utf8');
  assert.match(screen, /if \(!COMMUNITY_FEED_VISIBLE\) return <Redirect href="\/\(tabs\)\/support" \/>;/);
});
