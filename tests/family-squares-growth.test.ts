import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { getPushDestination } from '../src/lib/pushRouting';
import { entitlementsForAccountState } from '../src/lib/featureAccess';
import { FAMILY_SQUARES_NAME_KEY, sessionDisplayTitle } from '../src/lib/familySquaresSchedule';
import { FAMILY_SQUARES_CALENDAR_URL, WEBSITE_ORIGIN } from '../src/lib/websiteLinks';
import {
  ATTENDED_MAXIMUM_MS,
  ATTENDED_MINIMUM_MS,
  attendanceDecision,
  familySquaresJoinWindow,
  familySquaresReminderTapPlan,
  newJoinMark,
  parseJoinMark,
  reminderJoinSessionId,
  type JoinMark,
} from '../src/lib/familySquaresJoin';

const read = (path: string) => readFileSync(path, 'utf8');
const locale = (lang: string, ns: string) => JSON.parse(read(`src/locales/${lang}/${ns}.json`));
const SESSION = '123e4567-e89b-42d3-a456-426614174222';
const ZOOM = 'https://us02web.zoom.us/j/123456789';
const FAMILY_SQUARES = { title: 'The Family Squares', zoom_url: ZOOM };
// Monday 2026-11-16, 7:00 PM Pacific (PST) is 03:00 UTC on the 17th.
const START = Date.parse('2026-11-17T03:00:00Z');
const at = (minutesFromStart: number) => new Date(START + minutesFromStart * 60_000);

/** The newest migration that defines `name` is the one in force. */
function latestSql(name: string): string {
  return readdirSync('supabase/migrations')
    .filter((file) => file.endsWith('.sql')).sort().reverse()
    .map((file) => read(`supabase/migrations/${file}`))
    .find((sql) => new RegExp(`FUNCTION public\\.${name}\\(`).test(sql)) ?? '';
}

// ── 1. One name ─────────────────────────────────────────────────────────────

test('Family Squares shows under its one name; every other session keeps its title', () => {
  const t = (key: string) => (key === FAMILY_SQUARES_NAME_KEY ? 'Family Squares' : key);
  assert.equal(sessionDisplayTitle({ title: 'The Family Squares' }, t), 'Family Squares');
  assert.equal(sessionDisplayTitle({ title: ' Monday Night Family Support ' }, t), 'Family Squares', 'older seed title');
  assert.equal(sessionDisplayTitle({ title: 'La Sobremesa' }, t), 'La Sobremesa');
  assert.equal(sessionDisplayTitle({ title: 'First 90 Days After Intervention' }, t), 'First 90 Days After Intervention');
  assert.equal(sessionDisplayTitle(null, t), '');
  for (const lang of ['en', 'es']) assert.equal(locale(lang, 'common').familySquares.name, 'Family Squares', lang);
});

test('the screens print the display name, never the database row title', () => {
  const card = read('src/components/today/SituationCard.tsx');
  assert.match(card, /const title = nextFreeCall \? sessionDisplayTitle\(nextFreeCall, t\) : t\('situationCta\.freeCallTitle'\);/);
  assert.doesNotMatch(card, /nextFreeCall\?\.title/);
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /const name = sessionDisplayTitle\(sess, t\);/);
  assert.doesNotMatch(support, /\{sess\.title\}/);
  // One row renderer for every list on Support.
  assert.equal((support.match(/renderSession\(sess, (true|false)\)/g) ?? []).length, 3);
});

