import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { CaregiverCheckInInput, CheckIn } from '../src/api/types';
import { FELLOWSHIPS, FELLOWSHIP_FINDERS, isFellowship } from '../src/content/fellowshipFinders';
import { checkInFeedback } from '../src/lib/checkInFeedback';
import {
  EMPTY_FELLOWSHIP_RECORD,
  fellowshipFollowUp,
  fellowshipStepEnded,
  fellowshipStorageKey,
  isStruggling,
  nextFellowshipStep,
  parseFellowshipRecord,
  parseReachOutResult,
  serializeFellowshipRecord,
  showFellowshipStep,
  type FellowshipEvent,
  type FellowshipStep,
} from '../src/lib/checkInFellowship';

const read = (path: string) => readFileSync(path, 'utf8');
const base: CaregiverCheckInInput = { moodScore: 3, capacityScore: 3, pressureScore: 3, supportNeed: 'steady' };
const DAY = '2026-11-24';

test('"struggling": overloaded, a low mood, high pressure or a mood of 2 or less', () => {
  assert.equal(isStruggling(base), false, 'a steady day');
  assert.equal(isStruggling({ ...base, capacityScore: 1, pressureScore: 5 }), true, 'overloaded');
  assert.equal(checkInFeedback({ ...base, moodScore: 2 }).key, 'lowMood');
  assert.equal(isStruggling({ ...base, moodScore: 2 }), true, 'low mood');
  assert.equal(isStruggling({ ...base, pressureScore: 4 }), true, 'pressure 4');
  assert.equal(isStruggling({ ...base, pressureScore: 3, moodScore: 3 }), false);
  assert.equal(isStruggling({ ...base, supportNeed: 'rest', moodScore: 1 }), true, 'a mood of 1 with another need');
  assert.equal(isStruggling({ ...base, supportNeed: 'boundary', pressureScore: 5 }), true);
  const legacy: CheckIn = { id: 'c1', userId: 'u1', moodScore: 4, capacityScore: null, pressureScore: null, supportNeed: null, note: null, completedAt: '2026-11-24T15:00:00Z', synced: true };
  assert.equal(isStruggling(legacy), false, 'legacy rows');
  assert.equal(isStruggling({ ...legacy, moodScore: 2 }), true, 'a legacy low mood');
});

