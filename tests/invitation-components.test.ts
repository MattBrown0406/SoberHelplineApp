import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { scoreReceptivity } from '../src/lib/invitationForecast';
import { INVITATION_MOVES } from '../src/lib/invitationMoves';

// Execute the real component render functions with deterministic React/native
// doubles (same approach as today-ux.test.mjs). Pure src/lib modules load for
// real; sibling components are transpiled through the same doubles.

type Node = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
const realRequire = createRequire(import.meta.url);

function harness(stubs: Record<string, unknown> = {}) {
  const states: unknown[] = [];
  let cursor = 0;
  const routes: unknown[] = [];
  const React = {
    Fragment: 'Fragment',
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: { ...props, children } }),
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      return [states[index], (value: unknown) => {
        states[index] = typeof value === 'function' ? (value as (v: unknown) => unknown)(states[index]) : value;
      }];
    },
    useEffect() {},
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useRef: (value: unknown) => ({ current: value }),
  };
  const native = Object.fromEntries(['View', 'Text', 'TextInput', 'TouchableOpacity', 'ActivityIndicator', 'Switch'].map((x) => [x, x]));
  (native as Record<string, unknown>).StyleSheet = { create: (x: unknown) => x };
  const colors = new Proxy({}, { get: (_, key) => `#${String(key)}` });
  const cache = new Map<string, Record<string, unknown>>();

  function load(file: string): Record<string, unknown> {
    const cached = cache.get(file);
    if (cached) return cached;
    const source = readFileSync(file, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: Record<string, unknown> = {};
    cache.set(file, exports);
    const dir = dirname(file);
    const req = (id: string) => {
      if (id === 'react') return React;
      if (id === 'react-native') return native;
      if (id === 'expo-router') return { useRouter: () => ({ push: (route: unknown) => routes.push(route) }) };
      if (id === 'react-i18next') {
        return { useTranslation: () => ({ t: (key: string, params?: unknown) => (params ? `${key}:${JSON.stringify(params)}` : key) }) };
      }
      if (id.includes('ThemeContext')) return { useTheme: () => ({ colors }) };
      if (id in stubs) return stubs[id];
      if (id.startsWith('./')) return load(resolve(dir, `${id}.tsx`));
      if (id.startsWith('.')) return realRequire(resolve(dir, id));
      throw Error(`unexpected import ${id}`);
    };
    new Function('require', 'exports', output)(req, exports);
    return exports;
  }

  function flatten(node: unknown): Node[] {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    const n = node as Node;
    if (typeof n.type === 'function') return flatten((n.type as (p: unknown) => unknown)(n.props));
    return [n, ...flatten(n.props.children)];
  }
  const text = (node: unknown): string => typeof node === 'string' ? node
    : Array.isArray(node) ? node.map(text).join(' ')
      : node && typeof node === 'object' ? text((node as Node).props.children) : '';

  function mount(file: string, name: string, props: Record<string, unknown>) {
    const component = load(resolve(file))[name] as (p: unknown) => unknown;
    let tree: unknown;
    const api = {
      render() { cursor = 0; tree = component(props); return api; },
      nodes: () => flatten(tree),
      text: () => text(flatten(tree).filter((n) => n.type === 'Text').map((n) => n.props.children)),
      touchables: () => flatten(tree).filter((n) => n.type === 'TouchableOpacity'),
      press(label: string) {
        const button = api.touchables().find((n) => n.props.accessibilityLabel === label || text(n).includes(label));
        assert.ok(button, `button ${label}`);
        (button.props.onPress as () => void)();
        api.render();
      },
      routes,
    };
    return api.render();
  }
  return { mount };
}

const NOW = Date.parse('2026-10-02T22:00:00Z');

