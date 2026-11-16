import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import { isFamilySquaresSession } from '../src/lib/familySquaresSchedule';
import { familySquaresSyncWindow } from '../supabase/functions/_shared/family-squares-time';

// The second pass of the 4.3 visual review: one header on every tab, one
// button shape and colour rule on the main screens, and three small fixes.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const locale = (lang: string, name: string) => JSON.parse(read(`src/locales/${lang}/${name}.json`));

// ── One header on every tab ──────────────────────────────────────────────────

test('every tab starts with the same header: its name on the left, Settings on the right', () => {
  const titles: Record<string, RegExp> = {
    'app/(tabs)/index.tsx': /const header = <TabHeader title=\{greeting\} \/>;/,
    'app/(tabs)/scripts.tsx': /<TabHeader title=\{tCommon\('nav\.scripts'\)\} \/>/,
    'app/(tabs)/boundaries.tsx': /<TabHeader title=\{tCommon\('nav\.boundaries'\)\} \/>/,
    'app/(tabs)/tracker.tsx': /<TabHeader title=\{t\('common:nav\.tracker'\)\} \/>/,
    'app/(tabs)/learn.tsx': /<TabHeader title=\{t\('header'\)\} \/>/,
    'app/(tabs)/support.tsx': /<TabHeader title=\{t\('header'\)\} \/>/,
  };
  for (const [file, title] of Object.entries(titles)) {
    const screen = read(file);
    assert.match(screen, title, file);
    assert.match(screen, /import \{ TabHeader \} from '..\/..\/src\/components\/ui\/TabHeader';/, file);
    // No tab draws a header row, an initial or a gear of its own any more.
    assert.doesNotMatch(screen, /styles\.headerRow|styles\.avatar|settingsIcon|⚙/, file);
    // The header is the first thing in the scrolling content of each version of the screen.
    assert.doesNotMatch(screen, /a11y\.settings/, `${file}: the Settings button lives in the shared header`);
  }
  // The words: each tab's title is the word on its tab.
  for (const lang of ['en', 'es']) {
    const common = locale(lang, 'common');
    for (const tab of ['scripts', 'boundaries', 'tracker']) assert.equal(common.nav[tab], common.navShort[tab], `${lang} ${tab}`);
    assert.equal(locale(lang, 'learn').header, common.navShort.learn, lang);
    assert.equal(locale(lang, 'support').header, common.navShort.support, lang);
    assert.ok(common.a11y.settings, lang);
  }
});