test('never on a safety answer: crisis help comes first and stays as it is', () => {
  for (const extra of [{}, { moodScore: 1 as const }, { pressureScore: 5 as const, capacityScore: 1 as const }]) {
    const checkIn = { ...base, ...extra, supportNeed: 'safety' as const };
    assert.equal(checkInFeedback(checkIn).key, 'safety');
    assert.equal(checkInFeedback(checkIn).route, '/safety-wallet');
    assert.equal(isStruggling(checkIn), false);
    assert.equal(showFellowshipStep({ checkIn, loaded: true, closedDay: null, checkInDay: DAY }), false);
  }
  // The card itself: the safety body, disclaimer and button are unchanged, and
  // the meeting step is never mounted for a safety answer.
  const card = read('src/components/today/CheckInFeedbackCard.tsx');
  assert.match(card, /\{feedback\.key === 'safety' && <Text[^>]*>\{c\.disclaimer\}<\/Text>\}/);
  assert.match(card, /<GuidedButton label=\{action\} onPress=\{\(\) => router\.push\(feedback\.route\)\} \/>/);
  assert.match(card, /\{feedback\.key !== 'safety' && <CheckInFellowshipStep /);
});

test('the step shows once per check-in day', () => {
  const hard = { ...base, moodScore: 1 as const };
  const gate = { checkIn: hard, loaded: true, closedDay: null as string | null, checkInDay: DAY };
  assert.equal(showFellowshipStep(gate), true);
  assert.equal(showFellowshipStep({ ...gate, loaded: false }), false, 'device record not read yet');
  assert.equal(showFellowshipStep({ ...gate, closedDay: DAY }), false, 'already closed for this check-in');
  assert.equal(showFellowshipStep({ ...gate, closedDay: '2026-11-23' }), true, 'yesterday\'s close does not hide today');
  assert.equal(showFellowshipStep({ ...gate, checkIn: null }), false, 'no check-in');
  assert.equal(showFellowshipStep({ ...gate, checkIn: base }), false, 'a steady day');
  // The card keys the step by account and check-in day, so a new day starts fresh.
  assert.match(read('src/components/today/CheckInFeedbackCard.tsx'), /key=\{`\$\{user\?\.id \?\? 'none'\}:\$\{checkInDay\}`\}/);
});

test('after "Not right now": member, free, attached and admin outcomes', () => {
  const who = { settled: true, isAttached: false, isAdmin: false, isMember: false };
  assert.equal(fellowshipFollowUp({ ...who, isMember: true }), 'reachOut', 'a member may ask Matt to reach out');
  assert.equal(fellowshipFollowUp(who), 'booking', 'a free direct account is offered help booking');
  assert.equal(fellowshipFollowUp({ ...who, isAttached: true, isMember: true }), null, 'attached: their own team');
  assert.equal(fellowshipFollowUp({ ...who, isAttached: true }), null);
  assert.equal(fellowshipFollowUp({ ...who, isAdmin: true, isMember: true }), null, 'an admin is not a member');
  assert.equal(fellowshipFollowUp({ ...who, isMember: true, settled: false }), null, 'account not known for certain');
});

test('the step flow: fellowship -> not now -> reach out / booking / closed', () => {
  const run = (events: FellowshipEvent[]) => events.reduce<FellowshipStep>((step, event) => nextFellowshipStep(step, event), 'choose');
  // Member: asks, it goes through.
  assert.equal(run([{ type: 'notNow', followUp: 'reachOut' }]), 'reachOut');
  assert.equal(run([{ type: 'notNow', followUp: 'reachOut' }, { type: 'send' }]), 'sending');
  assert.equal(run([{ type: 'notNow', followUp: 'reachOut' }, { type: 'send' }, { type: 'sendResult', ok: true }]), 'sent');
  // It fails: she is told and can try again (or say no thanks).
  const failed = run([{ type: 'notNow', followUp: 'reachOut' }, { type: 'send' }, { type: 'sendResult', ok: false }]);
  assert.equal(failed, 'failed');
  assert.equal(nextFellowshipStep(failed, { type: 'send' }), 'sending');
  assert.equal(nextFellowshipStep(failed, { type: 'decline' }), 'closed');
  assert.equal(run([{ type: 'notNow', followUp: 'reachOut' }, { type: 'decline' }]), 'closed');
  // Free: booking or no thanks.
  assert.equal(run([{ type: 'notNow', followUp: 'booking' }]), 'booking');
  assert.equal(run([{ type: 'notNow', followUp: 'booking' }, { type: 'book' }]), 'closed');
  assert.equal(run([{ type: 'notNow', followUp: 'booking' }, { type: 'decline' }]), 'closed');
  // Attached, admin, unsettled: nothing follows.
  assert.equal(run([{ type: 'notNow', followUp: null }]), 'closed');
  // Events out of place change nothing.
  assert.equal(nextFellowshipStep('choose', { type: 'send' }), 'choose');
  assert.equal(nextFellowshipStep('booking', { type: 'send' }), 'booking', 'a free account never sends a reach-out');
  assert.equal(nextFellowshipStep('sending', { type: 'decline' }), 'sending');
  assert.equal(nextFellowshipStep('sent', { type: 'send' }), 'sent', 'one request');
  assert.equal(nextFellowshipStep('reachOut', { type: 'book' }), 'reachOut');
  // Only a finished offer is closed for the day; opening a finder is not.
  assert.deepEqual((['choose', 'reachOut', 'booking', 'sending', 'sent', 'failed', 'closed'] as FellowshipStep[]).filter(fellowshipStepEnded), ['sent', 'closed']);
});

test('her fellowship is remembered per account, versioned; a corrupt value is ignored', () => {
  assert.equal(fellowshipStorageKey('acct-1'), 'shl.checkInFellowship.v1:acct-1');
  assert.notEqual(fellowshipStorageKey('acct-1'), fellowshipStorageKey('acct-2'));
  const saved = serializeFellowshipRecord({ fellowship: 'narAnon', closedDay: DAY });
  assert.deepEqual(parseFellowshipRecord(saved), { fellowship: 'narAnon', closedDay: DAY });
  for (const bad of [null, '', 'not json', '[]', '42', 'null', '{"fellowship":"aa","closedDay":"yesterday"}']) {
    assert.deepEqual(parseFellowshipRecord(bad), EMPTY_FELLOWSHIP_RECORD, String(bad));
  }
  assert.deepEqual(parseFellowshipRecord('{"fellowship":"pal"}'), { fellowship: 'pal', closedDay: null });
  assert.deepEqual(parseReachOutResult({ ok: true, already: true }), { ok: true, already: true });
  assert.deepEqual(parseReachOutResult(null), { ok: false, already: false });
  assert.deepEqual(parseReachOutResult({ ok: 'yes' }), { ok: false, already: false });
});

test('every fellowship opens its own official finder over https, with copy in both languages', () => {
  assert.deepEqual([...FELLOWSHIPS], ['alAnon', 'narAnon', 'aca', 'coda', 'pal']);
  const official: Record<string, string> = { alAnon: 'al-anon.org', narAnon: 'nar-anon.org', aca: 'adultchildren.org', coda: 'coda.org', pal: 'palgroup.org' };
  const en = JSON.parse(read('src/locales/en/today.json')).fellowships;
  const es = JSON.parse(read('src/locales/es/today.json')).fellowships;
  for (const fellowship of FELLOWSHIPS) {
    const { url, domain } = FELLOWSHIP_FINDERS[fellowship];
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:', fellowship);
    assert.equal(domain, official[fellowship], fellowship);
    assert.ok(parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`), `${fellowship}: ${parsed.hostname}`);
    assert.ok(isFellowship(fellowship));
    for (const copy of [en, es]) {
      assert.ok(copy.options[fellowship].name.trim(), fellowship);
      assert.ok(copy.options[fellowship].description.trim(), fellowship);
    }
    // The names stay as they are; the descriptions are translated.
    assert.equal(es.options[fellowship].name, en.options[fellowship].name);
    assert.notEqual(es.options[fellowship].description, en.options[fellowship].description);
  }
  assert.equal(isFellowship('aa'), false);
  // The URLs live in one module, never in the words.
  for (const lang of ['en', 'es']) assert.doesNotMatch(JSON.stringify(lang === 'en' ? en : es), /https?:/);
});

test('the copy: same keys in English and Spanish, no price, Matt by name from the Support constant', () => {
  const en = JSON.parse(read('src/locales/en/today.json')).fellowships;
  const es = JSON.parse(read('src/locales/es/today.json')).fellowships;
  const keys = (value: unknown, prefix = ''): string[] => value && typeof value === 'object'
    ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
    : [prefix];
  assert.deepEqual(keys(es).sort(), keys(en).sort());
  for (const copy of [en, es]) {
    assert.doesNotMatch(JSON.stringify(copy), /\$|\d+\s?(USD|dólares)/, 'no price');
    assert.doesNotMatch(JSON.stringify(copy), /Matt/, 'the coach\'s name comes from PRIMARY_ON_CALL');
    assert.match(copy.reachOut.question, /\{\{name\}\}/);
    assert.match(copy.reachOut.sent, /\{\{name\}\}/);
    assert.match(copy.reachOut.emergency, /911[\s\S]*988/);
  }
  assert.match(es.remembered, /Toca/, 'tú');
  const step = read('src/components/today/CheckInFellowshipStep.tsx');
  assert.match(step, /const coach = PRIMARY_ON_CALL\.firstName;/);
});

test('the step: finder in the browser with a translated failure, a count without the fellowship, the right doors', () => {
  const step = read('src/components/today/CheckInFellowshipStep.tsx');
  // Only the tool name is recorded, never which fellowship.
  assert.match(step, /logToolUsage\('fellowship_finder', 'opened'\);/);
  assert.equal([...step.matchAll(/logToolUsage\(/g)].length, 1);
  assert.match(step, /Linking\.openURL\(finder\.url\)\.catch\(\(\) =>\s+appAlert\(t\('fellowships\.openErrorTitle'\), t\('fellowships\.openErrorBody', \{ site: finder\.domain \}\)\)\)/);
  assert.match(step, /supabase\.rpc\('request_reach_out'\)/);
  assert.match(step, /router\.push\('\/book-coaching'\)/);
  assert.doesNotMatch(step, /bereav/i);
  assert.match(step, /useFeatureAccess\('coachMessaging'\)/);
  assert.match(step, /accessibilityRole="radio"/);
  assert.match(step, /minHeight: 48/);
  // The tool name is on both allowlists.
  assert.match(read('src/lib/toolUsageNames.ts'), /'fellowship_finder'/);
  assert.match(read('supabase/migrations/20261124105000_usage_tools_screens.sql'), /'family_outcomes', 'fellowship_finder', 'finder'/);
});

test('the server: members only, never attached, one push a day, first name only', () => {
  const sql = read('supabase/migrations/20261124120000_checkin_reach_out_requests.sql');
  assert.match(sql, /ALTER TABLE public\.reach_out_requests ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.reach_out_requests FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /FUNCTION public\.request_reach_out\(\)[\s\S]*?SECURITY DEFINER\s+SET search_path = ''/);
  assert.match(sql, /RAISE EXCEPTION 'attached_account'/);
  assert.match(sql, /IF NOT public\.has_active_textline_access\(v_account\) THEN\s+RAISE EXCEPTION 'members_only'/);
  assert.match(sql, /r\.handled_at IS NULL\s+AND r\.created_at > now\(\) - interval '24 hours'\) THEN\s+RETURN jsonb_build_object\('ok', true, 'already', true\);/);
  assert.match(sql, /FROM public\.video_staff_roles r\s+WHERE r\.role = 'owner' AND r\.active\s+ON CONFLICT \(idempotency_key\) WHERE idempotency_key IS NOT NULL DO NOTHING;/);
  // Nothing she answered or wrote rides in the push.
  const push = /INSERT INTO public\.push_outbox[\s\S]*?DO NOTHING;/.exec(sql)?.[0] ?? '';
  assert.doesNotMatch(push, /mood|pressure|capacity|note|check_ins/i);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.request_reach_out\(\) FROM PUBLIC, anon;/);
  for (const fn of ['admin_reach_out_requests', 'admin_mark_reach_out_handled']) {
    assert.match(sql, new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?IF NOT public\\.is_admin_jwt\\(\\) THEN\\s+RAISE EXCEPTION 'not authorized'`), fn);
  }
  // The dispatcher keeps refusing unknown kinds.
  assert.match(sql, /RAISE EXCEPTION 'unsupported_push_kind: %',o\.kind;/);
});