test('forecast card shows the level, at most three reasons, and a toggleable quick check', () => {
  const calls: unknown[] = [];
  const forecast = scoreReceptivity({
    nowMs: NOW, localHour: 17, localWeekday: 5, latestConsequenceAt: new Date(NOW - 3_600_000).toISOString(),
    warningThisWeek: 0, warningLastWeek: 2, recoveryThisWeek: 2, recoveryLastWeek: 0,
    soberTimes: ['evening'], moveDaysLast7: 5, todayCheck: 'calm', safetySerious: false,
    localDate: '2026-10-02', lastOutcome: null, lastOutcomeDate: null, nextWindowDate: null, recoveryPhase: null,
  });
  const ui = harness().mount('src/components/invitation/ForecastCard.tsx', 'ForecastCard', {
    forecast, check: 'calm', onCheck: (mood: unknown) => calls.push(mood), checkSaving: false, checkError: false,
  });
  assert.match(ui.text(), /forecast\.level\.good/);
  const reasonTexts = ui.nodes().filter((n) => n.type === 'Text' && /^forecast\.reasons\./.test(String((n.props.children as unknown[])[0])));
  assert.equal(forecast.reasons.length > 3, true, 'fixture has more reasons than fit');
  assert.equal(reasonTexts.length, 3, 'only the top three reasons are shown');
  ui.press('forecast.check.rough');
  ui.press('forecast.check.calm');
  assert.deepEqual(calls, ['rough', null]);
  assert.match(ui.text(), /common\.notPromise/);
});

test('daily moves: one tap marks done; compact mode hides the how-to', () => {
  const toggled: unknown[] = [];
  const moves = [INVITATION_MOVES[0], INVITATION_MOVES[10]];
  const props = {
    moves, movesDone: [moves[1].id], onToggle: (id: unknown) => toggled.push(id), busyMove: null, error: false,
    familyScope: true, ownProfile: null, localDate: '2026-10-02',
  };
  const full = harness().mount('src/components/invitation/DailyMovesCard.tsx', 'DailyMovesCard', props);
  assert.match(full.text(), new RegExp(`moves\\.${moves[0].id}\\.body`));
  assert.match(full.text(), /moves\.familyNote/);
  full.press(`moves.doneA11y:${JSON.stringify({ title: `moves.${moves[0].id}.title` })}`);
  assert.deepEqual(toggled, [moves[0].id]);
  const checkboxes = full.touchables().filter((n) => n.props.accessibilityRole === 'checkbox');
  assert.deepEqual(checkboxes.map((n) => (n.props.accessibilityState as { checked: boolean }).checked), [false, true]);
  const compact = harness().mount('src/components/invitation/DailyMovesCard.tsx', 'DailyMovesCard', { ...props, compact: true });
  assert.doesNotMatch(compact.text(), /\.body/);
  assert.doesNotMatch(compact.text(), /moves\.familyNote/);
});

test('safety-first panel offers 911, the DV hotline (call and text) and Matt', () => {
  const links: unknown[] = [];
  const { mount } = harness({ '../../lib/emergencyLinks': { openEmergencyLink: (...args: unknown[]) => links.push(args) } });
  const ui = mount('src/components/invitation/SafetyFirstPanel.tsx', 'SafetyFirstPanel', {});
  assert.match(ui.text(), /safety\.danger/);
  ui.press('safety.call911');
  ui.press('safety.callHotline');
  ui.press('safety.textHotline');
  ui.press('safety.mattButton');
  assert.deepEqual(links, [['tel:911'], ['tel:18007997233', '1-800-799-7233'], ['sms:88788', '88788']]);
  assert.deepEqual(ui.routes, ['/situation-brief']);
  assert.match(ui.text(), /safety\.body/);
  assert.doesNotMatch(ui.text(), /familyBody/, 'never says someone in the family flagged anything');
});

test('the window safety notice replaces "leave now" with 911 and safety options', () => {
  const links: unknown[] = [];
  const { mount } = harness({ '../../lib/emergencyLinks': { openEmergencyLink: (...args: unknown[]) => links.push(args) } });
  const ui = mount('src/components/invitation/WindowSafetyNotice.tsx', 'WindowSafetyNotice', {});
  assert.match(ui.text(), /windowSafety\.title/);
  assert.doesNotMatch(ui.text(), /sayText|window\./);
  ui.press('safety.call911');
  ui.press('windowSafety.options');
  assert.deepEqual(links, [['tel:911']]);
  assert.deepEqual(ui.routes, ['/invitation-engine']);
});

test('paused card offers the plan after a yes and an update link, never an invitation', () => {
  const afterYes = harness().mount('src/components/invitation/PausedCard.tsx', 'PausedCard', { reason: 'after_yes' });
  assert.match(afterYes.text(), /paused\.after_yes\.title/);
  afterYes.press('paused.openPlan');
  afterYes.press('paused.logUpdate');
  assert.deepEqual(afterYes.routes, ['/treatment-action-plan', '/invitation-outcome']);
  assert.doesNotMatch(afterYes.text(), /prepare|kit\./i);
  const opened: unknown[] = [];
  const compact = harness().mount('src/components/invitation/PausedCard.tsx', 'PausedCard', {
    reason: 'in_treatment', compact: true, openLabel: 'today.open', onOpen: () => opened.push(true),
  });
  assert.equal(compact.touchables().length, 1);
  compact.press('today.open');
  assert.deepEqual(opened, [true]);
});

