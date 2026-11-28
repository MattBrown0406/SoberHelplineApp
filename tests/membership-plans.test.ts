import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { entitlementsForAccountState } from '../src/lib/featureAccess';
import {
  ESSENTIAL_BENEFITS,
  FREE_BENEFITS,
  PREMIER_BENEFITS,
  benefitKeys,
  benefitLines,
  benefitSummary,
  planForAccountState,
} from '../src/lib/membershipBenefits';
import {
  MEMBERSHIP_PATH_STAGES,
  PLAN_SOURCES,
  membershipPathMetadata,
  planSource,
  planTier,
  plansHref,
  purchasableTiers,
} from '../src/lib/membershipPath';
import { INVITATION_PLACEMENTS, invitationPlacementRows, placementLabel } from '../src/components/admin/invitationPlacements';
import {
  afterMeetingInviteReady,
  clearMeetingReturn,
  noteMeetingReturn,
  noteReviewCheck,
  subscribeAfterMeetingInvite,
} from '../src/lib/afterMeetingInvite';

const read = (path: string) => readFileSync(path, 'utf8');
const locale = (lang: string, ns: string) => JSON.parse(read(`src/locales/${lang}/${ns}.json`));
const FUNNEL_SQL = read('supabase/migrations/20261114130000_membership_path_funnel.sql');
const FOLLOWUP_SQL = read('supabase/migrations/20261114140000_family_squares_missed_followup.sql');

