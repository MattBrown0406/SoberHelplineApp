import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  askDate,
  INVITATION_OUTCOMES,
  learningSummary,
  LINE_STYLE_CHOICES,
  parseLearningRows,
  parseProgressAttempts,
  parseProgressForecasts,
  progressSummary,
  repairPlanKeys,
  suggestNextWindowDate,
  type LearningAttempt,
} from '../src/lib/invitationOutcomes';
import { parseAdminInvitationStats } from '../src/lib/invitationAdminStats';

const en = JSON.parse(readFileSync('src/locales/en/invitation.json', 'utf8'));
const es = JSON.parse(readFileSync('src/locales/es/invitation.json', 'utf8'));

function at(path: string, locale: Record<string, unknown>): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), locale);
}

test('next window: none after yes, a short wait after not yet, longer after anger', () => {
  assert.equal(suggestNextWindowDate('yes', '2026-10-01'), null);
  assert.equal(suggestNextWindowDate('not_yet', '2026-10-01'), '2026-10-04');
  assert.equal(suggestNextWindowDate('angry', '2026-10-01'), '2026-10-08');
  assert.equal(suggestNextWindowDate('didnt_get_to_it', '2026-10-01'), '2026-10-02');
  // Weekends are their window: move to the next Saturday on or after the gap.
  assert.equal(suggestNextWindowDate('not_yet', '2026-10-01', ['weekend']), '2026-10-10');
  assert.equal(suggestNextWindowDate('not_yet', '2026-09-30', ['weekend']), '2026-10-03');
  assert.equal(suggestNextWindowDate('didnt_get_to_it', '2026-10-01', ['weekend']), '2026-10-02');
});

test('every outcome, repair step and line style has EN and ES copy', () => {
  for (const outcome of INVITATION_OUTCOMES) {
    for (const locale of [en, es]) {
      assert.ok(at(`outcome.options.${outcome}`, locale), outcome);
      assert.ok(at(`outcome.optionBody.${outcome}`, locale), outcome);
      assert.ok(at(`progress.outcome.${outcome}`, locale), outcome);
      assert.ok(at(`engine.lastAttempt.${outcome}`, locale), outcome);
      if (outcome !== 'yes') assert.ok(at(`outcome.repairTitles.${outcome}`, locale), outcome);
      for (const key of repairPlanKeys(outcome)) assert.ok(at(key, locale), key);
    }
  }
  assert.deepEqual(repairPlanKeys('yes'), []);
  for (const style of LINE_STYLE_CHOICES) assert.ok(at(`outcome.style.${style}`, en) && at(`outcome.style.${style}`, es), style);
  assert.ok(String(at('outcome.angrySafety', en)).includes('911') && String(at('outcome.angrySafety', es)).includes('911'));
});

test('learning counts what preceded each real invitation and ranks better outcomes first', () => {
  const rows: LearningAttempt[] = [
    { outcome: 'yes', windowSources: ['calm', 'sober_time'], lineStyle: 'warm', createdAt: '2026-10-01', mine: true },
    { outcome: 'not_yet', windowSources: ['sober_time'], lineStyle: 'warm', createdAt: '2026-09-28', mine: false },
    { outcome: 'angry', windowSources: ['consequence'], lineStyle: 'observation', createdAt: '2026-09-20', mine: true },
    { outcome: 'angry', windowSources: [], lineStyle: null, createdAt: '2026-09-18', mine: true },
    { outcome: 'didnt_get_to_it', windowSources: ['calm'], lineStyle: 'help', createdAt: '2026-09-17', mine: true },
  ];
  const summary = learningSummary(rows);
  assert.equal(summary.asks, 4);
  assert.equal(summary.yes, 1);
  assert.deepEqual(summary.bySource.map((row) => row.key), ['calm', 'sober_time', 'consequence', 'none']);
  assert.deepEqual(summary.bySource.find((row) => row.key === 'sober_time'), { key: 'sober_time', asks: 2, yes: 1, notYet: 1, angry: 0 });
  assert.deepEqual(summary.byStyle.map((row) => row.key), ['warm', 'observation']);
  for (const row of summary.bySource) assert.ok(at(`progress.sources.${row.key}`, en) && at(`progress.sources.${row.key}`, es));
});

