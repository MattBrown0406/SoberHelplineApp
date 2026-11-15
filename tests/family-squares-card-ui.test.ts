import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  JOIN_WINDOW_LEAD_MS,
  callCardView,
  meetingDayLabel,
  sessionJoinWindow,
} from '../src/lib/familySquaresCard';
import { LA_SOBREMESA_CALL_LENGTH_MS, isCallInProgress } from '../src/lib/familySquaresSchedule';

// The 4.3 visual fixes to the Family Squares card (Today and Support) and the Support tab.
const read = (path: string) => readFileSync(path, 'utf8');
const locale = (lang: string, ns: string) => JSON.parse(read(`src/locales/${lang}/${ns}.json`));

// Monday, November 16, 2026, 7:00 PM Pacific.
const START = '2026-11-17T03:00:00+00:00';
const startMs = Date.parse(START);
const at = (minutesFromStart: number) => new Date(startMs + minutesFromStart * 60_000);

// ── 17: the join window ─────────────────────────────────────────────────────

test('the join window runs from three hours before the meeting starts until it ends', () => {
  assert.equal(JOIN_WINDOW_LEAD_MS, 3 * 60 * 60_000);
  assert.equal(sessionJoinWindow(START, at(-3 * 24 * 60)), 'outside', 'days before');
  assert.equal(sessionJoinWindow(START, at(-181)), 'outside');
  assert.equal(sessionJoinWindow(START, at(-180)), 'inside', 'three hours before, to the minute');
  assert.equal(sessionJoinWindow(START, at(0)), 'inside');
  assert.equal(sessionJoinWindow(START, at(59)), 'inside', 'still on');
  assert.equal(sessionJoinWindow(START, at(60)), 'unknown', 'its hour is over: a start in the past is never "days before"');
  assert.equal(sessionJoinWindow(START, at(8 * 24 * 60)), 'unknown', 'a next_at nobody moved on');
  // La Sobremesa runs 75 minutes: both screens pass its length.
  assert.equal(sessionJoinWindow(START, at(74), LA_SOBREMESA_CALL_LENGTH_MS), 'inside');
  assert.equal(sessionJoinWindow(START, at(75), LA_SOBREMESA_CALL_LENGTH_MS), 'unknown');
  // The decision itself imports nothing, so every screen and test harness can load it.
  assert.doesNotMatch(read('src/lib/familySquaresCard.ts'), /^import /m);
});

test('a start that is missing or unreadable is "unknown", never a guess', () => {
  for (const nextAt of [null, undefined, '', 'next Monday']) {
    assert.equal(sessionJoinWindow(nextAt, at(0)), 'unknown', String(nextAt));
  }
  // Unknown keeps what a set link always showed: Join is the big button.
  const view = callCardView({ familySquares: true, cancelled: false, answer: 'none', hasLink: true, joinWindow: 'unknown' });
  assert.equal(view.joinProminence, 'main');
  assert.equal(view.saveProminence, 'quiet');
});

test('the window reads the start the way the schedule does (ISO or Postgres text)', () => {
  for (const next_at of ['2026-11-17T03:00:00+00:00', '2026-11-17T03:00:00Z', '2026-11-17 03:00:00+00', ' 2026-11-16 19:00:00-08 ']) {
    for (const minutes of [-181, -180, -1, 0, 30, 59, 60, 600]) {
      const inside = sessionJoinWindow(next_at, at(minutes)) === 'inside';
      assert.equal(inside, minutes >= -180 && minutes < 60, `${next_at} at ${minutes}`);
      // While the call is on, the two readers agree.
      if (isCallInProgress(next_at, at(minutes))) assert.equal(inside, true, `${next_at} at ${minutes}`);
    }
  }
});

