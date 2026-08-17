import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = (path: string) => readFile(resolve(root, path), 'utf8');

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

test('alert foreground/background combinations meet WCAG AA for normal text', () => {
  assert.ok(contrast('#a94235', '#fbeae7') >= 4.5);
  assert.ok(contrast('#ffffff', '#a94235') >= 4.5);
  assert.ok(contrast('#22302f', '#d9913b') >= 4.5);
  assert.ok(contrast('#ffffff', '#b42318') >= 4.5);
  assert.ok(contrast('#3f684f', '#e9f2ec') >= 4.5);
  assert.ok(contrast('#82530e', '#fdf3e3') >= 4.5);
});

test('critical crisis controls expose semantics and 44-point targets', async () => {
  const crisis = await source('app/crisis-mode.tsx');
  assert.match(crisis, /accessibilityRole="progressbar"/);
  assert.match(crisis, /accessibilityLiveRegion="assertive"/);
  assert.match(crisis, /accessibilityRole="checkbox"/);
  assert.match(crisis, /minHeight: 44/);
});

test('script library exposes expandable state and labeled search', async () => {
  const library = await source('app/(tabs)/scripts.tsx');
  const card = await source('src/components/scripts/ScriptCard.tsx');
  assert.match(library, /accessibilityLabel=\{t\('searchPlaceholder'\)\}/);
  assert.match(library, /accessibilityState=\{\{ expanded: isOpen \}\}/);
  assert.match(library, /t\(`tags\.\$\{script\.tag\}`\)/);
  assert.match(library, /t\(`categories\.\$\{categoryKey\}`\)/);
  assert.match(card, /accessibilityState=\{\{ expanded: open \}\}/);
  assert.match(card, /minHeight: 44/);
});

test('primary tab icons are decorative and inactive labels use readable ink', async () => {
  const tabs = await source('app/(tabs)/_layout.tsx');
  assert.match(tabs, /accessible=\{false\}/);
  assert.match(tabs, /tabBarInactiveTintColor: colors\.inkSoft/);
  assert.match(tabs, /fontSize: 11/);
});

test('tracker toggles expose checkbox state and trajectory is a labeled button', async () => {
  const tracker = await source('app/(tabs)/tracker.tsx');
  assert.match(tracker, /accessibilityRole="checkbox"/);
  assert.match(tracker, /accessibilityState=\{\{ checked: active \}\}/);
  assert.match(tracker, /accessibilityLabel=\{t\('trajectory\.openButton'\)\}/);
  assert.match(tracker, /signRow:\s*\{[\s\S]*minHeight:\s*44/);
});

test('willingness-window Today alert exposes a heading, live countdown, and 44-point actions', async () => {
  const alert = await source('src/components/today/WillingnessWindowAlert.tsx');
  assert.match(alert, /accessibilityRole="summary"/);
  assert.match(alert, /accessibilityRole="header"/);
  assert.match(alert, /accessibilityLiveRegion="polite"/);
  assert.match(alert, /accessibilityRole="button"/);
  assert.match(alert, /minHeight: 48/);
});
