import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  consequenceOccurredAt,
  isConsequenceEventType,
  parseConsequenceEvent,
  willingnessWindowState,
  WILLINGNESS_WINDOW_HOURS,
} from '../src/lib/willingnessWindow';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('a fresh consequence opens a bounded 72-hour window', () => {
  const now = new Date('2026-08-14T12:00:00.000Z');
  const state = willingnessWindowState('2026-08-14T12:00:00.000Z', now);
  assert.equal(WILLINGNESS_WINDOW_HOURS, 72);
  assert.equal(state.active, true);
  assert.equal(state.hoursRemaining, 72);
  assert.equal(state.elapsedHours, 0);
  assert.equal(state.endsAt, '2026-08-17T12:00:00.000Z');
});

test('the opening counts down and closes at 72 hours', () => {
  const occurredAt = '2026-08-14T12:00:00.000Z';
  const beforeClose = willingnessWindowState(occurredAt, new Date('2026-08-17T11:01:00.000Z'));
  assert.equal(beforeClose.active, true);
  assert.equal(beforeClose.hoursRemaining, 1);
  const closed = willingnessWindowState(occurredAt, new Date('2026-08-17T12:00:00.000Z'));
  assert.equal(closed.active, false);
  assert.equal(closed.hoursRemaining, 0);
});

test('invalid and materially future timestamps never open a window', () => {
  const now = new Date('2026-08-14T12:00:00.000Z');
  assert.equal(willingnessWindowState('not-a-date', now).active, false);
  assert.equal(willingnessWindowState('2026-08-14T12:06:00.000Z', now).active, false);
});

test('quick timing choices produce honest approximate offsets', () => {
  const now = new Date('2026-08-14T12:00:00.000Z');
  assert.equal(consequenceOccurredAt('now', now), '2026-08-14T12:00:00.000Z');
  assert.equal(consequenceOccurredAt('earlier_today', now), '2026-08-14T06:00:00.000Z');
  assert.equal(consequenceOccurredAt('yesterday', now), '2026-08-13T12:00:00.000Z');
  assert.equal(consequenceOccurredAt('two_days_ago', now), '2026-08-12T12:00:00.000Z');
});

test('event parsing accepts only the consequence allowlist and valid timestamps', () => {
  assert.equal(isConsequenceEventType('medical'), true);
  assert.equal(isConsequenceEventType('warning'), false);
  assert.deepEqual(parseConsequenceEvent({
    id: 'event-1',
    event_type: 'medical',
    occurred_at: '2026-08-14T12:00:00.000Z',
  }), {
    id: 'event-1',
    eventType: 'medical',
    occurredAt: '2026-08-14T12:00:00.000Z',
  });
  assert.equal(parseConsequenceEvent({ id: 'event-2', event_type: 'warning', occurred_at: 'now' }), null);
});

test('loading and failed reads keep safety guidance visible and block a false closed state', () => {
  const card = readFileSync(resolve(ROOT, 'src/components/tracker/WillingnessWindowCard.tsx'), 'utf8');
  const hook = readFileSync(resolve(ROOT, 'src/hooks/useWillingnessWindow.ts'), 'utf8');
  const loadingBranch = card.slice(card.indexOf('if (windowData.loading)'), card.indexOf('if (windowData.loadError)'));
  const errorBranch = card.slice(card.indexOf('if (windowData.loadError)'), card.indexOf('const activeEvent'));
  const activeBranch = card.slice(card.indexOf('{activeEvent ? ('), card.indexOf('<View style={styles.linkRow}>'));
  assert.match(loadingBranch, /<SafetyNote\s*\/>/);
  assert.match(errorBranch, /<SafetyNote\s*\/>/);
  assert.match(errorBranch, /windowData\.retry/);
  assert.doesNotMatch(errorBranch, /setShowLogger/);
  assert.ok(activeBranch.indexOf('<SafetyNote />') < activeBranch.indexOf('window.sayLabel'));
  assert.match(hook, /loadedAccountId === accountId \? latestEvent : null/);
});
