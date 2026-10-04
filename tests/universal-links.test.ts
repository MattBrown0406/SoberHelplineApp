import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { appPathForIncomingUrl, APP_LINK_HOME } from '../src/lib/universalLinks';
import {
  clearPendingDeepLink,
  peekPendingDeepLink,
  PENDING_DEEP_LINK_TTL_MS,
  setPendingDeepLink,
  subscribePendingDeepLink,
  takePendingDeepLink,
} from '../src/lib/pendingDeepLink';
import { redirectSystemPath } from '../app/+native-intent';

test('every contract path on soberhelpline.com/app maps to its screen', () => {
  const cases: Record<string, string> = {
    'https://soberhelpline.com/app': '/',
    'https://soberhelpline.com/app/': '/',
    'https://soberhelpline.com/app/family-squares': '/support?focus=family-squares',
    'https://soberhelpline.com/app/coaching': '/book-coaching',
    'https://soberhelpline.com/app/coaching/booked': '/book-coaching?booked=1',
    'https://soberhelpline.com/app/coaching/booked/': '/book-coaching?booked=1',
    'https://soberhelpline.com/app/plan-review': '/crisis-mode?focus=session',
    'https://soberhelpline.com/app/chat': '/chat',
    'https://soberhelpline.com/app/learn': '/learn',
    'https://soberhelpline.com/app/settings': '/settings',
    'https://www.soberhelpline.com/app/chat': '/chat',
    'HTTPS://SoberHelpline.com/app/Chat': '/chat',
  };
  for (const [url, path] of Object.entries(cases)) assert.equal(appPathForIncomingUrl(url), path, url);
});

test('unknown /app paths open home; query strings and fragments never pass through', () => {
  for (const url of [
    'https://soberhelpline.com/app/nope',
    'https://soberhelpline.com/app/coaching/booked/extra',
    'https://soberhelpline.com/app/%E0%A4%A',
    'https://soberhelpline.com/app/admin',
  ]) {
    assert.equal(appPathForIncomingUrl(url), APP_LINK_HOME, url);
  }
  assert.equal(appPathForIncomingUrl('https://soberhelpline.com/app/coaching?sso_token=abc#x'), '/book-coaching');
  assert.equal(appPathForIncomingUrl('https://soberhelpline.com/app?redirect=/admin'), '/');
  assert.equal(appPathForIncomingUrl('https://soberhelpline.com:443/app/learn'), '/learn');
});

test('anything outside soberhelpline.com/app is left alone', () => {
  for (const url of [
    'https://soberhelpline.com',
    'https://soberhelpline.com/',
    'https://soberhelpline.com/apple',
    'https://soberhelpline.com/application/app',
    'https://soberhelpline.com/family-forum',
    'https://evil.example/app/chat',
    'https://soberhelpline.com.evil.example/app/chat',
    'http://soberhelpline.com/app/chat',
    'sober-helpline:///',
    'sober-helpline://chat',
    'sober-helpline://support?sessionId=1',
    'sober-helpline:///apple',
    'exp+sober-helpline://expo-development-client/?url=http%3A%2F%2F10.0.0.2%3A8081',
    '/chat',
    '',
    'not a url',
  ]) {
    assert.equal(appPathForIncomingUrl(url), null, url);
  }
  assert.equal(appPathForIncomingUrl(undefined), null);
  assert.equal(appPathForIncomingUrl(42), null);
});

test('the custom scheme also carries app links back from the website', () => {
  assert.equal(appPathForIncomingUrl('sober-helpline://app/coaching/booked'), '/book-coaching?booked=1');
  assert.equal(appPathForIncomingUrl('sober-helpline://app/plan-review'), '/crisis-mode?focus=session');
  assert.equal(appPathForIncomingUrl('sober-helpline://app'), '/');
  assert.equal(appPathForIncomingUrl('sober-helpline:///app/chat'), '/chat');
});

test('redirectSystemPath rewrites app links, remembers them, and passes everything else through', () => {
  clearPendingDeepLink();
  assert.equal(redirectSystemPath({ path: 'sober-helpline:///', initial: true }), 'sober-helpline:///');
  assert.equal(redirectSystemPath({ path: 'sober-helpline://chat', initial: false }), 'sober-helpline://chat');
  assert.equal(peekPendingDeepLink(), null, 'non-app links are never remembered');
  assert.equal(redirectSystemPath({ path: 'https://soberhelpline.com/app/coaching/booked', initial: true }), '/book-coaching?booked=1');
  assert.equal(takePendingDeepLink(), '/book-coaching?booked=1');
  assert.equal(takePendingDeepLink(), null, 'consumed once');
});

test('a pending link expires and notifies the layout', async () => {
  clearPendingDeepLink();
  let notified = 0;
  const unsubscribe = subscribePendingDeepLink(() => { notified += 1; });
  setPendingDeepLink('/learn', 1_000);
  assert.equal(notified, 0, 'notified after the current render, not during it');
  await Promise.resolve();
  assert.equal(notified, 1);
  assert.equal(peekPendingDeepLink(1_000 + PENDING_DEEP_LINK_TTL_MS), '/learn');
  assert.equal(peekPendingDeepLink(1_001 + PENDING_DEEP_LINK_TTL_MS), null);
  unsubscribe();
  setPendingDeepLink('/chat', 5_000);
  await Promise.resolve();
  assert.equal(notified, 1, 'unsubscribed listener is not called');
  clearPendingDeepLink();
  assert.equal(takePendingDeepLink(5_000), null);
});

test('universal links are declared for the /app namespace only and push routing is untouched', () => {
  const appJson = JSON.parse(readFileSync('app.json', 'utf8'));
  assert.deepEqual(appJson.expo.ios.associatedDomains, ['applinks:soberhelpline.com']);
  assert.equal(appJson.expo.scheme, 'sober-helpline');
  const intent = readFileSync('app/+native-intent.tsx', 'utf8');
  assert.doesNotMatch(intent, /from '[^']*(pushRouting|expo-notifications)/);
  const layout = readFileSync('app/_layout.tsx', 'utf8');
  assert.match(layout, /router\.replace\(\(takePendingDeepLink\(\) \?\? '\/\(tabs\)'\) as never\)/);
});
