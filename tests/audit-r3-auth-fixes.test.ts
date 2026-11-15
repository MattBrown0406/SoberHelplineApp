import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { STAY_ON_SCREEN, incomingLinkAction, preSignInHoldActive, setPreSignInHold, subscribeLinkWhileHeld } from '../src/lib/preSignInHold';
import { clearPendingDeepLink, peekPendingDeepLink } from '../src/lib/pendingDeepLink';
import { redirectSystemPath } from '../app/+native-intent';
import { collapseAppStack, returnToPreSignInScreen } from '../src/lib/appStack';
import { AUTO_TRY_MIN_GAP_MS, frontDoorRoute, shouldAutoTryOnReturn, signUpFailure } from '../src/lib/frontDoor';

// Audit round 3 (app side), before sign-in: the pure rules, and the places that must use them.
const read = (file: string) => readFileSync(file, 'utf8');
const locale = (lang: string, name: string) => JSON.parse(read(`src/locales/${lang}/${name}.json`));

// ── M4: a link that opens the app never takes the confirm step away ─────────

test('M4: signed out on a pre-sign-in screen, a link that arrives does not navigate', async () => {
  assert.equal(incomingLinkAction({ initial: false, held: true }), 'stay');
  assert.equal(incomingLinkAction({ initial: false, held: false }), 'route');
  // A link that STARTS the app is always routed: no screen is in front yet.
  assert.equal(incomingLinkAction({ initial: true, held: true }), 'route');
  // expo-router navigates only for a non-empty path.
  assert.equal(STAY_ON_SCREEN, '');
  assert.match(read('node_modules/expo-router/build/link/linking.js'), /if \(href\) \{\s+listener\(href\);\s+\}/, 'expo-router still ignores an empty path');

  let told = 0;
  const unsubscribe = subscribeLinkWhileHeld(() => { told += 1; });
  try {
    clearPendingDeepLink();
    assert.equal(preSignInHoldActive(), false);
    // Not held: exactly as before.
    assert.equal(redirectSystemPath({ path: 'sober-helpline://', initial: false }), 'sober-helpline://');
    assert.equal(redirectSystemPath({ path: 'https://soberhelpline.com/app/chat', initial: false }), '/chat');
    await Promise.resolve();
    assert.equal(told, 0);
    clearPendingDeepLink();

    setPreSignInHold(true);
    // The confirmation page's "open the app" link: stay, and the confirm step is told.
    assert.equal(redirectSystemPath({ path: 'sober-helpline://', initial: false }), STAY_ON_SCREEN);
    await Promise.resolve();
    assert.equal(told, 1);
    assert.equal(peekPendingDeepLink(), null, 'not an app link: nothing to land on later');
    // An app link stays too, and is still remembered for after sign-in.
    assert.equal(redirectSystemPath({ path: 'https://soberhelpline.com/app/coaching', initial: false }), STAY_ON_SCREEN);
    assert.equal(peekPendingDeepLink(), '/book-coaching');
    // A malformed link never reaches the router either way.
    assert.equal(redirectSystemPath({ path: 'sober-helpline://x?a=' + '%C2'.repeat(50) + '%E0%A4%A', initial: false }), STAY_ON_SCREEN);
    // A cold start is routed as always.
    assert.equal(redirectSystemPath({ path: 'https://soberhelpline.com/app/chat', initial: true }), '/chat');
  } finally {
    unsubscribe();
    setPreSignInHold(false);
    clearPendingDeepLink();
  }
  // The root layout holds exactly while she is signed out with a pre-sign-in screen in front.
  const layout = read('app/_layout.tsx');
  assert.match(layout, /const onPreSignInScreen = !isLoading && !isAuthenticated && segments\[0\] === '\(auth\)';\s+useEffect\(\(\) => \{\s+setPreSignInHold\(onPreSignInScreen\);\s+return \(\) => setPreSignInHold\(false\);\s+\}, \[onPreSignInScreen\]\);/);
  // The hold carries a yes/no only.
  assert.doesNotMatch(read('src/lib/preSignInHold.ts'), /^import |AsyncStorage|setItem/m);
  assert.match(read('src/lib/preSignInHold.ts'), /^let held = false;$/m);
});

// expo-router's container state: an internal `__root` route holding app/_layout's Stack.
function container(names: string[], ready = true) {
  const actions: unknown[] = [];
  let routes = names.map((name) => ({ name }));
  return {
    actions,
    names: () => routes.map((route) => route.name),
    isReady: () => ready,
    getRootState: () => ({ key: 'stack-root', type: 'stack', index: 0, routes: [{ state: { key: 'stack-app', type: 'stack', index: routes.length - 1, routes } }] }),
    dispatch: (action: { type: string; target?: string }) => {
      actions.push(action);
      if (action.type === 'POP_TO_TOP' && action.target === 'stack-app') routes = routes.slice(0, 1);
    },
  };
}

