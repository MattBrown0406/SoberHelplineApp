import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { callCardView, seatPanelView, seatSaveFailureKey, type SeatAnswer } from '../src/lib/familySquaresCard';

// Audit round 2 (app side): the pure decisions, the words, and the wiring.
const read = (path: string) => readFileSync(path, 'utf8');
const locale = (lang: string, ns: string) => JSON.parse(read(`src/locales/${lang}/${ns}.json`));

// ── M4: what the Family Squares card shows ──────────────────────────────────

test('a Monday the website cancelled offers nothing for that date: only the calm line', () => {
  const answers: SeatAnswer[] = ['going', 'declined', 'none'];
  for (const answer of answers) for (const hasLink of [true, false]) {
    assert.deepEqual(callCardView({ familySquares: true, cancelled: true, answer, hasLink }), {
      cancelledLine: true, join: false, saveSpot: false, going: false, question: false, rsvpNote: false, firstTimerNote: false,
    }, `${answer} / link ${hasLink}`);
    for (const weeklySeatOn of [true, false]) {
      // The "every Monday" switch stays (it is about the weeks after); nothing else does.
      assert.equal(seatPanelView({ cancelled: true, answer, weeklySeatOn }), 'weekly_only');
    }
  }
});

test('a meeting that is on shows what it always showed', () => {
  // No link yet: the main button saves her spot, or says she is going.
  assert.deepEqual(callCardView({ familySquares: true, cancelled: false, answer: 'none', hasLink: false }), {
    cancelledLine: false, join: false, saveSpot: true, going: false, question: false, rsvpNote: true, firstTimerNote: true,
  });
  assert.deepEqual(callCardView({ familySquares: true, cancelled: false, answer: 'going', hasLink: false }), {
    cancelledLine: false, join: false, saveSpot: false, going: true, question: true, rsvpNote: true, firstTimerNote: true,
  });
  // With the link: anyone may join (an RSVP is never a gate), and "Save my spot" sits beside it until saved.
  assert.deepEqual(callCardView({ familySquares: true, cancelled: false, answer: 'none', hasLink: true }), {
    cancelledLine: false, join: true, saveSpot: true, going: false, question: false, rsvpNote: true, firstTimerNote: true,
  });
  assert.deepEqual(callCardView({ familySquares: true, cancelled: false, answer: 'going', hasLink: true }), {
    cancelledLine: false, join: true, saveSpot: false, going: false, question: true, rsvpNote: true, firstTimerNote: true,
  });
  // "Can't make it": she can still save her spot again, and still join.
  const declined = callCardView({ familySquares: true, cancelled: false, answer: 'declined', hasLink: true });
  assert.equal(declined.saveSpot, true); assert.equal(declined.join, true); assert.equal(declined.question, false);
});

test('only Family Squares can be cancelled this way: any other call is never touched (fail open)', () => {
  // La Sobremesa or a group call, even if a stray flag said "cancelled".
  for (const cancelled of [true, false]) {
    assert.deepEqual(callCardView({ familySquares: false, cancelled, answer: 'none', hasLink: true }), {
      cancelledLine: false, join: true, saveSpot: true, going: false, question: false, rsvpNote: false, firstTimerNote: false,
    });
  }
  // No call loaded at all.
  assert.equal(callCardView({ familySquares: false, cancelled: false, answer: 'none', hasLink: false }).cancelledLine, false);
});

// ── L8: a weekly seat that has not been saved for the coming Monday yet ─────

