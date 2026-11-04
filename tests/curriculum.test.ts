import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CURRICULUM,
  CURRICULUM_ES,
  PHASE_WEEKS,
  curriculumWeek,
  getCurriculum,
  isBeyondAuthoredCurriculum,
  phaseForWeek,
  selectCurriculumPiece,
} from '../src/content/curriculum';

const JOINED = '2026-01-01T12:00:00Z';
const at = (iso: string) => new Date(Date.parse(iso));

// ─── Week derivation ──────────────────────────────────────────────────────────

test('week 1 covers the first seven days', () => {
  assert.equal(curriculumWeek(JOINED, at('2026-01-01T12:00:00Z')), 1);
  assert.equal(curriculumWeek(JOINED, at('2026-01-07T12:00:00Z')), 1);
});

test('week advances on day 8 and keeps advancing', () => {
  assert.equal(curriculumWeek(JOINED, at('2026-01-08T12:00:00Z')), 2);
  assert.equal(curriculumWeek(JOINED, at('2026-02-19T12:00:00Z')), 8);
});

test('week never wraps — the regression this feature exists to fix', () => {
  // The old focus rotation was dayOfYear % 7, so day 200 repeated day 60.
  // A curriculum week must be strictly non-decreasing over a full year.
  let previous = 0;
  for (let day = 0; day < 400; day += 1) {
    const now = new Date(Date.parse(JOINED) + day * 86400000);
    const week = curriculumWeek(JOINED, now);
    assert.ok(week >= previous, `week went backward at day ${day}`);
    previous = week;
  }
  assert.equal(curriculumWeek(JOINED, at('2026-12-31T12:00:00Z')), 53);
});

test('missing or malformed joinedAt falls back to week 1', () => {
  assert.equal(curriculumWeek(null), 1);
  assert.equal(curriculumWeek('not-a-date'), 1);
});

// ─── Phase mapping ────────────────────────────────────────────────────────────

test('weeks map onto the documented phase bounds', () => {
  assert.equal(phaseForWeek(1), 'orientation');
  assert.equal(phaseForWeek(2), 'orientation');
  assert.equal(phaseForWeek(3), 'stabilizing');
  assert.equal(phaseForWeek(5), 'stabilizing');
  assert.equal(phaseForWeek(6), 'family_recovery');
  assert.equal(phaseForWeek(8), 'family_recovery');
  assert.equal(phaseForWeek(9), 'durability');
  assert.equal(phaseForWeek(52), 'durability');
});

test('phase bounds are contiguous with no gaps', () => {
  const ordered = Object.values(PHASE_WEEKS).sort((a, b) => a.startWeek - b.startWeek);
  ordered.forEach((phase, idx) => {
    if (idx === 0) return;
    const previous = ordered[idx - 1];
    assert.equal(previous.endWeek, phase.startWeek - 1);
  });
});

// ─── Selection ────────────────────────────────────────────────────────────────

test('exact week match wins', () => {
  assert.equal(selectCurriculumPiece(1, 'calm')?.week, 1);
  assert.equal(selectCurriculumPiece(4, 'calm')?.week, 4);
  assert.equal(selectCurriculumPiece(8, 'calm')?.week, 8);
});

test('weeks 9–26 are authored and match exactly in both languages', () => {
  for (const week of [9, 13, 14, 18, 21, 26]) {
    assert.equal(selectCurriculumPiece(week, 'calm')?.week, week);
    assert.equal(selectCurriculumPiece(week, 'calm', 'es')?.week, week);
    assert.equal(selectCurriculumPiece(week, 'calm')?.phase, 'durability');
  }
  assert.equal(selectCurriculumPiece(26, 'calm', 'es')?.id, 'cur-w26-long-haul');
});

