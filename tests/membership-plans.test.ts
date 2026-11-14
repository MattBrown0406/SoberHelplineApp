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

/** The text[] a SQL list helper returns. */
function sqlList(name: string): string[] {
  const body = new RegExp(`FUNCTION public\\.${name}\\(\\)[\\s\\S]*?SELECT ARRAY\\[([\\s\\S]*?)\\]::text\\[\\]`).exec(FUNNEL_SQL)?.[1] ?? '';
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
  // Started just before the store call; the ending only for the session that started it.
  assert.match(purchase, /logMembershipPath\('purchase_started', \{ tier: upgradeTier, source \}\);\s+const result = upgradeTier === 'essential'\s+\? await purchaseEssential\(\)\s+: await purchasePremium\(\);\s+const session = await sameSession\(\);[\s\S]*?if \(!session\) return;\s+logMembershipPath\(\s+result === 'success' \? 'purchase_succeeded' : result === 'failed' \? 'purchase_failed' : 'purchase_cancelled',/);
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
    ['app/(tabs)/index.tsx', /<FreeTierPaywall inline source="today_membership" \/>/],
    ['app/(tabs)/index.tsx', /source="today_locked_preview"/],
    ['app/(tabs)/support.tsx', /router\.push\(plansHref\('support_upgrade', 'premium'\)\)/],
    ['app/(tabs)/support.tsx', /router\.push\(plansHref\('support_groups', 'essential'\)\)/],
  ];
  for (const [file, pattern] of expected) assert.match(read(file), pattern, file);
  // Both chat gates, both plan-review cards, both group buttons.
  assert.equal(read('app/chat.tsx').split("plansHref('chat_gate')").length - 1, 2);
  assert.equal(read('app/crisis-mode.tsx').split("plansHref('crisis_plan_review', 'premium')").length - 1, 2);
  assert.equal(read('app/(tabs)/support.tsx').split("plansHref('support_groups', 'essential')").length - 1, 2);
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
    for (const m of source.matchAll(/'(?:practice-completed|boundary-saved|after-meeting)': '([a-z_]+)'/g)) used.add(m[1]);
    for (const m of source.matchAll(/\? '(rehearsal_gate)' : '(feature_gate)'/g)) { used.add(m[1]); used.add(m[2]); }
  }
  assert.deepEqual([...used].sort(), [...PLAN_SOURCES].sort());
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
    assert.match(benefits.free.familySquares, /Family Squares/);
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
    'src/components/ui/FreeTierPaywall.tsx', 'app/membership-guide.tsx', 'app/(tabs)/support.tsx']) {
    assert.match(read(file), /<BenefitList plan=/, file);
  }
  assert.match(read('app/settings.tsx'), /benefitSummary\(accountState === 'direct-premium' \? 'premier' : 'essential', tPlans, i18n\.language\)/);
  assert.match(read('app/(tabs)/support.tsx'), /benefitSummary\(accountState === 'direct-premium' \? 'premier' : 'essential', tPlans as never, current\)/);
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
  // A check that finished before she was back says nothing about this visit.
  noteReviewCheck('a', 'none');
  assert.equal(afterMeetingInviteReady('a'), false);
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