test('the panel under the card: hidden, the weekly note, the full panel, or "sitting this week out"', () => {
  assert.equal(seatPanelView({ cancelled: false, answer: 'none', weeklySeatOn: false }), 'hidden');
  // Her switch is on but Monday's seat is not saved yet (after the meeting, before it is saved for her).
  assert.equal(seatPanelView({ cancelled: false, answer: 'none', weeklySeatOn: true }), 'weekly_note');
  for (const weeklySeatOn of [true, false]) {
    assert.equal(seatPanelView({ cancelled: false, answer: 'going', weeklySeatOn }), 'full');
    assert.equal(seatPanelView({ cancelled: false, answer: 'declined', weeklySeatOn }), 'declined');
  }
  // She can still save it now: the card's own button is untouched by the note.
  assert.equal(callCardView({ familySquares: true, cancelled: false, answer: 'none', hasLink: false }).saveSpot, true);

  const panel = read('src/components/familySquares/FamilySquaresSeatPanel.tsx');
  assert.match(panel, /\{panelView === 'weekly_note' && \([\s\S]*?\{t\('familySquares\.weekly\.onNote'\)\}/);
  // The calendar file and "can't make it" belong to a saved seat only; the switch shows in every visible state.
  assert.match(panel, /\{panelView === 'full' && \(\s+<>\s+<TouchableOpacity[\s\S]*?familySquares\.calendar\.label[\s\S]*?familySquares\.decline\.label/);
  assert.match(panel, /cancelled = false \}: Props\)/);
  for (const lang of ['en', 'es']) {
    const weekly = locale(lang, 'common').familySquares.weekly;
    assert.ok(weekly.onNote, `${lang}: weekly.onNote`);
  }
  assert.match(locale('en', 'common').familySquares.weekly.onNote, /weekly seat is on/);
  assert.match(locale('en', 'common').familySquares.weekly.onNote, /save it now/);
  assert.match(locale('es', 'common').familySquares.weekly.onNote, /lugar semanal está activado/);
});

// ── M4: the words, and where they show ──────────────────────────────────────

test('a refused seat never says "check your connection"; a real connection problem still does', () => {
  assert.equal(seatSaveFailureKey('website_declined', true), 'common:familySquares.cancelled.line');
  assert.equal(seatSaveFailureKey('website_declined', false), 'common:familySquares.registrationUnavailable');
  for (const cancelled of [true, false]) {
    assert.equal(seatSaveFailureKey(undefined, cancelled), 'support:sessions.rsvpErrorBody');
    assert.equal(seatSaveFailureKey('failed', cancelled), 'support:sessions.rsvpErrorBody');
  }
  for (const lang of ['en', 'es']) {
    const fs = locale(lang, 'common').familySquares;
    assert.ok(fs.cancelled.line && fs.registrationUnavailable, lang);
    assert.doesNotMatch(fs.cancelled.line + fs.registrationUnavailable, /connection|conexión|soberhelpline|\$/i, lang);
    // One name in both languages.
    assert.match(fs.cancelled.line, /Family Squares/);
    assert.match(fs.registrationUnavailable, /Family Squares/);
  }
  const en = locale('en', 'common').familySquares;
  assert.equal(en.cancelled.line, "There's no Family Squares this Monday. It's back next week.");
  assert.equal(en.registrationUnavailable, "Registration for this week's Family Squares isn't available right now.");
  assert.doesNotMatch(JSON.stringify(locale('es', 'common').familySquares), /usted|\bsu\b/);
});

test('the call card, the Support entry and the welcome-back card all follow the cancelled week', () => {
  const card = read('src/components/today/SituationCard.tsx');
  // (The cancelled DATE is compared with the coming meeting's date on every draw: audit round 3, M1.)
  assert.match(card, /const view = callCardView\(\{\s+familySquares: isFamilySquares,\s+cancelled: isCancelledMeetingDate\(nextFreeCall\?\.cancelledDate\),/);
  // The calm line takes the place of every button.
  assert.match(card, /\{view\.cancelledLine \? \(\s+<Text style=\{\[styles\.cancelledLine, \{ color: colors\.ink \}\]\} accessibilityLiveRegion="polite">\s+\{t\('common:familySquares\.cancelled\.line'\)\}\s+<\/Text>\s+\) : canJoin \? \(/);
  assert.match(card, /const canJoin = view\.join;/);
  assert.match(card, /\{view\.saveSpot && \(/);
  assert.match(card, /\{view\.rsvpNote && \(/);
  assert.match(card, /cancelled=\{view\.cancelledLine\}/);
  assert.doesNotMatch(card, /colors\.coral[^\n]*cancelled|accessibilityRole="alert"/, 'calm, not an error');

  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /const view = callCardView\(\{\s+familySquares,\s+cancelled: isCancelledMeetingDate\(sess\.cancelledDate\),/);
  assert.match(support, /\{view\.join \? \(/);
  assert.match(support, /\{view\.cancelledLine \? null : \(\s+<TouchableOpacity\s+accessibilityRole="button"\s+accessibilityLabel=\{t\(sess\.rsvped \? 'sessions\.confirmLabel' : 'sessions\.rsvpLabel', \{ name \}\)\}/);
  assert.match(support, /\{view\.cancelledLine && \(\s+<Text style=\{\[styles\.cancelledLine, \{ color: colors\.ink \}\]\} accessibilityLiveRegion="polite">\s+\{t\('common:familySquares\.cancelled\.line'\)\}/);
  // No question for that date: not from the row, not from a reminder or Today's link.
  assert.match(support, /\{sess\.rsvped && !view\.cancelledLine && !isLaSobremesaSession\(sess\) && \(/);
  assert.match(support, /if \(!isLaSobremesaSession\(session\) && !isCancelledMeetingDate\(session\.cancelledDate\)\) setQuestionSession\(session\);/);

  // Fetched alongside the session, on both screens; only Family Squares rows carry it.
  const feed = read('src/hooks/useTodayFeed.ts');
  assert.match(feed, /supabase\.rpc\('my_situation'\),\s+(\/\/[^\n]*\n\s+)?loadFamilySquaresCancelledDate\(\),\s+\]\);/);
  assert.match(feed, /cancelledDate: isFamilySquaresSession\(chosen\) \? cancelledDate : null \} : null;/);
  const sessions = read('src/hooks/useSessions.ts');
  assert.match(sessions, /loadFamilySquaresCancelledDate\(\),\s+\]\);/);
  assert.match(sessions, /if \(!isFamilySquaresSession\(s\)\) return \{ \.\.\.s, rsvped: going\.has\(s\.id\) \};/);
  assert.match(sessions, /declined: current && answer\?\.status === 'declined', cancelledDate \};/);
  const lib = read('src/lib/familySquaresCancelled.ts');
  assert.match(lib, /supabase\.rpc\('family_squares_meeting_cancelled', \{ p_meeting_date: meetingDate \}\)/);
  assert.match(lib, /return !!result && !result\.error && result\.data === true;/);
});

// ── L10 / L11: wording ──────────────────────────────────────────────────────

test('the weekly seat says plainly when it pauses, where the switch is described', () => {
  const en = locale('en', 'common').familySquares.weekly.desc as string;
  const es = locale('es', 'common').familySquares.weekly.desc as string;
  assert.match(en, /each week/);
  assert.match(en, /pauses while your reminders are paused/);
  // (The server now pauses it after about six months away, not five weeks: audit round 3, L12.)
  assert.match(en, /about six months/);
  assert.doesNotMatch(en, /five weeks/);
  assert.match(es, /Se pausa mientras tus recordatorios estén en pausa/);
  assert.match(es, /unos seis meses/);
  assert.doesNotMatch(es, /cinco semanas/);
  // One description for the seat panel and for Settings.
  assert.match(read('src/components/familySquares/FamilySquaresSeatPanel.tsx'), /\{t\('familySquares\.weekly\.desc'\)\}/);
  assert.match(read('app/settings.tsx'), /\{t\('common:familySquares\.weekly\.desc'\)\}/);
});

test('the admin note counts Join taps as the server does: from 5:00 PM to 8:30 PM Pacific', () => {
  const admin = read('app/admin.tsx');
  assert.match(admin, /Tapped Join = members who tapped Join between 5:00 PM and 8:30 PM Pacific on the meeting Monday/);
  assert.doesNotMatch(admin, /from an hour before/);
  assert.match(read('supabase/migrations/20261114140000_family_squares_missed_followup.sql'), /v_join_from := \(v_meeting \+ time '17:00'\) AT TIME ZONE 'America\/Los_Angeles';/);
});

// ── L6: nothing is sold to a bereaved member outside Today either ───────────

test('the Support tab shows no plans teaser to a bereaved member, or before the device knows', () => {
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /const bereaved = useBereavedOnDevice\(user\?\.id \?\? null\);/);
  assert.match(support, /\{bereaved === false && <PlansTeaserCard offers=\{planOffers\} source="support_tab" \/>\}/);
  assert.equal(support.split('<PlansTeaserCard').length - 1, 1);
  // Today's own record feeds the device copy every screen follows.
  assert.match(read('src/hooks/useLovedOne.ts'), /rememberBereavedOnDevice\(accountId, bereaved\);/);
  const hook = read('src/hooks/useBereavedOnDevice.ts');
  assert.match(hook, /subscribeBereavedOnDevice\(\(changedAccount, bereaved\) => \{\s+if \(active && changedAccount === accountId\) setState\(\{ accountId, bereaved \}\);/);
  assert.match(hook, /return state\.accountId === accountId \? state\.bereaved : undefined;/);
});