test('M4: a screen put on top of the pre-sign-in screen is taken off again, never replaced by a fresh one', () => {
  const linked = container(['(auth)', '(tabs)']);
  assert.equal(returnToPreSignInScreen(linked), true);
  assert.deepEqual(linked.actions, [{ type: 'POP_TO_TOP', target: 'stack-app' }]);
  assert.deepEqual(linked.names(), ['(auth)']);
  // Sign-out from Settings, a cold start, a lone pre-sign-in screen, an unready container: routed as usual.
  for (const other of [container(['(tabs)', 'settings']), container(['(tabs)']), container(['(auth)']), container(['(auth)', '(tabs)'], false), container(['(tabs)', '(auth)'])]) {
    assert.equal(returnToPreSignInScreen(other), false);
    assert.deepEqual(other.actions, []);
  }
  // If the pop did not bring her back, the caller routes as usual: never left on a screen that needs a sign-in.
  const stuck = { ...container(['(auth)', '(tabs)']), dispatch: () => undefined };
  assert.equal(returnToPreSignInScreen(stuck), false);
  const throwing = { ...container(['(auth)', '(tabs)']), dispatch: () => { throw new Error('not ready'); } };
  assert.equal(returnToPreSignInScreen(throwing), false);
  // (The existing collapse is untouched.)
  const signOut = container(['(tabs)', 'settings']);
  collapseAppStack(signOut);
  assert.deepEqual(signOut.actions, [{ type: 'POP_TO_TOP', target: 'stack-app' }]);
  const layout = read('app/_layout.tsx');
  assert.match(layout, /if \(deviceFlags === null && !signedInThisSession\.current\) return;[\s\S]*?if \(returnToPreSignInScreen\(navigationRef\)\) \{\s+addAppBreadcrumb\('auth\.navigation_pre_sign_in_kept'\);\s+return;\s+\}[\s\S]*?const flagsNow = knownFrontDoorFlags\(\);/);
});

test('M4: the first screen is chosen from the flags as they are now, and a link is one return, one try', () => {
  // A sign-up sent this run is in the store's memory only: with it, signed-out routing lands on sign-in.
  assert.equal(frontDoorRoute({ signedInBefore: false || false, signUpSubmitted: false || true, signedInThisSession: false }), '/(auth)/sign-in');
  // The link and the app coming forward at the same moment: the second is too close to be another try.
  const first = { nextState: 'active', wasBackgrounded: true, busy: false, hasPassword: true, lastAutoTryAtMs: null, nowMs: 1_000_000 };
  assert.equal(shouldAutoTryOnReturn(first), true);
  assert.equal(shouldAutoTryOnReturn({ ...first, lastAutoTryAtMs: 1_000_000, nowMs: 1_000_050 }), false);
  assert.equal(shouldAutoTryOnReturn({ ...first, lastAutoTryAtMs: 1_000_000, nowMs: 1_000_000 + AUTO_TRY_MIN_GAP_MS }), true);
  const panel = read('src/components/auth/ConfirmEmailPanel.tsx');
  // One path for both kinds of return: the same forget rule, the same single try.
  assert.match(panel, /const comeBack = \(nowMs: number, byLink: boolean\) => \{[\s\S]*?if \(shouldForgetPassword\(awaySince, nowMs\)\) \{\s+forget\(\);\s+return;\s+\}\s+if \(shouldAutoTryOnReturn\(\{\s+nextState: 'active',\s+wasBackgrounded: returned \|\| byLink,/);
  assert.match(panel, /if \(nextState !== 'active'\) return;\s+comeBack\(nowMs, false\);/);
  assert.match(panel, /const unsubscribeLink = subscribeLinkWhileHeld\(\(\) => comeBack\(Date\.now\(\), true\)\);\s+return \(\) => \{\s+subscription\.remove\(\);\s+unsubscribeLink\(\);/);
  assert.equal((panel.match(/lastAutoTryAt = nowMs;\s+void trySignIn\.current\(\);/g) ?? []).length, 1, 'still one place that tries by itself');
  // The hold's listeners are told "a link came" and nothing else: no value can travel with it.
  assert.match(read('src/lib/preSignInHold.ts'), /const listeners = new Set<\(\) => void>\(\);/);
  assert.match(read('src/lib/preSignInHold.ts'), /listener\(\);/);
});

// ── L10: what a refused sign-up says ────────────────────────────────────────

test('L10: "already exists" only for the error that means it; a refused password says so', () => {
  assert.equal(signUpFailure({ code: 'user_already_exists', message: 'User already registered', status: 422 }), 'email-taken');
  assert.equal(signUpFailure({ code: 'email_exists', message: 'A user with this email address has already been registered', status: 422 }), 'email-taken');
  assert.equal(signUpFailure({ message: 'User already registered', status: 400 }), 'email-taken');
  // A 422 by itself is not "taken": most often the password.
  assert.equal(signUpFailure({ code: 'weak_password', message: 'Password should be at least 12 characters.', status: 422 }), 'password');
  assert.equal(signUpFailure({ name: 'AuthWeakPasswordError', message: 'Weak', status: 422 }), 'password');
  assert.equal(signUpFailure({ message: 'Password is known to be weak and easy to guess, please choose a different one.', status: 422 }), 'password');
  assert.equal(signUpFailure({ message: 'Unable to validate email address: invalid format', status: 422 }), 'failed');
  assert.equal(signUpFailure({ status: 422 }), 'failed');
  assert.equal(signUpFailure({ message: 'Network request failed' }), 'failed');
  assert.equal(signUpFailure({ status: 429, message: 'Email rate limit exceeded' }), 'failed');
  assert.equal(signUpFailure(null), 'failed');
  const en = locale('en', 'auth').signUp, es = locale('es', 'auth').signUp;
  assert.equal(en.errorPasswordRejected, "That password wasn't accepted. Try a longer or less common one.");
  assert.ok(es.errorPasswordRejected);
  assert.doesNotMatch(es.errorPasswordRejected, /usted|\bsu\b/);
});
