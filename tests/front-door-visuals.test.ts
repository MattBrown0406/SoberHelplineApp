import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import { guidedStartCopy } from '../src/content/guidedStartCopy';
import { emptyGuidedStart, type GuidedStart, type StartSituation } from '../src/lib/guidedStart';

// The front door's look after the 4.3 visual review: launch screen, logo,
// sign-up, sign-in and onboarding.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const locale = (lang: string, name: string) => JSON.parse(read(`src/locales/${lang}/${name}.json`));

// ── Launch screen and logo ───────────────────────────────────────────────────

test('the launch screen draws the lighthouse at its designed size, and the app draws the same thing', () => {
  const expo = JSON.parse(read('app.json')).expo;
  const plugin = expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-splash-screen')[1];
  // A square mark with a width: without `imageWidth` the plugin shrinks any image into a 100-point box.
  assert.deepEqual(plugin, { image: './assets/images/lighthouse-mark.png', imageWidth: 130, backgroundColor: '#142a47', resizeMode: 'contain' });
  assert.equal(expo.splash.image, plugin.image);
  assert.equal(expo.splash.backgroundColor, plugin.backgroundColor);
  // 390 px square = 130 points at 3x, so nothing is scaled up; its background is the launch colour.
  const png = readFileSync(resolve(root, 'assets/images/lighthouse-mark.png'));
  assert.equal(png.readUInt32BE(16), 390);
  assert.equal(png.readUInt32BE(20), 390);
  // The app's own copy of the launch screen matches it, so nothing moves at the hand-over.
  const cover = read('src/components/auth/LaunchCover.tsx');
  assert.match(cover, /export const LAUNCH_BACKGROUND = '#142a47';/);
  assert.match(cover, /export const LAUNCH_MARK_WIDTH = 130;/);
  assert.match(cover, /require\('\.\.\/\.\.\/\.\.\/assets\/images\/lighthouse-mark\.png'\)/);
  assert.match(cover, /<StatusBar style="light" \/>/);
});

test('the in-app logo uses the artwork with white light beams', () => {
  const logo = read('src/components/ui/AppLogo.tsx');
  assert.match(logo, /require\('\.\.\/\.\.\/\.\.\/assets\/images\/lighthouse-mark\.png'\)/);
  assert.doesNotMatch(logo, /lighthouse-icon\.png/);
  assert.match(logo, /export function AppLogo\(\{ size = 72 \}: Props\)/);
});

// ── No Today flash before the front door (item 22) ───────────────────────────

test('a signed-out launch stays on the launch screen until the front door is in front', () => {
  const layout = read('app/_layout.tsx');
  // Up from the first frame; down at once for someone signed in; never back in this run.
  assert.match(layout, /const \[launchCover, setLaunchCover\] = useState\(true\);/);
  assert.match(layout, /const showLaunchCover = launchCover && !isAuthenticated;/);
  assert.match(layout, /if \(!launchCover\) return undefined;\s+if \(isAuthenticated\) \{\s+setLaunchCover\(false\);\s+return undefined;\s+\}/);
  assert.equal(layout.split('setLaunchCover(true)').length - 1, 0);
  // A beat after a pre-sign-in screen is in front, and after five seconds whatever happens.
  assert.match(layout, /const LAUNCH_COVER_SETTLE_MS = 450;/);
  assert.match(layout, /const LAUNCH_COVER_EMERGENCY_MS = 1500;\s+const LAUNCH_COVER_MAX_MS = 5000;/);
  assert.match(layout, /const timer = setTimeout\(\(\) => setLaunchCover\(false\), preSignInScreenInFront \? LAUNCH_COVER_SETTLE_MS : LAUNCH_COVER_MAX_MS\);\s+return \(\) => clearTimeout\(timer\);\s+\}, \[launchCover, isAuthenticated, preSignInScreenInFront\]\);/);
  // A slow start never lifts the cover early onto the tabs; it puts the
  // emergency actions on the cover instead, so help is never out of reach.
  assert.match(layout, /setTimeout\(\(\) => setLaunchCoverSlow\(true\), LAUNCH_COVER_EMERGENCY_MS\)/);
  assert.match(read('src/components/auth/LaunchCover.tsx'), /\{emergency && viewportHeight > 0 \? \(\s*<ScrollView[\s\S]*?<View style=\{styles\.emergency\}[\s\S]*?>\s*<View style=\{styles\.emergencyInner\}>\s*<EmergencyActions \/>[\s\S]*?<\/ScrollView>/);
  // It lies on top of the one router stack: the stack is never hidden or unmounted for it.
  assert.match(layout, /<View style=\{\{ flex: 1, display: overlay \? 'none' : 'flex' \}\}>\s+<Stack screenOptions=\{\{ headerShown: false \}\} \/>\s+<\/View>\s+\{overlay\}\s+\{showLaunchCover \? <LaunchCover emergency=\{launchCoverSlow\} \/> : null\}/);
  assert.equal((layout.match(/<Stack /g) ?? []).length, 1);
  // No blank frame while the words load.
  assert.match(layout, /if \(!i18nReady\) return <LaunchCover \/>;/);
  const cover = read('src/components/auth/LaunchCover.tsx');
  assert.match(cover, /<View\s+accessibilityViewIsModal\s+style=\{\[StyleSheet\.absoluteFill, styles\.cover\]\}/);
});

