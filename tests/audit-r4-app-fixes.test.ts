import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { seatPanelView, weeklySeatNoteHeld, type SeatAnswer } from '../src/lib/familySquaresCard';
import { RESEND_COOLDOWN_SECONDS, resendSecondsLeft, signUpEmailAlreadySentAt, signUpFailure } from '../src/lib/frontDoor';
import { MEMBERSHIP_PATH_STAGES, PLAN_SOURCES, planSource, plansHref, purchasableTiers } from '../src/lib/membershipPath';
import { mondayCallShareMessage } from '../src/lib/passItOnResources';
import { PAYMENT_PENDING_ERROR_CODE, isPaymentPending, purchaseExitsLocked } from '../src/lib/purchaseSteps';

// Audit round 4 (app side): the pure rules, the words, and the places that must use them.
const read = (file: string) => readFileSync(file, 'utf8');
const locale = (lang: string, name: string) => JSON.parse(read(`src/locales/${lang}/${name}.json`));

// ── A1: what a Spanish member is invited to share ───────────────────────────

test('A1: in Spanish the invite card is named for the meeting it shares, La Sobremesa', () => {
  assert.equal(locale('es', 'today').disclosure.invite, 'Invita a alguien a La Sobremesa');
  assert.equal(locale('en', 'today').disclosure.invite, 'Invite someone to Family Squares');
  // The card under that title shares La Sobremesa in Spanish and Family Squares in English.
  assert.match(mondayCallShareMessage('es'), /La Sobremesa/);
  assert.doesNotMatch(mondayCallShareMessage('es'), /Family Squares/);
  assert.match(mondayCallShareMessage('en'), /Family Squares/);
  // Nothing else on Today names the English meeting to a Spanish member.
  assert.doesNotMatch(read('src/locales/es/today.json'), /Family Squares/);
});

// ── A2: what Today's reminder ask promises a Spanish member ─────────────────

test('A2: in Spanish the reminder ask promises only what La Sobremesa sends', () => {
  const es = locale('es', 'common').reminderAsk;
  // One reminder, 15 minutes before, and only for a member who reserved her place.
  for (const line of [es.todayBody, es.on]) {
    assert.match(line, /La Sobremesa/);
    assert.match(line, /Si reservas tu lugar/);
    assert.match(line, /15 minutos antes/);
    // The push opens Support, where her personal link is: no "join with one tap".
    assert.doesNotMatch(line, /un toque|una hora antes/);
    assert.doesNotMatch(line, /usted|\bsu\b|—/);
  }
  assert.equal(es.todayBody, '¿Quieres un recordatorio de La Sobremesa? Si reservas tu lugar, te avisamos 15 minutos antes de que empiece.');
  assert.equal(es.on, 'Los recordatorios están activados. Si reservas tu lugar, te avisamos 15 minutos antes de La Sobremesa.');
  // The same facts as the switch in Settings.
  assert.match(locale('es', 'settings').notifications.familyCallDesc, /15 minutos antes de La Sobremesa[\s\S]*si reservaste tu lugar/);
  // What "Remind me" sets is what that reminder needs: this device's push token and the Monday reminder switch.
  const hook = read('src/hooks/useReminderAsk.ts');
  assert.match(hook, /const registered = await registerForPushNotifications\(accountId, askSystem\)/);
  assert.match(hook, /supabase\.rpc\('set_family_call_reminders', \{ p_enabled: true \}\)/);
  // The English lines are unchanged.
  assert.equal(locale('en', 'common').reminderAsk.on, "Reminders are on. We'll let you know before the meeting.");
});

// ── A4: "your seat is saved for you" is said only where it is true ──────────

