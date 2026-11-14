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
  assert.ok(tappables('app/(tabs)/support.tsx').length >= 40);
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

test('Today: her initial opens Settings on every version of the screen, with a real 44-point target', () => {
  const today = readFileSync(resolve(root, 'app/(tabs)/index.tsx'), 'utf8');
  assert.match(
    today,
    /<TouchableOpacity\s+accessibilityRole="button"\s+accessibilityLabel=\{t\('common:a11y\.settings'\)\}\s+onPress=\{\(\) => router\.push\('\/settings'\)\}[\s\S]*?style=\{styles\.avatarButton\}\s+>\s+<View style=\{\[styles\.avatar,/,
  );
  // A real size, not hitSlop; the negative margin keeps the header where it was.
  assert.match(today, /avatarButton: \{\s+minWidth: 44,\s+minHeight: 44,\s+margin: -3,/);
  // One header for the free, member, bereaved and still-loading Today.
  assert.equal((today.match(/\{header\}/g) ?? []).length, 4);
  assert.equal((today.match(/styles\.avatarButton/g) ?? []).length, 1);
  for (const lang of ['en', 'es']) {
    const common = JSON.parse(readFileSync(resolve(root, `src/locales/${lang}/common.json`), 'utf8'));
    assert.ok(common.a11y.settings && common.a11y.close, `${lang}: a11y labels`);
  }
});

test('Support keeps its Settings gear', () => {
  const support = readFileSync(resolve(root, 'app/(tabs)/support.tsx'), 'utf8');
  assert.match(support, /onPress=\{\(\) => router\.push\('\/settings'\)\} hitSlop=\{12\} accessibilityRole="button" accessibilityLabel=\{t\('common:a11y\.settings'\)\}/);
});

test('choices say whether they are chosen: onboarding chips, crisis-guide tabs and the language pills', () => {
  const lovedOne = readFileSync(resolve(root, 'app/(onboarding)/loved-one.tsx'), 'utf8');
  assert.match(lovedOne, /accessibilityRole=\{role\}\s+accessibilityState=\{\{ checked: selected \}\}/);
  assert.match(lovedOne, /onPress=\{\(\) => toggleSubstance\(s\)\}\s+role="checkbox"/);
  const support = readFileSync(resolve(root, 'app/(tabs)/support.tsx'), 'utf8');
  assert.match(support, /accessibilityRole="tab"\s+accessibilityState=\{\{ selected: tab === tb\.key \}\}/);
  assert.match(support, /accessibilityRole="radio"\s+accessibilityState=\{\{ checked: active \}\}/);
});