test('past week 26 it cycles through the durability pieces instead of repeating one', () => {
  assert.equal(selectCurriculumPiece(27, 'calm')?.week, 9);
  assert.equal(selectCurriculumPiece(28, 'calm')?.week, 10);
  assert.equal(selectCurriculumPiece(44, 'calm')?.week, 26);
  assert.equal(selectCurriculumPiece(45, 'calm')?.week, 9);
  assert.equal(selectCurriculumPiece(27, 'calm', 'es')?.id, selectCurriculumPiece(27, 'calm')?.id);
  // Deterministic, and never the same piece two weeks running.
  for (let week = 27; week <= 120; week += 1) {
    const piece = selectCurriculumPiece(week, 'calm');
    assert.ok(piece, `week ${week} produced no piece`);
    assert.equal(piece?.phase, 'durability');
    assert.equal(selectCurriculumPiece(week, 'calm')?.id, piece?.id);
    assert.notEqual(selectCurriculumPiece(week + 1, 'calm')?.id, piece?.id, `week ${week} repeated`);
  }
});

test('guarded cycling past week 26 only serves crisis-safe durability pieces and still rotates', () => {
  const safeCycle = CURRICULUM.filter((piece) => piece.phase === 'durability' && piece.crisisSafe)
    .sort((a, b) => a.week - b.week);
  assert.ok(safeCycle.length >= 9, 'at least half the durability pieces are crisis-safe');
  assert.equal(selectCurriculumPiece(27, 'crisis')?.id, safeCycle[0].id);
  assert.equal(selectCurriculumPiece(28, 'elevated')?.id, safeCycle[1].id);
  const seen = new Set<string>();
  for (let week = 27; week < 27 + safeCycle.length; week += 1) {
    const piece = selectCurriculumPiece(week, 'crisis', 'es');
    assert.equal(piece?.crisisSafe, true);
    seen.add(piece!.id);
  }
  assert.equal(seen.size, safeCycle.length, 'guarded cycle visits every crisis-safe piece');
});

test('relapse pieces are always crisis-safe', () => {
  for (const piece of CURRICULUM.filter((p) => p.tag === 'WHEN THEY RELAPSE')) {
    assert.equal(piece.crisisSafe, true, `${piece.id} must reach a family in crisis`);
  }
});

test('elevated and crisis bands only receive crisis-safe pieces', () => {
  for (const band of ['elevated', 'crisis'] as const) {
    for (let week = 1; week <= 60; week += 1) {
      const piece = selectCurriculumPiece(week, band);
      if (piece) {
        assert.equal(piece.crisisSafe, true, `week ${week} leaked an unsafe piece to ${band}`);
      }
    }
  }
});

test('a guarded week falls back rather than serving the unsafe exact match', () => {
  // Week 5 is authored crisisSafe:false — an elevated family must not get it.
  assert.equal(selectCurriculumPiece(5, 'calm')?.id, 'cur-w05-consistency');
  const guarded = selectCurriculumPiece(5, 'elevated');
  assert.ok(guarded);
  assert.notEqual(guarded?.id, 'cur-w05-consistency');
  assert.equal(guarded?.crisisSafe, true);
});

test('calm and watch bands are not guarded', () => {
  assert.equal(selectCurriculumPiece(5, 'watch')?.id, 'cur-w05-consistency');
});

// ─── Locale parity ────────────────────────────────────────────────────────────

test('both libraries expose identical ids, weeks, phases, and crisis flags', () => {
  assert.equal(CURRICULUM.length, CURRICULUM_ES.length);
  const es = new Map(CURRICULUM_ES.map((piece) => [piece.id, piece]));
  for (const piece of CURRICULUM) {
    const match = es.get(piece.id);
    assert.ok(match, `missing Spanish piece for ${piece.id}`);
    assert.equal(match?.week, piece.week);
    assert.equal(match?.phase, piece.phase);
    assert.equal(match?.crisisSafe, piece.crisisSafe);
    assert.equal(match?.icon, piece.icon);
    assert.equal(match?.accentColor, piece.accentColor);
    assert.equal(match?.tagBackgroundColor, piece.tagBackgroundColor);
    assert.equal(match?.tagTextColor, piece.tagTextColor);
  }
});