test('A4: the weekly note is held back from anyone the server may not save a seat for', () => {
  // Shown only when the device KNOWS she is not bereaved, and no Save tap here was refused for this meeting.
  assert.equal(weeklySeatNoteHeld({ bereaved: false, refusedHere: false }), false);
  assert.equal(weeklySeatNoteHeld({ bereaved: true, refusedHere: false }), true);
  assert.equal(weeklySeatNoteHeld({ bereaved: undefined, refusedHere: false }), true, 'not known yet: never on a guess');
  assert.equal(weeklySeatNoteHeld({ bereaved: false, refusedHere: true }), true);

  // Held: the switch is still shown (so "Save my spot" does not look as if it were off), without the sentence.
  assert.equal(seatPanelView({ cancelled: false, answer: 'none', weeklySeatOn: true, weeklyNoteHeld: true }), 'weekly_only');
  assert.equal(seatPanelView({ cancelled: false, answer: 'none', weeklySeatOn: true, weeklyNoteHeld: false }), 'weekly_note');
  assert.equal(seatPanelView({ cancelled: false, answer: 'none', weeklySeatOn: true }), 'weekly_note');
  // Holding the note changes nothing else.
  for (const weeklyNoteHeld of [true, false]) {
    assert.equal(seatPanelView({ cancelled: false, answer: 'none', weeklySeatOn: false, weeklyNoteHeld }), 'hidden');
    assert.equal(seatPanelView({ cancelled: true, answer: 'none', weeklySeatOn: true, weeklyNoteHeld }), 'weekly_only');
    for (const answer of ['going', 'declined'] as SeatAnswer[]) {
      assert.equal(seatPanelView({ cancelled: false, answer, weeklySeatOn: true, weeklyNoteHeld }), answer === 'going' ? 'full' : 'declined');
    }
  }

  const panel = read('src/components/familySquares/FamilySquaresSeatPanel.tsx');
  assert.match(panel, /const bereaved = useBereavedOnDevice\(accountId\);\s+const refusedHere = useFamilySquaresSeatRefused\(accountId\);\s+const panelView = seatPanelView\(\{ cancelled, answer: rsvp, weeklySeatOn: weekly\.enabled, weeklyNoteHeld: weeklySeatNoteHeld\(\{ bereaved, refusedHere \}\) \}\);/);
  // "Saved again from next Monday" follows the same rule.
  assert.match(panel, /t\(weekly\.enabled && bereaved === false \? 'familySquares\.decline\.doneWeekly' : 'familySquares\.decline\.done'\)/);
  const refused = read('src/hooks/useFamilySquaresSeatRefused.ts');
  assert.match(refused, /useEffect\(\(\) => subscribeFamilySquaresSeatRefused\(/);
  assert.match(refused, /return familySquaresSeatRefusedHere\(accountId\);/);

  // The sentence itself promises no more than usually happens, and still offers the button.
  const en = locale('en', 'common').familySquares.weekly.onNote;
  const es = locale('es', 'common').familySquares.weekly.onNote;
  assert.equal(en, 'Your weekly seat is on. We usually save your seat for the coming Monday within a few hours, and you can also save it now.');
  assert.equal(es, 'Tu lugar semanal está activado. Normalmente guardamos tu lugar para el próximo lunes en unas horas, y también puedes reservarlo ahora.');
  assert.doesNotMatch(en, /We'll save your seat for you|—/);
  assert.doesNotMatch(es, /Guardaremos tu lugar por ti|usted|—/);
});

// ── A5: a quiet door to the plans in Settings ───────────────────────────────

test('A5: Settings has one plain "See plans" row for anyone who could still choose a plan', () => {
  assert.ok((PLAN_SOURCES as readonly string[]).includes('settings'));
  assert.equal(planSource('settings'), 'settings');
  assert.deepEqual(plansHref('settings'), { pathname: '/plans', params: { source: 'settings' } });
  // Free, and Essential (Premier is still above it); nobody else.
  assert.equal(purchasableTiers('direct-free').length > 0, true);
  assert.equal(purchasableTiers('direct-essential').length > 0, true);
  assert.equal(purchasableTiers('direct-premium').length, 0);
  assert.equal(purchasableTiers('attached').length, 0);

  const settings = read('app/settings.tsx');
  assert.match(settings, /const canSeePlans = purchasableTiers\(accountState\)\.length > 0;/);
  // Inside the direct-account membership card, above Restore Purchases, in the same row style.
  const card = /\{!isAttached && \(\s+<View style=\{\[styles\.card[\s\S]*?\{t\('membership\.restore'\)\}/.exec(settings)?.[0] ?? '';
  const row = /\{canSeePlans && \(\s+<TouchableOpacity[\s\S]*?<\/TouchableOpacity>\s+\)\}/.exec(card)?.[0] ?? '';
  assert.ok(row, 'the row is in the membership card');
  assert.match(row, /styles\.restoreBtn,/);
  assert.match(row, /borderColor: colors\.line,/);
  assert.match(row, /onPress=\{\(\) => router\.push\(plansHref\('settings'\)\)\}/);
  assert.match(row, /accessibilityRole="button"\s+accessibilityLabel=\{t\('membership\.seePlans'\)\}/);
  assert.match(row, /<Text style=\{\[styles\.restoreText, \{ color: colors\.primary \}\]\}>\s+\{t\('membership\.seePlans'\)\}\s+<\/Text>/);
  // A door, not a sales card: no benefits, no price, no badge, and bereavement is never asked about.
  assert.doesNotMatch(row, /benefit|price|badge|bereaved|PlansTeaserCard|LockedPreviewRow/i);
  assert.equal(settings.split("plansHref('settings')").length - 1, 1);
  assert.equal(locale('en', 'settings').membership.seePlans, 'See plans');
  assert.equal(locale('es', 'settings').membership.seePlans, 'Ver planes');
});

// ── A6: sign-up asked again inside a minute ─────────────────────────────────

test('A6: the server\'s "too soon" at sign-up means the email already went out', () => {
  const now = 1_800_000_000_000;
  const tooSoon = { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 37 seconds.' };
  // The server names the wait: the email went out 23 seconds ago, and the resend rests for the 37 left.
  const sentAt = signUpEmailAlreadySentAt(tooSoon, { lastSentHereAtMs: null, nowMs: now });
  assert.equal(sentAt, now - 23_000);
  assert.equal(resendSecondsLeft(sentAt, now), 37);
  // This device sent that address an email within the last minute: its own time is used.
  assert.equal(signUpEmailAlreadySentAt(tooSoon, { lastSentHereAtMs: now - 10_000, nowMs: now }), now - 10_000);
  assert.equal(signUpEmailAlreadySentAt({ status: 429 }, { lastSentHereAtMs: now - 59_000, nowMs: now }), now - 59_000);
  // An older send on this device proves nothing by itself; the server's wait still does.
  assert.equal(signUpEmailAlreadySentAt({ status: 429 }, { lastSentHereAtMs: now - 61_000, nowMs: now }), null);
  assert.equal(signUpEmailAlreadySentAt(tooSoon, { lastSentHereAtMs: now - 61_000, nowMs: now }), now - 23_000);
  // A wait longer than the rest never locks the button for more than one rest.
  const long = signUpEmailAlreadySentAt({ status: 429, message: 'you can only request this after 300 seconds' }, { lastSentHereAtMs: null, nowMs: now });
  assert.equal(resendSecondsLeft(long, now), RESEND_COOLDOWN_SECONDS);
  // Not every 429 means an email went out: the project's own email limit sends nothing.
  assert.equal(signUpEmailAlreadySentAt({ status: 429, code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' }, { lastSentHereAtMs: null, nowMs: now }), null);
  assert.equal(signUpEmailAlreadySentAt({ status: 429, message: 'Request rate limit reached' }, { lastSentHereAtMs: null, nowMs: now }), null);
  assert.equal(signUpFailure({ status: 429, message: 'Email rate limit exceeded' }), 'failed');
  // And nothing but a 429 does.
  for (const other of [null, undefined, { status: 422, message: 'you can only request this after 5 seconds' }, { message: 'Network request failed' }]) {
    assert.equal(signUpEmailAlreadySentAt(other, { lastSentHereAtMs: now - 1_000, nowMs: now }), null);
  }

  const signUp = read('app/(auth)/sign-up.tsx');
  // Asked before the failure is read; she lands on "Confirm your email" with the time the email went out.
  assert.match(signUp, /if \(err\) \{[\s\S]*?const alreadySentAt = signUpEmailAlreadySentAt\(err, \{\s+lastSentHereAtMs: confirmationEmailLastSentAt\(email\),\s+nowMs: Date\.now\(\),\s+\}\);\s+if \(alreadySentAt !== null\) \{\s+setEmailSentAt\(alreadySentAt\);\s+setCheckEmail\(true\);\s+return;\s+\}[\s\S]*?const failure = signUpFailure\(err\);/);
  // A sign-up that goes through starts the rest from now.
  assert.match(signUp, /if \(!data\.session\) \{\s+setEmailSentAt\(null\);\s+setCheckEmail\(true\);\s+\}/);
  assert.match(signUp, /<ConfirmEmailPanel\s+email=\{email\.trim\(\)\}\s+password=\{password\}\s+sentAtMs=\{emailSentAt\}/);
  const panel = read('src/components/auth/ConfirmEmailPanel.tsx');
  assert.match(panel, /const \[lastSentAt, setLastSentAt\] = useState<number \| null>\(\(\) => sentAtMs \?\? Date\.now\(\)\);/);
  assert.match(panel, /useEffect\(\(\) => \{ noteConfirmationEmailSent\(email, sentAtMs \?\? Date\.now\(\)\); \}, \[email, sentAtMs\]\);/);
  // The resend button still refuses while the rest is running.
  assert.match(panel, /if \(busyRef\.current \|\| resendSecondsLeft\(lastSentAt, Date\.now\(\)\) > 0\) return;/);
});

// ── A7: a purchase waiting for approval ─────────────────────────────────────

test('A7: a purchase waiting for approval is not a failure, is not logged as one, and says so calmly', () => {
  // The code is RevenueCat's own, read from the installed SDK.
  const sdk = read('node_modules/@revenuecat/purchases-typescript-internal/dist/errors.d.ts');
  assert.match(sdk, new RegExp(`PAYMENT_PENDING_ERROR = "${PAYMENT_PENDING_ERROR_CODE}"`));
  assert.equal(isPaymentPending({ code: '20', message: 'The payment is pending.' }), true);
  assert.equal(isPaymentPending({ code: 20 }), true);
  assert.equal(isPaymentPending({ userInfo: { readableErrorCode: 'PaymentPendingError' } }), true);
  assert.equal(isPaymentPending({ userInfo: { readableErrorCode: 'PAYMENT_PENDING_ERROR' } }), true);
  for (const other of [null, undefined, 'error', {}, { code: '2' }, { code: '1', userCancelled: true }, { code: '10' }, { message: 'pending' }, new Error('20')]) {
    assert.equal(isPaymentPending(other), false);
  }

  const iap = read('src/hooks/useIAP.ts');
  assert.match(iap, /export type PurchaseResult = 'success' \| 'cancelled' \| 'failed' \| 'pending';/);
  // Read after "she cancelled" and "never started", before anything is logged or kept as an error.
  assert.match(iap, /if \(rcErr\.userCancelled\) return 'cancelled';[\s\S]*?if \(rcErr\.message === PURCHASE_NOT_STARTED\) return 'cancelled';[\s\S]*?if \(isPaymentPending\(err\)\) return 'pending';\s+console\.error\(/);

  const purchase = read('src/hooks/usePlanPurchase.ts');
  // The exits open again for anything but a success, pending included.
  assert.match(purchase, /setPhase\(result === 'success' \? 'finishing' : 'idle'\);/);
  assert.equal(purchaseExitsLocked('idle', false), false);
  // None of the server's stages means "waiting for approval": nothing is logged, and no new stage is invented.
  assert.match(purchase, /if \(\(session \|\| stillHers\) && result !== 'pending'\) \{\s+logMembershipPath\(\s+result === 'success' \? 'purchase_succeeded' : result === 'failed' \? 'purchase_failed' : 'purchase_cancelled',/);
  assert.deepEqual([...MEMBERSHIP_PATH_STAGES], [
    'plans_viewed', 'plan_sheet_opened', 'purchase_started', 'purchase_succeeded', 'purchase_cancelled', 'purchase_failed',
    'membership_invite_shown', 'membership_invite_tapped',
  ]);
  // The sheet closes and a calm note is shown: not the error title, and no "try again".
  assert.match(purchase, /\} else if \(result === 'pending'\) \{[\s\S]*?if \(onScreen\(\)\) \{\s+closeUpgrade\(\);\s+appAlert\(t\('upgradeSheet\.pendingTitle'\), t\('upgradeSheet\.pendingBody'\)\);\s+\}/);
  for (const lang of ['en', 'es']) {
    const sheet = locale(lang, 'support').upgradeSheet;
    assert.ok(sheet.pendingTitle && sheet.pendingBody, lang);
    assert.notEqual(sheet.pendingTitle, sheet.iapErrorTitle);
    assert.doesNotMatch(sheet.pendingTitle + sheet.pendingBody, /try again|inténtalo|wrong|salió mal|not completed|no completada|—|[$€£]\s?\d|usted/i, lang);
  }
  assert.equal(locale('en', 'support').upgradeSheet.pendingTitle, 'Waiting for approval');
  assert.equal(locale('en', 'support').upgradeSheet.pendingBody, "Your purchase is waiting for approval. Once it's approved, your plan turns on by itself.");
});

// ── A9: what this build tells the server it understands ─────────────────────

test('A9: this build reports push contract 2, because it logs attendance before leaving for Zoom', () => {
  const push = read('src/hooks/usePushNotifications.ts');
  assert.match(push, /export const PUSH_APP_CONTRACT = 2;/);
  assert.match(push, /p_app_contract: PUSH_APP_CONTRACT \}/);
  // What "2" stands for is true of every way into the meeting: Today, Support and a reminder tap.
  assert.match(read('src/components/today/SituationCard.tsx'), /await logFunnelEventAndWait\('attended', \{ source: 'today' \}\);\s+try \{\s+await Linking\.openURL\(/);
  assert.match(read('app/(tabs)/support.tsx'), /await logFunnelEventAndWait\('attended', \{ source: 'support' \}\);/);
  assert.match(read('src/lib/familySquaresPushJoin.ts'), /await logFunnelEventAndWait\('attended', \{ source: 'push' \}\);/);
});