test('a slow start\'s emergency card scrolls instead of covering the lighthouse (Spanish, large text)', () => {
  const cover = read('src/components/auth/LaunchCover.tsx');
  // The mark is centred where the launch screen draws it while the card fits; moved up, then scrolled, when it doesn't.
  assert.match(cover, /contentContainerStyle=\{\[styles\.scrollContent, \{ paddingTop: launchMarkTop\(viewportHeight, cardHeight\) \}\]\}/);
  assert.match(cover, /<View style=\{styles\.emergency\} onLayout=\{\(e\) => setCardHeight\(e\.nativeEvent\.layout\.height\)\}>/);
  assert.match(cover, /scrollContent: \{ flexGrow: 1, alignItems: 'center' \}/);
  // Before the slow start, the cover is the plain centred mark.
  assert.match(cover, /\) : \(\s*<Image accessible=\{false\} source=\{MARK\} style=\{styles\.mark\} \/>\s*\)\}/);
  const start = cover.indexOf('const MARK_GAP');
  const end = cover.indexOf('/**', cover.indexOf('export function launchMarkTop'));
  const js = ts.transpileModule(cover.slice(start, end).replace('export function', 'function'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const launchMarkTop = new Function('LAUNCH_MARK_WIDTH', `${js}; return launchMarkTop;`)(130) as (h: number, c: number) => number;
  assert.equal(launchMarkTop(844, 0), (844 - 130) / 2, 'before the card is measured: centred');
  assert.equal(launchMarkTop(844, 300), (844 - 130) / 2, 'a card that fits: still centred');
  assert.equal(launchMarkTop(844, 500), 844 - 500 - 24 - 130, 'a taller card: the mark moves up just enough');
  assert.equal(launchMarkTop(667, 700), 56, 'never under the status bar; past that the cover scrolls');
});

// ── Status bar ───────────────────────────────────────────────────────────────

test('navy screens get a light status bar only while in front; everything else keeps the dark default', () => {
  const layout = read('app/_layout.tsx');
  // The default is mounted first, so a navy screen's own (mounted later) wins.
  assert.match(layout, /<ThemeProvider>\s+\{\/\*[\s\S]*?\*\/\}\s+<StatusBar style="auto" \/>\s+<InitialLayout \/>/);
  assert.equal(layout.split('<StatusBar ').length - 1, 1);
  const navy = read('src/components/auth/NavyScreenStatusBar.tsx');
  assert.match(navy, /useFocusEffect\(useCallback\(\(\) => \{\s+setInFront\(true\);\s+return \(\) => setInFront\(false\);\s+\}, \[\]\)\);\s+return inFront \? <StatusBar style="light" \/> : null;/);
  // Welcome is navy throughout; the reminders step only once it says "done".
  assert.match(read('app/(onboarding)/welcome.tsx'), /backgroundColor: colors\.primary \}\]\}>\s+<NavyScreenStatusBar \/>/);
  const reminders = read('app/(onboarding)/notifications.tsx');
  assert.equal(reminders.split('<NavyScreenStatusBar />').length - 1, 1);
  assert.match(reminders, /if \(done\) \{\s+return \(\s+<SafeAreaView style=\{\[styles\.container, \{ backgroundColor: colors\.primary \}\]\}>\s+<NavyScreenStatusBar \/>/);
  // Cream screens set nothing.
  for (const file of ['app/(auth)/sign-in.tsx', 'app/(auth)/sign-up.tsx', 'app/(auth)/reset-password.tsx', 'app/(onboarding)/loved-one.tsx', 'app/(onboarding)/consent.tsx', 'app/(onboarding)/invite-code.tsx', 'src/components/auth/ConfirmEmailPanel.tsx']) {
    assert.doesNotMatch(read(file), /StatusBar/, file);
  }
});

