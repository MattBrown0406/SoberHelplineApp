import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { accountIsNewForFirstTimerNote, FIRST_TIMER_NOTE_DAYS, seatSaveFailureKey, websiteDeclineReason } from '../src/lib/familySquaresCard';
import { isFamilySquaresMeetingDay, mondayChallengeShown } from '../src/lib/mondayChallenge';
import { STORE_ANSWER_WAIT_MS, purchaseAccountNow, purchaseExitsLocked } from '../src/lib/purchaseSteps';
import { emptyReminderAskMemory, recordsTodayShowing, reminderAskResult, todayReminderAsk } from '../src/lib/reminderAsk';

// Audit round 3 (app side): the pure rules, and the places that must use them.
const read = (file: string) => readFileSync(file, 'utf8');
const locale = (lang: string, name: string) => JSON.parse(read(`src/locales/${lang}/${name}.json`));

// ── M1: a cancelled week is a DATE, compared every time it is used ──────────

test('M1: every screen compares the cancelled date with the coming meeting each time it draws', () => {
  const card = read('src/components/today/SituationCard.tsx');
  assert.match(card, /cancelled: isCancelledMeetingDate\(nextFreeCall\?\.cancelledDate\),/);
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /cancelled: isCancelledMeetingDate\(sess\.cancelledDate\),/);
  assert.match(read('app/(tabs)/index.tsx'), /!isCancelledMeetingDate\(nextFreeCall\.cancelledDate\);/);
  // No bare yes/no is kept anywhere: the hooks hold the date the answer was for.
  for (const file of ['src/hooks/useSessions.ts', 'src/hooks/useTodayFeed.ts']) {
    const hook = read(file);
    assert.match(hook, /cancelledDate\?: string \| null;/, file);
    assert.doesNotMatch(hook, /cancelled\?: boolean/, file);
    assert.match(hook, /loadFamilySquaresCancelledDate\(\),/, file);
  }
  for (const file of ['app/(tabs)/support.tsx', 'app/(tabs)/index.tsx', 'src/components/today/SituationCard.tsx']) {
    assert.doesNotMatch(read(file), /(nextFreeCall|sess|session)\??\.cancelled\b/, `${file}: no bare cancelled flag`);
  }
  // Support reads again when the app returns to the front, as Today does, and is drawn again at once.
  const sessions = read('src/hooks/useSessions.ts');
  assert.match(sessions, /AppState\.addEventListener\('change', \(state\) => \{\s+if \(state !== 'active'\) return;\s+setReturns\(\(count\) => count \+ 1\);\s+if \(accountId\) void load\(\);/);
  // Today: a read that fails keeps the card but never an earlier "cancelled".
  const feed = read('src/hooks/useTodayFeed.ts');
  assert.match(feed, /if \(failed && loadedFor\.current === accountId\) \{[\s\S]*?const fresh = isFamilySquaresSession\(prev\) \? cancelledDate : null;\s+return \(prev\.cancelledDate \?\? null\) === fresh \? prev : \{ \.\.\.prev, cancelledDate: fresh \};/);
});

// ── M2: the Boundaries tab's Monday line ────────────────────────────────────

test('M2: "meeting day" is the meeting\'s own Pacific day, until its hour is over', () => {
  // Monday 2026-11-16, Pacific (PST, UTC-8).
  assert.equal(isFamilySquaresMeetingDay(new Date('2026-11-16T08:30:00Z')), true, 'Monday 12:30 AM Pacific');
  assert.equal(isFamilySquaresMeetingDay(new Date('2026-11-17T03:30:00Z')), true, 'Monday 7:30 PM Pacific: under way');
  assert.equal(isFamilySquaresMeetingDay(new Date('2026-11-17T04:30:00Z')), false, 'Monday 8:30 PM Pacific: over');
  assert.equal(isFamilySquaresMeetingDay(new Date('2026-11-17T17:00:00Z')), false, 'Tuesday');
  // A phone in Sydney: Monday 10:00 AM there is still Sunday afternoon in Pacific time.
  assert.equal(isFamilySquaresMeetingDay(new Date('2026-11-15T23:00:00Z')), false);
  // ...and its Tuesday 10:00 AM is Monday 3:00 PM Pacific, the day of the meeting.
  assert.equal(isFamilySquaresMeetingDay(new Date('2026-11-16T23:00:00Z')), true);
  // Summer time too (PDT, UTC-7): Monday 2026-07-06, 6:00 PM Pacific.
  assert.equal(isFamilySquaresMeetingDay(new Date('2026-07-07T01:00:00Z')), true);
});

test('M2: the Monday line never shows in a cancelled week or after "can\'t make it", and Spanish is as before', () => {
  const english = { spanish: false, localMonday: true, meetingDay: true, cancelled: false, declined: false };
  assert.equal(mondayChallengeShown(english), true);
  assert.equal(mondayChallengeShown({ ...english, cancelled: true }), false);
  assert.equal(mondayChallengeShown({ ...english, declined: true }), false);
  // The phone's own Monday does not decide it in English (Sydney: a day early).
  assert.equal(mondayChallengeShown({ ...english, meetingDay: false }), false);
  assert.equal(mondayChallengeShown({ ...english, localMonday: false }), true);
  // Spanish: La Sobremesa's line on the phone's Monday, whatever Family Squares is doing.
  for (const cancelled of [true, false]) for (const declined of [true, false]) for (const meetingDay of [true, false]) {
    assert.equal(mondayChallengeShown({ spanish: true, localMonday: true, meetingDay, cancelled, declined }), true);
    assert.equal(mondayChallengeShown({ spanish: true, localMonday: false, meetingDay, cancelled, declined }), false);
  }
  const screen = read('app/(tabs)/boundaries.tsx');
  assert.match(screen, /const meetingDay = !spanish && isFamilySquaresMeetingDay\(now\);\s+const mondayWeek = useMondayMeetingWeek\(user\?\.id \?\? null, meetingDay\);\s+const isMonday = mondayChallengeShown\(\{/);
  assert.doesNotMatch(screen, /const isMonday = now\.getDay\(\) === 1;/);
  // The same two sources Today reads, both kept as the date they were read for; any failure is "show it".
  const hook = read('src/hooks/useMondayMeetingWeek.ts');
  assert.match(hook, /Promise\.all\(\[loadFamilySquaresCancelledDate\(\), loadDeclinedDate\(accountId\)\]\)/);
  assert.match(hook, /\.from\('session_rsvps'\)\s+\.select\('family_squares_meeting_date'\)\s+\.eq\('account_id', accountId\)\s+\.eq\('status', 'declined'\);\s+if \(error \|\| !Array\.isArray\(data\)\) return null;/);
  assert.match(hook, /\} catch \{\s+return null;\s+\}/);
  assert.match(hook, /declined: mine !== null && mine\.declinedDate !== null && mine\.declinedDate === comingFamilySquaresMeetingDate\(\),/);
  assert.match(hook, /if \(!accountId \|\| !enabled\) \{\s+setWeek\(null\);\s+return;/);
});

// ── M3: the website's own reason for refusing a seat ────────────────────────

test('M3: the website\'s reason decides the sentence; without one, what the device knows does', () => {
  const CANCELLED = 'common:familySquares.cancelled.line', UNAVAILABLE = 'common:familySquares.registrationUnavailable';
  for (const known of [true, false]) {
    assert.equal(seatSaveFailureKey('website_declined', known, 'meeting_cancelled'), CANCELLED);
    assert.equal(seatSaveFailureKey('website_declined', known, 'registration_unavailable'), UNAVAILABLE);
    // A connection problem keeps its own words whatever else is known.
    assert.equal(seatSaveFailureKey(undefined, known, 'meeting_cancelled'), 'support:sessions.rsvpErrorBody');
    assert.equal(seatSaveFailureKey('failed', known), 'support:sessions.rsvpErrorBody');
  }
  // An older server sends no reason.
  assert.equal(seatSaveFailureKey('website_declined', true), CANCELLED);
  assert.equal(seatSaveFailureKey('website_declined', false), UNAVAILABLE);
  assert.equal(websiteDeclineReason('meeting_cancelled'), 'meeting_cancelled');
  assert.equal(websiteDeclineReason('registration_unavailable'), 'registration_unavailable');
  for (const other of [undefined, null, '', 'attendee_blocked', 'MEETING_CANCELLED', 1, {}]) assert.equal(websiteDeclineReason(other), undefined);
});

test('M3: onboarding asks whether the week is cancelled before it offers the seat', () => {
  const screen = read('app/(onboarding)/notifications.tsx');
  // Asked for the English meeting only; no answer, or any doubt, offers the seat (the state starts "not cancelled").
  assert.match(screen, /const \[cancelledDate, setCancelledDate\] = useState<string \| null>\(null\);/);
  assert.match(screen, /if \(spanish\) \{\s+setCancelledDate\(null\);\s+return undefined;\s+\}\s+let active = true;\s+void loadFamilySquaresCancelledDate\(\)\.then\(\(date\) => \{ if \(active\) setCancelledDate\(date\); \}\)\.catch\(\(\) => undefined\);/);
  assert.match(screen, /const weekCancelled = !spanish && isCancelledMeetingDate\(cancelledDate\);/);
  // The calm line takes the button's place; the button, its note and the seat options are for a week that is on.
  assert.match(screen, /\{nextGroupId && weekCancelled && \(\s+<Text style=\{\[styles\.cancelledLine, \{ color: '#fff' \}\]\} accessibilityLiveRegion="polite">\s+\{t\('common:familySquares\.cancelled\.line'\)\}/);
  assert.match(screen, /\{nextGroupId && !weekCancelled && \(\s+<TouchableOpacity\s+accessibilityRole="button"\s+accessibilityLabel=\{rsvped \? t\('done\.rsvpDone'\) : t\('done\.rsvpButton'\)\}/);
  // A refusal that says "cancelled" puts the line there as well.
  assert.match(screen, /if \(reserved\.reason === 'website_declined' && reserved\.websiteReason === 'meeting_cancelled'\) setCancelledDate\(comingFamilySquaresMeetingDate\(\)\);/);
  // The hooks show the cancelled line at once on that answer.
  assert.match(read('src/hooks/useTodayFeed.ts'), /if \(reserved\.websiteReason === 'meeting_cancelled'\) \{[\s\S]*?const cancelledDate = comingFamilySquaresMeetingDate\(\);\s+setNextFreeCall\(\(prev\) => prev\?\.id === nextFreeCall\.id \? \{ \.\.\.prev, cancelledDate \} : prev\);/);
  assert.match(read('src/hooks/useSessions.ts'), /if \(reserved\.websiteReason === 'meeting_cancelled'\) \{[\s\S]*?setSessions\(\(prev\) => prev\.map\(\(s\) => s\.id === session\.id \? \{ \.\.\.s, cancelledDate \} : s\)\);\s+return 'meeting_cancelled';/);
});

// ── L2 / L3: a purchase the store completed is never dropped; no wait is endless ──

test('L2: a purchase is dropped only when a DIFFERENT account is signed in afterwards', () => {
  const buyer = { buyerAccountId: 'account-A', buyerUserId: 'auth-A' };
  assert.equal(purchaseAccountNow({ ...buyer, accountIdNow: 'account-A', userIdNow: 'auth-A' }), 'same');
  // The session read came back empty or failed (a token refresh failing at that moment): still hers.
  assert.equal(purchaseAccountNow({ ...buyer, accountIdNow: 'account-A', userIdNow: null }), 'unknown');
  assert.equal(purchaseAccountNow({ ...buyer, accountIdNow: 'account-A', userIdNow: undefined }), 'unknown');
  assert.equal(purchaseAccountNow({ ...buyer, accountIdNow: undefined, userIdNow: null }), 'unknown');
  assert.equal(purchaseAccountNow({ ...buyer, accountIdNow: null, userIdNow: 'auth-A' }), 'unknown');
  // Someone else: never credited.
  assert.equal(purchaseAccountNow({ ...buyer, accountIdNow: 'account-B', userIdNow: 'auth-A' }), 'different');
  assert.equal(purchaseAccountNow({ ...buyer, accountIdNow: 'account-A', userIdNow: 'auth-B' }), 'different');
  assert.equal(purchaseAccountNow({ ...buyer, accountIdNow: 'account-B', userIdNow: null }), 'different');
  assert.equal(purchaseAccountNow({ ...buyer, accountIdNow: undefined, userIdNow: 'auth-B' }), 'different');
});

test('L3: the exits are locked only while the store is asked and has not been silent for two minutes', () => {
  assert.equal(STORE_ANSWER_WAIT_MS, 120_000);
  assert.equal(purchaseExitsLocked('store', false), true);
  assert.equal(purchaseExitsLocked('store', undefined), true);
  assert.equal(purchaseExitsLocked('store', true), false);
  for (const phase of ['idle', 'preparing', 'finishing'] as const) for (const slow of [true, false]) assert.equal(purchaseExitsLocked(phase, slow), false);
  const hook = read('src/hooks/usePlanPurchase.ts');
  assert.match(hook, /purchaseInFlight: purchaseExitsLocked\(flowPhase, storeSlow\),/);
  assert.match(hook, /stillChecking: flowPhase === 'store' && storeSlow,/);
  assert.match(hook, /if \(flow\.phase === 'store' && !flow\.storeSlow\) return;/);
  // The line is shown in the sheet and, once she has closed it, on the plans screen.
  const screen = read('app/plans.tsx');
  assert.match(screen, /stillChecking=\{plan\.stillChecking\}/);
  assert.match(screen, /\{plan\.stillChecking && \(\s+<Text style=\{\[styles\.intro, \{ color: colors\.ink \}\]\} accessibilityLiveRegion="polite">\{t\('stillChecking'\)\}<\/Text>/);
  assert.match(read('src/components/plans/UpgradeSheet.tsx'), /\{stillChecking && \(\s+<Text[^>]*accessibilityLiveRegion="polite">\s+\{tPlans\('stillChecking'\)\}/);
  // The store's answer is still waited for without limit (useIAP is unchanged there).
  assert.match(read('src/hooks/useIAP.ts'), /const result = await purchase;/);
  for (const lang of ['en', 'es']) {
    const line = locale(lang, 'plans').stillChecking as string;
    assert.ok(line.length > 20, lang);
    assert.doesNotMatch(line, /[!¡$]|\d/, `${lang}: calm, and no price`);
  }
  assert.equal(locale('en', 'plans').stillChecking, "This is taking longer than usual. We're still checking your purchase with the App Store, and you don't have to wait here.");
});

test('L1: the purchase-error alert has a title that is true for either plan', () => {
  const hook = read('src/hooks/usePlanPurchase.ts');
  assert.equal((hook.match(/appAlert\(t\('upgradeSheet\.iapErrorTitle'\), t\('upgradeSheet\.iapError'\)\)/g) ?? []).length, 2);
  assert.doesNotMatch(hook, /appAlert\(t\('upgradeSheet\.title'\)/);
  assert.equal(locale('en', 'support').upgradeSheet.iapErrorTitle, 'Purchase not completed');
  assert.equal(locale('es', 'support').upgradeSheet.iapErrorTitle, 'Compra no completada');
  for (const lang of ['en', 'es']) assert.doesNotMatch(locale(lang, 'support').upgradeSheet.iapErrorTitle, /Premier|Essential/);
});

// ── L4 / L8: the reminder ask ───────────────────────────────────────────────

test('L4: Today\'s showing is recorded only when Today is in front and the ask is on it', () => {
  const now = new Date('2026-11-18T18:00:00Z');
  const memory = emptyReminderAskMemory();
  const seen = { kind: 'ask' as const, focused: true, showing: 'ask' as const, memory, now };
  assert.equal(recordsTodayShowing(seen), true);
  // The look ran while another tab was in front (every foreground and store notice does): not a showing.
  assert.equal(recordsTodayShowing({ ...seen, focused: false }), false);
  // Nothing to show, or something else is on screen.
  assert.equal(recordsTodayShowing({ ...seen, kind: null, showing: null }), false);
  assert.equal(recordsTodayShowing({ ...seen, showing: null }), false);
  assert.equal(recordsTodayShowing({ ...seen, showing: 'on' }), false);
  assert.equal(recordsTodayShowing({ ...seen, memory: null }), false);
  // Already recorded today: once per showing.
  assert.equal(recordsTodayShowing({ ...seen, memory: { ...memory, todayShownAt: now.toISOString() } }), false);
  assert.equal(recordsTodayShowing({ ...seen, kind: 'settings', showing: 'settings' }), true);
});

test('L4: no reminder is offered for a Monday that is known cancelled', () => {
  const now = new Date('2026-11-18T18:00:00Z');
  const base = { supported: true, permission: 'askable' as const, memory: emptyReminderAskMemory(), joinedAt: '2026-01-05T12:00:00Z', now, seatAskShowing: false, welcomeBackShowing: false };
  assert.equal(todayReminderAsk(base), 'ask');
  assert.equal(todayReminderAsk({ ...base, meetingCancelled: false }), 'ask');
  assert.equal(todayReminderAsk({ ...base, meetingCancelled: true }), null);
  assert.equal(todayReminderAsk({ ...base, permission: 'blocked', meetingCancelled: true }), null);
  // Only Family Squares can be cancelled: La Sobremesa's card never passes it.
  assert.match(read('app/(tabs)/index.tsx'), /const mondayCancelled = isFamilySquaresSession\(nextFreeCall\) && isCancelledMeetingDate\(nextFreeCall\?\.cancelledDate\);/);
  assert.match(read('src/hooks/useReminderAsk.ts'), /welcomeBackShowing: holdBack,\s+meetingCancelled,\s+\}\) : null\), \[joinedAt, holdBack, meetingCancelled\]\);/);
});

test('L8: "Reminders are on" is said only after her own tap whose preference change was saved', () => {
  const granted = { registered: true, permission: 'granted' as const };
  assert.equal(reminderAskResult({ ...granted, herTap: true, preferenceSaved: true }), 'on');
  // The device registered but her Monday reminder could not be switched on: "couldn't turn reminders on".
  assert.equal(reminderAskResult({ ...granted, herTap: true, preferenceSaved: false }), 'failed');
  // Permission merely found already given: her Monday switch may be off, so nothing is promised.
  assert.equal(reminderAskResult({ ...granted, herTap: false, preferenceSaved: false }), null);
  assert.equal(reminderAskResult({ ...granted, herTap: false, preferenceSaved: true }), null);
  // Not registered: as before.
  for (const herTap of [true, false]) {
    assert.equal(reminderAskResult({ registered: false, herTap, preferenceSaved: false, permission: 'blocked' }), 'settings');
    assert.equal(reminderAskResult({ registered: false, herTap, preferenceSaved: false, permission: 'granted' }), 'failed');
    assert.equal(reminderAskResult({ registered: false, herTap, preferenceSaved: false, permission: 'askable' }), 'ask');
    assert.equal(reminderAskResult({ registered: false, herTap, preferenceSaved: false, permission: null }), 'ask');
  }
  const hook = read('src/hooks/useReminderAsk.ts');
  // No fire-and-forget: the answer is waited for (ten seconds at most), and an error is "not saved".
  assert.doesNotMatch(hook, /void Promise\.resolve\(supabase\.rpc\('set_family_call_reminders'/);
  assert.match(hook, /const preferenceSaved = registered && askSystem \? await turnMondayRemindersOn\(\) : false;/);
});

// ── L6: no sales prompts for a bereaved member ──────────────────────────────

test('L6: a bereaved member is shown no Upgrade button on Support and no "See plans" card on Learn', () => {
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /\{accountState === 'direct-essential' && bereaved === false && \(\s+<TouchableOpacity[\s\S]*?plansHref\('support_upgrade', 'premium'\)/);
  const learn = read('app/(tabs)/learn.tsx');
  assert.match(learn, /const bereaved = useBereavedOnDevice\(user\?\.id \?\? null\);/);
  // "Not known yet" shows nothing either, as everywhere else that sells.
  assert.match(learn, /\)\) : bereaved === false \? \(\s+<View[^>]*>\s+<Text[^>]*>\{t\('membersLibrary\.title'\)\}<\/Text>[\s\S]*?plansHref\('learn_library'\)[\s\S]*?\) : null\}/);
  // Plans stay reachable on purpose from Settings and the membership guide.
  assert.match(read('app/settings.tsx') + read('app/membership-guide.tsx'), /plansHref\(/);
});

// ── L7: "What to expect your first time" is for new accounts ────────────────

test('L7: only an account created in the last 30 days can be shown the first-timer note', () => {
  const now = new Date('2026-11-14T18:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  assert.equal(FIRST_TIMER_NOTE_DAYS, 30);
  assert.equal(accountIsNewForFirstTimerNote(daysAgo(0), now), true);
  assert.equal(accountIsNewForFirstTimerNote(daysAgo(29.9), now), true);
  assert.equal(accountIsNewForFirstTimerNote(daysAgo(30), now), false);
  assert.equal(accountIsNewForFirstTimerNote(daysAgo(400), now), false, 'a long-standing attendee after an update');
  // Not known, or unreadable: never on a guess.
  for (const unknown of [null, undefined, '', 'yesterday']) assert.equal(accountIsNewForFirstTimerNote(unknown, now), false);
  const hook = read('src/hooks/useFirstTimerNote.ts');
  assert.match(hook, /if \(!accountId \|\| !accountIsNewForFirstTimerNote\(joinedAt\)\) return;\s+let active = true;\s+void firstTimerNoteWanted\(accountId\)/);
  assert.match(read('src/components/familySquares/FamilySquaresFirstTimerNote.tsx'), /useFirstTimerNote\(accountId, user && user\.id === accountId \? user\.joinedAt : null, onPrimary\)/);
});

// ── L9 / L11 / L12: words ───────────────────────────────────────────────────

test('L9: the Monday group card no longer says an RSVP is needed to join Family Squares', () => {
  const en = locale('en', 'support').mondayGroup.sub as string;
  assert.doesNotMatch(en, /RSVP to get|to get the Zoom link/);
  assert.match(en, /you can join without it/);
  assert.match(en, /no subscription needed/);
  // Spanish members see La Sobremesa here, where reserving really is what gives the personal link.
  const es = locale('es', 'support').mondayGroup.sub as string;
  assert.match(es, /enlace personal/);
  assert.match(locale('es', 'common').laSobremesa.note, /Al reservar recibes tu enlace personal/);
});

test('L11: Spanish plans copy names La Sobremesa as the free meeting, never Family Squares', () => {
  const es = locale('es', 'plans');
  for (const [name, line] of [['intro', es.intro], ['paywall.free', es.paywall.free], ['benefits.free.familySquares', es.benefits.free.familySquares], ['invite.afterMeeting', es.invite.afterMeeting]] as const) {
    assert.match(line, /La Sobremesa/, name);
    assert.doesNotMatch(line, /Family Squares/, name);
  }
  // English is unchanged, and the keys still line up.
  const en = locale('en', 'plans');
  assert.match(en.intro, /^Family Squares, the crisis guide/);
  assert.match(en.paywall.free, /Family Squares stay free/);
  assert.deepEqual(Object.keys(es), Object.keys(en));
});

test('L12: the weekly seat pauses after about six months away, in both languages', () => {
  assert.match(locale('en', 'common').familySquares.weekly.desc, /or after about six months away from the app\.$/);
  assert.match(locale('es', 'common').familySquares.weekly.desc, /o después de unos seis meses sin abrir la app\.$/);
});
