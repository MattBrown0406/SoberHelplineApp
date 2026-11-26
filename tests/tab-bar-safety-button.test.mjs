import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const locale = (lang, ns) => JSON.parse(read(`src/locales/${lang}/${ns}.json`));
const EMOJI = /\p{Extended_Pictographic}/u;
// Four tabs since 4.4: Boundaries is a part of Practice, the Tracker a pushed screen.
const TABS = ['today', 'scripts', 'learn', 'support'];

const layout = read('app/(tabs)/_layout.tsx');
const shortcut = read('src/components/safety/SafetyShortcut.tsx');
const container = read('src/components/ui/ScreenContainer.tsx');

/** The layout numbers and the padding rule, run for real (they are plain arithmetic). */
function containerMetrics() {
  const constants = [...container.matchAll(/^export const (?:TAB_BAR_HEIGHT|SAFETY_SHORTCUT_GAP|SAFETY_SHORTCUT_TARGET|TAB_SCREEN_BOTTOM_CLEARANCE) = .*;$/gm)].map((m) => m[0]);
  assert.equal(constants.length, 4);
  const rule = container.match(/^export function tabScreenBottomPadding[\s\S]*?^}$/m);
  assert.ok(rule);
  const js = ts.transpileModule([...constants, rule[0]].join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ exports: {} });
  vm.runInContext(js, context);
  return context.exports;
}

test('the tab bar uses one icon set, and every glyph it names exists', () => {
  assert.doesNotMatch(layout, EMOJI, 'no emoji icons in the tab bar');
  assert.doesNotMatch(layout, /AppLogo/);
  assert.match(layout, /import MaterialCommunityIcons from '@expo\/vector-icons\/MaterialCommunityIcons';/);
  const glyphs = JSON.parse(read('node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json'));
  const icons = [...layout.matchAll(/^ {2}(\w+): \{ outline: '([\w-]+)', filled: '([\w-]+)' \},$/gm)];
  assert.deepEqual(icons.map((m) => m[1]), ['index', 'scripts', 'learn', 'support']);
  for (const [, tab, outline, filled] of icons) {
    assert.ok(outline in glyphs, `${tab}: ${outline}`);
    assert.ok(filled in glyphs, `${tab}: ${filled}`);
  }
  // Outline when unselected, filled when selected, in the tab's own tint; never read aloud.
  assert.match(layout, /name=\{focused \? filled : outline\}/);
  assert.match(layout, /<MaterialCommunityIcons\s+accessible=\{false\}/);
  assert.match(layout, /size=\{24\}\s+color=\{color\}/);
  assert.ok('lifebuoy' in glyphs);
});

test('a tab name stays whole on one line at every text size', () => {
  const label = layout.slice(layout.indexOf('function TabLabel'), layout.indexOf('export default function TabLayout'));
  assert.match(label, /numberOfLines=\{1\}/);
  assert.match(label, /adjustsFontSizeToFit/);
  // Four tabs leave room: a name shrinks only a little, and only at the largest sizes.
  assert.match(label, /minimumFontScale=\{0\.85\}/);
  assert.match(label, /maxFontSizeMultiplier=\{1\.3\}/);
  assert.match(label, /\{ color \}/, 'the label keeps the tab tint');
  assert.match(layout, /fontSize: 11,\s+lineHeight: 14,\s+textAlign: 'center',\s+fontWeight: '700',/);
  assert.match(layout, /tabBarActiveTintColor: colors\.primary/);
  assert.match(layout, /tabBarInactiveTintColor: colors\.inkSoft/);
});

test('the word on a tab is the word used for that screen', () => {
  const expected = {
    en: ['Today', 'Practice', 'Tools', 'Support'],
    es: ['Hoy', 'Práctica', 'Guías', 'Apoyo'],
  };
  for (const lang of ['en', 'es']) {
    const common = locale(lang, 'common');
    assert.deepEqual(TABS.map((key) => common.navShort[key]), expected[lang], lang);
    assert.deepEqual(TABS.map((key) => common.nav[key]), expected[lang], lang);
    // The screens that carry their own title key say the same word.
    assert.equal(locale(lang, 'learn').header, common.nav.learn, lang);
    assert.equal(locale(lang, 'support').header, common.nav.support, lang);
    // What a screen reader hears for a tab still contains the word shown on it.
    for (const key of ['scripts', 'learn', 'support']) {
      assert.ok(common.navPurpose[key].toLowerCase().includes(common.nav[key].toLowerCase()), `${lang}: ${key}`);
    }
  }
  // Spanish copy that names the Tools tab uses the tab's name.
  for (const ns of ['diyInterventionPlanner', 'familyVisitationPlan', 'homecomingWeek', 'treatmentActionPlan']) {
    assert.match(locale('es', ns).back, /Guías$/, ns);
    assert.match(locale('en', ns).back, /Tools$/, ns);
  }
  assert.match(locale('es', 'support').intro, /abre Práctica.*abre Guías/);
  assert.match(locale('en', 'support').intro, /open Practice.*open Tools/);
});