// ── Sign-up and sign-in ──────────────────────────────────────────────────────

test('sign-up: the agreement sits above the button it unlocks, and the way to sign-in keeps its shape', () => {
  const signUp = read('app/(auth)/sign-up.tsx');
  const checkbox = signUp.indexOf('accessibilityRole="checkbox"');
  const submit = signUp.indexOf("accessibilityLabel={t('signUp.submitButton')}");
  assert.ok(checkbox > signUp.indexOf("t('signUp.passwordLabel')") && checkbox < submit, 'password, then the agreement, then Create account');
  // The checkbox, its label, state and both links are as they were.
  assert.match(signUp, /accessibilityRole="checkbox"\s+accessibilityLabel=\{t\('signUp\.termsCheckboxLabel'\)\}\s+accessibilityState=\{\{ checked: acceptedTerms \}\}\s+aria-checked=\{acceptedTerms\}\s+style=\{styles\.termsCheckboxButton\}\s+onPress=\{\(\) => setAcceptedTerms\(\(value\) => !value\)\}/);
  assert.match(signUp, /openLegalDocument\(TERMS_OF_USE_URL\)/);
  assert.match(signUp, /openLegalDocument\(PRIVACY_POLICY_URL\)/);
  assert.match(signUp, /termsCheckboxButton: \{ width: 44, height: 44,/);
  // <Link asChild> spreads its child's style: an array there loses every rule
  // (that is what left "I already have an account" bare and off-centre).
  assert.match(signUp, /style=\{StyleSheet\.flatten\(\[styles\.haveAccountBtn, \{ borderColor: colors\.primary \}\]\)\}/);
  assert.match(signUp, /haveAccountBtn: \{[^}]*alignSelf: 'center',[^}]*marginTop: 20,/);
  for (const file of ['app/(auth)/sign-in.tsx', 'app/(auth)/sign-up.tsx', 'app/(auth)/reset-password.tsx']) {
    assert.doesNotMatch(read(file), /asChild\s*>\s*<TouchableOpacity[^>]*?style=\{\[/, `${file}: an array style under <Link asChild>`);
  }
});

test('sign-in, sign-up and reset-password are one family', () => {
  const signIn = read('app/(auth)/sign-in.tsx');
  const signUp = read('app/(auth)/sign-up.tsx');
  const reset = read('app/(auth)/reset-password.tsx');
  // One brand block: the lighthouse tile, the name and the tagline.
  for (const [name, screen] of [['sign-in', signIn], ['sign-up', signUp], ['reset-password', reset]] as const) {
    assert.equal(screen.split('<AuthBrand />').length - 1, 1, name);
    assert.doesNotMatch(screen, /images\/logo\.png/, name);
  }
  const brand = read('src/components/auth/AuthBrand.tsx');
  assert.match(brand, /<AppLogo size=\{72\} \/>\s+<Text style=\{\[styles\.appName, \{ color: colors\.primary \}\]\}>\{t\('appName'\)\}<\/Text>\s+<Text style=\{\[styles\.tagline, \{ color: colors\.inkSoft \}\]\}>\{t\('appTagline'\)\}<\/Text>/);
  for (const lang of ['en', 'es']) {
    assert.equal(locale(lang, 'auth').appName, 'Sober Helpline');
    assert.ok(locale(lang, 'auth').appTagline);
  }
  // The same heading, main button and card on all three.
  for (const screen of [signIn, signUp, reset]) {
    assert.match(screen, /title: \{ fontSize: 20, fontWeight: '700',/);
    assert.match(screen, /primaryBtn: \{\s*borderRadius: 99,/);
    assert.match(screen, /primaryBtnText: \{ color: '#fff', fontSize: 15, fontWeight: '700' \}/);
    assert.match(screen, /borderRadius: 20,/);
  }
  // The way to the other screen is the same outlined button on both.
  assert.match(signIn, /<Link href="\/\(auth\)\/sign-up" asChild>\s+<TouchableOpacity\s+accessibilityRole="link"[\s\S]*?style=\{StyleSheet\.flatten\(\[styles\.otherScreenBtn, \{ borderColor: colors\.primary \}\]\)\}[\s\S]*?t\('signIn\.noAccount'\)[\s\S]*?t\('signIn\.signUpLink'\)/);
  assert.match(signIn, /otherScreenBtn: \{[^}]*minHeight: 48,/);
});

test('sign-in: return on the password field signs in, when the button could', () => {
  const signIn = read('app/(auth)/sign-in.tsx');
  assert.match(signIn, /ref=\{passwordInput\}[\s\S]*?returnKeyType="go"\s+onSubmitEditing=\{\(\) => \{ if \(!loading && email && password\) void handleEmailSignIn\(\); \}\}/);
  assert.match(signIn, /disabled=\{loading \|\| !email \|\| !password\}/);
  // Return on the email field moves on to the password.
  assert.match(signIn, /returnKeyType="next"\s+onSubmitEditing=\{\(\) => passwordInput\.current\?\.focus\(\)\}/);
});

// ── Onboarding ───────────────────────────────────────────────────────────────

type Node = { type: unknown; props: Record<string, any> };

function loadWelcome(language: string, guided: Record<string, unknown>) {
  const slots: unknown[] = [];
  let cursor = 0;
  const React = {
    Fragment: 'Fragment',
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: { ...props, children } }),
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === 'function' ? (value as (prev: unknown) => unknown)(slots[index]) : value; }];
    },
  };
  const code = ts.transpileModule(read('app/(onboarding)/welcome.tsx'), {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'react') return React;
    if (id === 'react-native') return { View: 'View', Text: 'Text', TouchableOpacity: 'Button', ScrollView: 'ScrollView', StyleSheet: { create: (styles: unknown) => styles } };
    if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (id === 'expo-router') return { useRouter: () => ({ push: () => assert.fail('urgent help never leaves the screen') }) };
    if (id === 'react-i18next') return { useTranslation: () => ({ t: (key: string) => key, i18n: { language } }) };
    if (id.includes('ThemeContext')) return { useTheme: () => ({ colors: { primary: 'primary', white: 'white', line: 'line', ink: 'ink', inkSoft: 'inkSoft', coral: 'coral' } }) };
    if (id.includes('AccountContext')) return { useAccount: () => ({ user: { id: 'a' } }) };
    if (id.endsWith('useGuidedStart')) return { useGuidedStart: () => guided };
    if (id.endsWith('guidedStartCopy')) return { guidedStartCopy };
    if (id.endsWith('lib/guidedStart')) return { SITUATIONS: ['worried', 'refuses', 'treatment', 'boundaries', 'urgent'] };
    if (id.endsWith('EmergencyActions')) return { EmergencyActions: 'EmergencyActions' };
    if (id.endsWith('AppLogo')) return { AppLogo: 'AppLogo' };
    if (id.endsWith('NavyScreenStatusBar')) return { NavyScreenStatusBar: 'NavyScreenStatusBar' };
    throw Error(id);
  }, exports);
  const flatten = (node: unknown): Node[] => Array.isArray(node)
    ? node.flatMap(flatten)
    : node && typeof node === 'object' ? [node as Node, ...flatten((node as Node).props.children)] : [];
  const words = (node: unknown): string => Array.isArray(node)
    ? node.map(words).join('')
    : typeof node === 'string' ? node : node && typeof node === 'object' ? words((node as Node).props.children) : '';
  return {
    render() {
      cursor = 0;
      // WelcomeScreen renders <WelcomeContent>; render that body directly.
      const content = exports.default();
      const nodes = flatten((content.type as (props: unknown) => unknown)(content.props));
      const tappable = (label: string) => {
        const found = nodes.find((node) => node.type === 'Button' && words(node) === label || node.type === 'Button' && words(node) === `${label}✓`);
        assert.ok(found, `a tappable "${label}"`);
        return found;
      };
      return { nodes, tappable, words };
    },
  };
}

