import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  NEXT_STEP_FALLBACK,
  NEXT_STEP_PRIORITY,
  chooseNextStep,
  type NextStepCard,
} from '../src/lib/todayNextStep';

const read = (file: string) => readFileSync(file, 'utf8');
const showing = (...cards: NextStepCard[]) => Object.fromEntries(cards.map((card) => [card, true]));

test('the next-step slot holds at most one card, by priority', () => {
  assert.deepEqual([...NEXT_STEP_PRIORITY], ['willingnessWindow', 'lovedOneCheck', 'holidayPlan', 'invitation', 'guidedStart']);
  // Everything showing: the willingness window wins, the rest wait in order.
  assert.deepEqual(chooseNextStep(showing(...NEXT_STEP_PRIORITY)), {
    slot: 'willingnessWindow',
    more: ['lovedOneCheck', 'holidayPlan', 'invitation', 'guidedStart'],
  });
  // Each card wins once everything above it has nothing to show.
  NEXT_STEP_PRIORITY.forEach((card, index) => {
    const below = NEXT_STEP_PRIORITY.slice(index);
    assert.deepEqual(chooseNextStep(showing(...below)), { slot: card, more: below.slice(1) });
  });
  assert.deepEqual(chooseNextStep(showing('invitation', 'holidayPlan')), { slot: 'holidayPlan', more: ['invitation'] });
});

test('a card with nothing to show never takes the slot and is not listed under More', () => {
  assert.deepEqual(chooseNextStep({}), { slot: null, more: [] });
  assert.deepEqual(chooseNextStep({ willingnessWindow: false, lovedOneCheck: false, guidedStart: true }), { slot: 'guidedStart', more: [] });
  assert.deepEqual(chooseNextStep({ lovedOneCheck: true, holidayPlan: false, invitation: true }), { slot: 'lovedOneCheck', more: ['invitation'] });
});

test('the always-there fallback waits for the cards above it before taking the slot', () => {
  assert.equal(NEXT_STEP_FALLBACK, 'guidedStart');
  // Still waiting: the slot stays empty rather than showing a card that is about to be replaced.
  assert.deepEqual(chooseNextStep(showing('guidedStart'), { fallbackReady: false }), { slot: null, more: ['guidedStart'] });
  // A card that is ready takes the slot at once, waiting or not.
  assert.deepEqual(chooseNextStep(showing('invitation', 'guidedStart'), { fallbackReady: false }), { slot: 'invitation', more: ['guidedStart'] });
  assert.deepEqual(chooseNextStep(showing('guidedStart'), { fallbackReady: true }), { slot: 'guidedStart', more: [] });
});

test('Today wires every candidate card through the slot, and the losers stay reachable', () => {
  const today = read('app/(tabs)/index.tsx');
  // The five cards, each still built with its own props (their show/hide rules are untouched).
  const cards = /const nextStepCards: Record<NextStepCard, React\.ReactNode> = \{([\s\S]*?)\n  \};/.exec(today)?.[1] ?? '';
  for (const entry of [
    'willingnessWindow: willingnessWindowAlert,',
    'lovedOneCheck: lovedOneCheckCard,',
    'holidayPlan: holidayCard,',
    'invitation: invitationCard,',
    'guidedStart: <GuidedStartPanel />,',
  ]) assert.ok(cards.includes(entry), entry);
  assert.match(today, /const nextStepSlot = nextStep\.slot \? \[nextStepItem\(nextStep\.slot, true\)\] : \[\];/);
  // Every card that did not win is still mounted, and shown under an open "More for this week".
  assert.match(today, /NEXT_STEP_PRIORITY\.filter\(\(card\) => card !== nextStep\.slot\)\s*\.map\(\(card\) => nextStepItem\(card, moreOpen && nextStep\.more\.includes\(card\)\)\)/);
  assert.match(today, /nextStep\.more\.length \? \[\s*<TodayDisclosureToggle\s+key="more"\s+title=\{t\('disclosure\.more'\)\}/);
  // One keyed list, so a card is not remounted when it moves between the slot and More.
  assert.equal((today.match(/\{\[\.\.\.nextStepSlot, <NeedsRouter key="needs" \/>, \.\.\.moreForThisWeek\]\}/g) ?? []).length, 2);
  assert.match(today, /<NextStepItem key=\{card\} shown=\{shown\} onShowing=\{\(showing\) => nextStep\.report\(card, showing\)\}>/);

  const item = read('src/components/today/NextStepItem.tsx');
  assert.match(item, /chooseNextStep\(showing, \{ fallbackReady \}\)/);
  // A tucked-away card is out of reach of touch and screen readers, but still measured.
  assert.match(item, /pointerEvents=\{shown \? 'auto' : 'none'\}/);
  assert.match(item, /accessibilityElementsHidden=\{!shown\}/);
  assert.match(item, /importantForAccessibility=\{shown \? 'auto' : 'no-hide-descendants'\}/);
  assert.match(item, /onLayout=\{\(event\) => onShowing\(event\.nativeEvent\.layout\.height > 0\)\}/);

  // The cards themselves were not changed to make this work.
  for (const file of ['today/WillingnessWindowAlert', 'today/LovedOneCheckCard', 'today/HolidayPlanTodayCard', 'invitation/InvitationTodayCard', 'today/GuidedStartPanel']) {
    assert.doesNotMatch(read(`src/components/${file}.tsx`), /todayNextStep|NextStepItem/);
  }
});

test('the section toggle is shared, labelled and says whether it is open', () => {
  const disclosure = read('src/components/today/TodayDisclosure.tsx');
  assert.match(disclosure, /export function TodayDisclosureToggle/);
  assert.match(disclosure, /accessibilityRole="button"\s+aria-expanded=\{expanded\} accessibilityState=\{\{ expanded \}\}/);
  assert.match(disclosure, /<TodayDisclosureToggle\s+title=\{title\}\s+expanded=\{expanded\}/);
  for (const lang of ['en', 'es']) {
    const copy = JSON.parse(read(`src/locales/${lang}/today.json`)).disclosure;
    assert.ok(copy.more && copy.invite && copy.pathway && copy.practice && copy.membership);
  }
});