test('both screens hand the window to the one decision, and neither changes what a tap does', () => {
  const card = read('src/components/today/SituationCard.tsx');
  assert.match(card, /hasLink: !!nextFreeCall\?\.zoom_url,\s+joinWindow: sessionJoinWindow\(nextFreeCall\?\.next_at, new Date\(\), isLaSobremesaSession\(nextFreeCall\) \? LA_SOBREMESA_CALL_LENGTH_MS : undefined\),\s+\}\);/);
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /hasLink: !!sess\.zoom_url,\s+joinWindow: sessionJoinWindow\(sess\.next_at, new Date\(\), isLaSobremesaSession\(sess\) \? LA_SOBREMESA_CALL_LENGTH_MS : undefined\),\s+\}\);/);
  // Today: the big button and the small link are the same two buttons, swapped.
  assert.match(card, /const joinLeads = canJoin && view\.joinProminence === 'main';\s+const saveLeads = view\.saveSpot && view\.saveProminence === 'main';/);
  assert.match(card, /key="join"[\s\S]*?style=\{joinLeads \? \[styles\.primaryBtn, \{ backgroundColor: colors\.primary \}\] : styles\.quietLink\}\s+onPress=\{join\}/);
  assert.match(card, /key="save"[\s\S]*?style=\{saveLeads \? \[styles\.primaryBtn, \{ backgroundColor: colors\.primary \}\] : styles\.quietLink\}\s+onPress=\{onRsvp\}/);
  assert.match(card, /\{joinLeads \? joinButton : saveButton\}/);
  assert.match(card, /<View style=\{styles\.quietRow\}>\s+\{!joinLeads && joinButton\}\s+\{!saveLeads && saveButton\}\s+\{questionLink\}\s+<\/View>/);
  assert.match(card, /quietLink: \{[^}]*minHeight: 44/);
  // Support: the same, with the same handlers as before.
  assert.match(support, /const joinLeads = view\.join && view\.joinProminence === 'main';\s+const saveLeads = view\.saveSpot && view\.saveProminence === 'main';/);
  assert.match(support, /key="join"[\s\S]*?onPress=\{\(\) => void joinSession\(sess\)\}/);
  assert.match(support, /key="save"[\s\S]*?onPress=\{\(\) => void handleSessionRsvp\(sess\)\}/);
  assert.match(support, /sessionQuietLink: \{ minHeight: 44,/);
});

// ── 16: one confirmation ────────────────────────────────────────────────────

test('the confirmation names the meeting\'s real day in her language', () => {
  const now = at(-3 * 24 * 60);
  assert.equal(meetingDayLabel(START, { now, locale: 'en', timeZone: 'America/Los_Angeles' }), 'Monday, November 16');
  assert.equal(meetingDayLabel(START, { now, locale: 'es', timeZone: 'America/Los_Angeles' }), 'lunes, 16 de noviembre');
  // In her own time zone, like the time printed on the card.
  assert.equal(meetingDayLabel(START, { now, locale: 'en', timeZone: 'Europe/Madrid' }), 'Tuesday, November 17');
  // Still the same day while the meeting is on; no date once it is over or when the start is unknown.
  assert.equal(meetingDayLabel(START, { now: at(59), locale: 'en', timeZone: 'America/Los_Angeles' }), 'Monday, November 16');
  assert.equal(meetingDayLabel(START, { now: at(60), locale: 'en' }), null);
  assert.equal(meetingDayLabel(START, { now: at(60), locale: 'en', timeZone: 'America/Los_Angeles', lengthMs: LA_SOBREMESA_CALL_LENGTH_MS }), 'Monday, November 16');
  for (const unknown of [null, undefined, '', 'next Monday']) assert.equal(meetingDayLabel(unknown, { now, locale: 'en' }), null);
  assert.equal(meetingDayLabel(START, { now, locale: 'en', timeZone: 'Not/AZone' }), null);

  const en = locale('en', 'common').familySquares;
  const es = locale('es', 'common').familySquares;
  assert.equal(en.spotSaved, 'Your spot is saved for {{date}}');
  assert.equal(en.spotSavedNoDate, 'Your spot is saved');
  assert.equal(es.spotSaved, 'Tu lugar está reservado para el {{date}}');
  assert.equal(es.spotSavedNoDate, 'Tu lugar está reservado');
});