test('the invitation is wired to the real return from the meeting, on the free Today only', () => {
  const layout = read('app/_layout.tsx');
  // Attendance logged (ten minutes or more after Join) is the moment.
  assert.match(layout, /flushFamilySquaresAttendance\(accountId\)\.then\(\(attended\) => \{\s+if \(attended && active\) noteMeetingReturn\(accountId\);/);
  // The rating-prompt check reports its answer; the invitation waits for it.
  assert.match(layout, /void flushQueuedSupportCallReview\(user\.id\)\.then\(\(outcome\) => noteReviewCheck\(user\.id, outcome\)\);/);
  assert.match(layout, /const leftForeground = nextState === 'background';[\s\S]*?if \(leftForeground\) clearMeetingReturn\(\);/);
  assert.match(read('src/lib/meetingAttendance.ts'), /logFunnelEvent\('attended_10min', \{ meeting_date: mark\.meetingDate, source: mark\.source \}\);\s+return true;/);

  const today = read('app/(tabs)/index.tsx');
  // Never for a bereaved member (or before we know), and never beside another ask.
  assert.match(today, /useAfterMeetingInvite\(\s+bereaved \|\| bereavedUnknown \? null : user\?\.id \?\? null,\s+welcome\.visible \|\| !!reminderAsk\.view,\s+\);/);
  const [beforeFree, afterFree] = today.split('if (!canAccessFullToday) {');
  const [freeToday, paidToday] = afterFree.split("\n  return (\n    <ScreenContainer backgroundColor={colors.cream} scrollRef={scrollRef}>");
  assert.ok(freeToday && paidToday, 'the free and paid Today are separate returns');
  assert.match(freeToday, /<ContextualMembershipInvitation\s+accountId=\{user\?\.id \?\? null\}\s+placement="after-meeting"\s+completed=\{afterMeeting\}\s+\/>/);
  assert.ok(!beforeFree.includes('<ContextualMembershipInvitation'), 'not on the bereaved Today');
  assert.ok(!paidToday.includes('<ContextualMembershipInvitation'), 'not on the paid Today');
  // The card itself refuses anyone who is not a free member.
  const card = read('src/membershipInvitations/ContextualMembershipInvitation.tsx');
  assert.match(card, /!account\.isAdmin && !account\.isAttached &&\s+account\.accountState === 'direct-free';/);
  assert.match(card, /'after-meeting': 'after_meeting',/);
  for (const lang of ['en', 'es']) {
    const invite = locale(lang, 'plans').invite;
    assert.match(invite.afterMeeting, /Family Squares/);
    assert.match(invite.afterMeeting, /coach/);
    for (const key of ['title', 'body', 'cta', 'later', 'never', 'practiceCompleted', 'boundarySaved', 'afterMeetingTitle']) assert.ok(invite[key], `${lang}: invite.${key}`);
  }
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
  // Contract branching: only 4.2 (3)+ builds get the new note; the others keep every older wording.
  assert.match(FOLLOWUP_SQL, /WHEN s\.missed AND coalesce\(s\.push_app_contract, 0\) >= 1 THEN\s+'If Monday got away from you, we missed you\. Next Monday''s seat is one tap away, and '/);
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

test('the free Today says what members see in the progress section, with no fake data', () => {
  const today = read('app/(tabs)/index.tsx');
  const [, afterFree] = today.split('if (!canAccessFullToday) {');
  const [freeToday, paidToday] = afterFree.split("\n  return (\n    <ScreenContainer backgroundColor={colors.cream} scrollRef={scrollRef}>");
  // One row, inside "Scripts, practice & your progress", on the free Today only.
  assert.equal(today.split('<LockedPreviewRow').length - 1, 1);
  const section = freeToday.slice(freeToday.indexOf("t('disclosure.practice')"), freeToday.indexOf("t('disclosure.membership')"));
  assert.match(section, /<LockedPreviewRow\s+source="today_locked_preview"\s+line=\{i18n\.t\('plans:locked\.todayLine'\)\}\s+label=\{i18n\.t\('plans:locked\.todayLabel'\)\}\s+\/>/);
  assert.ok(!paidToday.includes('<LockedPreviewRow'));
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
    // Today's script is not "unlocked": the whole library is free in Practice.
    const freeDaily = locale(lang, 'today').freeDaily;
    assert.doesNotMatch(`${freeDaily.eyebrow} ${freeDaily.note}`, /unlock|desbloque/i, lang);
    // The tab is named by the label in the tab bar ("Words" / "Ensayo"), filled in from that same key.
    assert.match(freeDaily.note, /\{\{tab\}\}/, `${lang}: names the tab by its visible label`);
    assert.doesNotMatch(freeDaily.note, new RegExp(locale(lang, 'common').nav.scripts), `${lang}: not the screen heading`);
  }
  assert.match(read('app/(tabs)/index.tsx'), /t\('freeDaily\.note', \{ tab: t\('common:navShort\.scripts'\) \}\)/);
  assert.match(read('app/(tabs)/_layout.tsx'), /tabBarLabel: t\('navShort\.scripts'\)/);
  assert.equal(locale('en', 'common').navShort.scripts, 'Words');
  assert.equal(locale('es', 'common').navShort.scripts, 'Ensayo');
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