test('Spanish text is actually translated, not copied through', () => {
  const es = new Map(CURRICULUM_ES.map((piece) => [piece.id, piece]));
  for (const piece of CURRICULUM) {
    const match = es.get(piece.id)!;
    assert.notEqual(match.title, piece.title, `${piece.id} title untranslated`);
    assert.notEqual(match.mechanism, piece.mechanism, `${piece.id} mechanism untranslated`);
    assert.notEqual(match.practice, piece.practice, `${piece.id} practice untranslated`);
    assert.notEqual(match.prompt, piece.prompt, `${piece.id} prompt untranslated`);
    assert.notEqual(match.tag, piece.tag, `${piece.id} tag untranslated`);
  }
});

test('language selection routes to the right library', () => {
  assert.equal(getCurriculum('es').length, CURRICULUM_ES.length);
  assert.equal(getCurriculum('es-MX')[0].title, CURRICULUM_ES[0].title);
  assert.equal(getCurriculum('en')[0].title, CURRICULUM[0].title);
  assert.equal(getCurriculum(undefined)[0].title, CURRICULUM[0].title);
});

test('selection honours language', () => {
  assert.equal(selectCurriculumPiece(1, 'calm', 'es')?.title, CURRICULUM_ES[0].title);
});

// ─── Library integrity ────────────────────────────────────────────────────────

test('ids are unique and weeks are contiguous from 1', () => {
  const ids = new Set(CURRICULUM.map((piece) => piece.id));
  assert.equal(ids.size, CURRICULUM.length, 'duplicate curriculum id');
  const weeks = CURRICULUM.map((piece) => piece.week).sort((a, b) => a - b);
  weeks.forEach((week, idx) => assert.equal(week, idx + 1, 'gap in authored weeks'));
});

test('every piece declares a phase consistent with its week', () => {
  for (const piece of CURRICULUM) {
    assert.equal(piece.phase, phaseForWeek(piece.week), `${piece.id} phase/week mismatch`);
  }
});

test('no piece ships empty prose', () => {
  for (const piece of [...CURRICULUM, ...CURRICULUM_ES]) {
    for (const field of ['title', 'mechanism', 'practice', 'prompt'] as const) {
      assert.ok(piece[field].trim().length > 0, `${piece.id}.${field} is empty`);
    }
    assert.ok(piece.mechanism.length > 200, `${piece.id} mechanism is too thin to teach`);
    // The practice doubles as Today's "this week's one thing".
    assert.ok(piece.practice.length < 400, `${piece.id} practice is too long for Today`);
  }
});

test('backlog signal fires only past the authored range', () => {
  assert.equal(isBeyondAuthoredCurriculum(8), false);
  assert.equal(isBeyondAuthoredCurriculum(26), false);
  assert.equal(isBeyondAuthoredCurriculum(27), true);
  assert.equal(isBeyondAuthoredCurriculum(26, 'es'), false);
});

test('library covers weeks 1–26 in both languages', () => {
  assert.equal(CURRICULUM.length, 26);
  assert.equal(CURRICULUM_ES.length, 26);
  assert.deepEqual(CURRICULUM_ES.map((p) => p.week), CURRICULUM.map((p) => p.week));
  assert.deepEqual(CURRICULUM_ES.map((p) => p.id), CURRICULUM.map((p) => p.id));
});

test('English pieces refer to the loved one as they/them, not he or she', () => {
  for (const piece of CURRICULUM) {
    for (const field of ['title', 'mechanism', 'practice', 'prompt'] as const) {
      assert.doesNotMatch(piece[field], /\b(he|she|him|his|hers|himself|herself)\b/i, `${piece.id}.${field}`);
    }
  }
});