test('English copy names the meeting Family Squares everywhere it is named', () => {
  assert.equal(locale('en', 'today').situationCta.freeCallTitle, 'Family Squares');
  assert.equal(locale('en', 'support').mondayGroup.heading, 'Family Squares');
  assert.equal(locale('en', 'settings').notifications.familyCallTitle, 'Family Squares reminder');
  assert.match(locale('en', 'onboarding').done.rsvpButton, /Family Squares/);
  for (const ns of readdirSync('src/locales/en')) {
    const json = read(`src/locales/en/${ns}`);
    assert.doesNotMatch(json, /The Family Squares|Monday Family Support|Monday family call reminder|Monday's free call/, ns);
  }
  for (const ns of readdirSync('src/locales/es')) {
    assert.doesNotMatch(read(`src/locales/es/${ns}`), /The Family Squares/, ns);
  }
});

test('push copy and shared copy name the meeting Family Squares, on every build', () => {
  const engagement = read('supabase/functions/send-engagement-push/index.ts');
  assert.match(engagement, /"Family Squares comienza en 30 minutos" : "Family Squares starts in 30 minutes"/);
  assert.match(engagement, /\n\s+: "Family Squares",/);
  // The older-build wording is still chosen by the app contract.
  assert.match(engagement, /asksQuestion\.has\(target\.account_id\)\n\s+\? \(es \? "Empieza/);
  assert.match(read('supabase/functions/notify-session-reminder/index.ts'), /body: 'Family Squares is tonight at 7:00 PM Pacific — tap to join'/);
  assert.match(read('supabase/functions/notify-daily-morning/index.ts'), /mondayTitle: 'Family Squares tonight'/);
  for (const fn of ['send-engagement-push', 'notify-session-reminder', 'notify-daily-morning']) {
    const code = read(`supabase/functions/${fn}/index.ts`).split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    assert.doesNotMatch(code, /["'`][^"'`\n]*The Family Squares/, `${fn} still sends the old name`);
  }
  const shared = read('src/lib/passItOnResources.ts');
  assert.match(shared, /'Family Squares — free family support call'/);
  assert.doesNotMatch(shared, /'The Family Squares/);
  // The database row is never renamed: SQL helpers find the session by its title.
  const migrations = readdirSync('supabase/migrations').filter((file) => file > '20261114100000');
  for (const file of migrations) {
    assert.doesNotMatch(read(`supabase/migrations/${file}`), /UPDATE\s+(public\.)?sessions\b[^;]*\btitle\s*=/i, file);
  }
});

// ── 2. "Tap to join" joins ──────────────────────────────────────────────────

test('the join window runs from 30 minutes before the start until the hour is over', () => {
  assert.equal(familySquaresJoinWindow(at(-31)), null);
  assert.deepEqual(familySquaresJoinWindow(at(-30)), { meetingDate: '2026-11-16', start: new Date(START) });
  assert.equal(familySquaresJoinWindow(at(0))?.meetingDate, '2026-11-16');
  assert.equal(familySquaresJoinWindow(at(59))?.meetingDate, '2026-11-16');
  assert.equal(familySquaresJoinWindow(at(60)), null, 'the hour is over');
  assert.equal(familySquaresJoinWindow(new Date('2026-11-18T19:00:00Z')), null, 'a Wednesday');
  // Daylight time: Monday 2026-10-05, 7:00 PM Pacific is 02:00 UTC on the 6th.
  assert.equal(familySquaresJoinWindow(new Date('2026-10-06T01:45:00Z'))?.meetingDate, '2026-10-05');
});

test('a Family Squares reminder opens the meeting at meeting time and the call card otherwise', () => {
  // The 30-minute and 15-minute reminders ("tap to join").
  assert.deepEqual(familySquaresReminderTapPlan(FAMILY_SQUARES, at(-29)), { action: 'open_meeting', url: ZOOM, meetingDate: '2026-11-16' });
  assert.deepEqual(familySquaresReminderTapPlan({ ...FAMILY_SQUARES, zoom_url: ` ${ZOOM} ` }, at(20)), { action: 'open_meeting', url: ZOOM, meetingDate: '2026-11-16' });
  // An hour before, or a reminder tapped the next morning.
  assert.deepEqual(familySquaresReminderTapPlan(FAMILY_SQUARES, at(-55)), { action: 'call_card' });
  assert.deepEqual(familySquaresReminderTapPlan(FAMILY_SQUARES, at(12 * 60)), { action: 'call_card' });
  // No link yet, or something that is not a link: never a failed open.
  for (const zoom_url of [null, undefined, '', '   ', 'zoom', 'http://zoom.us/j/1', 'https://zoom.us/j/1 x']) {
    assert.deepEqual(familySquaresReminderTapPlan({ title: 'The Family Squares', zoom_url }, at(5)), { action: 'call_card' }, String(zoom_url));
  }
  // Only Family Squares: La Sobremesa keeps its personal link on Support.
  assert.deepEqual(familySquaresReminderTapPlan({ title: 'La Sobremesa', zoom_url: ZOOM }, at(5)), { action: 'default' });
  assert.deepEqual(familySquaresReminderTapPlan({ title: 'Boundaries Night', zoom_url: ZOOM }, at(5)), { action: 'default' });
  assert.deepEqual(familySquaresReminderTapPlan(null, at(5)), { action: 'default' });
});

test('only a "tap to join" session reminder is taken further; the question reminder is not', () => {
  const ESSENTIAL = entitlementsForAccountState('direct-essential');
  assert.equal(reminderJoinSessionId(getPushDestination({ kind: 'session_reminder', session_id: SESSION })), SESSION);
  assert.equal(reminderJoinSessionId(getPushDestination({ kind: 'session_reminder', session_id: SESSION, ask: 'question' })), null);
  assert.equal(reminderJoinSessionId(getPushDestination({ kind: 'session_reminder' })), null, 'no session named');
  assert.equal(reminderJoinSessionId(getPushDestination({ kind: 'session_reminder', room_name: 'shp-parents' }, { entitlements: ESSENTIAL })), null, 'a live group room');
  assert.equal(reminderJoinSessionId(getPushDestination({ kind: 'family_call_followup' })), null);
  assert.equal(reminderJoinSessionId(getPushDestination({ kind: 'morning_note', screen: 'support' })), null);
  assert.equal(reminderJoinSessionId(null), null);
  // The question reminder still opens the question sheet.
  assert.deepEqual(getPushDestination({ kind: 'session_reminder', session_id: SESSION, ask: 'question' }),
    { pathname: '/(tabs)/support', params: { sessionId: SESSION, ask: 'question' } });
});

test('the tap handler looks the session up, opens Zoom once, and logs the Join like the Join buttons', () => {
  const hook = read('src/hooks/usePushNotifications.ts');
  // Lookup before the duplicate check; navigation and the open after it.
  assert.match(hook, /const joinSessionId = reminderJoinSessionId\(destination\);[\s\S]*?const plan = await planReminderJoin\(joinSessionId\);[\s\S]*?if \(!shouldHandlePushResponse\(data, response\.notification\.request\.identifier\)\) return true;[\s\S]*?router\.push\(route as never\);[\s\S]*?if \(meetingUrl\) void joinFamilySquaresFromPush\(accountId, meetingUrl\);/);
  assert.match(hook, /if \(plan\.action !== 'default'\) route = \{ pathname: '\/\(tabs\)' \};/);
  const join = read('src/lib/familySquaresPushJoin.ts');
  assert.match(join, /await markFamilySquaresJoin\(accountId, 'push'\);\s+try \{\s+await Linking\.openURL\(withAppContext\(url\)\);\s+logFunnelEvent\('attended', \{ source: 'push' \}\);/);
  assert.match(join, /\} catch \{\s+await clearFamilySquaresJoin\(accountId\);\s+return false;/);
  // A failed lookup keeps the push's usual destination.
  assert.match(join, /if \(error \|\| !data\) return \{ action: 'default' \};/);
});

// ── 3. Every Monday, and the calendar file ──────────────────────────────────

test('the calendar file is opened from the website-links module, never from an inline URL', () => {
  assert.equal(FAMILY_SQUARES_CALENDAR_URL, 'https://soberhelpline.com/family-squares.ics');
  assert.ok(FAMILY_SQUARES_CALENDAR_URL.startsWith(`${WEBSITE_ORIGIN}/`));
  const panel = read('src/components/familySquares/FamilySquaresSeatPanel.tsx');
  assert.match(panel, /await Linking\.openURL\(FAMILY_SQUARES_CALENDAR_URL\);/);
  assert.doesNotMatch(panel, /soberhelpline\.com/);
});

test('"Save my seat every Monday" is offered after a saved seat on Today, Support, onboarding, and in Settings', () => {
  const card = read('src/components/today/SituationCard.tsx');
  assert.match(card, /<FamilySquaresSeatPanel\s+accountId=\{accountId\}\s+rsvp=\{nextFreeCall\?\.rsvped \? 'going' : nextFreeCall\?\.declined \? 'declined' : 'none'\}\s+onDecline=\{onDecline\}/);
  assert.match(read('app/(tabs)/index.tsx'), /accountId=\{user\?\.id \?\? null\}[\s\S]*?onDecline=\{declineFreeCall\}/);
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /\{familySquares && \(\s+<FamilySquaresSeatPanel[\s\S]*?onDecline=\{\(\) => declineRsvp\(sess\)\}/);
  const onboarding = read('app/(onboarding)/notifications.tsx');
  assert.match(onboarding, /\{nextGroupId && !spanish && \(rsvped \|\| declined\) && \(/);
  assert.match(onboarding, /<FamilySquaresSeatPanel[\s\S]*?tone="onPrimary"/);
  const settings = read('app/settings.tsx');
  assert.match(settings, /value=\{weeklySeat\.enabled\}\s+onValueChange=\{\(value\) => void toggleWeeklySeat\(value\)\}/);
  // Turning it on in Settings also covers the coming meeting, unless she already answered.
  assert.match(settings, /if \(enabled\) void saveComingSeatIfUnanswered\(user\.id\);/);
  const seat = read('src/lib/familySquaresSeat.ts');
  assert.match(seat, /rpc\('set_family_squares_weekly_seat', \{ p_enabled: enabled \}\)/);
  assert.match(seat, /if \(error \|\| familySquaresRsvpIsCurrent\(answer\?\.family_squares_meeting_date\)\) return;\s+await reserveFamilySquares\(accountId\);/);
  // The panel shows nothing until a seat is saved, and a plain on/off switch after.
  const panel = read('src/components/familySquares/FamilySquaresSeatPanel.tsx');
  assert.match(panel, /if \(rsvp === 'none'\) return null;/);
  assert.match(panel, /<Switch\s+value=\{weekly\.enabled\}[\s\S]*?accessibilityRole="switch"\s+accessibilityLabel=\{t\('familySquares\.weekly\.title'\)\}/);
});

test('the weekly reset saves next Monday\'s seat only for verified members who asked', () => {
  const sql = read('supabase/migrations/20261114120000_family_squares_weekly_seat_and_decline.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS family_squares_weekly_seat boolean NOT NULL DEFAULT false;/);
  const restore = /FUNCTION public\._family_squares_restore_weekly_seats\(p_meeting_date date\)[\s\S]*?\$\$;/.exec(sql)?.[0] ?? '';
  for (const rule of [
    /WHERE a\.family_squares_weekly_seat/,
    /u\.email_confirmed_at IS NOT NULL/,
    /u\.deleted_at IS NULL/,
    /NOT coalesce\(u\.is_anonymous, false\)/,
    /coalesce\(a\.locale, 'en'\) NOT LIKE 'es%'/,
    // An answer already given for that meeting (going or declined) is kept.
    /ON CONFLICT \(session_id, account_id\) DO NOTHING;/,
    /SELECT v_session, a\.id, 'going', p_meeting_date, now\(\)/,
  ]) assert.match(restore, rule);
  // The reset in force is this one: it clears first, then saves next Monday (Tuesday + 6 days).
  const reset = /FUNCTION public\.reset_family_squares_weekly_rsvps\(\)[\s\S]*?\$function\$;/.exec(latestSql('reset_family_squares_weekly_rsvps'))?.[0] ?? '';
  assert.match(reset, /DELETE FROM public\.session_rsvps\s+WHERE session_id = public\.family_squares_session_id\(\)[\s\S]*?PERFORM public\._family_squares_restore_weekly_seats\(v_local_now::date \+ 6\);/);
  assert.match(reset, /PERFORM public\._family_squares_record_meeting_stats\(v_local_now::date - 1\);[\s\S]*?DELETE FROM public\.session_rsvps/);
  // Neither extra step can stop or undo the reset itself.
  assert.equal((reset.match(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/g) ?? []).length, 2);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\._family_squares_restore_weekly_seats\(date\) FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.set_family_squares_weekly_seat\(boolean\) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public\.set_family_squares_weekly_seat\(boolean\) TO authenticated;/);
});

// ── 4. "Can't make it this week" ────────────────────────────────────────────

test('declining changes only her own going Family Squares RSVP, and the reminders skip it', () => {
  const sql = read('supabase/migrations/20261114120000_family_squares_weekly_seat_and_decline.sql');
  assert.match(sql, /UPDATE public\.session_rsvps SET status = 'declined'\s+WHERE session_id = v_session AND account_id = v_account AND status = 'going';/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.decline_family_squares_rsvp\(\) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public\.decline_family_squares_rsvp\(\) TO authenticated;/);
  assert.match(read('src/lib/familySquaresSeat.ts'), /rpc\('decline_family_squares_rsvp'\);\s+return !error && data === true;/);
  // The delivery rules in force: "seat is saved" needs going; the 6:30 PM invite skips going and declined.
  const delivery = latestSql('dispatcher_job_delivery');
  assert.match(delivery, /IF p_job='session_reminder' THEN\s+allowed:=allowed AND EXISTS\(SELECT 1 FROM session_rsvps WHERE account_id=a\.id AND session_id=p_session_id AND status='going'\);/);
  assert.match(delivery, /NOT EXISTS\(SELECT 1 FROM session_rsvps\s+WHERE account_id=a\.id AND session_id=p_session_id AND status IN \('going','declined'\)\);/);
  // The 15-minute reminder reads going RSVPs only.
  const fifteen = read('supabase/functions/notify-session-reminder/index.ts');
  assert.equal((fifteen.match(/\.eq\('status', 'going'\)/g) ?? []).length, 2);
  // After a decline the panel says so; the weekly seat comes back next Monday.
  const panel = read('src/components/familySquares/FamilySquaresSeatPanel.tsx');
  assert.match(panel, /t\(weekly\.enabled \? 'familySquares\.decline\.doneWeekly' : 'familySquares\.decline\.done'\)/);
});

// ── 5. First-timer note ─────────────────────────────────────────────────────

test('"What to expect" covers the practical facts in both languages and promises nothing about anonymity', () => {
  for (const lang of ['en', 'es']) {
    const note = locale(lang, 'common').familySquares.firstTime;
    for (const key of ['title', 'zoom', 'camera', 'listen', 'length', 'dismiss', 'dismissLabel']) assert.ok(note[key], `${lang} ${key}`);
    assert.match(note.zoom, /Zoom/, lang);
    assert.match(note.length, /Matt Brown/, lang);
    assert.doesNotMatch(JSON.stringify(note), /anonym|anónim|confiden|privad|private|secret/i, lang);
  }
  const en = locale('en', 'common').familySquares.firstTime;
  assert.match(en.camera, /camera/i);
  assert.match(en.camera, /first name/i);
  assert.match(en.listen, /listen/i);
  assert.match(en.length, /hour/);
  assert.match(en.length, /free/);
  // Spanish speaks to her (most members are women).
  assert.match(locale('es', 'common').familySquares.firstTime.listen, /bienvenida/);
});

test('the note shows on the call card and on the RSVP confirmation, and hides for good', () => {
  assert.match(read('src/components/today/SituationCard.tsx'), /\{isFamilySquares && <FamilySquaresFirstTimerNote accountId=\{accountId\} \/>\}/);
  assert.match(read('app/(tabs)/support.tsx'), /\{familySquares && sess\.rsvped && <FamilySquaresFirstTimerNote accountId=\{user\?\.id \?\? null\} \/>\}/);
  assert.match(read('app/(onboarding)/notifications.tsx'), /\{rsvped && <FamilySquaresFirstTimerNote accountId=\{user\?\.id \?\? null\} tone="onPrimary" \/>\}/);
  const note = read('src/components/familySquares/FamilySquaresFirstTimerNote.tsx');
  assert.match(note, /if \(!visible\) return null;/);
  assert.match(note, /accessibilityLabel=\{t\('familySquares\.firstTime\.dismissLabel'\)\}\s+onPress=\{dismiss\}/);
  // Hidden once she dismisses it or taps Join; unknown (a failed read) never shows it.
  const store = read('src/lib/familySquaresFirstTimer.ts');
  assert.match(store, /return \(await AsyncStorage\.getItem\(key\(accountId\)\)\) === null;\s+\} catch \{\s+return false;/);
  assert.match(read('src/lib/meetingAttendance.ts'), /await markFamilySquaresJoined\(accountId\);/);
});

// ── 6. Real attendance ──────────────────────────────────────────────────────

test('only a Join tap at meeting time leaves a mark', () => {
  assert.equal(newJoinMark('today', new Date('2026-11-18T19:00:00Z')), null, 'a midweek Join is not attendance');
  assert.equal(newJoinMark('support', at(-45)), null);
  assert.deepEqual(newJoinMark('push', at(-10)), { schemaVersion: 1, joinedAt: at(-10).toISOString(), meetingDate: '2026-11-16', source: 'push' });
  const mark = newJoinMark('today', at(3))!;
  assert.deepEqual(parseJoinMark(JSON.stringify(mark)), mark);
  for (const raw of [null, '', 'x', '[]', '{}', JSON.stringify({ ...mark, schemaVersion: 2 }), JSON.stringify({ ...mark, joinedAt: 'soon' }),
    JSON.stringify({ ...mark, meetingDate: 'Monday' }), JSON.stringify({ ...mark, source: 'elsewhere' })]) {
    assert.equal(parseJoinMark(raw), null, String(raw));
  }
});

test('coming back ten minutes or more later counts, once per meeting', () => {
  const mark = newJoinMark('today', at(0)) as JoinMark;
  const after = (ms: number) => START + ms;
  assert.equal(attendanceDecision(mark, after(2_000), null), 'keep', 'Zoom is still opening');
  assert.equal(attendanceDecision(mark, after(2 * 60_000), null), 'discard', 'a quick look and back');
  assert.equal(attendanceDecision(mark, after(ATTENDED_MINIMUM_MS - 1), null), 'discard');
  assert.equal(attendanceDecision(mark, after(ATTENDED_MINIMUM_MS), null), 'log');
  assert.equal(attendanceDecision(mark, after(65 * 60_000), null), 'log');
  assert.equal(attendanceDecision(mark, after(ATTENDED_MAXIMUM_MS + 1), null), 'discard', 'a stale mark the next day');
  assert.equal(attendanceDecision(mark, after(65 * 60_000), '2026-11-16'), 'discard', 'already logged for this meeting');
  assert.equal(attendanceDecision(mark, after(65 * 60_000), '2026-11-09'), 'log', 'last week does not block this week');
  assert.equal(attendanceDecision(mark, after(-60_000), null), 'discard', 'a clock that moved backwards');
});

test('every Join button leaves the mark, and returning to any screen logs it', () => {
  const card = read('src/components/today/SituationCard.tsx');
  assert.match(card, /if \(isFamilySquares\) await markFamilySquaresJoin\(accountId, 'today'\);\s+try \{\s+await Linking\.openURL\(withAppContext\(nextFreeCall!\.zoom_url!\)\);\s+logFunnelEvent\('attended', \{ source: 'today' \}\);/);
  assert.match(card, /if \(isFamilySquares\) await clearFamilySquaresJoin\(accountId\);/);
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /if \(session\.kind === 'group'\) logFunnelEvent\('attended', \{ source: 'support' \}\);/);
  assert.match(support, /void markFamilySquaresJoin\(user\?\.id, 'support'\)\s+\.then\(\(\) => Linking\.openURL\(url\)\)\s+\.catch\(\(\) => clearFamilySquaresJoin\(user\?\.id\)\);/);
  assert.match(read('src/lib/familySquaresPushJoin.ts'), /markFamilySquaresJoin\(accountId, 'push'\)/);
  const layout = read('app/_layout.tsx');
  assert.match(layout, /if \(returnedToForeground\) void flushFamilySquaresAttendance\(accountId\);/);
  assert.match(layout, /<MeetingAttendanceCoordinator \/>/);
  const attendance = read('src/lib/meetingAttendance.ts');
  // Remembered on the device before it is sent, so a second return cannot log twice.
  assert.match(attendance, /await AsyncStorage\.setItem\(loggedKey, mark\.meetingDate\);\s+logFunnelEvent\('attended_10min', \{ meeting_date: mark\.meetingDate, source: mark\.source \}\);/);
  // Both keys carry the account id, so sign-out clears them (accountLocalKeys).
  assert.match(attendance, /return `\$\{prefix\}\$\{encodeURIComponent\(accountId\)\}`;/);
});

test('the server allows exactly the stages the app can log, attended_10min included', () => {
  const sql = latestSql('log_funnel_event');
  const allowList = /IF p_stage NOT IN \(([\s\S]*?)\) THEN/.exec(sql)?.[1] ?? '';
  const serverStages = new Set([...allowList.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));
  const union = /export type FunnelStage =([\s\S]*?);/.exec(read('src/lib/funnel.ts'))?.[1] ?? '';
  const clientStages = [...union.matchAll(/\| '([a-z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(clientStages.includes('attended_10min'));
  for (const stage of clientStages) assert.ok(serverStages.has(stage), `log_funnel_event refuses ${stage}`);
  // The table constraint allows every stage the function accepts.
  const constraint = /ADD CONSTRAINT funnel_events_stage_check\s+CHECK \(stage IN \(([\s\S]*?)\)\);/.exec(sql)?.[1] ?? '';
  for (const stage of serverStages) assert.match(constraint, new RegExp(`'${stage}'`), stage);
  // Only the meeting date and the source are kept; one per member and meeting.
  assert.match(sql, /AND e\.metadata ->> 'meeting_date' = v_meeting\s+\) THEN\s+RETURN;/);
  assert.match(sql, /WHEN p_metadata ->> 'source' IN \('today', 'support', 'push'\) THEN p_metadata ->> 'source'/);
});

test('the admin figure is per meeting, and older admin builds still get every key they read', () => {
  const sql = latestSql('admin_funnel_stats');
  for (const key of ['members', 'paid_accounts', 'onboarded_loved_one', 'free_rsvps', 'attended', 'coaching_requested',
    'coaching_confirmed', 'intervention_viewed', 'intervention_started', 'bands', 'family_squares_weeks']) {
    assert.match(sql, new RegExp(`'${key}',`), key);
  }
  for (const key of ['meeting_date', 'rsvps', 'declined', 'join_taps', 'attended_10min']) assert.match(sql, new RegExp(`'${key}',`), key);
  assert.match(sql, /IF NOT public\.is_admin_jwt\(\) THEN\s+RAISE EXCEPTION 'not authorized';/);
  const admin = read('app/admin.tsx');
  assert.match(admin, /family_squares_weeks\?: FamilySquaresWeek\[\];/);
  assert.match(admin, /funnel\.family_squares_weeks\?\.length \? \(/);
  // Against an older backend the screen falls back to the line it always showed.
  assert.match(admin, /Funnel: \{funnel\.free_rsvps\} RSVP&apos;d → \{funnel\.attended\} attended/);
  assert.match(admin, /\{week\.rsvps \?\? '–'\} RSVP&apos;d/);
});

// ── Accessibility of the new and touched buttons ────────────────────────────

test('every new or touched button says what it is and what it does', () => {
  const buttons = (source: string) => source.match(/<TouchableOpacity[\s\S]*?>/g) ?? [];
  for (const file of ['src/components/familySquares/FamilySquaresSeatPanel.tsx', 'src/components/familySquares/FamilySquaresFirstTimerNote.tsx']) {
    const found = buttons(read(file));
    assert.ok(found.length >= 1, file);
    for (const button of found) {
      assert.match(button, /accessibilityRole="button"/, `${file}: ${button}`);
      assert.match(button, /accessibilityLabel=\{t\('/, `${file}: ${button}`);
    }
  }
  const card = read('src/components/today/SituationCard.tsx');
  for (const label of ['situationCta.joinLabel', 'situationCta.rsvpLabel', 'situationCta.goingLabel']) {
    assert.match(card, new RegExp(`accessibilityRole="button"\\s+accessibilityLabel=\\{t\\([^\\n]*'${label.replace('.', '\\.')}'`), label);
  }
  const row = /const renderSession = [\s\S]*?\n  \};\n/.exec(read('app/(tabs)/support.tsx'))?.[0] ?? '';
  const rowButtons = buttons(row);
  assert.equal(rowButtons.length, 3, 'Join, RSVP and Ask a question');
  for (const button of rowButtons) {
    assert.match(button, /accessibilityRole="button"\s+accessibilityLabel=\{t\(/, button);
  }
  assert.match(read('app/(onboarding)/notifications.tsx'), /accessibilityRole="button"\s+accessibilityLabel=\{rsvped \? t\('done\.rsvpDone'\) : t\('done\.rsvpButton'\)\}/);
  for (const lang of ['en', 'es']) {
    const today = locale(lang, 'today').situationCta;
    const support = locale(lang, 'support');
    for (const label of [today.joinLabel, today.rsvpLabel, today.goingLabel, support.sessions.joinLabel,
      support.sessions.rsvpLabel, support.sessions.confirmLabel, support.questionModal.buttonLabel]) {
      assert.match(label, /\{\{name\}\}/, `${lang}: ${label}`);
    }
  }
});