test('the first screen: urgent help opens in place and never leaves the screen or waits, in English and Spanish', () => {
  for (const language of ['en', 'es']) {
    const welcome = loadWelcome(language, {});
    const c = guidedStartCopy(language);
    let view = welcome.render();
    // The emergency contacts are not shown until asked for.
    assert.equal(view.nodes.some((node) => node.type === 'EmergencyActions'), false);
    const urgent = view.tappable(c.situations.urgent);
    assert.equal(urgent.props.accessibilityRole, 'button');
    assert.deepEqual(urgent.props.accessibilityState, { expanded: false });
    urgent.props.onPress();
    view = welcome.render();
    assert.ok(view.nodes.some((node) => node.type === 'EmergencyActions' && node.props.prominent === true));
    assert.ok(view.nodes.some((node) => node.props.accessibilityRole === 'alert' && view.words(node) === c.disclaimer));
    assert.deepEqual(view.tappable(c.situations.urgent).props.accessibilityState, { expanded: true });
  }
});

test('the first screen: no starting-point question; the two ways in, then a quiet urgent-help link', () => {
  const screen = read('app/(onboarding)/welcome.tsx');
  assert.doesNotMatch(screen, /StartingPointQuestion|useGuidedStart|setChoosing/);
  assert.match(screen, /style=\{styles\.changeLink\}\s+onPress=\{\(\) => setUrgent\(\(open\) => !open\)\}/);
  assert.match(screen, /changeLink: \{[^}]*minHeight: 44/);
  assert.doesNotMatch(/changeLink: \{[^}]*\}/.exec(screen)?.[0] ?? '', /border|backgroundColor/);
  // A solid white outline and white words, not a faint fill.
  assert.match(screen, /choiceBtn: \{[^}]*borderWidth: 1\.5,\s+borderColor: '#fff',/);
  assert.match(screen, /choiceBtnOutline: \{\s+backgroundColor: 'transparent',\s+\}/);
  assert.match(screen, /onPress=\{\(\) => router\.push\('\/\(onboarding\)\/loved-one'\)\}/);
  assert.match(screen, /onPress=\{\(\) => router\.push\('\/\(onboarding\)\/invite-code'\)\}/);
});

