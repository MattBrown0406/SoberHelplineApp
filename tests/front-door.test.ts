import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  AUTO_TRY_MIN_GAP_MS,
  PASSWORD_MEMORY_BACKGROUND_LIMIT_MS,
  RESEND_COOLDOWN_SECONDS,
  FRONT_DOOR_READ_TIMEOUT_MS,
  SIGNED_IN_BEFORE_KEY,
  SIGN_UP_CONFIRM_REDIRECT_URL,
  SIGN_UP_SUBMITTED_KEY,
  confirmSignInOutcome,
  frontDoorRoute,
  hasEarlierSignInTrace,
  lateFrontDoorAction,
  parseSignedInBefore,
  resendSecondsLeft,
  shouldAutoTryOnReturn,
  shouldForgetPassword,
} from '../src/lib/frontDoor';
import { accountLocalKeys } from '../src/lib/accountLocalKeys';

const read = (file: string) => readFileSync(file, 'utf8');
const T0 = Date.UTC(2026, 10, 13, 18, 0, 0);

test('a device nobody has signed in on opens on creating an account; after any sign-in it opens on sign-in', () => {
  assert.equal(frontDoorRoute({ signedInBefore: false, signedInThisSession: false }), '/(auth)/sign-up');
  assert.equal(frontDoorRoute({ signedInBefore: true, signedInThisSession: false }), '/(auth)/sign-in');
  // Sign-out or account deletion in this session, even before the flag reached storage.
  assert.equal(frontDoorRoute({ signedInBefore: false, signedInThisSession: true }), '/(auth)/sign-in');
  assert.equal(frontDoorRoute({ signedInBefore: true, signedInThisSession: true }), '/(auth)/sign-in');
});