test('"going" is confirmed once, with or without a link, and never on a cancelled week', () => {
  for (const hasLink of [true, false]) {
    assert.equal(callCardView({ familySquares: true, cancelled: false, answer: 'going', hasLink }).confirmed, true);
    assert.equal(callCardView({ familySquares: true, cancelled: true, answer: 'going', hasLink }).confirmed, false);
    assert.equal(callCardView({ familySquares: true, cancelled: false, answer: 'none', hasLink }).confirmed, false);
    assert.equal(callCardView({ familySquares: true, cancelled: false, answer: 'declined', hasLink }).confirmed, false);
  }
  assert.equal('going' in callCardView({ familySquares: true, cancelled: false, answer: 'going', hasLink: false }), false, 'the old no-link flag is folded in');

  const line = read('src/components/familySquares/FamilySquaresSpotSavedLine.tsx');
  assert.match(line, /meetingDayLabel\(session\?\.next_at, \{\s+locale: i18n\.resolvedLanguage \?\? i18n\.language,\s+lengthMs: isLaSobremesaSession\(session\) \? LA_SOBREMESA_CALL_LENGTH_MS : undefined,\s+\}\)/);
  assert.match(line, /day \? t\('familySquares\.spotSaved', \{ date: day \}\) : t\('familySquares\.spotSavedNoDate'\)/);
  assert.match(line, /if \(!confirmed\) return null;/);
  // Green is the confirmation colour; the words stay ink for contrast.
  assert.match(line, /styles\.check, \{ backgroundColor: colors\.green \}/);
  assert.match(line, /backgroundColor: colors\.greenLight, borderColor: colors\.green/);
  // Read out as one sentence (the check mark is decoration), and when her own tap has just saved the seat.
  assert.match(line, /<View accessible accessibilityRole="text" accessibilityLabel=\{text\} accessibilityLiveRegion="polite"/);
  assert.match(line, /accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/);
  assert.match(line, /if \(savedHere === announced\.current\) return;\s+announced\.current = savedHere;\s+if \(confirmed\) AccessibilityInfo\.announceForAccessibility\(text\);/);

  // Drawn on both screens from the same decision; no second "You're going" / "Confirmed" anywhere.
  const card = read('src/components/today/SituationCard.tsx');
  assert.match(card, /<FamilySquaresSpotSavedLine\s+confirmed=\{view\.confirmed\}\s+session=\{nextFreeCall\}\s+savedHere=\{seatSavedHere\}/);
  assert.doesNotMatch(card, /situationCta\.going'|greenLight/);
  // A call other than Family Squares keeps the tap its "You're going" button had while there is no link.
  assert.match(card, /const confirmedTap = !isFamilySquares && !canJoin \? onRsvp : undefined;/);
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /<FamilySquaresSpotSavedLine\s+confirmed=\{view\.confirmed\}\s+session=\{sess\}\s+savedHere=\{familySquares \? seatSavedHere : 0\}\s+showDate=\{familySquares\}\s+onPress=\{familySquares \? undefined : \(\) => void handleSessionRsvp\(sess\)\}\s+pressLabel=\{t\('sessions\.confirmLabel', \{ name \}\)\}/);
  assert.doesNotMatch(support, /sessions\.confirmButton/);
});

// ── 18 / 15: a shorter card ─────────────────────────────────────────────────

test('the RSVP note is one sentence that still says where her RSVP goes and that an email may follow', () => {
  for (const lang of ['en', 'es']) {
    const note = locale(lang, 'common').familySquares.rsvpNote as string;
    assert.equal((note.match(/[.!?](\s|$)/g) ?? []).length, 1, `${lang}: one sentence`);
    assert.match(note, /Matt/, lang);
    assert.match(note, /soberhelpline\.com/, lang);
    assert.ok(note.length <= 150, `${lang}: ${note.length} characters`);
  }
  assert.match(locale('en', 'common').familySquares.rsvpNote, /saved spot and your questions/);
  assert.match(locale('en', 'common').familySquares.rsvpNote, /follow-up email may come after your first call/);
  assert.match(locale('es', 'common').familySquares.rsvpNote, /reserva y tus preguntas/);
  assert.match(locale('es', 'common').familySquares.rsvpNote, /puede que recibas un correo de seguimiento después de tu primera llamada/);
});