test('the last step: the long "Save my spot" label has room and wraps centred', () => {
  const screen = read('app/(onboarding)/notifications.tsx');
  assert.match(screen, /rsvpBtn: \{[^}]*minHeight: 48,[^}]*paddingHorizontal: 24,[^}]*justifyContent: 'center'/);
  assert.match(screen, /rsvpBtnText: \{[^}]*textAlign: 'center'/);
  assert.doesNotMatch(/rsvpBtn: \{[^}]*\}/.exec(screen)?.[0] ?? '', /\bheight:/);
  // What the tap does is untouched.
  assert.match(screen, /onPress=\{\(\) => void reserveSpot\(\)\}\s+disabled=\{reserving \|\| \(spanish && rsvped\)\}/);
});

test('every onboarding step ends the same way: one main button, then a quiet link with a 44-point target', () => {
  for (const file of ['app/(onboarding)/loved-one.tsx', 'app/(onboarding)/notifications.tsx', 'app/(onboarding)/consent.tsx', 'app/(onboarding)/invite-code.tsx']) {
    const screen = read(file);
    assert.match(screen, /primaryBtn: \{ borderRadius: 99,/, file);
    assert.match(screen, /skipBtn: \{ alignItems: 'center', justifyContent: 'center', minHeight: 44,/, file);
  }
});

test('the reminders step says the Monday meeting is among the reminders, in the words true of each language', () => {
  const en = locale('en', 'onboarding').notifications.body;
  const es = locale('es', 'onboarding').notifications.body;
  // English: the reminder goes to every device with reminders on (accounts.family_call_reminders defaults on).
  assert.match(en, /That includes Family Squares, our free Monday meeting\./);
  // Spanish: La Sobremesa reminds only those who reserved.
  assert.match(es, /Eso incluye La Sobremesa, nuestra reunión gratuita de los lunes, cuando reservas tu lugar\./);
  for (const body of [en, es]) assert.doesNotMatch(body, /[—–]/);
  assert.doesNotMatch(es, /Family Squares/);
});
