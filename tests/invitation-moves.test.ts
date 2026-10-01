import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  dayNumber,
  EMPTY_PLAN_SIGNALS,
  fnv1a,
  INVITATION_MOVES,
  MOVE_CATEGORIES,
  moveHint,
  selectDailyMoves,
  type PlanSignals,
} from '../src/lib/invitationMoves';
import { emptyLovedOneProfile } from '../src/lib/lovedOneProfile';

const en = JSON.parse(readFileSync('src/locales/en/invitation.json', 'utf8'));
const es = JSON.parse(readFileSync('src/locales/es/invitation.json', 'utf8'));
const FAMILY_SEED = '5b0c9f6e-1d2a-4e1b-9c5d-2f7a8b9c0d1e';

function days(start: string, count: number): string[] {
  const base = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

test('every move has EN and ES copy and an id the database accepts', () => {
  const ids = new Set<string>();
  for (const move of INVITATION_MOVES) {
    assert.ok(!ids.has(move.id), `duplicate ${move.id}`);
    ids.add(move.id);
    assert.match(move.id, /^[a-z][a-z0-9_]{1,47}$/, move.id);
    for (const locale of [en, es]) {
      for (const field of ['title', 'body', 'example']) {
        assert.ok(typeof locale.moves[move.id]?.[field] === 'string' && locale.moves[move.id][field].trim(), `${move.id}.${field}`);
      }
    }
  }
  for (const category of MOVE_CATEGORIES) {
    assert.ok(INVITATION_MOVES.some((move) => move.category === category), category);
    assert.ok(en.moves.category[category] && es.moves.category[category], category);
  }
});

test('moves are deterministic per plan and day, so a whole family sees the same two', () => {
  const signals: PlanSignals = { ...EMPTY_PLAN_SIGNALS, soberMoments: true };
  const mom = selectDailyMoves({ seed: FAMILY_SEED, localDate: '2026-10-02', signals });
  const dad = selectDailyMoves({ seed: FAMILY_SEED, localDate: '2026-10-02', signals });
  assert.deepEqual(mom.map((move) => move.id), dad.map((move) => move.id));
  const other = days('2026-10-01', 14).map((date) => selectDailyMoves({ seed: 'another-family', localDate: date, signals }).map((m) => m.id).join());
  const ours = days('2026-10-01', 14).map((date) => selectDailyMoves({ seed: FAMILY_SEED, localDate: date, signals }).map((m) => m.id).join());
  assert.notDeepEqual(other, ours, 'different families get different rotations');
});

test('the two daily moves always come from different categories and rotate through the week', () => {
  const seen = new Set<string>();
  for (const date of days('2026-10-01', 60)) {
    const [first, second] = selectDailyMoves({ seed: FAMILY_SEED, localDate: date, signals: EMPTY_PLAN_SIGNALS });
    assert.notEqual(first.category, second.category, date);
    assert.notEqual(first.category, 'safety');
    assert.notEqual(second.category, 'safety');
    seen.add(first.category);
  }
  for (const category of ['reward', 'communication', 'consequences', 'timing']) assert.ok(seen.has(category), category);
});

test('moves built on the pattern map appear only when the family has that signal', () => {
  const personal = INVITATION_MOVES.filter((move) => move.requires).map((move) => move.id);
  const without = new Set(days('2026-01-01', 365).flatMap((date) =>
    selectDailyMoves({ seed: FAMILY_SEED, localDate: date, signals: EMPTY_PLAN_SIGNALS }).map((move) => move.id)));
  for (const id of personal) assert.ok(!without.has(id), id);
  const all: PlanSignals = { soberMoments: true, triggers: true, costs: true, phrases: true, safetySerious: false };
  const withSignals = new Set(days('2026-01-01', 365).flatMap((date) =>
    selectDailyMoves({ seed: FAMILY_SEED, localDate: date, signals: all }).map((move) => move.id)));
  for (const id of personal) assert.ok(withSignals.has(id), id);
});

test('knowing their sober moments makes reward the partner of every communication day', () => {
  const signals: PlanSignals = { ...EMPTY_PLAN_SIGNALS, soberMoments: true };
  for (const date of days('2026-10-01', 28)) {
    const [first, second] = selectDailyMoves({ seed: FAMILY_SEED, localDate: date, signals });
    if (first.category === 'communication') assert.equal(second.category, 'reward', date);
  }
});

test('a serious safety concern switches the plan to safety planning plus self-care', () => {
  for (const date of days('2026-10-01', 21)) {
    const [first, second] = selectDailyMoves({
      seed: FAMILY_SEED,
      localDate: date,
      signals: { ...EMPTY_PLAN_SIGNALS, soberMoments: true, safetySerious: true },
    });
    assert.equal(first.category, 'safety');
    assert.equal(second.category, 'selfcare');
  }
});

test('hints come only from the viewer\'s own words', () => {
  const move = INVITATION_MOVES.find((item) => item.id === 'reward_best_hour')!;
  assert.equal(moveHint(move, null, '2026-10-02'), null);
  assert.equal(moveHint(move, emptyLovedOneProfile(), '2026-10-02'), null);
  const profile = { ...emptyLovedOneProfile(), soberMoments: ['Saturday mornings'] };
  assert.deepEqual(moveHint(move, profile, '2026-10-02'), { key: 'moves.hint.soberMoments', item: 'Saturday mornings' });
  const selfcare = INVITATION_MOVES.find((item) => item.category === 'selfcare')!;
  assert.equal(moveHint(selfcare, profile, '2026-10-02'), null);
  for (const key of ['soberMoments', 'triggers', 'costs', 'phrases']) {
    assert.ok(en.moves.hint[key].includes('{{item}}') && es.moves.hint[key].includes('{{item}}'), key);
  }
});

test('hashing and day numbers are stable', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('abc'), fnv1a('abc'));
  assert.notEqual(fnv1a('abc'), fnv1a('abd'));
  assert.equal(dayNumber('1970-01-02'), 1);
  assert.equal(dayNumber('not a date'), 0);
});

test('the server accepts exactly the move ids the app can show', () => {
  const sql = readFileSync('supabase/migrations/20261001100000_invitation_engine.sql', 'utf8');
  const body = sql.slice(sql.indexOf('FUNCTION public._invitation_move_ids()'));
  const list = body.slice(body.indexOf('ARRAY['), body.indexOf(']::text[]'));
  const serverIds = [...list.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(serverIds, INVITATION_MOVES.map((move) => move.id).sort());
});
