import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The screens a screen-reader user meets first: the front door, onboarding,
// Today's Monday-call card, Support, and every membership surface.
const FILES = [
  'src/components/today/SituationCard.tsx',
  'app/(onboarding)/welcome.tsx',
  'app/(onboarding)/notifications.tsx',
  'app/(onboarding)/loved-one.tsx',
  'app/(auth)/sign-in.tsx',
  'app/(auth)/sign-up.tsx',
  'src/components/auth/ConfirmEmailPanel.tsx',
  'src/components/ui/FreeTierPaywall.tsx',
  'app/plans.tsx',
  ...readdirSync(resolve(root, 'src/components/plans'))
    .filter((name) => name.endsWith('.tsx'))
    .sort()
    .map((name) => `src/components/plans/${name}`),
  'app/(tabs)/support.tsx',
  // The Support tab's pieces (4.4).
  ...readdirSync(resolve(root, 'src/components/support'))
    .filter((name) => name.endsWith('.tsx'))
    .sort()
    .map((name) => `src/components/support/${name}`),
  'app/(tabs)/index.tsx',
];

const TAPPABLE = new Set(['TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'Pressable']);

type Tappable = { line: number; attributes: Map<string, string> };

function tappables(file: string): Tappable[] {
  const source = readFileSync(resolve(root, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Tappable[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && TAPPABLE.has(node.tagName.getText(tree))) {
      const attributes = new Map<string, string>();
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute)) {
          attributes.set(attribute.name.getText(tree), attribute.initializer?.getText(tree) ?? 'true');
        }
      }
      found.push({
        line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
        attributes,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

test('the plans folder is covered file by file, and the check really finds tappable elements', () => {
  assert.ok(FILES.filter((file) => file.startsWith('src/components/plans/')).length >= 5);
  for (const file of ['app/(auth)/sign-in.tsx', 'app/(auth)/sign-up.tsx', 'app/plans.tsx', 'src/components/plans/PlansCard.tsx', 'src/components/today/SituationCard.tsx']) {
    assert.ok(tappables(file).length > 0, `${file}: expected at least one tappable element`);
  }
  const supportFiles = FILES.filter((file) => file === 'app/(tabs)/support.tsx' || file.startsWith('src/components/support/'));
  assert.ok(supportFiles.length >= 7);
  assert.ok(supportFiles.reduce((sum, file) => sum + tappables(file).length, 0) >= 40);
});

for (const file of FILES) {
  test(`${file}: every tappable element has an accessibilityRole`, () => {
    const missing = tappables(file)
      .filter((item) => !item.attributes.has('accessibilityRole'))
      .map((item) => `${file}:${item.line}`);
    assert.deepEqual(missing, [], 'tappable elements without an accessibilityRole');
  });

  test(`${file}: a tappable element that can be disabled says so to a screen reader`, () => {
    const missing = tappables(file)
      .filter((item) => item.attributes.has('disabled') && !item.attributes.has('accessibilityState'))
      .map((item) => `${file}:${item.line}`);
    assert.deepEqual(missing, [], 'disabled without accessibilityState');
  });

  test(`${file}: accessibility labels come from the locale files`, () => {
    for (const item of tappables(file)) {
      const label = item.attributes.get('accessibilityLabel');
      if (label === undefined) continue;
      assert.doesNotMatch(label, /^"/, `${file}:${item.line} has a hard-coded accessibilityLabel`);
    }
  });
}

test('Today: the shared header opens Settings on every version of the screen, with a real 44-point target', () => {
  const today = readFileSync(resolve(root, 'app/(tabs)/index.tsx'), 'utf8');
  // Today's title is her greeting, in the same header as every other tab.
  assert.match(today, /const header = <TabHeader title=\{greeting\} \/>;/);
  assert.doesNotMatch(today, /avatarButton|styles\.avatar/);
  // One header for the free and member Today.
  assert.equal((today.match(/\{header\}/g) ?? []).length, 2);
  // The Settings button itself: a real size (not hitSlop), a role and a label from the locale files.
  const header = readFileSync(resolve(root, 'src/components/ui/TabHeader.tsx'), 'utf8');
  assert.match(
    header,
    /<TouchableOpacity\s+accessibilityRole="button"\s+accessibilityLabel=\{t\('common:a11y\.settings'\)\}\s+onPress=\{\(\) => router\.push\('\/settings'\)\}[\s\S]*?style=\{styles\.settings\}\s+>\s+<MaterialCommunityIcons\s+name="cog-outline"\s+size=\{24\}\s+color=\{colors\.primary\}/,
  );
  assert.match(header, /settings: \{\s+width: 44,\s+minHeight: 44,/);
  assert.doesNotMatch(header, /hitSlop/);
  for (const lang of ['en', 'es']) {
    const common = JSON.parse(readFileSync(resolve(root, `src/locales/${lang}/common.json`), 'utf8'));
    assert.ok(common.a11y.settings && common.a11y.close, `${lang}: a11y labels`);
  }
});

test('Support keeps its way to Settings: the shared header, not a gear of its own', () => {
  const support = readFileSync(resolve(root, 'app/(tabs)/support.tsx'), 'utf8');
  assert.match(support, /<TabHeader title=\{t\('header'\)\} \/>/);
  assert.doesNotMatch(support, /⚙|settingsIcon/);
});

test('choices say whether they are chosen: onboarding chips, crisis-guide tabs and the language pills', () => {
  const lovedOne = readFileSync(resolve(root, 'app/(onboarding)/loved-one.tsx'), 'utf8');
  assert.match(lovedOne, /accessibilityRole=\{role\}\s+accessibilityState=\{\{ checked: selected \}\}/);
  assert.match(lovedOne, /onPress=\{\(\) => toggleSubstance\(s\)\}\s+role="checkbox"/);
  // The crisis guide now opens inside the crisis sheet (4.4).
  const crisisSheet = readFileSync(resolve(root, 'src/components/support/CrisisSheet.tsx'), 'utf8');
  assert.match(crisisSheet, /accessibilityRole="tab"\s+accessibilityState=\{\{ selected: tab === tb\.key \}\}/);
  // The guide's row says whether it is open.
  assert.match(crisisSheet, /accessibilityState=\{\{ expanded: guideOpen \}\}/);
  // The language choice is in Settings only (4.4): Support has no language pills of its own.
  const support = readFileSync(resolve(root, 'app/(tabs)/support.tsx'), 'utf8');
  assert.doesNotMatch(support, /useLanguage\(\)|languages\.map/);
  assert.match(readFileSync(resolve(root, 'app/settings.tsx'), 'utf8'), /languages\.map\(\(lang\) =>/);
});