/** Every .ts/.tsx file under the app's own source. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) out.push(path);
    }
  };
  walk('app');
  walk('src');
  return out;
}

/** Every migration, oldest first. */
const MIGRATIONS = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: read(join('supabase/migrations', name)) }));
/** The text[] a SQL list helper returns, as the LATEST migration that defines it says. */
function sqlList(name: string): string[] {
  const pattern = new RegExp(`FUNCTION public\\.${name}\\(\\)[\\s\\S]*?SELECT ARRAY\\[([\\s\\S]*?)\\]::text\\[\\]`);
  let body = '';
  for (const { sql } of MIGRATIONS) body = pattern.exec(sql)?.[1] ?? body;
  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

// ── 12. The membership path ─────────────────────────────────────────────────

test('membership-path events carry a known source label and a tier, and nothing else', () => {
  assert.equal(planSource('after_meeting'), 'after_meeting');
  assert.equal(planSource('my son relapsed last night'), 'unknown');
  assert.equal(planSource(undefined), 'unknown');
  assert.equal(planSource(['chat_gate']), 'unknown');
  assert.equal(planTier('essential'), 'essential');
  assert.equal(planTier('premium'), 'premium');
  assert.equal(planTier('premier'), null, 'the code key is premium');
  assert.equal(planTier(undefined), null);
  assert.deepEqual(membershipPathMetadata({ source: 'chat_gate', tier: 'essential' }), { source: 'chat_gate', tier: 'essential' });
  assert.deepEqual(membershipPathMetadata({ source: 'chat_gate' }), { source: 'chat_gate' });
  assert.deepEqual(membershipPathMetadata({ source: 'someone@example.com', tier: 'gold' }), { source: 'unknown' });
  assert.deepEqual(
    membershipPathMetadata({ source: 'support_tab', tier: 'premium', email: 'a@b.c', note: 'private' } as never),
    { source: 'support_tab', tier: 'premium' },
    'extra fields never leave the device',
  );
  const funnel = read('src/lib/funnel.ts');
  assert.match(funnel, /export function logMembershipPath\(stage: MembershipPathStage, input: \{ source\?: unknown; tier\?: unknown \}\): void \{\s+logFunnelEvent\(stage, membershipPathMetadata\(input\)\);/);
});

test('the app and the server keep the same stages and the same source labels', () => {
  assert.deepEqual(sqlList('_membership_path_stages'), [...MEMBERSHIP_PATH_STAGES]);
  assert.deepEqual(sqlList('_membership_path_sources'), [...PLAN_SOURCES]);
  assert.equal(new Set(PLAN_SOURCES).size, PLAN_SOURCES.length);
  for (const source of PLAN_SOURCES) assert.match(source, /^[a-z_]{3,24}$/, `${source}: a short label`);
  // The server keeps only the source and the tier, and counts an invitation once a day.
  assert.match(FUNNEL_SQL, /ELSIF p_stage = ANY \(public\._membership_path_stages\(\)\) THEN/);
  assert.match(FUNNEL_SQL, /WHEN p_metadata ->> 'source' = ANY \(public\._membership_path_sources\(\)\) THEN p_metadata ->> 'source'\s+ELSE 'unknown'/);
  assert.match(FUNNEL_SQL, /v_metadata := jsonb_build_object\('source', v_source\);\s+IF p_metadata ->> 'tier' IN \('essential', 'premium'\) THEN/);
  assert.match(FUNNEL_SQL, /IF p_stage = 'membership_invite_shown' AND EXISTS \(/);
  for (const helper of ['_membership_path_stages', '_membership_path_sources']) {
    assert.match(FUNNEL_SQL, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${helper}\\(\\) FROM PUBLIC, anon, authenticated;`));
  }
  // Every stage is in the table constraint and in the function's allow-list.
  const constraint = /ADD CONSTRAINT funnel_events_stage_check\s+CHECK \(stage IN \(([\s\S]*?)\)\);/.exec(FUNNEL_SQL)?.[1] ?? '';
  const allowList = /IF p_stage NOT IN \(([\s\S]*?)\) THEN/.exec(FUNNEL_SQL)?.[1] ?? '';
  for (const stage of MEMBERSHIP_PATH_STAGES) {
    assert.match(constraint, new RegExp(`'${stage}'`), `${stage}: constraint`);
    assert.match(allowList, new RegExp(`'${stage}'`), `${stage}: allow-list`);
  }
});

test('each step is logged at the real moment, once', () => {
  const screen = read('app/plans.tsx');
  // Seen: once per visit to the plans screen.
  assert.match(screen, /const viewLogged = useRef\(false\);\s+useEffect\(\(\) => \{\s+if \(viewLogged\.current \|\| !user\) return;\s+viewLogged\.current = true;\s+logMembershipPath\('plans_viewed', \{ source \}\);/);
  assert.equal(screen.split("logMembershipPath('plans_viewed'").length - 1, 1);
  const purchase = read('src/hooks/usePlanPurchase.ts');
  assert.match(purchase, /setUpgradeOpen\(true\);\s+logMembershipPath\('plan_sheet_opened', \{ tier, source \}\);/);
  // Started just before the purchase call; the ending only for the session that started it.
  assert.match(purchase, /logMembershipPath\('purchase_started', \{ tier: upgradeTier, source \}\);\s+const result = upgradeTier === 'essential'\s+\? await purchaseEssential\(control\)\s+: await purchasePremium\(control\);[\s\S]*?const now = await afterPurchase\(\);\s+session = now\.session;\s+stillHers = now\.who !== 'different';[\s\S]*?if \(checked && !session && !stillHers\) return;\s+(\/\/[^\n]*\n\s+)+if \(\(session \|\| stillHers\) && result !== 'pending'\) \{\s+logMembershipPath\(\s+result === 'success' \? 'purchase_succeeded' : result === 'failed' \? 'purchase_failed' : 'purchase_cancelled',/);
  // One start, one ending: neither is logged anywhere else in the flow.
  assert.equal(purchase.split("logMembershipPath('purchase_started'").length - 1, 1);
  assert.equal(purchase.split("'purchase_cancelled',").length - 1, 1);
  // No other file logs a purchase or a plans view.
  for (const file of sourceFiles()) {
    if (file.endsWith(join('hooks', 'usePlanPurchase.ts')) || file.endsWith(join('app', 'plans.tsx')) || file.endsWith(join('lib', 'membershipPath.ts')) || file.endsWith(join('lib', 'funnel.ts'))) continue;
    assert.doesNotMatch(read(file), /log(MembershipPath|FunnelEvent)\(\s*'(plans_viewed|plan_sheet_opened|purchase_started|purchase_succeeded|purchase_cancelled|purchase_failed)'/, file);
  }
  const row = read('src/components/plans/LockedPreviewRow.tsx');
  assert.match(row, /if \(logged\.current\) return;\s+logged\.current = true;\s+logMembershipPath\('membership_invite_shown', \{ source \}\);/);
  assert.match(row, /logMembershipPath\('membership_invite_tapped', \{ source \}\);\s+router\.push\(plansHref\(source\)\);/);
});

test('the admin screen shows the membership path for the last 30 days', () => {
  assert.match(FUNNEL_SQL, /'membership_path_30d', \(SELECT jsonb_object_agg\(s\.stage, \(\s+SELECT count\(DISTINCT e\.account_id\)/);
  assert.match(FUNNEL_SQL, /AND e\.created_at >= now\(\) - interval '30 days'\s+AND NOT public\._dispatcher_admin\(e\.account_id\)/);
  assert.match(FUNNEL_SQL, /FROM unnest\(public\._membership_path_stages\(\)\) AS s\(stage\)\)/);
  const admin = read('app/admin.tsx');
  assert.match(admin, /membership_path_30d\?: Partial<Record<MembershipPathStage, number>>;/);
  // Against an older backend the block is simply not shown.
  assert.match(admin, /\{funnel\.membership_path_30d \? \(/);
  for (const stage of MEMBERSHIP_PATH_STAGES) assert.match(admin, new RegExp(`funnel\\.membership_path_30d\\.${stage} \\?\\? 0`), stage);
});

// ── 13. One plans screen ────────────────────────────────────────────────────

test('plansHref opens the plans screen with the source and, when named, the plan', () => {
  assert.deepEqual(plansHref('chat_gate'), { pathname: '/plans', params: { source: 'chat_gate' } });
  assert.deepEqual(plansHref('support_upgrade', 'premium'), { pathname: '/plans', params: { source: 'support_upgrade', tier: 'premium' } });
  assert.deepEqual(purchasableTiers('direct-free'), ['essential', 'premium']);
  assert.deepEqual(purchasableTiers('direct-essential'), ['premium'], 'an Essential member is never sold Essential again');
  assert.deepEqual(purchasableTiers('direct-premium'), []);
  assert.deepEqual(purchasableTiers('attached'), [], 'a provider-covered member has nothing to buy');
  assert.deepEqual(purchasableTiers(undefined), []);
});

test('the plans screen shows the plans, opens the sheet, and carries restore, the disclosure and the legal links', () => {
  const screen = read('app/plans.tsx');
  assert.match(screen, /const source = planSource\(params\.source\);/);
  assert.match(screen, /const requestedTier = planTier\(params\.tier\);/);
  assert.match(screen, /if \(!purchasableTiers\(accountState\)\.includes\(requestedTier\)\) return;/);
  // A named plan's sheet opens a beat after the screen arrives, never on mount
  // (iOS can drop a sheet presented during the push or a closing alert).
  assert.match(screen, /sheetTimer\.current = setTimeout\(\(\) => \{\s+sheetTimer\.current = null;[\s\S]*?if \(!sheetShowing\.current\) openUpgradeRef\.current\(requestedTier\);\s+\}, SHEET_SETTLE_MS\);/);
  assert.match(screen, /<UpgradeSheet\s+key=\{plan\.sheetAttempt\}/);
  // No leaving while the App Store has not answered a purchase.
  assert.match(screen, /<Stack\.Screen options=\{\{ gestureEnabled: !purchaseInFlight \}\} \/>/);
  assert.match(screen, /BackHandler\.addEventListener\('hardwareBackPress', \(\) => true\)/);
  assert.match(screen, /closeDisabled=\{purchaseInFlight\}/);
  assert.match(screen, /accessibilityLabel=\{t\('common:a11y\.back'\)\}\s+accessibilityState=\{\{ disabled: purchaseInFlight \}\}\s+disabled=\{purchaseInFlight\}/);
  const upgradeSheet = read('src/components/plans/UpgradeSheet.tsx');
  assert.match(upgradeSheet, /const close = \(\) => \{ if \(!closeDisabled\) onClose\(\); \};/);
  assert.match(upgradeSheet, /onRequestClose=\{close\}/);
  assert.doesNotMatch(upgradeSheet, /onPress=\{onClose\}|onRequestClose=\{onClose\}/);
  assert.match(screen, /<UpgradeSheet[\s\S]*?onPurchase=\{\(\) => void plan\.handlePurchase\(\)\}/);
  assert.match(screen, /<PlansCard[\s\S]*?onChoose=\{plan\.openUpgrade\}[\s\S]*?onRestore=\{\(\) => void handleRestore\(\)\}/);
  assert.match(screen, /accessibilityRole="button"\s+accessibilityLabel=\{t\('common:a11y\.back'\)\}/);
  const card = read('src/components/plans/PlansCard.tsx');
  assert.match(card, /t\('paywall\.autoRenewDisclosure', \{/);
  assert.match(card, /t\('paywall\.trialDisclosure'\)/);
  assert.match(card, /Linking\.openURL\(TERMS_OF_USE_URL\)/);
  assert.match(card, /Linking\.openURL\(PRIVACY_POLICY_URL\)/);
  assert.match(card, /tPlans\('restore\.button'\)/);
  // The existing trial logic is kept: shown only when StoreKit says she is eligible.
  assert.match(card, /const trial = trialLabel\(tier\);/);
  assert.match(card, /t\('paywall\.startTrial', \{ trial, price \}\)/);
  // The purchase flow exists once: the hook. No screen starts a purchase itself.
  for (const file of sourceFiles()) {
    if (file.endsWith(join('hooks', 'usePlanPurchase.ts')) || file.endsWith(join('hooks', 'useIAP.ts')) || file.endsWith(join('lib', 'revenueCat.ts'))) continue;
    assert.doesNotMatch(read(file), /purchaseEssential\(\)|purchasePremium\(\)|purchaseRevenueCatPackage\(|Purchases\.purchasePackage\(/, `${file} must not buy on its own`);
  }
  assert.doesNotMatch(read('app/(tabs)/support.tsx'), /UpgradeSheet|handlePurchase|openUpgrade/);
  // The Support tab keeps a compact plans card that opens the screen.
  assert.match(read('app/(tabs)/support.tsx'), /<PlansTeaserCard offers=\{planOffers\} source="support_tab" \/>/);
  assert.match(read('src/components/plans/PlansTeaserCard.tsx'), /onPress=\{\(\) => router\.push\(plansHref\(source\)\)\}/);
});

test('every "see plans" or "upgrade" entry point opens the plans screen and says where she came from', () => {
  const expected: Array<[string, RegExp]> = [
    ['src/components/ui/FreeTierPaywall.tsx', /router\.push\(plansHref\(from\)\)/],
    ['app/chat.tsx', /router\.push\(plansHref\('chat_gate'\)\)/],
    ['app/crisis-mode.tsx', /router\.push\(plansHref\('crisis_command_plan', tier === 'Premier' \? 'premium' : 'essential'\)\)/],
    ['app/crisis-mode.tsx', /onUpgrade=\{\(\) => router\.push\(plansHref\('crisis_plan_review', 'premium'\)\)\}/],
    ['app/crisis-mode.tsx', /onPress=\{\(\) => router\.push\(plansHref\('crisis_plan_review'\)\)\}/],
    ['app/(tabs)/learn.tsx', /router\.push\(plansHref\('learn_library'\)\)/],
    ['app/trajectory.tsx', /router\.push\(plansHref\('tracker_share'\)\)/],
    ['app/membership-guide.tsx', /router\.push\(plansHref\('membership_guide'\)\)/],
    ['src/membershipInvitations/ContextualMembershipInvitation.tsx', /router\.push\(plansHref\(source\)\)/],
    ['app/invitation-engine.tsx', /<FreeTierPaywall inline source="invitation_engine" \/>/],
    ['app/invitation-setup.tsx', /<FreeTierPaywall inline source="invitation_setup" \/>/],
    ['app/diy-intervention-planner.tsx', /<FreeTierPaywall inline source="diy_planner" \/>/],
    // Today's "Explore membership" is the plans teaser (an invitation), not the lock card.
    ['app/(tabs)/index.tsx', /<PlansTeaserCard offers=\{offers\} source="today_membership" \/>/],
    // The Support tab's plan card and groups card (their own files since 4.4).
    ['src/components/support/MemberPlanCard.tsx', /router\.push\(plansHref\('support_upgrade', 'premium'\)\)/],
    ['src/components/support/SupportGroupsCard.tsx', /router\.push\(plansHref\('support_groups', 'essential'\)\)/],
  ];
  for (const [file, pattern] of expected) assert.match(read(file), pattern, file);
  // Both chat gates, both plan-review cards, both group buttons.
  assert.equal(read('app/chat.tsx').split("plansHref('chat_gate')").length - 1, 2);
  assert.equal(read('app/crisis-mode.tsx').split("plansHref('crisis_plan_review', 'premium')").length - 1, 2);
  // 4.4: the group buttons share one "See plans" button for a free member.
  const groups = read('src/components/support/SupportGroupsCard.tsx');
  assert.equal(groups.split("plansHref('support_groups', 'essential')").length - 1, 1);
  assert.match(groups, /\) : !hasMembershipAccess && \(isLive \|\| room\) \? \(\s+<TouchableOpacity[\s\S]{0,400}plansHref\('support_groups', 'essential'\)/);
  // Nothing sends her to the top of the Support tab to find the plans any more:
  // every remaining push to Support is a real trip to Support.
  const allowed = new Set([
    'app/plans.tsx', 'app/chat.tsx', 'app/book-coaching.tsx', 'app/personal-reminders.tsx', 'app/community.tsx',
    'app/(tabs)/learn.tsx', 'app/diy-intervention-planner.tsx', 'src/components/today/SituationCard.tsx',
    'src/lib/pushRouting.ts', 'src/lib/familySquaresJoin.ts', 'src/lib/checkInFeedback.ts', 'src/lib/recoveryPathway.ts',
    'src/lib/caregiverCheckIn.ts', 'src/lib/guidedStart.ts',
  ]);
  for (const file of sourceFiles()) {
    if (read(file).includes("'/(tabs)/support'")) assert.ok(allowed.has(file), `${file} points at the Support tab`);
  }
  for (const gate of ['app/chat.tsx', 'app/(tabs)/learn.tsx']) {
    assert.doesNotMatch(read(gate), /router\.push\('\/\(tabs\)\/support'( as never)?\)/, gate);
  }
  // Every label is used, and every label used is on the list (also the server's list).
  const used = new Set<string>();
  for (const file of sourceFiles()) {
    if (file.endsWith(join('lib', 'membershipPath.ts'))) continue;
    const source = read(file);
    for (const m of source.matchAll(/plansHref\('([a-z_]+)'/g)) used.add(m[1]);
    for (const m of source.matchAll(/<(?:FreeTierPaywall|LockedPreviewRow|PlansTeaserCard)[^>]*?source="([a-z_]+)"/g)) used.add(m[1]);
    for (const m of source.matchAll(/'(?:practice-completed|boundary-saved|after-meeting|tool-finished|checkin-week)': '([a-z_]+)'/g)) used.add(m[1]);
    for (const m of source.matchAll(/\? '(rehearsal_gate)' : '(feature_gate)'/g)) { used.add(m[1]); used.add(m[2]); }
  }
  // Labels no screen uses any more stay on the list so past events keep their name.
  const retired = ['today_locked_preview']; // 4.4: the locked row left Today
  for (const label of retired) assert.ok(!used.has(label), `${label} is retired`);
  assert.deepEqual([...used, ...retired].sort(), [...PLAN_SOURCES].sort());
});

test('inside the app nothing sends her to the website to buy, and no price is written into copy', () => {
  for (const lang of ['en', 'es']) {
    const raw = read(`src/locales/${lang}/plans.json`);
    assert.doesNotMatch(raw, /soberhelpline|ayudasobria|\.com|website|sitio web|página web|PayPal|[$€£]\s?\d|\d+[.,]\d{2}/i, `${lang}: plans.json`);
    assert.doesNotMatch(raw, /annual|yearly|per year|anual|al año/i, `${lang}: plans are monthly only`);
    assert.doesNotMatch(raw, /!|¡/, `${lang}: no exclamation marks`);
  }
  for (const file of ['app/plans.tsx', 'src/components/plans/PlansCard.tsx', 'src/components/plans/UpgradeSheet.tsx',
    'src/components/plans/PlansTeaserCard.tsx', 'src/components/plans/LockedPreviewRow.tsx', 'src/components/plans/BenefitList.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /openWithSSO|websiteUrl|WEBSITE_PATHS|soberhelpline\.com\/(?!app-terms|privacy)|\$\d/, file);
    // No hard-coded words on screen: every <Text> shows a translation, a store value or a symbol.
    for (const text of source.match(/<Text[^>]*>[^<{]*[A-Za-z]{3,}[^<{]*<\/Text>/g) ?? []) assert.fail(`${file}: hard-coded text ${text}`);
  }
});

test('the plans screen leads with a plan she can buy, and its button sits under the price and first benefits', () => {
  const card = read('src/components/plans/PlansCard.tsx');
  // A plan she can buy comes first (Essential for a free member, Premier for an Essential member).
  assert.match(card, /const order: SubscriptionTier\[\] = \[\.\.\.canBuy, \.\.\.\(\['essential', 'premium'\] as const\)\.filter\(\(tier\) => !canBuy\.includes\(tier\)\)\];/);
  assert.match(card, /const lead = tier === order\[0\];/);
  // Paid plans, then Free ("Your plan" for a free member), then the notes and legal lines.
  const at = ['{order.map(paidPlan)}', "t('tier.freeName')", "tPlans('notEmergency')", "t('paywall.autoRenewDisclosure'", 'TERMS_OF_USE_URL)', 'PRIVACY_POLICY_URL)', "tPlans('restore.button')"]
    .map((piece) => card.lastIndexOf(piece));
  assert.ok(at.every((index) => index >= 0));
  assert.deepEqual(at, [...at].sort((a, b) => a - b), 'plans card order');
  // Inside a paid plan: name and price, the trial line, the first few benefits,
  // the button, then the rest of the same list. Nothing is left out.
  const plan = card.slice(card.indexOf('const paidPlan ='), card.indexOf('return (\n    <View>\n      {current'));
  const inside = ['t(`tier.${tier}Name`)', 'priceLine(tier)', "t('paywall.trialThen'", '<BenefitList plan={plan} limit={TOP_BENEFITS} />', 'onPress={() => onChoose(tier)}', "tPlans('headings.more')", '<BenefitList plan={plan} skip={TOP_BENEFITS} />']
    .map((piece) => plan.indexOf(piece));
  assert.ok(inside.every((index) => index >= 0), 'paid plan pieces');
  assert.deepEqual(inside, [...inside].sort((a, b) => a - b), 'paid plan order');
  assert.match(card, /const TOP_BENEFITS = 4;/);
  assert.match(card, /const hasMore = benefitKeys\(plan, i18n\.language\)\.length > TOP_BENEFITS;/);
  // The list component: `skip` drops the first few, `limit` keeps the first few of what is left.
  assert.match(read('src/components/plans/BenefitList.tsx'), /const lines = benefitLines\(plan, t as never, i18n\.language\)\.slice\(skip\);/);
  for (const lang of ['en', 'es']) assert.ok(JSON.parse(read(`src/locales/${lang}/plans.json`)).headings.more, `${lang}: headings.more`);
});

test('Today invites a free member to look at membership with the plans teaser, never the lock card', () => {
  const today = read('app/(tabs)/index.tsx');
  assert.doesNotMatch(today, /FreeTierPaywall/);
  // Only in the free Today.
  const free = today.slice(today.indexOf('if (!canAccessFullToday) {'), today.indexOf("\n  return (\n    <ScreenContainer backgroundColor={colors.cream} scrollRef={scrollRef}>", today.indexOf('if (!canAccessFullToday) {')));
  assert.match(free, /<TodayDisclosure title=\{t\('disclosure\.membership'\)\}>\s+<ExploreMembership \/>\s+<\/TodayDisclosure>/);
  assert.equal(today.split('<ExploreMembership').length - 1, 1);
  assert.equal(today.split("t('disclosure.membership')").length - 1, 1);
  // The store is read inside the section (mounted when she opens it), and the price is the store's.
  assert.match(today, /function ExploreMembership\(\) \{\s+const offers = usePlanOffers\(\);\s+return <PlansTeaserCard offers=\{offers\} source="today_membership" \/>;\s+\}/);
  assert.equal(today.split('usePlanOffers()').length - 1, 1);
  const teaser = read('src/components/plans/PlansTeaserCard.tsx');
  assert.match(teaser, /\{price \? tPlans\('perMonth', \{ price \}\) : tPlans\('priceUnavailable'\)\}/);
});

// ── 14. One benefits list ───────────────────────────────────────────────────

test('every benefit listed is true according to featureAccess', () => {
  const free = entitlementsForAccountState('direct-free');
  const essential = entitlementsForAccountState('direct-essential');
  const premier = entitlementsForAccountState('direct-premium');
  for (const { key, entitlement } of FREE_BENEFITS) assert.equal(free[entitlement], true, `free: ${key}`);
  for (const { key, entitlement } of ESSENTIAL_BENEFITS) {
    assert.equal(free[entitlement], false, `${key} must not already be free`);
    assert.equal(essential[entitlement], true, `${key} must come with Essential`);
    assert.equal(premier[entitlement], true, `${key} must come with Premier too`);
  }
  for (const { key, entitlement } of PREMIER_BENEFITS) {
    assert.equal(essential[entitlement], false, `${key} must not already come with Essential`);
    assert.equal(premier[entitlement], true, `${key} must come with Premier`);
  }
  // Coach messaging leads; phone calls are not promised (no screen uses canCallCoach).
  assert.equal(ESSENTIAL_BENEFITS[0].key, 'coachMessaging');
  const app = sourceFiles().filter((file) => !file.endsWith(join('lib', 'featureAccess.ts'))
    && !file.endsWith(join('lib', 'offlineAccountCache.ts')) && !file.endsWith(join('api', 'types.ts'))
    && !file.endsWith(join('lib', 'membershipBenefits.ts')));
  const usesCallCoach = app.some((file) => /canCallCoach/.test(read(file)));
  for (const lang of ['en', 'es']) {
    const premierLines = Object.values(locale(lang, 'plans').benefits.premier).join(' ');
    if (!usesCallCoach) assert.doesNotMatch(premierLines, /phone|llamadas? telef/i, `${lang}: no phone calls promised`);
  }
  // The library and recordings are member pages exactly as Learn decides it.
  const learn = read('app/(tabs)/learn.tsx');
  assert.match(learn, /\{entitlements\.canAccessGroups \|\| spanish \? sections\.map/);
  assert.equal(ESSENTIAL_BENEFITS.find((benefit) => benefit.key === 'library')?.entitlement, 'canAccessGroups');
  // The member coaching rate follows coach messaging.
  assert.match(read('src/lib/coachingPrice.ts'), /return !!entitlements\?\.canMessageOnCallCoach;/);
});

test('the locale files hold the one ordered list, in both languages', () => {
  for (const lang of ['en', 'es']) {
    const benefits = locale(lang, 'plans').benefits;
    assert.deepEqual(Object.keys(benefits.free), FREE_BENEFITS.map((benefit) => benefit.key), `${lang}: free order`);
    assert.deepEqual(Object.keys(benefits.essential), ESSENTIAL_BENEFITS.map((benefit) => benefit.key), `${lang}: Essential order`);
    assert.deepEqual(Object.keys(benefits.premier), PREMIER_BENEFITS.map((benefit) => benefit.key), `${lang}: Premier order`);
    for (const line of [...Object.values(benefits.free), ...Object.values(benefits.essential), ...Object.values(benefits.premier)] as string[]) {
      assert.ok(line.length >= 10 && line.length <= 80, `${lang}: "${line}" is one short line`);
      assert.doesNotMatch(line, /[!¡]|\{\{|\$/, `${lang}: "${line}"`);
      assert.doesNotMatch(line, /\b(unlimited|ilimitad|24\/7|best|amazing|guarantee)/i, `${lang}: "${line}" promises too much`);
    }
    // The member rate is named without a number.
    assert.doesNotMatch(benefits.essential.memberRate, /\d/);
    // Spanish-language members attend La Sobremesa and never see Family Squares (audit round 3, L11).
    assert.match(benefits.free.familySquares, lang === 'es' ? /La Sobremesa/ : /Family Squares/);
    if (lang === 'es') assert.doesNotMatch(benefits.free.familySquares, /Family Squares/);
    assert.match(benefits.essential.library, /Family Squares/);
  }
  const t = (key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], locale('en', 'plans')) as string;
  assert.deepEqual(benefitLines('essential', t, 'en').slice(0, 2), ['Message a coach between meetings', 'Live groups with other families']);
  assert.equal(benefitLines('essential', t, 'en').length, ESSENTIAL_BENEFITS.length);
  // In Spanish the library is public and La Sobremesa is not recorded: not sold as a benefit.
  assert.ok(benefitKeys('essential', 'en').includes('library'));
  assert.ok(!benefitKeys('essential', 'es-MX').includes('library'));
  assert.equal(benefitKeys('essential', 'es').length, ESSENTIAL_BENEFITS.length - 1);
  assert.equal(benefitKeys('essential', null).length, ESSENTIAL_BENEFITS.length);
  assert.equal(
    benefitSummary('essential', t, 'en'),
    'Message a coach between meetings · Live groups with other families · Conversation rehearsal with a simulated partner',
  );
  assert.equal(
    benefitSummary('premier', t, 'en'),
    'Everything in Essential · Private video with a coach, subject to scheduling · Plan review included · The Family Command Plan',
  );
  assert.equal(planForAccountState('direct-free'), 'free');
  assert.equal(planForAccountState('direct-essential'), 'essential');
  assert.equal(planForAccountState('direct-premium'), 'premier');
  assert.equal(planForAccountState('attached'), 'covered');
});

test('every place that describes a plan reads the one list', () => {
  for (const file of ['src/components/plans/PlansCard.tsx', 'src/components/plans/UpgradeSheet.tsx', 'src/components/plans/PlansTeaserCard.tsx',
    'src/components/ui/FreeTierPaywall.tsx', 'app/membership-guide.tsx', 'src/components/support/MembershipGuideCard.tsx']) {
    assert.match(read(file), /<BenefitList plan=/, file);
  }
  assert.match(read('app/settings.tsx'), /benefitSummary\(accountState === 'direct-premium' \? 'premier' : 'essential', tPlans, i18n\.language\)/);
  assert.match(read('src/components/support/MemberPlanCard.tsx'), /benefitSummary\(accountState === 'direct-premium' \? 'premier' : 'essential', tPlans as never, current\)/);
  // The four older descriptions are gone, in both languages.
  for (const lang of ['en', 'es']) {
    const settings = locale(lang, 'settings').membership;
    assert.equal(settings.essentialFeatures, undefined);
    assert.equal(settings.premiumFeatures, undefined);
    const support = locale(lang, 'support');
    for (const key of ['freeFeatures', 'essentialFeatures', 'premiumFeatures']) assert.equal(support.tier[key], undefined, `${lang}: tier.${key}`);
    for (const key of ['heading', 'body', 'viewPlans']) assert.equal(support.paywall[key], undefined, `${lang}: paywall.${key}`);
    for (const key of ['feature1', 'feature2', 'feature3', 'featuresHeader']) assert.equal(support.upgradeSheet[key], undefined, `${lang}: upgradeSheet.${key}`);
  }
  const wallet = read('src/content/walletMembershipCopy.ts');
  assert.doesNotMatch(wallet, /\bessential: '|\bpremier: '/);
  // No screen still asks for one of them.
  for (const file of sourceFiles()) {
    assert.doesNotMatch(read(file), /tier\.(essential|premium|free)Features|membership\.(essential|premium)Features|\bt\('paywall\.(heading|body)'\)|copy\.(essential|premier)\b/, file);
  }
});

// ── 15a. After Family Squares ───────────────────────────────────────────────

test('the after-meeting moment waits for the rating-prompt check and never shares a visit with the prompt', () => {
  clearMeetingReturn();
  let changes = 0;
  const unsubscribe = subscribeAfterMeetingInvite(() => { changes += 1; });
  assert.equal(afterMeetingInviteReady('a'), false);
  // A check from an earlier visit says nothing about this one: leaving the foreground forgets it.
  noteReviewCheck('a', 'none');
  assert.equal(afterMeetingInviteReady('a'), false);
  clearMeetingReturn();
  noteMeetingReturn('a');
  assert.equal(afterMeetingInviteReady('a'), false, 'not until the rating-prompt check has answered');
  noteReviewCheck('b', 'none');
  assert.equal(afterMeetingInviteReady('a'), false, 'another account\'s check does not count');
  noteReviewCheck('a', 'none');
  assert.equal(afterMeetingInviteReady('a'), true);
  assert.equal(afterMeetingInviteReady('b'), false);
  assert.equal(afterMeetingInviteReady(null), false);
  assert.ok(changes >= 2, 'Today hears about it');
  // It lasts for the visit only.
  clearMeetingReturn();
  assert.equal(afterMeetingInviteReady('a'), false);

  for (const outcome of ['not_eligible', 'unavailable'] as const) {
    noteMeetingReturn('a'); noteReviewCheck('a', outcome);
    assert.equal(afterMeetingInviteReady('a'), true, outcome);
    clearMeetingReturn();
  }
  // The two happen about a second apart, in either order. The check answering FIRST on this visit
  // used to leave the moment waiting for the whole visit.
  for (const outcome of ['none', 'not_eligible', 'unavailable'] as const) {
    noteReviewCheck('a', outcome); noteMeetingReturn('a');
    assert.equal(afterMeetingInviteReady('a'), true, `${outcome} before the return`);
    clearMeetingReturn();
  }
  for (const outcome of ['requested', 'failed'] as const) {
    noteReviewCheck('a', outcome);
    // A later clear check on the same visit does not undo a prompt that may have shown.
    noteReviewCheck('a', 'none');
    noteMeetingReturn('a');
    assert.equal(afterMeetingInviteReady('a'), false, `${outcome} before the return: never beside the prompt`);
    clearMeetingReturn();
  }
  // Another account's earlier check does not count for her.
  noteReviewCheck('b', 'none'); noteMeetingReturn('a');
  assert.equal(afterMeetingInviteReady('a'), false);
  noteReviewCheck('a', 'none');
  assert.equal(afterMeetingInviteReady('a'), true);
  clearMeetingReturn();
  // The rating prompt was requested (or a failed check may have shown it): no invitation, even if a later check is clear.
  for (const outcome of ['requested', 'failed'] as const) {
    noteMeetingReturn('a'); noteReviewCheck('a', outcome);
    assert.equal(afterMeetingInviteReady('a'), false, outcome);
    noteReviewCheck('a', 'none');
    assert.equal(afterMeetingInviteReady('a'), false, `${outcome}: stays skipped for the visit`);
    clearMeetingReturn();
  }
  unsubscribe();
});

test('meeting return offers a private reflection instead of a membership ask', () => {
  const today = read('app/(tabs)/index.tsx');
  assert.doesNotMatch(today, /placement="after-meeting"|useAfterMeetingInvite/);
  assert.equal((today.match(/<MondayReflection/g) ?? []).length, 2);
  assert.match(read('src/components/familySquares/MondayReflection.tsx'), /monday_save_reflection/);
  assert.match(read('src/lib/reviewPrompt.ts'), /support_call_attended.*not_eligible/);
});

// ── 15c. Two more moments (4.4) ─────────────────────────────────────────────

test('the server learns the two new labels in one migration that changes nothing else', () => {
  const sql = read('supabase/migrations/20261124110000_membership_invite_placements.sql');
  const code = sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
  // Only the source list is redefined, and it stays locked away from clients.
  assert.deepEqual([...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]), ['_membership_path_sources']);
  assert.doesNotMatch(code, /ALTER TABLE|CREATE TABLE|DROP |log_funnel_event|admin_funnel_stats|_membership_path_stages/);
  assert.match(code, /REVOKE EXECUTE ON FUNCTION public\._membership_path_sources\(\) FROM PUBLIC, anon, authenticated;/);
  // Every label from before is still there, plus the two new ones.
  const before = (/FUNCTION public\._membership_path_sources\(\)[\s\S]*?SELECT ARRAY\[([\s\S]*?)\]::text\[\]/.exec(FUNNEL_SQL)?.[1] ?? '').match(/'[a-z_]+'/g) ?? ([] as string[]);
  const after = sqlList('_membership_path_sources');
  for (const label of before) assert.ok(after.includes(label.slice(1, -1)), label);
  assert.deepEqual(after.filter((label) => !before.includes(`'${label}'`)).sort(), ['checkin_week', 'tool_finished']);
});

test('the invitation names only what Essential really adds, never a price or the website', () => {
  const essential = ESSENTIAL_BENEFITS.map((benefit) => benefit.key);
  // tool-finished names coach messaging; checkin-week names the week in review and progress on Today.
  assert.ok(essential.includes('coachMessaging') && essential.includes('todayFull'));
  const en = locale('en', 'plans');
  assert.match(en.invite.toolFinished, /message a coach between meetings/);
  assert.match(en.benefits.essential.coachMessaging, /Message a coach between meetings/);
  assert.match(en.invite.checkinWeek, /week in review and their progress here on Today/);
  assert.match(en.benefits.essential.todayFull, /week in review and progress on Today/);
  for (const lang of ['en', 'es']) {
    const invite = locale(lang, 'plans').invite;
    for (const key of ['toolFinished', 'checkinWeekTitle', 'checkinWeek', 'trial']) {
      assert.doesNotMatch(invite[key], /[!¡$€£]|\d|soberhelpline|website|sitio web|today only|solo hoy|hurry|don't miss|no te lo pierdas/i, `${lang}: invite.${key}`);
    }
    // The trial line names only the trial the store gives (interpolated), nothing more.
    assert.match(invite.trial, /^Essential .*\{\{trial\}\}\.$/);
  }
});

test('tool-finished sits where each free tool already logs its finish, and the check-in moment is the fifth day', () => {
  for (const [file, tool] of [['app/holiday-plan.tsx', 'holiday_plan'], ['app/prosecutor-letter.tsx', 'prosecutor_letter']] as const) {
    const screen = read(file);
    assert.match(screen, new RegExp(`logToolUsage\\('${tool}', 'finished'\\);\\s+setFinishedHere\\(true\\);`), file);
    assert.match(screen, /sawIncomplete\.current = true;\s+setFinishedHere\(false\);/, file);
    assert.match(screen, /<ContextualMembershipInvitation accountId=\{user\?\.id \?\? null\} placement="tool-finished" completed=\{finishedHere\} \/>/, file);
    assert.equal(screen.split('<ContextualMembershipInvitation').length - 1, 1, file);
  }
  const letter = read('app/letter.tsx');
  // After the rating-prompt check has answered: never on the same visit as a requested prompt.
  assert.match(letter, /await updateDraft\(\{ status: 'complete' \}\);\s+logToolUsage\('letter', 'finished'\);[\s\S]*?void maybeRequestReview\(\{[\s\S]*?\}\)\.then\(\(\) => \{\s+if \(accountIdRef\.current === user\.id\) setFinishedHere\(true\);/);
  assert.match(letter, /<ContextualMembershipInvitation accountId=\{user\?\.id \?\? null\} placement="tool-finished" completed=\{finishedHere\} \/>/);
  assert.equal(letter.split('<ContextualMembershipInvitation').length - 1, 1);

  const today = read('app/(tabs)/index.tsx');
  // The fifth day, and never on a hard check-in (a difficult answer only keeps the card away).
  assert.match(today, /if \(nextStreak\.currentStreak === 5 && !isDifficultCheckIn\(input\)\) setCheckinWeek\(true\);\s+if \(nextStreak\.currentStreak === 7\) \{/);
  assert.match(today, /useFocusEffect\(useCallback\(\(\) => \(\) => setCheckinWeek\(false\), \[\]\)\);/);
  const [beforeFree, afterFree] = today.split('if (!canAccessFullToday) {');
  const [freeToday, paidToday] = afterFree.split("\n  return (\n    <ScreenContainer backgroundColor={colors.cream} scrollRef={scrollRef}>");
  // Under the check-in, on the free Today only.
  assert.match(freeToday, /\{checkInCard\}\s+<CheckInFeedbackCard checkIn=\{todayCheckIn\} \/>\s+\{\/\*[^*]*\*\/\}\s+<ContextualMembershipInvitation\s+accountId=\{user\?\.id \?\? null\}\s+placement="checkin-week"\s+completed=\{checkinWeek\}\s+\/>/);
  assert.ok(!beforeFree.includes('placement="checkin-week"') && !paidToday.includes('placement="checkin-week"'));
  // One ask per visit: Today's reminder ask is reported once it shows.
  assert.match(today, /useEffect\(\(\) => \{\s+if \(reminderAskOpen\) noteVisitAsk\(user\?\.id \?\? null\);\s+\}, \[reminderAskOpen, user\?\.id\]\);/);
  // The rating prompt reports itself, for every milestone, in one place.
  const review = read('src/lib/reviewPrompt.ts');
  assert.match(review, /noteReviewPending\(accountId, true\);\s+const request = runReviewRequest\(accountId, milestone, safety\)\.then\(\(outcome\) => \{\s+if \(outcome === 'requested' \|\| outcome === 'failed'\) noteVisitAsk\(accountId\);/);
  assert.match(review, /\.finally\(\(\) => \{\s+noteReviewPending\(accountId, false\);/);
  assert.match(read('src/lib/afterMeetingInvite.ts'), /export function clearMeetingReturn\(\): void \{\s+visitCheck = null;[\s\S]*?clearVisitAsks\(\);/);
  assert.match(read('src/membershipInvitations/ContextualMembershipInvitation.tsx'), /createInvitationPolicy\(AsyncStorage, Date\.now, askedThisVisit\)/);
});

test('admin shows each invitation place: shown, tapped and joined', () => {
  const admin = read('app/admin.tsx');
  const block = admin.slice(admin.indexOf('{funnel.membership_path_30d ? ('), admin.indexOf('Readiness bands'));
  assert.match(block, /<InvitationPlacementsCard viewerId=\{user\?\.id \?\? null\} \/>/);
  // Members counted once per column; the admin looking is left out; a purchase counts for the place she came from.
  const rows = invitationPlacementRows([
    { account_id: 'm1', stage: 'membership_invite_shown', metadata: { source: 'tool_finished' } },
    { account_id: 'm1', stage: 'membership_invite_shown', metadata: { source: 'tool_finished' } },
    { account_id: 'm2', stage: 'membership_invite_shown', metadata: { source: 'tool_finished' } },
    { account_id: 'm1', stage: 'membership_invite_tapped', metadata: { source: 'tool_finished' } },
    { account_id: 'm1', stage: 'purchase_succeeded', metadata: { source: 'tool_finished', tier: 'essential' } },
    { account_id: 'm3', stage: 'purchase_succeeded', metadata: { source: 'support_tab' } },
    { account_id: 'm2', stage: 'membership_invite_shown', metadata: { source: 'today_locked_preview' } },
    { account_id: 'me', stage: 'membership_invite_shown', metadata: { source: 'checkin_week' } },
    { account_id: 'm4', stage: 'membership_invite_shown', metadata: null },
  ], 'me');
  assert.deepEqual(rows.map((row) => row.source), [...INVITATION_PLACEMENTS, 'today_locked_preview']);
  assert.deepEqual(rows.find((row) => row.source === 'tool_finished'), { source: 'tool_finished', shown: 2, tapped: 1, subscribed: 1 });
  assert.deepEqual(rows.find((row) => row.source === 'checkin_week'), { source: 'checkin_week', shown: 0, tapped: 0, subscribed: 0 });
  assert.deepEqual(invitationPlacementRows(null, null).map((row) => row.shown), [0, 0, 0, 0, 0]);
  for (const place of INVITATION_PLACEMENTS) assert.ok(PLAN_SOURCES.includes(place), place);
  assert.equal(placementLabel('checkin_week'), 'Five-day check-in streak');
  const card = read('src/components/admin/InvitationPlacementsCard.tsx');
  assert.match(card, /\.from\('funnel_events'\)\s+\.select\('account_id, stage, metadata'\)\s+\.in\('stage', \['membership_invite_shown', 'membership_invite_tapped', 'purchase_succeeded'\]\)/);
});

// ── 15b. Missed it ──────────────────────────────────────────────────────────

test('a member who saved a seat and never tapped Join gets her own Tuesday note, on builds that can show it', () => {
  // Who saved a seat is read as before: 1 AM Tuesday, before the 2 AM reset.
  assert.match(FOLLOWUP_SQL, /IF extract\(isodow FROM v_local\) <> 2 OR extract\(hour FROM v_local\) <> 1 OR v_session IS NULL THEN\s+RETURN 0;/);
  assert.match(FOLLOWUP_SQL, /r\.status = 'going'\s+AND \(r\.family_squares_meeting_date = v_meeting[\s\S]*?OR \(r\.family_squares_meeting_date IS NULL AND r\.created_at > v_prev_end AND r\.created_at < v_end\)\)\s+\) AS had_seat,/);
  // A Join tap counts from 5 PM Pacific (people join early), and so does a confirmed stay in the meeting.
  assert.match(FOLLOWUP_SQL, /v_join_from := \(v_meeting \+ time '17:00'\) AT TIME ZONE 'America\/Los_Angeles';/);
  assert.match(FOLLOWUP_SQL, /e\.stage = 'attended'\s+AND e\.created_at >= v_join_from AND e\.created_at < v_end \+ interval '30 minutes'/);
  assert.match(FOLLOWUP_SQL, /e\.stage = 'attended_10min'/);
  // "Save my seat every Monday" is never "missed": her seat is automatic and she may join where the app cannot see.
  assert.match(FOLLOWUP_SQL, /\(c\.had_seat AND NOT c\.joined AND NOT c\.weekly_seat\) AS missed/);
  // The same people as before are eligible.
  assert.match(FOLLOWUP_SQL, /WHERE nullif\(a\.push_token, ''\) IS NOT NULL\s+AND coalesce\(a\.family_call_reminders, false\)[\s\S]*?AND coalesce\(a\.locale, 'en'\) NOT LIKE 'es%'/);
  // Contract branching: only 4.3+ builds (contract 2) get the new note; the others keep every older wording.
  assert.match(FOLLOWUP_SQL, /WHEN s\.missed AND coalesce\(s\.push_app_contract, 0\) >= 2 THEN\s+'If Monday got away from you, we missed you\. Next Monday''s seat is one tap away, and '/);
  assert.match(FOLLOWUP_SQL, /CASE WHEN public\._dispatcher_member_access\(s\.id\)\s+THEN 'recordings of past meetings are in your library, under Tools\.'\s+ELSE 'members can watch recordings of past meetings\.' END/);
  assert.match(FOLLOWUP_SQL, /WHEN v_takeaway IS NOT NULL THEN 'This week''s one thing: ' \|\| v_takeaway\s+WHEN coalesce\(s\.push_app_contract, 0\) >= 1 THEN\s+'Your one thing to try this week is on Today, and next Monday''s seat is one tap away\.'\s+-- Older builds have no such card on Today\.\s+ELSE 'Next Monday''s call is free too\. You can save your seat in the app\.'/);
  // Same kind, payload, one-per-meeting key, time of day and cut-off.
  assert.match(FOLLOWUP_SQL, /jsonb_build_object\('kind', 'family_call_followup', 'meeting_date', v_meeting::text\),\s+'family-call-followup:' \|\| v_meeting \|\| ':' \|\| s\.id,\s+s\.due,\s+\(\(\(s\.due AT TIME ZONE s\.tz\)::date\) \+ time '21:00'\) AT TIME ZONE s\.tz/);
  assert.match(FOLLOWUP_SQL, /ON CONFLICT \(idempotency_key\) WHERE idempotency_key IS NOT NULL DO NOTHING;/);
  assert.match(FOLLOWUP_SQL, /REVOKE EXECUTE ON FUNCTION public\.enqueue_family_call_followups\(timestamptz\) FROM PUBLIC, anon, authenticated;/);
  // The delivery rules (quiet hours, the reminder switch, the bereavement pause) are not redefined here.
  assert.doesNotMatch(FOLLOWUP_SQL, /FUNCTION public\.dispatcher_outbox_delivery|cron\.schedule/);
  // Nothing promises this week's recording, names a price or points at the website.
  const code = FOLLOWUP_SQL.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
  const strings = [...code.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).join('\n');
  assert.match(strings, /we missed you/);
  assert.doesNotMatch(strings, /this week''s recording|last night''s recording|is posted|soberhelpline|\$\d/i);
  // The tab it names is the tab's real name.
  assert.equal(locale('en', 'common').nav.learn, 'Tools');
  assert.match(locale('en', 'learn').recordings.title, /Recordings/);
});

// ── 16. Show what is locked ─────────────────────────────────────────────────

test('the free Today has one "See plans" (Explore membership), no locked row, and no fake member data', () => {
  const today = read('app/(tabs)/index.tsx');
  const [, afterFree] = today.split('if (!canAccessFullToday) {');
  const [freeToday] = afterFree.split("\n  return (\n    <ScreenContainer backgroundColor={colors.cream} scrollRef={scrollRef}>");
  // 4.4: "Explore membership" is the one quiet plans door in "More for you"; the
  // locked row said the same thing a second time.
  assert.ok(!today.includes('<LockedPreviewRow'));
  assert.match(freeToday, /t\('disclosure\.membership'\)/);
  // The member cards themselves are not rendered for her, blurred or otherwise.
  for (const card of ['<HeroCard', '<ContinueLetterCard', '<WeekReviewCard']) assert.ok(!freeToday.includes(card), card);
  const row = read('src/components/plans/LockedPreviewRow.tsx');
  // The row is a lock, one line and the button: no picture, blur or stand-in numbers.
  assert.doesNotMatch(row, /BlurView|blurRadius|<Image|<HeroCard|<WeekReviewCard|>\s*\d/);
  assert.match(row, /<Text style=\{\[styles\.line, \{ color: colors\.ink \}\]\}>\{line\}<\/Text>/);
  assert.match(row, /accessibilityRole="button"\s+accessibilityLabel=\{label\}/);
  for (const lang of ['en', 'es']) {
    const plans = locale(lang, 'plans');
    assert.ok(plans.locked.todayLine && plans.locked.todayLabel.startsWith(plans.locked.todayLine));
    assert.ok(plans.seePlans);
    // 4.4: the free daily script left Today (Practice has the scripts, all free).
    assert.equal(locale(lang, 'today').freeDaily, undefined, lang);
    // The word on the tab is the word in that screen's title.
    assert.equal(locale(lang, 'common').navShort.scripts, locale(lang, 'common').nav.scripts, lang);
  }
  assert.doesNotMatch(read('app/(tabs)/index.tsx'), /freeDaily|<ScriptCard|getDailyScripts/);
  assert.match(read('app/(tabs)/scripts.tsx'), /<TabHeader title=\{tCommon\('nav\.scripts'\)\} \/>/);
  assert.match(read('app/(tabs)/_layout.tsx'), /tab\('scripts', t\('navShort\.scripts'\)\)/);
  assert.equal(locale('en', 'common').navShort.scripts, 'Practice');
  assert.equal(locale('es', 'common').navShort.scripts, 'Práctica');
  assert.doesNotMatch(read('app/(tabs)/scripts.tsx'), /<Gate |useFeatureAccess\(/, 'the script library is free');
});

// ── Accessibility of the new and touched buttons ────────────────────────────

test('every button on the new plans surfaces says what it is and what it does', () => {
  for (const file of ['app/plans.tsx', 'src/components/plans/PlansCard.tsx', 'src/components/plans/UpgradeSheet.tsx',
    'src/components/plans/PlansTeaserCard.tsx', 'src/components/plans/LockedPreviewRow.tsx', 'src/components/ui/FreeTierPaywall.tsx',
    'src/membershipInvitations/ContextualMembershipInvitation.tsx']) {
    const buttons = read(file).match(/<(?:TouchableOpacity|Pressable)[\s\S]*?>/g) ?? [];
    assert.ok(buttons.length >= 1, file);
    for (const button of buttons) {
      assert.match(button, /accessibilityRole="(button|link)"/, `${file}: ${button}`);
      assert.match(button, /accessibilityLabel=\{/, `${file}: ${button}`);
    }
  }
  const chat = read('app/chat.tsx');
  assert.equal(chat.split("accessibilityRole=\"button\" accessibilityLabel={t('textline.viewPlans')}").length - 1, 2);
  assert.match(read('app/trajectory.tsx'), /accessibilityRole="button" accessibilityLabel=\{t\('trajectory\.sharePlansLink'\)\} onPress=\{\(\) => router\.push\(plansHref\('tracker_share'\)\)\}/);
  assert.match(read('app/crisis-mode.tsx'), /<TouchableOpacity accessibilityRole="button" accessibilityLabel=\{cta\}/);
});