test('the shared header: a wrapping title with the header role, and one 44-point Settings button', () => {
  const header = read('src/components/ui/TabHeader.tsx');
  assert.match(header, /<Text accessibilityRole="header" style=\{\[styles\.title, \{ color: colors\.ink \}\]\}>\{title\}<\/Text>/);
  // The title takes the row's free width and wraps: no fixed height, no line limit.
  assert.match(header, /titles: \{ flex: 1 \}/);
  assert.doesNotMatch(header, /numberOfLines|height: \d/);
  assert.match(header, /title: \{\s+fontSize: 24,\s+fontWeight: '700',\s+letterSpacing: -0\.4,\s+\}/);
  assert.match(header, /name="cog-outline"\s+size=\{24\}\s+color=\{colors\.primary\}/);
  assert.match(header, /accessibilityRole="button"\s+accessibilityLabel=\{t\('common:a11y\.settings'\)\}\s+onPress=\{\(\) => router\.push\('\/settings'\)\}/);
  assert.match(header, /settings: \{\s+width: 44,\s+minHeight: 44,/);
  // The icon comes from the set the tab bar already uses: nothing new to install.
  assert.match(header, /import MaterialCommunityIcons from '@expo\/vector-icons\/MaterialCommunityIcons';/);
  assert.doesNotMatch(read('package.json'), /"@expo\/vector-icons"/);
  // Same top spacing on every tab: the Tools tab no longer pads its own content.
  assert.match(read('app/(tabs)/learn.tsx'), /inner: \{ paddingBottom: 40 \},/);
});

// ── One button shape, one colour rule ────────────────────────────────────────

test('the button shape is written once: the pill of the sign-up and onboarding screens', () => {
  const button = read('src/components/ui/Button.tsx');
  assert.match(button, /export const BUTTON_RADIUS = 99;/);
  assert.match(button, /export const BUTTON_MIN_HEIGHT = 48;/);
  assert.match(button, /export const buttonShape = \{\s+borderRadius: BUTTON_RADIUS,\s+minHeight: BUTTON_MIN_HEIGHT,/);
  assert.match(button, /btn: \{\s+\.\.\.buttonShape,/);
  // The same pill as the front door (pass one), which this pass did not touch.
  assert.match(read('app/(auth)/sign-up.tsx'), /borderRadius: 99,/);
  assert.match(read('app/(onboarding)/consent.tsx'), /primaryBtn: \{ borderRadius: 99,/);
});

test('full-width buttons on the tabs, plans and settings all use the shared shape', () => {
  const styles: Record<string, string[]> = {
    'app/(tabs)/support.tsx': ['sosButton', 'solidBtn', 'outlineBtn', 'copilotButton'],
    'app/(tabs)/learn.tsx': ['cardButton'],
    'app/(tabs)/boundaries.tsx': ['solidBtn'],
    'app/settings.tsx': ['restoreBtn', 'adminBtn', 'retryBtn', 'signOutBtn'],
    'src/components/plans/PlansCard.tsx': ['solidBtn', 'outlineBtn'],
    'src/components/plans/PlansTeaserCard.tsx': ['button'],
    'src/components/plans/UpgradeSheet.tsx': ['solidBtn'],
    'src/components/today/SituationCard.tsx': ['primaryBtn', 'doorBtn', 'briefBtn'],
    'src/components/today/CheckInCard.tsx': ['btn'],
    'src/components/today/PassItOnCard.tsx': ['primaryButton', 'secondaryButton'],
    'src/components/today/HolidayPlanTodayCard.tsx': ['button'],
    'src/components/today/LovedOneCheckCard.tsx': ['same'],
    'src/components/scripts/ScriptCard.tsx': ['practiceBtn'],
    'src/components/boundaries/HoldLogCard.tsx': ['shareBtn'],
    'src/components/bereavement/BereavementSettingsCard.tsx': ['button'],
    'src/components/bereavement/BereavementSheet.tsx': ['confirm'],
    'src/components/ui/FreeTierPaywall.tsx': ['btn'],
    'src/components/video/PremierVideoSchedulingCard.tsx': ['action', 'secondary'],
  };
  for (const [file, names] of Object.entries(styles)) {
    const source = read(file);
    assert.match(source, /import \{ buttonShape \} from '[./]+\/(?:src\/components\/ui|ui)?\/?Button';/, file);
    for (const name of names) {
      const block = source.match(new RegExp(`\\b${name}: \\{([^}]*)\\}`));
      assert.ok(block, `${file}: ${name}`);
      assert.match(block![1], /\.\.\.buttonShape/, `${file}: ${name} uses the shared shape`);
      assert.doesNotMatch(block![1], /borderRadius|minHeight/, `${file}: ${name} repeats no radius or height of its own`);
    }
  }
});

test('colour: a navy main button, an outlined second one; coral only for safety, green only for something confirmed', () => {
  const tools = read('app/(tabs)/learn.tsx');
  const fills = [...tools.matchAll(/style=\{\[styles\.cardButton, \{ backgroundColor: colors\.(\w+) \}\]\}\s+onPress=\{\(\) => (?:void )?[\w.]+\((?:user\?\.id \?\? null, )?([^)]*)\)/g)]
    .map((match) => [match[2], match[1]] as const);
  assert.equal(fills.length, 12);
  for (const [target, colour] of fills) {
    // The Safety plan is the one coral button (as the Safety button above the
    // tab bar); on the navy card the main button is turned inside out (white, navy words).
    const expected = /safety-wallet/.test(target) ? 'coral' : /treatment-action-plan/.test(target) ? 'white' : 'primary';
    assert.equal(colour, expected, target);
  }
  assert.match(tools, /backgroundColor: colors\.primary \}\]\}\s+onPress=\{\(\) => router\.push\('\/invitation-engine' as never\)\}/);
  assert.doesNotMatch(tools, /cardButton, \{ backgroundColor: colors\.(?:green|secondary) \}/);

  const support = read('app/(tabs)/support.tsx');
  // Every outlined button says its colour (an unstated border draws black), and none is amber.
  const outlined = support.match(/style=\{[^\n]*styles\.outlineBtn\b[^\n]*/g) ?? [];
  assert.ok(outlined.length >= 11);
  for (const use of outlined) assert.match(use, /styles\.outlineBtn, \{ borderColor: colors\.primary/, use);
  assert.doesNotMatch(support, /outlineBtnText, \{ color: colors\.secondary \}/);
  // Coral stays where it means danger: the crisis button.
  assert.match(support, /style=\{\[styles\.sosButton, \{ backgroundColor: colors\.coral \}\]\}/);

  const settings = read('app/settings.tsx');
  for (const use of settings.match(/style=\{[^\n]*styles\.(?:restoreBtn|retryBtn|signOutBtn)[^\n]*/g) ?? []) {
    assert.match(use, /borderColor: colors\.(?:line|primary)/, use);
  }
  // Deleting the account is the one coral action on Settings.
  assert.match(settings, /<Text style=\{\[styles\.deleteText, \{ color: colors\.coral \}\]\}>\{t\('deleteAccount\.button'\)\}<\/Text>/);
});

test('the Monday meeting says "Save my spot" wherever its button is; other sessions keep "RSVP"', () => {
  assert.match(read('app/(tabs)/support.tsx'), /\{t\(mondayMeeting \? 'today:situationCta\.rsvp' : 'sessions\.rsvpButton'\)\}/);
  assert.match(read('src/components/today/SituationCard.tsx'), /\{t\('situationCta\.rsvp'\)\}/);
  assert.equal(locale('en', 'today').situationCta.rsvp, 'Save my spot');
  assert.equal(locale('en', 'support').sessions.rsvpButton, 'RSVP');
  assert.doesNotMatch(locale('en', 'onboarding').done.rsvpButton, /RSVP/);
});

// ── Small fixes ──────────────────────────────────────────────────────────────

test('the onboarding done screen says what a castle wall is, in plain words, before using the words', () => {
  const en = locale('en', 'onboarding').done;
  const es = locale('es', 'onboarding').done;
  assert.equal(en.castle, 'A boundary is a limit you set. Each one is a wall of your castle.');
  assert.equal(es.castle, 'Un límite es una regla que tú pones. Cada uno es una muralla de tu castillo.');
  // The same word for "wall" as the sentence after it, and nothing said twice.
  assert.match(es.body, /muralla/);
  assert.doesNotMatch(`${en.body} ${es.body}`, /limit you set|regla que tú pones/);
  for (const line of [en.castle, es.castle]) assert.doesNotMatch(line, /[—–!]/);
  const screen = read('app/(onboarding)/notifications.tsx');
  assert.match(screen, /\{t\('done\.title'\)\}[\s\S]*?\{t\('done\.castle'\)\}[\s\S]*?\{t\('done\.body'\)\}/);
  assert.match(screen, /style=\{\[styles\.bodyText, styles\.castleLine, \{ color: 'rgba\(255,255,255,0\.8\)' \}\]\}/);
});

test('the Text Line never names a cancelled Family Squares Monday as the next live session', () => {
  const chat = read('app/chat.tsx');
  // The real checks, the same two Today's card uses.
  assert.match(chat, /import \{ isFamilySquaresSession \} from '..\/src\/lib\/familySquaresSchedule';/);
  assert.match(chat, /import \{ isCancelledMeetingDate \} from '..\/src\/lib\/familySquaresCancelled';/);
  assert.match(chat, /const nextGroupSession = nextLiveGroupSession\(sessions\);/);
  assert.doesNotMatch(chat, /sessions\.find\(\(s\) => s\.kind === 'group'\);/);
  // With no session left to name, the line is not shown at all.
  assert.match(chat, /\{nextSchedule && \(\s+<Text[^>]*>\s+\{t\('chat\.presenceNextSession', \{ schedule: nextSchedule \}\)\}/);

  // Run the screen's own function, with the real Family Squares test and the
  // same date rule as isCancelledMeetingDate (the coming meeting's Pacific date).
  const body = chat.match(/export function nextLiveGroupSession[\s\S]*?\n\}\n/);
  assert.ok(body);
  const js = ts.transpileModule(body![0].replace('export function', 'function'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const coming = familySquaresSyncWindow(new Date()).meetingDate;
  const isCancelledMeetingDate = (date: unknown) => typeof date === 'string' && date !== '' && date === coming;
  type Session = { id: string; kind: string; title: string; cancelledDate?: string | null };
  const next = new Function('isFamilySquaresSession', 'isCancelledMeetingDate', `${js}; return nextLiveGroupSession;`)(
    isFamilySquaresSession, isCancelledMeetingDate,
  ) as (sessions: Session[]) => Session | undefined;

  const monday: Session = { id: 'fs', kind: 'group', title: 'The Family Squares' };
  const other: Session = { id: 'wed', kind: 'group', title: 'Wednesday Parents Group' };
  const private1: Session = { id: 'one', kind: 'one-on-one', title: 'Coaching' };
  // An ordinary week: the first group session, as before.
  assert.equal(next([private1, monday, other])?.id, 'fs');
  // The website cancelled this Monday: the next group session is named instead.
  assert.equal(next([private1, { ...monday, cancelledDate: coming }, other])?.id, 'wed');
  // Nothing else is coming: no session, so no line.
  assert.equal(next([private1, { ...monday, cancelledDate: coming }]), undefined);
  // Last week's cancellation says nothing about this Monday.
  assert.equal(next([{ ...monday, cancelledDate: '2020-01-06' }, other])?.id, 'fs');
  // Only Family Squares can be cancelled this way: a stray date on another session is ignored.
  assert.equal(next([{ ...other, cancelledDate: coming }])?.id, 'wed');
  assert.equal(next([]), undefined);
});

test('the two admin subheads come from the locale files, in both languages', () => {
  const admin = read('app/admin.tsx');
  assert.match(admin, /const \{ t \} = useTranslation\('common'\);/);
  assert.match(admin, /\{t\('admin\.familySquaresByMeeting'\)\}/);
  assert.match(admin, /\{t\('admin\.membershipPath30d'\)\}/);
  assert.doesNotMatch(admin, />Family Squares, by meeting<|>Membership path, last 30 days</);
  assert.deepEqual(locale('en', 'common').admin, { familySquaresByMeeting: 'Family Squares, by meeting', membershipPath30d: 'Membership path, last 30 days' });
  assert.deepEqual(Object.keys(locale('es', 'common').admin), Object.keys(locale('en', 'common').admin));
  for (const value of Object.values(locale('es', 'common').admin)) assert.ok(typeof value === 'string' && value.length > 0);
});
