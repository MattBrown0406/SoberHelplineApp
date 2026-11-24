import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 4.4: a smaller, clearer Support tab. Same features, a new order, and the
// less-used parts behind one "More support" row.

const read = (path: string) => readFileSync(path, 'utf8');
const locale = (lang: string, ns: string) => JSON.parse(read(`src/locales/${lang}/${ns}.json`));
const tab = read('app/(tabs)/support.tsx');
const at = (needle: string) => {
  const index = tab.indexOf(needle);
  assert.ok(index > 0, `missing: ${needle}`);
  return index;
};

test('top to bottom: header, crisis help, the meeting, coaching, membership, then "More support"', () => {
  const order = [
    "<TabHeader title={t('header')} />",
    'onPress={() => setCrisisOpen(true)}',
    "t('mondayGroup.sub')",
    "t('sessions.eyebrow')",
    "t('coachingHeading', { name: PRIMARY_ON_CALL.firstName })",
    "<SectionHeading title={t('membership.eyebrow')} />",
    "<TodayDisclosure title={t('moreSupport.title')}>",
  ].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(tab, /useToolOpened\('support'\);/);
  assert.match(tab, /import \{ TodayDisclosure \} from '\.\.\/\.\.\/src\/components\/today\/TodayDisclosure';/);
});

test('crisis help is one row; the crisis guide and the free note are inside the sheet it opens', () => {
  assert.equal(tab.split('setCrisisOpen(true)').length - 1, 1);
  assert.match(tab, /accessibilityLabel=\{t\('crisis\.button'\)\}\s+accessibilityHint=\{t\('crisis\.buttonHint'\)\}\s+style=\{\[styles\.sosButton, \{ backgroundColor: colors\.coral \}\]\}/);
  assert.doesNotMatch(tab, /CrisisProtocolSheet|crisisProtocol/);
  const sheet = read('src/components/support/CrisisSheet.tsx');
  // The guide sits under 911 and 988, above the helpline.
  const order = ["t('crisis.line911')", "t('crisis.line988')", '{guideOpen && <CrisisGuide />}', "t('crisis.guidanceDivider')", "t('crisis.lineSh')", "t('crisis.freeNote')"]
    .map((needle) => sheet.indexOf(needle));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), order.join(', '));
  // Each time the sheet opens, the emergency lines are what she sees first.
  assert.match(sheet, /useEffect\(\(\) => \{\s+if \(!visible\) setGuideOpen\(false\);\s+\}, \[visible\]\);/);
});