test('a sign-up sent from this phone opens on sign-in next time, even though nobody has signed in yet', () => {
  // She signed up at night, confirmed by email in the morning, and iOS had closed the app.
  assert.equal(frontDoorRoute({ signedInBefore: false, signedInThisSession: false, signUpSubmitted: true }), '/(auth)/sign-in');
  assert.equal(frontDoorRoute({ signedInBefore: false, signedInThisSession: false, signUpSubmitted: false }), '/(auth)/sign-up');
  // The flag is set the moment creating the account succeeds, before any session.
  const signUp = read('app/(auth)/sign-up.tsx');
  assert.match(signUp, /if \(err\) \{[\s\S]*?return;\s+\}\s+(\/\/[^\n]*\n\s+)+markSignUpSubmitted\(\);/);
  assert.equal(signUp.split('markSignUpSubmitted()').length - 1, 1);
  const store = read('src/lib/frontDoorStore.ts');
  assert.match(store, /export function markSignUpSubmitted\(\): void \{\s+if \(submitted === true\) return;\s+submitted = true;\s+void AsyncStorage\.setItem\(SIGN_UP_SUBMITTED_KEY, '1'\)\.catch\(\(\) => undefined\);/);
  assert.match(store, /stored = parseSignedInBefore\(await AsyncStorage\.getItem\(SIGN_UP_SUBMITTED_KEY\)\);/);
  // Like the other flag it carries no identity, so account deletion leaves it.
  const accountId = '3f0c2a54-9d1e-4a7b-8c11-2f6d5e7a9b10';
  assert.deepEqual(accountLocalKeys([SIGN_UP_SUBMITTED_KEY, `@sh:onboarded:${accountId}`], [accountId]), [`@sh:onboarded:${accountId}`]);
});

test('device flags that arrive after the wait still count, but never take a started form away', () => {
  assert.equal(FRONT_DOOR_READ_TIMEOUT_MS, 1500);
  const returning = { signedInBefore: true, signUpSubmitted: false };
  const base = { flags: returning, isLoading: false, isAuthenticated: false, inAuth: true, onSignUp: true, formStarted: false };
  assert.equal(lateFrontDoorAction(base), 'sign-in', 'an untouched "Create your account" is corrected once');
  assert.equal(lateFrontDoorAction({ ...base, flags: { signedInBefore: false, signUpSubmitted: true } }), 'sign-in');
  assert.equal(lateFrontDoorAction({ ...base, formStarted: true }), 'done', 'she has started typing: she stays');
  assert.equal(lateFrontDoorAction({ ...base, onSignUp: false }), 'done', 'already on sign-in or reset-password');
  assert.equal(lateFrontDoorAction({ ...base, isAuthenticated: true }), 'done');
  assert.equal(lateFrontDoorAction({ ...base, flags: { signedInBefore: false, signUpSubmitted: false } }), 'done', 'a new phone after all');
  // Not routed yet: the normal routing will use the corrected flags.
  assert.equal(lateFrontDoorAction({ ...base, isLoading: true }), 'wait');
  assert.equal(lateFrontDoorAction({ ...base, inAuth: false, onSignUp: false }), 'wait');

  const layout = read('app/_layout.tsx');
  // The late answer replaces the "new phone" fallback instead of being dropped.
  assert.match(layout, /if \(!gaveUp\) \{\s+setDeviceFlags\(\(current\) => current \?\? flags\);\s+return;\s+\}[\s\S]*?setLateFlags\(true\);/);
  assert.match(layout, /formStarted: signUpFormStarted\(\),/);
  assert.match(layout, /if \(action === 'wait'\) return;\s+setLateFlags\(false\);\s+if \(action !== 'sign-in'\) return;/);
  // Sign-up reports only a yes/no, never what was typed.
  const signUp = read('app/(auth)/sign-up.tsx');
  assert.match(signUp, /const formStarted = !!\(firstName \|\| lastName \|\| email \|\| password \|\| acceptedTerms \|\| checkEmail\);\s+useEffect\(\(\) => \{ noteSignUpFormStarted\(formStarted\); \}, \[formStarted\]\);/);
  assert.match(read('src/lib/frontDoorStore.ts'), /export function noteSignUpFormStarted\(started: boolean\): void \{\s+formStarted = started;\s+\}/);
});

test('the device flag is only ever "1", holds no identity, and survives account deletion', () => {
  assert.equal(parseSignedInBefore('1'), true);
  for (const stored of [null, undefined, '', '0', 'true', '{"email":"x"}']) assert.equal(parseSignedInBefore(stored), false);
  // Account deletion removes keys that carry the account or auth-user id; this one carries neither.
  const accountId = '3f0c2a54-9d1e-4a7b-8c11-2f6d5e7a9b10';
  assert.deepEqual(accountLocalKeys([SIGNED_IN_BEFORE_KEY, `@sh:onboarded:${accountId}`], [accountId]), [`@sh:onboarded:${accountId}`]);
  const store = read('src/lib/frontDoorStore.ts');
  assert.match(store, /AsyncStorage\.setItem\(SIGNED_IN_BEFORE_KEY, '1'\)/);
  assert.match(store, /AsyncStorage\.setItem\(SIGN_UP_SUBMITTED_KEY, '1'\)/);
  // Three writes, each of the bare '1': two for "signed in before", one for "sign-up sent".
  assert.equal((store.match(/AsyncStorage\.setItem\(/g) ?? []).length, 3, 'only the flags are ever written');
  assert.equal((store.match(/AsyncStorage\.setItem\((SIGNED_IN_BEFORE_KEY|SIGN_UP_SUBMITTED_KEY), '1'\)/g) ?? []).length, 3);
  assert.doesNotMatch(store, /email|password|accountId|user/i);
});

test('a phone that had the app before the flag existed still counts as signed in before', () => {
  assert.equal(hasEarlierSignInTrace([]), false);
  assert.equal(hasEarlierSignInTrace(['@sh:rehearsal_counts', 'reminderHour']), false);
  assert.equal(hasEarlierSignInTrace(['@sh:onboarded:3f0c2a54-9d1e-4a7b-8c11-2f6d5e7a9b10']), true);
  assert.equal(hasEarlierSignInTrace(['@sh:onboarded']), true);
  assert.equal(hasEarlierSignInTrace(['@sh:onboardedX']), false);
});

test('the root layout chooses the first screen from the flag and still sends sign-out to sign-in', () => {
  const layout = read('app/_layout.tsx');
  assert.match(layout, /if \(isAuthenticated\) signedInThisSession\.current = true;/);
  assert.match(layout, /if \(deviceFlags === null && !signedInThisSession\.current\) return;/);
  assert.match(layout, /const door = frontDoorRoute\(\{\s+signedInBefore: deviceFlags\?\.signedInBefore === true,\s+signUpSubmitted: deviceFlags\?\.signUpSubmitted === true,\s+signedInThisSession: signedInThisSession\.current,\s+\}\);/);
  assert.match(layout, /router\.replace\(door\);/);
  assert.doesNotMatch(layout, /router\.replace\('\/\(auth\)\/sign-in'\)/);
  // A session (new or restored) is what marks "signed in before"; sign-up alone never does
  // (it sets its own "sign-up sent" flag).
  assert.match(layout, /if \(!isAuthenticated\) return;\s+markSignedInBefore\(\);\s+setDeviceFlags\(\(current\) => \(\{ signUpSubmitted: current\?\.signUpSubmitted === true, signedInBefore: true \}\)\);/);
  // A slow device store never leaves a signed-out person waiting.
  assert.match(layout, /const timer = setTimeout\(\(\) => \{\s+gaveUp = true;\s+if \(active\) setDeviceFlags\(\(current\) => current \?\? \{ signedInBefore: false, signUpSubmitted: false \}\);\s+\}, FRONT_DOOR_READ_TIMEOUT_MS\);/);
  for (const file of ['app/(auth)/sign-up.tsx', 'src/components/auth/ConfirmEmailPanel.tsx']) {
    assert.doesNotMatch(read(file), /markSignedInBefore/, `${file} must not mark the device as signed in`);
  }
  assert.doesNotMatch(read('src/components/auth/ConfirmEmailPanel.tsx'), /frontDoorStore/);
});

test('"Send the email again" rests for 60 seconds after every email', () => {
  assert.equal(RESEND_COOLDOWN_SECONDS, 60);
  assert.equal(resendSecondsLeft(null, T0), 0);
  assert.equal(resendSecondsLeft(T0, T0), 60);
  assert.equal(resendSecondsLeft(T0, T0 + 1), 60);
  assert.equal(resendSecondsLeft(T0, T0 + 1_000), 59);
  assert.equal(resendSecondsLeft(T0, T0 + 59_001), 1);
  assert.equal(resendSecondsLeft(T0, T0 + 60_000), 0);
  assert.equal(resendSecondsLeft(T0, T0 + 3_600_000), 0);
  // A clock set backwards waits one cooldown, never longer.
  assert.equal(resendSecondsLeft(T0, T0 - 86_400_000), 60);
  assert.equal(resendSecondsLeft(Number.NaN, T0), 0);
});

test('the sign-in is tried by itself once per real return to the app, and never in a loop', () => {
  const base = { nextState: 'active', wasBackgrounded: true, busy: false, hasPassword: true, lastAutoTryAtMs: null, nowMs: T0 };
  assert.equal(shouldAutoTryOnReturn(base), true);
  // Only "active" is a return; a system sheet or the app switcher passing over is not one.
  assert.equal(shouldAutoTryOnReturn({ ...base, nextState: 'background' }), false);
  assert.equal(shouldAutoTryOnReturn({ ...base, nextState: 'inactive' }), false);
  assert.equal(shouldAutoTryOnReturn({ ...base, wasBackgrounded: false }), false);
  // Never on top of a running try, and never without the password.
  assert.equal(shouldAutoTryOnReturn({ ...base, busy: true }), false);
  assert.equal(shouldAutoTryOnReturn({ ...base, hasPassword: false }), false);
  // Fast app switching cannot hammer the server.
  assert.equal(shouldAutoTryOnReturn({ ...base, lastAutoTryAtMs: T0 - (AUTO_TRY_MIN_GAP_MS - 1) }), false);
  assert.equal(shouldAutoTryOnReturn({ ...base, lastAutoTryAtMs: T0 - AUTO_TRY_MIN_GAP_MS }), true);
  assert.equal(shouldAutoTryOnReturn({ ...base, lastAutoTryAtMs: Number.NaN }), false);

  // The panel clears "was in the background" on every return, so one return is one try.
  const panel = read('src/components/auth/ConfirmEmailPanel.tsx');
  assert.match(panel, /const returned = wasBackgrounded;\s+const awaySince = backgroundedAt;\s+wasBackgrounded = false;\s+backgroundedAt = null;/);
  assert.match(panel, /lastAutoTryAt = nowMs;\s+void trySignIn\.current\(\);/);
  assert.equal((panel.match(/AppState\.addEventListener/g) ?? []).length, 1);
  // A failed try shows a message and stops: nothing schedules another one.
  assert.doesNotMatch(panel, /setTimeout\([^)]*trySignIn|setInterval\([^)]*trySignIn/);
  assert.match(panel, /if \(busyRef\.current \|\| !typedPassword\) return;/);
});

test('away for more than five minutes: the password is forgotten', () => {
  assert.equal(PASSWORD_MEMORY_BACKGROUND_LIMIT_MS, 5 * 60 * 1000);
  assert.equal(shouldForgetPassword(null, T0), false);
  assert.equal(shouldForgetPassword(T0, T0 + 60_000), false);
  assert.equal(shouldForgetPassword(T0, T0 + PASSWORD_MEMORY_BACKGROUND_LIMIT_MS), false);
  assert.equal(shouldForgetPassword(T0, T0 + PASSWORD_MEMORY_BACKGROUND_LIMIT_MS + 1), true);
  // An unreadable or backwards clock fails closed.
  assert.equal(shouldForgetPassword(T0, T0 - 1), true);
  assert.equal(shouldForgetPassword(Number.NaN, T0), true);
});

test('the answer to the confirm-step sign-in: signed in, not yet, already has an account, or try again', () => {
  assert.equal(confirmSignInOutcome({ error: null, hasSession: true }), 'signed-in');
  assert.equal(confirmSignInOutcome({ error: null, hasSession: false }), 'failed');
  assert.equal(confirmSignInOutcome({ error: { code: 'email_not_confirmed', message: 'Email not confirmed', status: 400 }, hasSession: false }), 'not-confirmed');
  assert.equal(confirmSignInOutcome({ error: { message: 'Email not confirmed' }, hasSession: false }), 'not-confirmed');
  // Sign-up does not reveal an existing account; the sign-in that follows does.
  assert.equal(confirmSignInOutcome({ error: { code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 }, hasSession: false }), 'wrong-password');
  assert.equal(confirmSignInOutcome({ error: { message: 'Invalid login credentials' }, hasSession: false }), 'wrong-password');
  assert.equal(confirmSignInOutcome({ error: { message: 'Network request failed' }, hasSession: false }), 'failed');
  assert.equal(confirmSignInOutcome({ error: { status: 429, message: 'Too many requests' }, hasSession: false }), 'failed');
  assert.equal(confirmSignInOutcome({ error: {}, hasSession: true }), 'failed');
});

test('the password lives in memory only: never stored, logged, routed or sent to monitoring', () => {
  const panel = read('src/components/auth/ConfirmEmailPanel.tsx');
  const signUp = read('app/(auth)/sign-up.tsx');
  for (const [name, source] of [['panel', panel], ['sign-up', signUp]] as const) {
    assert.doesNotMatch(source, /AsyncStorage|SecureStore|expo-secure-store|localStorage|sessionStorage|expo-file-system/, `${name}: no storage`);
    assert.doesNotMatch(source, /console\.\w+\(/, `${name}: no logging`);
    assert.doesNotMatch(source, /logFunnelEvent|logToolUsage|logMembershipPath/, `${name}: no analytics`);
  }
  // Monitoring gets fixed names and the thrown error only, never a value from the form.
  for (const call of panel.match(/addAppBreadcrumb\([^)]*\)/g) ?? []) assert.match(call, /^addAppBreadcrumb\('auth\.[a-z_]+'(, '(warning|error)')?\)$/);
  for (const call of panel.match(/captureAppError\([^)]*\)/g) ?? []) assert.match(call, /^captureAppError\((signInError|resendError)\)$/);
  // The only place the password goes is the sign-in request itself.
  assert.match(panel, /supabase\.auth\.signInWithPassword\(\{ email, password: typedPassword \}\)/);
  assert.doesNotMatch(panel, /params:[^\n]*password/i);
  assert.match(panel, /params: Platform\.OS !== 'web' \? \{ email \} : \{\}/);

  // Forgotten on success, when the address turns out to have another password,
  // after too long away, and on every way out of the step.
  assert.match(panel, /if \(outcome === 'signed-in' && sessionUser\) \{\s+\/\/[^\n]*\n\s+forgetRef\.current\(\);/);
  assert.match(panel, /if \(outcome === 'wrong-password'\) forgetRef\.current\(\);/);
  assert.match(panel, /if \(shouldForgetPassword\(awaySince, nowMs\)\) \{\s+forget\(\);\s+return;\s+\}/);
  assert.match(panel, /setTimeout\(forget, PASSWORD_MEMORY_BACKGROUND_LIMIT_MS \+ 1000\)/);
  assert.match(panel, /function goToSignIn\(\) \{\s+forgetRef\.current\(\);/);
  assert.match(signUp, /onForgetPassword=\{\(\) => setPassword\(''\)\}/);
  assert.match(signUp, /onUseDifferentEmail=\{\(\) => \{\s+setPassword\(''\);\s+setError\(null\);\s+setCheckEmail\(false\);\s+\}\}/);
});

test('the confirm step shows her address, continues into the normal first sign-in, and keeps emergency help in view', () => {
  const panel = read('src/components/auth/ConfirmEmailPanel.tsx');
  const signUp = read('app/(auth)/sign-up.tsx');
  assert.match(signUp, /if \(checkEmail\) \{[\s\S]*?<ConfirmEmailPanel\s+email=\{email\.trim\(\)\}\s+password=\{password\}/);
  assert.match(panel, /<Text selectable style=\{\[styles\.email, \{ color: colors\.ink \}\]\}>\{email\}<\/Text>/);
  // Same entry as sign-in.tsx: the root layout then routes a new account to onboarding.
  assert.match(panel, /completeSignIn\(sessionUser\);/);
  assert.match(read('app/_layout.tsx'), /if \(user && !onboarded && !inOnboarding\) \{[\s\S]*?router\.replace\('\/\(onboarding\)\/welcome'\);/);
  assert.doesNotMatch(panel, /router\.(replace|push)\('\/\((tabs|onboarding)\)/);
  // "Not confirmed yet" is a calm note, not an error.
  assert.match(panel, /accessibilityLiveRegion="polite"/);
  assert.doesNotMatch(panel, /colors\.coral|accessibilityRole="alert"/);
  // Resend is the sign-up resend, and the button rests while the cooldown runs.
  assert.match(panel, /supabase\.auth\.resend\(\{\s+type: 'signup',/);
  assert.match(panel, /if \(busyRef\.current \|\| resendSecondsLeft\(lastSentAt, Date\.now\(\)\) > 0\) return;/);
  assert.match(panel, /const \[lastSentAt, setLastSentAt\] = useState<number \| null>\(\(\) => Date\.now\(\)\);/);
  // Every pre-sign-in screen keeps the emergency block.
  for (const file of ['app/(auth)/sign-in.tsx', 'app/(auth)/sign-up.tsx', 'app/(auth)/reset-password.tsx', 'src/components/auth/ConfirmEmailPanel.tsx']) {
    assert.match(read(file), /<EmergencyActions \/>/, `${file} shows the emergency actions`);
  }
});

test('sign-up keeps its checks and offers a plain way to sign in; the redirect address is unchanged', () => {
  const signUp = read('app/(auth)/sign-up.tsx');
  assert.equal(SIGN_UP_CONFIRM_REDIRECT_URL, 'https://soberhelpline.com/app-confirmed.html');
  assert.match(signUp, /if \(!acceptedTerms\) \{\s+setError\(t\('signUp\.errorTermsRequired'\)\);/);
  assert.match(signUp, /if \(password\.length < 8\) \{\s+setError\(t\('signUp\.errorWeakPassword'\)\);/);
  assert.match(signUp, /err\.message\.toLowerCase\(\)\.includes\('already'\) \|\| err\.status === 422\s+\? t\('signUp\.errorEmailTaken'\)/);
  assert.match(signUp, /disabled=\{loading \|\| !email \|\| !password \|\| !firstName \|\| !acceptedTerms\}/);
  assert.match(signUp, /accessibilityRole="checkbox"/);
  assert.match(signUp, /<Link href="\/\(auth\)\/sign-in" asChild>\s+<TouchableOpacity\s+accessibilityRole="link"[\s\S]*?t\('signUp\.hasAccountButton'\)/);
  assert.match(signUp, /haveAccountBtn: \{[^}]*minHeight: 48/);
  // No new sign-in method or native module came with this.
  assert.doesNotMatch(signUp + read('app/(auth)/sign-in.tsx') + read('src/components/auth/ConfirmEmailPanel.tsx'), /expo-apple-authentication|AppleAuthentication/);
});

test('the new words exist in both languages, and Spanish speaks to her', () => {
  const en = JSON.parse(read('src/locales/en/auth.json'));
  const es = JSON.parse(read('src/locales/es/auth.json'));
  assert.equal(en.confirmEmail.title, 'Confirm your email');
  assert.equal(en.confirmEmail.continueButton, "I've confirmed, continue");
  assert.equal(en.confirmEmail.resendButton, 'Send the email again');
  assert.equal(en.confirmEmail.differentEmail, 'Use a different email');
  assert.equal(en.signUp.hasAccountButton, 'I already have an account');
  assert.match(en.confirmEmail.resendWait, /\{\{seconds\}\}/);
  assert.match(es.confirmEmail.resendWait, /\{\{seconds\}\}/);
  // Every notice the panel can show has its words.
  const panel = read('src/components/auth/ConfirmEmailPanel.tsx');
  const notices = panel.match(/type Notice = ([^;]+);/)?.[1].match(/'(\w+)'/g)?.map((name) => name.slice(1, -1)) ?? [];
  assert.equal(notices.length, 6);
  for (const notice of notices) {
    assert.ok(en.confirmEmail[notice] && es.confirmEmail[notice], `confirmEmail.${notice}`);
  }
  assert.equal(es.signIn.title, 'Bienvenida de vuelta');
  assert.doesNotMatch(JSON.stringify(es.confirmEmail), /usted|\bsu\b|Bienvenido/);
});