test('RPC rows are parsed defensively', () => {
  assert.deepEqual(parseLearningRows('nope'), []);
  assert.deepEqual(parseLearningRows([{ outcome: 'maybe', created_at: 'x' }, { outcome: 'yes', created_at: 'x', window_sources: ['calm', 3], line_style: 'warm', mine: true }]), [
    { outcome: 'yes', windowSources: ['calm'], lineStyle: 'warm', createdAt: 'x', mine: true },
  ]);
  assert.deepEqual(parseProgressAttempts([{ outcome: 'not_yet', created_at: '2026-10-01T12:00:00Z', note: '' }]), [
    { outcome: 'not_yet', createdAt: '2026-10-01T12:00:00Z', note: null, localDate: '2026-10-01' },
  ]);
  assert.deepEqual(parseProgressForecasts([{ local_date: '2026-10-01', level: 'good', pushed_at: '2026-10-01T22:00:00Z' }, { local_date: 1, level: 'good' }]), [
    { localDate: '2026-10-01', level: 'good', pushed: true },
  ]);
});

test('progress summary counts moves, move days, outcomes and good days', () => {
  const summary = progressSummary(
    [
      { outcome: 'yes', createdAt: 'a', note: null, localDate: '2026-10-01' },
      { outcome: 'angry', createdAt: 'b', note: null, localDate: '2026-09-28' },
    ],
    ['2026-10-01', '2026-10-01', '2026-09-30'],
    [{ localDate: '2026-10-01', level: 'good', pushed: false }, { localDate: '2026-09-30', level: 'low', pushed: false }],
  );
  assert.deepEqual(summary, {
    attempts: 2,
    outcomes: { yes: 1, not_yet: 0, angry: 1, didnt_get_to_it: 0 },
    movesDone: 3,
    moveDays: 2,
    goodDays: 1,
  });
});

test('admin stats parse the RPC shape and survive missing pieces', () => {
  assert.equal(parseAdminInvitationStats(null), null);
  assert.equal(parseAdminInvitationStats({ other: 1 }), null);
  const stats = parseAdminInvitationStats({
    families_using: 3, profiles_mapped: 5, window_push_opt_ins: 2, attempts: 6, asks: 5,
    outcomes: { yes: 2, not_yet: 2, angry: 1, didnt_get_to_it: 1 },
    yes_rate: '0.400', families_with_yes: 2, median_days_to_yes: 12.5, moves_done: 40,
    last_30_days: { attempts: 4, yes: 2, moves_done: 30, new_families: 1, active_families: 3 },
    prior_30_days: { attempts: 2 },
    weekly: [{ week_start: '2026-09-28', attempts: 2, yes: 1, moves_done: 9 }, { attempts: 1 }],
    recent_yes: [{ id: 'x', created_at: '2026-10-01T12:00:00Z', first_name: 'Ann', last_name: null, email: 'ann@example.com', note: null }],
  });
  assert.ok(stats);
  assert.equal(stats.yesRate, 0.4);
  assert.equal(stats.medianDaysToYes, 12.5);
  assert.equal(stats.prior30.yes, 0);
  assert.equal(stats.weekly.length, 1);
  assert.deepEqual(stats.recentYes[0], { id: 'x', createdAt: '2026-10-01T12:00:00Z', name: 'Ann', email: 'ann@example.com' });
  assert.equal(parseAdminInvitationStats({ families_using: 0, yes_rate: null, median_days_to_yes: null })?.yesRate, null);
});

test('an invitation can be logged for the day it happened', () => {
  assert.equal(askDate('2026-10-02', 'today'), '2026-10-02');
  assert.equal(askDate('2026-10-01', 'yesterday'), '2026-09-30');
  assert.equal(askDate('2026-03-01', 'yesterday'), '2026-02-28');
  for (const day of ['today', 'yesterday']) {
    assert.ok(at(`outcome.when.${day}`, en) && at(`outcome.when.${day}`, es), day);
  }
});
