import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIFFICULTY_LADDER,
  recommendDifficulty,
  sessionScoresFromRows,
  suggestedStartingLevel,
  type SessionScore,
} from '../src/lib/practiceDifficulty';
import { readScores, scoreTrend } from '../src/lib/practiceTrends';
import type { PartnerTemperament } from '../src/lib/practiceScenarios';

const s = (temperament: PartnerTemperament, love: number, ask: number, boundaries: number, calm: number): SessionScore => ({
  temperament,
  scores: { love, ask, boundaries, calm },
});

test('the ladder climbs from minimizing to erupting', () => {
  assert.deepEqual(DIFFICULTY_LADDER, ['guarded', 'tearful', 'defensive', 'volatile']);
});

test('two strong reps in a row at this level earn the next one', () => {
  const advice = recommendDifficulty('guarded', [s('guarded', 4, 4, 4, 4), s('guarded', 4, 4, 3, 5)]);
  assert.deepEqual(advice, { action: 'up', current: 'guarded', suggested: 'tearful', reason: 'strong' });
});

test('one standout rep is enough; one good rep is not', () => {
  assert.equal(recommendDifficulty('tearful', [s('tearful', 5, 5, 4, 5)]).action, 'up');
  assert.deepEqual(recommendDifficulty('tearful', [s('tearful', 4, 4, 4, 4)]), {
    action: 'stay', current: 'tearful', suggested: 'tearful', reason: 'first',
  });
  // A single weak dimension holds them at the level even with a high average.
  assert.equal(recommendDifficulty('defensive', [s('defensive', 5, 5, 2, 5), s('defensive', 5, 5, 5, 5)]).action, 'stay');
});

test('a rough rep suggests stepping down, except at the bottom', () => {
  assert.deepEqual(recommendDifficulty('volatile', [s('volatile', 2, 2, 2, 3)]), {
    action: 'down', current: 'volatile', suggested: 'defensive', reason: 'struggling',
  });
  assert.equal(recommendDifficulty('defensive', [s('defensive', 4, 4, 1, 4)]).action, 'down');
  assert.deepEqual(recommendDifficulty('guarded', [s('guarded', 1, 2, 2, 2)]), {
    action: 'stay', current: 'guarded', suggested: 'guarded', reason: 'bottom',
  });
});

test('only reps at the current level count, and the top level stays put', () => {
  // Strong guarded reps say nothing about readiness beyond defensive.
  const recent = [s('defensive', 3, 3, 3, 3), s('guarded', 5, 5, 5, 5), s('guarded', 5, 5, 5, 5)];
  assert.deepEqual(recommendDifficulty('defensive', recent), {
    action: 'stay', current: 'defensive', suggested: 'defensive', reason: 'first',
  });
  assert.deepEqual(recommendDifficulty('volatile', [s('volatile', 5, 5, 5, 5)]), {
    action: 'stay', current: 'volatile', suggested: 'volatile', reason: 'top',
  });
  assert.equal(recommendDifficulty('tearful', []).reason, 'first');
  assert.equal(recommendDifficulty('tearful', [s('tearful', 3, 3, 3, 3), s('tearful', 3, 4, 3, 3)]).reason, 'steady');
});

test('saved rows feed the recommendation; warm-ups and malformed rows are skipped', () => {
  const rows = [
    { created_at: '2026-09-30', scenario: { temperament: 'guarded', warmup: true }, debrief: { scores: { love: 1, ask: 1, boundaries: 1, calm: 1 } } },
    { created_at: '2026-09-29', scenario: { temperament: 'guarded' }, debrief: { scores: { love: 5, ask: 5, boundaries: 4, calm: 5 } } },
    { created_at: '2026-09-28', scenario: { temperament: 'chaotic' }, debrief: { scores: { love: 5, ask: 5, boundaries: 5, calm: 5 } } },
    { created_at: '2026-09-27', scenario: null, debrief: null },
    { created_at: '2026-09-26', scenario: { temperament: 'guarded' }, debrief: { scores: { love: '5' } } },
  ];
  assert.deepEqual(sessionScoresFromRows(rows), [s('guarded', 5, 5, 4, 5)]);
  assert.deepEqual(suggestedStartingLevel(sessionScoresFromRows(rows))?.suggested, 'tearful');
  assert.equal(suggestedStartingLevel([]), null);
});

test('scores are read defensively and clamped to 1–5', () => {
  assert.deepEqual(readScores({ scores: { love: 7, ask: 0, boundaries: 2.6, calm: 3 } }), { love: 5, ask: 1, boundaries: 3, calm: 3 });
  assert.equal(readScores({ scores: { love: 3, ask: 3, boundaries: 3 } }), null);
  assert.equal(readScores('nope'), null);
});

test('the trend runs oldest to newest over full sessions, with the change since the first', () => {
  const rows = [
    { created_at: 'd4', scenario: {}, debrief: { scores: { love: 4, ask: 4, boundaries: 3, calm: 5 } } },
    { created_at: 'd3', scenario: { warmup: true }, debrief: { scores: { love: 1, ask: 1, boundaries: 1, calm: 1 } } },
    { created_at: 'd2', scenario: {}, debrief: null },
    { created_at: 'd1', scenario: {}, debrief: { scores: { love: 3, ask: 2, boundaries: 3, calm: 5 } } },
  ];
  const trend = scoreTrend(rows);
  assert.deepEqual(trend.points.map((p) => p.at), ['d1', 'd4']);
  assert.deepEqual(trend.change, { love: 1, ask: 2, boundaries: 0, calm: 0 });
  assert.equal(scoreTrend(rows.slice(0, 1)).change, null);
  const many = Array.from({ length: 15 }, (_, i) => ({
    created_at: `n${i}`,
    debrief: { scores: { love: 3, ask: 3, boundaries: 3, calm: 3 } },
  }));
  const capped = scoreTrend(many);
  assert.equal(capped.points.length, 10);
  assert.equal(capped.points[9].at, 'n0', 'newest row is last');
});

test('incoming calls (random temperament) never drive the suggested level', () => {
  const rows = [
    { created_at: 'd2', scenario: { temperament: 'volatile', mode: 'incoming_call' }, debrief: { scores: { love: 1, ask: 1, boundaries: 1, calm: 1 } } },
    { created_at: 'd1', scenario: { temperament: 'guarded' }, debrief: { scores: { love: 5, ask: 5, boundaries: 5, calm: 5 } } },
  ];
  assert.deepEqual(sessionScoresFromRows(rows), [s('guarded', 5, 5, 5, 5)]);
  assert.equal(suggestedStartingLevel(sessionScoresFromRows(rows))?.suggested, 'tearful');
});