test('"What to expect" is open the first time, then one line that opens it again; only Join removes it', () => {
  const store = read('src/lib/familySquaresFirstTimer.ts');
  // Both keys carry the account id (sign-out clears them: accountLocalKeys).
  assert.match(store, /const KEY_PREFIX = '@sh:family-squares-first-note:';\s+const SEEN_KEY_PREFIX = '@sh:family-squares-first-note-seen:';/);
  assert.match(store, /return `\$\{SEEN_KEY_PREFIX\}\$\{encodeURIComponent\(accountId\)\}`;/);
  // Open only the first time it is shown on this device; a failed read folds it.
  assert.match(store, /export async function firstTimerNoteStartsOpen\(accountId: string\): Promise<boolean> \{\s+if \(firstShownNow\.has\(accountId\)\) return true;\s+try \{\s+if \(\(await AsyncStorage\.getItem\(seenKey\(accountId\)\)\) !== null\) return false;\s+\} catch \{\s+return false;\s+\}\s+firstShownNow\.add\(accountId\);\s+await markFirstTimerNoteSeen\(accountId\);\s+return true;/);
  // "Got it" folds it everywhere and is remembered; it no longer writes the "joined" key.
  assert.match(store, /export async function foldFirstTimerNote\(accountId: string\): Promise<void> \{\s+firstShownNow\.delete\(accountId\);\s+tell\(accountId, 'folded'\);\s+await markFirstTimerNoteSeen\(accountId\);\s+\}/);
  assert.match(store, /export async function markFamilySquaresJoined\(accountId: string\): Promise<void> \{\s+tell\(accountId, 'joined'\);\s+await AsyncStorage\.setItem\(key\(accountId\), 'done'\);\s+\}/);

  const hook = read('src/hooks/useFirstTimerNote.ts');
  assert.match(hook, /const startsOpen = alwaysStartsOpen \|\| await firstTimerNoteStartsOpen\(accountId\);\s+if \(!active\) return;\s+setOpen\(startsOpen\);\s+setVisible\(true\);/);
  assert.match(hook, /if \(change === 'joined'\) setVisible\(false\);\s+else setOpen\(false\);/);
  assert.match(hook, /const dismiss = useCallback\(\(\) => \{\s+setOpen\(false\);\s+if \(accountId\) void foldFirstTimerNote\(accountId\);/);
  assert.doesNotMatch(hook, /markFamilySquaresJoined/);
  // The first Join is still what removes it for good.
  assert.match(read('src/lib/meetingAttendance.ts'), /await markFamilySquaresJoined\(accountId\);/);

  const note = read('src/components/familySquares/FamilySquaresFirstTimerNote.tsx');
  // The onboarding done screen (onPrimary) always starts with it open.
  assert.match(note, /useFirstTimerNote\(accountId, user && user\.id === accountId \? user\.joinedAt : null, onPrimary\)/);
  assert.match(note, /if \(!open\) \{\s+return \(\s+<TouchableOpacity\s+accessibilityRole="button"\s+accessibilityLabel=\{t\('familySquares\.firstTime\.title'\)\}\s+accessibilityState=\{\{ expanded: false \}\}\s+onPress=\{expand\}/);
  assert.match(note, /folded: \{ minHeight: 44, flexDirection: 'row',/);
});

test('"What to expect" is written in ink, with a hanging indent', () => {
  const note = read('src/components/familySquares/FamilySquaresFirstTimerNote.tsx');
  assert.match(note, /const ink = onPrimary \? '#fff' : colors\.ink;/);
  assert.match(note, /<View key=\{point\} style=\{styles\.pointRow\}>\s+<Text style=\{\[styles\.bullet, \{ color: ink \}\]\}[^>]*>•<\/Text>\s+<Text style=\{\[styles\.point, \{ color: ink \}\]\}>\{t\(`familySquares\.firstTime\.\$\{point\}`\)\}<\/Text>/);
  assert.match(note, /pointRow: \{ flexDirection: 'row', alignItems: 'flex-start',/);
  assert.match(note, /point: \{ flex: 1,/);
  assert.doesNotMatch(note, /inkSoft|rgba\(255,255,255,0\.85\)/);
});

// ── 7 / 11: Support ─────────────────────────────────────────────────────────

test('Support: Join is navy, the Monday meetings say "Save my spot", and green is only the confirmation', () => {
  const support = read('app/(tabs)/support.tsx');
  const row = /const renderSession = [\s\S]*?\n  \};\n/.exec(support)?.[0] ?? '';
  assert.ok(row.length > 0);
  assert.doesNotMatch(row, /colors\.green/);
  assert.match(row, /style=\{joinLeads \? \[styles\.solidBtn, \{ backgroundColor: colors\.primary \}\] : styles\.sessionQuietLink\}/);
  // Today's own words, from Today's own keys; any other session keeps "RSVP".
  assert.match(row, /const mondayMeeting = familySquares \|\| isLaSobremesaSession\(sess\);/);
  assert.match(row, /accessibilityLabel=\{t\(mondayMeeting \? 'today:situationCta\.rsvpLabel' : 'sessions\.rsvpLabel', \{ name \}\)\}/);
  assert.match(row, /\{t\(mondayMeeting \? 'today:situationCta\.rsvp' : 'sessions\.rsvpButton'\)\}/);
  assert.equal(locale('en', 'today').situationCta.rsvp, 'Save my spot');
  assert.equal(locale('es', 'today').situationCta.rsvp, 'Reservar mi lugar');
});

test('Support: one heading for Family Squares, no rule under the last row, and room under the paragraphs', () => {
  const support = read('app/(tabs)/support.tsx');
  // The free card no longer prints the name above the row that prints it.
  assert.doesNotMatch(support, /t\('mondayGroup\.heading'\)/);
  assert.match(support, /\{t\('mondayGroup\.sub'\)\}/);
  // A rule only between rows.
  assert.match(support, /const renderSession = \(sess: DbSession, showType: boolean, last: boolean\) => \{/);
  assert.match(support, /style=\{\[styles\.sessionOuter, !last && \{ borderBottomWidth: 1, borderBottomColor: colors\.line \},/);
  assert.match(support, /sessionOuter: \{\s+paddingVertical: 10,\s+\},/);
  // The same for the moderated groups: a rule under the last one only when the forum link follows.
  assert.match(support, /const ruleBelow = index < groups\.length - 1 \|\| \(hasMembershipAccess && !COMMUNITY_FEED_VISIBLE\);/);
  assert.match(support, /style=\{\[styles\.groupRow, ruleBelow && \{ borderBottomWidth: 1, borderBottomColor: colors\.line \}\]\}/);
  // The three paragraphs that stand between cards keep the cards' spacing below them.
  assert.match(support, /sectionNote: \{ marginBottom: 12 \},/);
  for (const key of ["t('intro')", "t('crisis.freeNote')", "t('peopleAccess', { rate: coachingRate.hourly })"]) {
    assert.ok(support.includes(`<Text style={[styles.referralBody, styles.sectionNote, { color: colors.inkSoft }]}>{${key}}</Text>`), key);
  }
});

test('Support: "How to use your membership" is only for someone who has one', () => {
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /const hasMembershipAccess = entitlements\.canAccessGroups;/);
  assert.match(support, /\{hasMembershipAccess && \(\s+<View style=\{\[styles\.card, \{ borderColor: colors\.line, backgroundColor: colors\.white \}\]\}>\s+<TouchableOpacity accessibilityRole="button" accessibilityState=\{\{ expanded: membershipExpanded \}\}/);
});

// ── Re-check of the visual pass ─────────────────────────────────────────────

test('only a Family Squares seat names its day; another call says the seat is saved, with no date', () => {
  const line = read('src/components/familySquares/FamilySquaresSpotSavedLine.tsx');
  assert.match(line, /showDate = true/);
  assert.match(line, /const day = showDate\s+\? meetingDayLabel\(/);
  assert.match(read('src/components/today/SituationCard.tsx'), /showDate=\{isFamilySquares\}/);
  assert.match(read('app/(tabs)/support.tsx'), /showDate=\{familySquares\}/);
});

test('without a plan, Support still links to how coaching support works', () => {
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /\{!hasMembershipAccess && \(\s*<TouchableOpacity[\s\S]{0,200}?router\.push\('\/membership-guide'\)/);
});
