import { fileURLToPath as localFilePath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';

// 4.4 navigation: four tabs (Today, Practice, Tools, Support). Boundaries is a
// part of Practice (its old tab route stays registered, hidden, and forwards);
// the Tracker is a pushed screen with no tab of the same name.

const root = localFilePath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const locale = (lang, ns) => JSON.parse(read(`src/locales/${lang}/${ns}.json`));

test('the tab bar shows four tabs in order; Boundaries stays registered but hidden; no tracker tab', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  const visible = [...layout.matchAll(/<Tabs\.Screen\s+name="(\w+)"\s+options=\{\{\s+title:/g)].map((m) => m[1]);
  assert.deepEqual(visible, ['index', 'scripts', 'learn', 'support']);
  assert.match(layout, /<Tabs\.Screen name="boundaries" options=\{\{ href: null \}\} \/>/);
  // A tab named "tracker" would capture router.push('/tracker') (seen on a
  // simulator in 4.4: a blank hidden tab), so neither the screen nor the file may exist.
  assert.doesNotMatch(layout, /name="tracker"/);
  assert.ok(!fs.existsSync(path.join(root, 'app/(tabs)/tracker.tsx')));
  for (const file of ['app/(tabs)/boundaries.tsx', 'app/tracker.tsx']) assert.ok(fs.existsSync(path.join(root, file)), file);
});

test('Practice: a Conversations | Boundaries switch that reads and writes the section param', () => {
  const screen = read('app/(tabs)/scripts.tsx');
  const sw = read('src/components/practice/PracticeSwitch.tsx');
  assert.match(screen, /useLocalSearchParams<\{ q\?: string; n\?: string; section\?: string \}>\(\)/);
  assert.match(screen, /const section = practiceSectionFromParam\(sectionParam\);/);
  assert.match(screen, /router\.setParams\(\{ section: next \}\);/);
  // Boundaries mounts the first time it is chosen (opening Practice on Conversations reads nothing over the
  // network), then stays mounted and is only hidden, so a half-written wall, note or code survives the switch.
  assert.match(screen, /const \[boundariesOpened, setBoundariesOpened\] = useState\(section === 'boundaries'\);/);
  assert.match(screen, /if \(section === 'boundaries'\) setBoundariesOpened\(true\);/);
  assert.match(screen, /\{\(boundariesOpened \|\| section === 'boundaries'\) && \(\s+<View style=\{\{ display: section === 'boundaries' \? 'flex' : 'none' \}\}>\s+<BoundariesPractice scrollRef=\{scrollRef\} active=\{section === 'boundaries'\} \/>/);
  assert.match(screen, /\{section !== 'boundaries' && \(\s+<>\s+<ConversationsOpened \/>/);
  // While hidden it counts no open and starts no focus re-read.
  const boundaries = read('src/components/practice/BoundariesPractice.tsx');
  assert.match(boundaries, /\{active && <BoundariesOpened \/>\}/);
  assert.match(boundaries, /if \(!active \|\| !user\?\.id\) return;/);
  // The search links from Today (q, n) still fill the search.
  assert.match(screen, /if \(typeof q === 'string' && q\.length > 0\) setQuery\(q\);\s+\}, \[q, n\]\);/);
  // Each part counts its own opens.
  assert.match(screen, /function ConversationsOpened\(\) \{\s+useToolOpened\('scripts'\);/);
  assert.match(boundaries, /function BoundariesOpened\(\) \{\s+useToolOpened\('boundaries'\);/);
  // An accessible two-part switch: a tab list of 44-point tabs with their selected state.
  assert.match(sw, /accessibilityRole="tablist"/);
  assert.match(sw, /accessibilityRole="tab"\s+accessibilityState=\{\{ selected \}\}/);
  assert.match(sw, /minHeight: 44,/);
  assert.match(sw, /\{t\(`sections\.\$\{section\}`\)\}/);
  // Only "boundaries" picks Boundaries; anything else (missing, garbage) is Conversations.
  assert.match(sw, /return raw === 'boundaries' \? 'boundaries' : 'conversations';/);
  for (const [lang, words] of [['en', ['Conversations', 'Boundaries']], ['es', ['Conversaciones', 'Límites']]]) {
    const sections = locale(lang, 'scripts').sections;
    assert.deepEqual([sections.conversations, sections.boundaries], words, lang);
    // Practice's spoken tab label names both parts.
    const purpose = locale(lang, 'common').navPurpose.scripts.toLowerCase();
    assert.ok(purpose.includes(locale(lang, 'common').nav.scripts.toLowerCase()), lang);
  }
});

test('the old Boundaries tab opens Practice on Boundaries, by navigate (a tab has no replace)', () => {
  const redirect = read('app/(tabs)/boundaries.tsx');
  assert.match(redirect, /useFocusEffect\(useCallback\(\(\) => \{\s+router\.navigate\(\{ pathname: '\/\(tabs\)\/scripts', params: \{ section: 'boundaries' \} \}\);/);
  assert.doesNotMatch(redirect, /<Redirect|supabase|use(?:Boundaries|FamilySpace|HoldLog)/);
});

test('the Tracker is a pushed screen with Back; the old tab leaves for Today, then pushes it', () => {
  const tracker = read('app/tracker.tsx');
  assert.match(tracker, /useToolOpened\('tracker'\);/);
  assert.match(tracker, /<Gate feature="tracker" fallback=\{<TrackerLocked \/>\}>/);
  assert.match(tracker, /<WillingnessWindowCard/);
  assert.match(tracker, /router\.push\('\/trajectory'\)/);
  // Back never strands her: from a notification with nothing behind, Back opens Today.
  assert.match(tracker, /if \(router\.canGoBack\(\)\) router\.back\(\);\s+else router\.replace\('\/\(tabs\)'\);/);
  // Without membership: the plans card, under the same way back.
  assert.match(tracker, /function TrackerLocked\(\) \{[\s\S]*<TrackerHeader \/>\s+<FreeTierPaywall inline \/>/);
});

test('a plain /tracker resolves to the pushed screen', () => {
  // Build expo-router's real linking config from the files under app/ and ask it.
  const require = createRequire(import.meta.url);
  const original = Module._load;
  const stub = new Proxy({}, { get: (_, key) => (key === '__esModule' ? true : key === 'Platform' ? { OS: 'ios', select: (o) => o.ios ?? o.default } : () => {}) });
  Module._load = function load(request, ...rest) {
    if (request === 'react-native' || request.startsWith('react-native/') || request === '@react-navigation/native') return stub;
    return original.call(this, request, ...rest);
  };
  try {
    const build = path.join(root, 'node_modules/expo-router/build/');
    const { getRoutes } = require(path.join(build, 'getRoutes.js'));
    const { getReactNavigationConfig } = require(path.join(build, 'getReactNavigationConfig.js'));
    const { getStateFromPath } = require(path.join(build, 'fork/getStateFromPath.js'));
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(root, 'app', dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(rel);
        else if (/\.(tsx|ts)$/.test(entry.name)) files.push(`./${rel}`);
      }
    };
    walk('');
    const context = Object.assign(() => ({ default: () => null }), { keys: () => files, resolve: (key) => key, id: 'app' });
    const config = getReactNavigationConfig(getRoutes(context, { platform: 'ios', skipGenerated: true, ignoreEntryPoints: true }), true);
    const names = (state) => {
      const out = [];
      for (let node = state?.routes?.[0]; node; node = node.state?.routes?.[0]) out.push(node.name);
      return out;
    };
    // From a tab and from a pushed screen.
    for (const segments of [['(tabs)'], ['(tabs)', 'index'], ['settings'], []]) {
      assert.deepEqual(names(getStateFromPath('/tracker', config, segments)), ['tracker'], JSON.stringify(segments));
    }
    assert.deepEqual(names(getStateFromPath('/(tabs)/boundaries', config, ['(tabs)'])), ['(tabs)', 'boundaries']);
    const practice = getStateFromPath('/(tabs)/scripts?section=boundaries', config, ['(tabs)', 'boundaries']);
    assert.deepEqual(names(practice), ['(tabs)', 'scripts']);
    assert.deepEqual(practice.routes[0].state.routes[0].params, { section: 'boundaries' });
  } finally {
    Module._load = original;
  }
});