test('chip picker adds suggestions and free text, and removes on tap', () => {
  let items: string[] = ['Friday nights'];
  const props = {
    items,
    onChange: (next: string[]) => { items = next; props.items = next; },
    suggestions: [{ label: 'With old using friends', fromTracker: true }, { label: 'Friday nights', fromTracker: false }],
  };
  const ui = harness().mount('src/components/invitation/ChipPicker.tsx', 'ChipPicker', props);
  assert.match(ui.text(), /setup\.fromTracker/);
  assert.equal(ui.touchables().filter((n) => String(n.props.accessibilityLabel).startsWith('setup.addA11y')).length, 1, 'already-added suggestions are hidden');
  ui.press(`setup.addA11y:${JSON.stringify({ item: 'With old using friends' })}`);
  assert.deepEqual(items, ['Friday nights', 'With old using friends']);
  const input = ui.nodes().find((n) => n.type === 'TextInput')!;
  (input.props.onChangeText as (v: string) => void)('  after   payday ');
  ui.render();
  ui.press('setup.add');
  assert.deepEqual(items, ['Friday nights', 'With old using friends', 'after payday']);
  ui.press(`setup.removeA11y:${JSON.stringify({ item: 'Friday nights' })}`);
  assert.deepEqual(items, ['With old using friends', 'after payday']);
});

test('chip picker can hand its typed text to the parent (setup commits it on Next/Previous/Back)', () => {
  let items: string[] = [];
  let typed = '';
  const props = {
    items,
    onChange: (next: string[]) => { items = next; props.items = next; },
    suggestions: [],
    draftText: typed,
    onDraftChange: (text: string) => { typed = text; props.draftText = text; },
  };
  const ui = harness().mount('src/components/invitation/ChipPicker.tsx', 'ChipPicker', props);
  const input = () => ui.nodes().find((n) => n.type === 'TextInput')!;
  (input().props.onChangeText as (v: string) => void)('fights with his dad');
  ui.render();
  // Typed but not Added: owned by the parent, shown in the field, not in the list.
  assert.equal(typed, 'fights with his dad');
  assert.equal(input().props.value, 'fights with his dad');
  assert.deepEqual(items, []);
  // The parent clears it (as setup does after committing on Next) → the field is empty.
  props.onDraftChange('');
  ui.render();
  assert.equal(input().props.value, '');
  // Add still works and clears the parent's copy.
  (input().props.onChangeText as (v: string) => void)('payday');
  ui.render();
  ui.press('setup.add');
  assert.deepEqual(items, ['payday']);
  assert.equal(typed, '');
});

test('chip picker locks typing and Add while the parent is saving', () => {
  let items: string[] = [];
  const props = {
    items,
    onChange: (next: string[]) => { items = next; props.items = next; },
    suggestions: [],
    draftText: 'payday',
    onDraftChange: (text: string) => { props.draftText = text; },
    inputDisabled: true,
  };
  const ui = harness().mount('src/components/invitation/ChipPicker.tsx', 'ChipPicker', props);
  const input = ui.nodes().find((n) => n.type === 'TextInput')!;
  assert.equal(input.props.editable, false);
  const add = ui.touchables().find((n) => n.props.accessibilityLabel === 'setup.add')!;
  assert.equal(add.props.disabled, true);
  (input.props.onSubmitEditing as () => void)();
  assert.deepEqual(items, [], 'nothing added while locked');
  props.inputDisabled = false;
  ui.render();
  ui.press('setup.add');
  assert.deepEqual(items, ['payday']);
});

test('crisis resources offer 911, 988 (call and text), the DV hotline and Matt — no invitation', () => {
  const links: unknown[] = [];
  const { mount } = harness({ '../../lib/emergencyLinks': { openEmergencyLink: (...args: unknown[]) => links.push(args) } });
  const ui = mount('src/components/invitation/CrisisResourcesPanel.tsx', 'CrisisResourcesPanel', {});
  for (const label of ['crisis.call911', 'crisis.call988', 'crisis.text988', 'safety.callHotline', 'safety.textHotline', 'safety.mattButton']) ui.press(label);
  assert.deepEqual(links, [['tel:911'], ['tel:988'], ['sms:988'], ['tel:18007997233', '1-800-799-7233'], ['sms:88788', '88788']]);
  assert.deepEqual(ui.routes, ['/situation-brief']);
  assert.doesNotMatch(ui.text(), /kit\.|lines\./);
});