test('links into Support keep working: a session to stand out, a question to ask, Family Squares to land on', () => {
  assert.match(tab, /const \{ sessionId: sessionIdParam, focus, ask \} = useLocalSearchParams<\{ sessionId\?: string; focus\?: string; ask\?: string \}>\(\);/);
  assert.match(tab, /const focusedSessionId = sessionIdParam\s+\?\? \(focus === 'family-squares'\s+\? sessions\.find\(\(s\) => isFamilySquaresSession\(s\) \|\| isLaSobremesaSession\(s\)\)\?\.id/);
  assert.match(tab, /if \(ask !== 'question'\) return;\s+navigation\.setParams\(\{ ask: undefined \} as never\);\s+setPendingAsk\(sessionIdParam \?\? null\);/);
  assert.match(tab, /<QuestionSheet\s+visible=\{questionSession !== null\}/);
  // The meeting card is the first card under the crisis row, never inside "More support".
  const more = at("<TodayDisclosure title={t('moreSupport.title')}>");
  for (const call of tab.matchAll(/renderSession\(sess, (true|false)/g)) assert.ok((call.index ?? 0) < more);
});

test('"More support" holds the finder, a provider, groups and Pass it on', () => {
  const more = tab.slice(at("<TodayDisclosure title={t('moreSupport.title')}>"), at('</TodayDisclosure>'));
  for (const piece of ["router.push('/finder')", 'setProviderOpen(true)', '<SupportGroupsCard hasMembershipAccess={hasMembershipAccess} />']) {
    assert.ok(more.includes(piece), piece);
  }
  // Pass it on (moved from Today): rendered on Support.
  assert.match(tab, /import \{ PassItOnCard \} from '\.\.\/\.\.\/src\/components\/today\/PassItOnCard';/);
  assert.match(more, /\n\s+<PassItOnCard \/>/);
  assert.equal(tab.split('<PassItOnCard').length - 1, 1);
  for (const lang of ['en', 'es']) assert.ok(locale(lang, 'support').moreSupport.title, lang);
});

test('the language choice lives in Settings only', () => {
  assert.doesNotMatch(tab, /useLanguage|languages\.map|language\.eyebrow/);
  assert.match(read('app/settings.tsx'), /const \{ current, change, languages \} = useLanguage\(\);/);
  for (const lang of ['en', 'es']) assert.equal(locale(lang, 'support').language, undefined, lang);
});

test('the plans in short for a free member; booking for members only', () => {
  assert.match(tab, /\{freeTier && \(\s+<>[\s\S]*?<PlansTeaserCard offers=\{planOffers\} source="support_tab" \/>/);
  assert.match(tab, /\{!subscriptionPrices\.essential && \(/);
  // Booking a paid session: members only, as before 4.4 (no new promotion on Support).
  assert.match(tab, /\{!isAttached && hasMembershipAccess && \(\s+<View[\s\S]*?router\.push\('\/book-coaching'\)/);
  assert.match(tab, /\{\(hasMembershipAccess \|\| isAttached\) && <SectionHeading title=\{t\('membership\.eyebrow'\)\} \/>\}/);
  assert.equal(tab.split("router.push('/book-coaching')").length - 1, 1);
  assert.match(tab, /\{!hasMembershipAccess && \(\s*<TouchableOpacity[^\n]*router\.push\('\/membership-guide'\)/);
  assert.match(read('src/components/support/MemberPlanCard.tsx'), /\{accountState === 'direct-essential' && \(/);
  assert.match(read('src/components/support/MembershipGuideCard.tsx'), /\n\s+<TouchableOpacity[^\n]*router\.push\('\/membership-guide'\)/);
  // The free conversation practice stays for everyone without a plan.
  assert.match(tab, /\{!hasMembershipAccess && \(\s*<TouchableOpacity[^\n]*router\.push\('\/free-practice'\)/);
});

test('a free member can read the store prices again when they did not load', () => {
  assert.match(tab, /const \{ subscriptionPrices, retryPrices \} = planOffers;/);
  assert.match(tab, /accessibilityLabel=\{tPlans\('retryPricesLabel'\)\}[\s\S]*?onPress=\{retryPrices\}\s*>\s*<Text[^>]*>\{tPlans\('retryPrices'\)\}<\/Text>/);
  // Shown only inside the free tier's part of the screen.
  const free = tab.lastIndexOf('{freeTier && (', at("tPlans('retryPricesLabel')"));
  assert.ok(free > 0);
});

test('the meeting card names the meeting while the sessions load', () => {
  assert.match(tab, /const \{ sessions, loading: sessionsLoading, toggleRsvp, declineRsvp, seatSavedHere \} = useSessions\(user\?\.id \?\? null\);/);
  assert.match(tab, /\{groupSessions\.length === 0 && meetingPlaceholder\}/);
  assert.match(tab, /\{sessions\.length === 0 && meetingPlaceholder\}/);
  assert.match(tab, /<Text style=\{\[styles\.sessionTitle, \{ color: colors\.ink \}\]\}>\{t\('mondayGroup\.loadingTitle'\)\}<\/Text>/);
  assert.equal(locale('en', 'support').mondayGroup.loadingTitle, 'Family Squares');
  assert.equal(locale('es', 'support').mondayGroup.loadingTitle, 'La Sobremesa');
});

test('a La Sobremesa seat saved on Support is read out, as a Family Squares seat is', () => {
  assert.match(tab, /const wasSaved = !!session\.rsvped;\s+const saved = await toggleRsvp\(session\);\s+if \(saved === true && !wasSaved && isLaSobremesaSession\(session\)\) setSobremesaSavedHere\(\(count\) => count \+ 1\);/);
  assert.match(tab, /savedHere=\{familySquares \? seatSavedHere : laSobremesa \? sobremesaSavedHere : 0\}/);
  // The line announces itself when that count goes up while the seat is confirmed.
  assert.match(read('src/components/familySquares/FamilySquaresSpotSavedLine.tsx'), /if \(confirmed\) AccessibilityInfo\.announceForAccessibility\(text\);/);
});

test('new Support strings exist in English and Spanish', () => {
  for (const lang of ['en', 'es']) {
    const support = locale(lang, 'support');
    assert.ok(support.crisis.buttonHint, `${lang}: crisis.buttonHint`);
    assert.match(support.coachingHeading, /\{\{name\}\}/, `${lang}: coachingHeading`);
    for (const gone of ['peopleHeading']) assert.equal(support[gone], undefined, `${lang}: ${gone}`);
    assert.equal(support.crisisProtocol.eyebrow, undefined);
    assert.equal(support.crisisProtocol.close, undefined);
  }
  assert.match(locale('es', 'support').crisis.buttonHint, /Copiloto de Crisis/);
});