test('the Safety button is on every tab, above the tab bar, and still opens the Safety Wallet', () => {
  assert.match(read('app/_layout.tsx'), /<SafetyShortcut \/>/);
  // Shown to every signed-in member on the tabs and on the Tracker (a pushed screen since 4.4, where she
  // logs warning signs); nothing else hides it.
  assert.match(shortcut, /const onTabs = segments\[0\] === '\(tabs\)';/);
  assert.match(shortcut, /const onTracker = \(segments\[0\] as string \| undefined\) === 'tracker';/);
  assert.match(shortcut, /if \(!isAuthenticated \|\| !user \|\| !\(onTabs \|\| onTracker\)\) return null;/);
  // The Tracker's content scrolls clear of it.
  const tracker = read('app/tracker.tsx');
  assert.equal(tracker.split('<ScreenContainer backgroundColor={colors.cream} contentContainerStyle={styles.clearSafety}>').length - 1, 2);
  assert.match(tracker, /clearSafety: \{ paddingBottom: TAB_SCREEN_BOTTOM_CLEARANCE \},/);
  assert.match(shortcut, /accessibilityRole="button"\s+accessibilityLabel=\{t\('safetyShortcut\.accessibility'\)\}\s+onPress=\{\(\) => router\.push\('\/safety-wallet' as never\)\}/);
  assert.match(shortcut, /\{t\('safetyShortcut\.label'\)\}/, 'the word stays next to the icon');
  assert.match(shortcut, /name="lifebuoy"/);
  assert.doesNotMatch(shortcut, EMOJI);
  // Its offset starts at the top of the tab bar on every device, so it never sits on the bar.
  // (On the Tracker, which has no tab bar, it starts at the bottom inset.)
  assert.match(shortcut, /bottom: \(onTabs \? TAB_BAR_HEIGHT : 0\) \+ insets\.bottom \+ SAFETY_SHORTCUT_GAP/);
  assert.match(layout, /height: TAB_BAR_HEIGHT \+ insets\.bottom/);
  assert.match(shortcut, /minHeight: SAFETY_SHORTCUT_TARGET,\s+minWidth: SAFETY_SHORTCUT_TARGET,/);
  const metrics = containerMetrics();
  assert.equal(metrics.TAB_BAR_HEIGHT, 64);
  assert.ok(metrics.SAFETY_SHORTCUT_GAP >= 0);
  assert.ok(metrics.SAFETY_SHORTCUT_TARGET >= 44);
  for (const lang of ['en', 'es']) {
    assert.ok(locale(lang, 'common').safetyShortcut.label);
    assert.ok(locale(lang, 'common').safetyShortcut.accessibility);
  }
});

test('tab screens can scroll their last button clear of the Safety button', () => {
  const metrics = containerMetrics();
  const top = metrics.SAFETY_SHORTCUT_GAP + metrics.SAFETY_SHORTCUT_TARGET;
  assert.ok(metrics.TAB_SCREEN_BOTTOM_CLEARANCE >= top + 8, 'the button, its offset, and a margin');
  assert.equal(metrics.tabScreenBottomPadding(undefined), metrics.TAB_SCREEN_BOTTOM_CLEARANCE);
  // A tab screen that asks for less (Tools asks for 40) still gets the clearance; one that asks for more keeps it.
  assert.equal(metrics.tabScreenBottomPadding(40), metrics.TAB_SCREEN_BOTTOM_CLEARANCE);
  assert.equal(metrics.tabScreenBottomPadding(120), 120);
  assert.equal(metrics.tabScreenBottomPadding('10%'), metrics.TAB_SCREEN_BOTTOM_CLEARANCE);
  // Only on the tabs (the same test the button uses); every other screen keeps its 48pt.
  assert.match(container, /const onTab = useSegments\(\)\[0\] === '\(tabs\)';/);
  assert.match(container, /onTab && \{\s+paddingBottom: tabScreenBottomPadding\(/);
  assert.match(container, /paddingBottom: 48,/);
  // Every tab screen is built on ScreenContainer, so the rule reaches all four
  // (Practice's Boundaries part sits inside Practice's container).
  for (const screen of ['index', 'scripts', 'learn', 'support']) {
    assert.match(read(`app/(tabs)/${screen}.tsx`), /<ScreenContainer[\s>]/, screen);
  }
});