test('the unknown-safety window notice offers 911 and a retry, not "leave now"', () => {
  const links: unknown[] = [];
  const retries: unknown[] = [];
  const { mount } = harness({ '../../lib/emergencyLinks': { openEmergencyLink: (...args: unknown[]) => links.push(args) } });
  const ui = mount('src/components/invitation/WindowSafetyNotice.tsx', 'WindowSafetyNotice', { unknown: true, onRetry: () => retries.push(1) });
  assert.match(ui.text(), /windowSafety\.unknownTitle/);
  ui.press('safety.call911');
  ui.press('windowSafety.retry');
  assert.deepEqual(links, [['tel:911']]);
  assert.equal(retries.length, 1);
});

test('phase pauses point to the right next step', () => {
  const home = harness().mount('src/components/invitation/PausedCard.tsx', 'PausedCard', { reason: 'returning_home' });
  assert.match(home.text(), /paused\.returning_home\.title/);
  home.press('paused.openHomecoming');
  home.press('paused.updateStage');
  assert.deepEqual(home.routes, ['/homecoming-week', '/(tabs)']);
  const recovery = harness().mount('src/components/invitation/PausedCard.tsx', 'PausedCard', { reason: 'in_recovery' });
  assert.match(recovery.text(), /paused\.in_recovery\.body/);
  assert.equal(recovery.touchables().length, 1, 'only "update their stage"');
});

test('the crisis panel points to where the words came from, without a bypass', () => {
  const map = harness({ '../../lib/emergencyLinks': { openEmergencyLink: () => undefined } })
    .mount('src/components/invitation/CrisisResourcesPanel.tsx', 'CrisisResourcesPanel', { field: 'usual_phrases' });
  assert.match(map.text(), /crisis\.mapHint/);
  map.press('crisis.editMap');
  assert.deepEqual(map.routes, [{ pathname: '/invitation-setup', params: { step: 'phrases' } }]);
  assert.doesNotMatch(map.text(), /crisis\.editHint/);
  const typed = harness({ '../../lib/emergencyLinks': { openEmergencyLink: () => undefined } })
    .mount('src/components/invitation/CrisisResourcesPanel.tsx', 'CrisisResourcesPanel', { field: 'observation' });
  assert.match(typed.text(), /crisis\.editHint/);
  assert.doesNotMatch(typed.text(), /crisis\.editMap/);
  const plan = harness({ '../../lib/emergencyLinks': { openEmergencyLink: () => undefined } })
    .mount('src/components/invitation/CrisisResourcesPanel.tsx', 'CrisisResourcesPanel', { field: 'next_step' });
  plan.press('crisis.editPlan');
  assert.deepEqual(plan.routes, ['/treatment-action-plan']);
});

test('the "safe right now" choice sits after every resource, with a link to review her safety answer', () => {
  const acknowledged: unknown[] = [];
  const ui = harness({ '../../lib/emergencyLinks': { openEmergencyLink: () => undefined } })
    .mount('src/components/invitation/CrisisResourcesPanel.tsx', 'CrisisResourcesPanel', {
      field: 'recent_incidents', onAcknowledge: () => acknowledged.push(true),
    });
  const labels = ui.touchables().map((n) => String(n.props.accessibilityLabel));
  assert.ok(labels.indexOf('crisis.acknowledge') > labels.indexOf('crisis.call911'), 'help first');
  assert.ok(labels.indexOf('crisis.acknowledge') > labels.indexOf('safety.callHotline'));
  assert.ok(labels.includes('crisis.editMap'));
  ui.press('crisis.acknowledge');
  ui.press('crisis.reviewSafety');
  assert.deepEqual(acknowledged, [true]);
  assert.deepEqual(ui.routes.at(-1), { pathname: '/invitation-setup', params: { step: 'safety' } });
  const flagged = harness({ '../../lib/emergencyLinks': { openEmergencyLink: () => undefined } })
    .mount('src/components/invitation/CrisisResourcesPanel.tsx', 'CrisisResourcesPanel', { field: 'unknown' });
  assert.equal(flagged.touchables().some((n) => n.props.accessibilityLabel === 'crisis.acknowledge'), false, 'no bypass without onAcknowledge');
});
