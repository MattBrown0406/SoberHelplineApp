import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { WEBSITE_ORIGIN, WEBSITE_PATHS, isWebsiteUrl, siteUrlFor, websiteUrl, withAppContext } from '../src/lib/websiteLinks';
import {
  COACHING_MEMBER_PRICE,
  COACHING_STANDARD_PRICE,
  coachingRateCopy,
  fillCoachingRates,
  isCoachingMember,
} from '../src/lib/coachingPrice';
import { formatNextCallTime, isFamilySquaresSession } from '../src/lib/familySquaresSchedule';
import { isWebsiteEntitlement, isWebsiteMembership, WEBSITE_MEMBERSHIP_GRANT } from '../src/lib/membershipSource';

const read = (path: string) => readFileSync(path, 'utf8');

const APP = 'from_app=1&app_links=1';

test('website URLs carry the app context and the sign-in token once and never leave the site', () => {
  assert.equal(websiteUrl('/family-forum'), `https://soberhelpline.com/family-forum?${APP}`);
  assert.equal(websiteUrl('/family-forum', 'tok-1'), `https://soberhelpline.com/family-forum?${APP}&sso_token=tok-1`);
  assert.equal(websiteUrl('/book-consultation?type=coaching', 'a b'), `https://soberhelpline.com/book-consultation?type=coaching&${APP}&sso_token=a%20b`);
  assert.equal(websiteUrl('/family-education#tracks', 't'), `https://soberhelpline.com/family-education?${APP}&sso_token=t#tracks`);
  assert.equal(websiteUrl('//evil.example/x', 't'), `https://soberhelpline.com/?${APP}&sso_token=t`);
  assert.equal(websiteUrl('https://evil.example'), `https://soberhelpline.com/?${APP}`);
  assert.equal(websiteUrl('/zoom-recordings', null), `https://soberhelpline.com/zoom-recordings?${APP}`);
  // Already marked: never doubled.
  assert.equal(websiteUrl('/privacy?from_app=1'), `https://soberhelpline.com/privacy?from_app=1&app_links=1`);
  assert.equal(WEBSITE_ORIGIN, 'https://soberhelpline.com');
  for (const path of Object.values(WEBSITE_PATHS)) {
    assert.ok(path.startsWith('/') && !path.startsWith('/app'), `${path} must never be a universal-link path`);
  }
});

test('every soberhelpline.com page the app opens says it came from the app (from_app hides membership purchase links)', () => {
  // The plan-review checkout URL from create-plan-review-checkout keeps its token.
  assert.equal(
    withAppContext('https://soberhelpline.com/coaching-checkout?token=abc.def'),
    `https://soberhelpline.com/coaching-checkout?token=abc.def&${APP}`,
  );
  assert.equal(withAppContext('https://www.soberhelpline.com/x#top'), `https://www.soberhelpline.com/x?${APP}#top`);
  assert.equal(withAppContext('https://soberhelpline.com'), `https://soberhelpline.com?${APP}`);
  assert.equal(withAppContext(`https://soberhelpline.com/y?${APP}`), `https://soberhelpline.com/y?${APP}`);
  // AyudaSobria (the Spanish site) also hides membership purchase for app visitors.
  assert.equal(withAppContext('https://ayudasobria.com/registro'), `https://ayudasobria.com/registro?${APP}`);
  // Other hosts (PayPal, look-alike domains) are never touched.
  for (const other of ['https://www.paypal.com/checkoutnow?token=1', 'https://soberhelpline.com.evil.example/x', 'https://ayudasobria.com.evil.example/x', 'http://soberhelpline.com/x', 'tel:+14582988008']) {
    assert.equal(withAppContext(other), other);
    assert.equal(isWebsiteUrl(other), false);
  }

  const card = read('src/components/video/PlanReviewBookingCard.tsx');
  assert.match(card, /const url = withAppContext\(checkoutUrl\);[\s\S]*Linking\.openURL\(url\)/);
  const config = read('src/config.ts');
  assert.match(config, /TERMS_OF_USE_URL = websiteUrl\('\/app-terms'\)/);
  assert.match(config, /PRIVACY_POLICY_URL = websiteUrl\('\/privacy'\)/);

  // No other hard-coded soberhelpline.com page is opened from the app.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.tsx?$/.test(name)) continue;
      const source = read(path);
      if (/openURL\(\s*['`"]https:\/\/(www\.)?soberhelpline\.com/.test(source)) offenders.push(path);
    }
  };
  walk('app');
  walk('src');
  assert.deepEqual(offenders, []);

  // The token never reaches a log line.
  const sso = read('src/hooks/useWebSSO.ts');
  for (const line of sso.split('\n').filter((l) => /console\.|addAppBreadcrumb|captureAppError/.test(l))) {
    assert.doesNotMatch(line, /tokenId|url|Url/, line);
  }
  assert.doesNotMatch(card, /console\.[a-z]+\([^)]*url/i);
});

test('every soberhelpline.com member page the app opens goes through the signed-in hand-off', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!/\.tsx?$/.test(name) || path.endsWith(join('src', 'lib', 'websiteLinks.ts'))) continue;
      const source = read(path);
      if (/soberhelpline\.com\/(family-forum|family-education|zoom-recordings|family-webinars|member-|book-consultation|family-coaching)/.test(source)) offenders.push(path);
    }
  };
  walk('app');
  walk('src');
  assert.deepEqual(offenders, [], 'member pages are opened by path through useWebSSO');

  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /openWithSSO\(user\?\.id \?\? null, WEBSITE_PATHS\.familyForum\)/);
  assert.doesNotMatch(support, /GROUPS_URL/);
  const learn = read('app/(tabs)/learn.tsx');
  assert.match(learn, /openWithSSO\(user\?\.id \?\? null, path\)/);
  assert.doesNotMatch(learn, /Linking\.openURL/);
  const booking = read('app/book-coaching.tsx');
  assert.match(booking, /openWithSSO\(user\?\.id \?\? null, WEBSITE_PATHS\.bookConsultation\)/);
  // The request flow stays available as the secondary option.
  assert.match(booking, /from\('coaching_bookings'\)/);
  const sso = read('src/hooks/useWebSSO.ts');
  assert.match(sso, /Linking\.openURL/);
  assert.doesNotMatch(sso, /WebBrowser|openBrowserAsync/, 'PayPal needs Safari, not an in-app browser');
});

test('members see the $125 member price, everyone else $150', () => {
  const t = (key: string, options?: Record<string, unknown>) => `${key}|${String(options?.price)}`;
  assert.equal(isCoachingMember({ canMessageOnCallCoach: true }), true);
  assert.equal(isCoachingMember({ canMessageOnCallCoach: false }), false);
  assert.equal(isCoachingMember(null), false);
  assert.deepEqual(coachingRateCopy(true, t), {
    member: true,
    amount: COACHING_MEMBER_PRICE,
    rate: 'coachingPrice.member|$125',
    hourly: 'coachingPrice.memberHourly|$125',
  });
  assert.deepEqual(coachingRateCopy(false, t), {
    member: false,
    amount: COACHING_STANDARD_PRICE,
    rate: '$150',
    hourly: 'coachingPrice.hourly|$150',
  });
  assert.equal(
    fillCoachingRates('A {rate}; B {memberRate}; again {rate}', { rate: '$150/hour', memberRate: '$125' }),
    'A $150/hour; B $125; again $150/hour',
  );
});

test('coaching prices in member-facing copy come from the member-aware price, not hard-coded text', () => {
  for (const lang of ['en', 'es']) {
    const files = ['support', 'crisis', 'today'].map((ns) => read(`src/locales/${lang}/${ns}.json`));
    for (const json of files) assert.doesNotMatch(json, /\$1[25]0|\$44\.99|\$14\.99/, `${lang}: hard-coded price`);
    const common = JSON.parse(read(`src/locales/${lang}/common.json`));
    for (const key of ['member', 'memberHourly', 'hourly']) assert.match(common.coachingPrice[key], /\{\{price\}\}/);
  }
  const card = read('src/components/video/PlanReviewBookingCard.tsx');
  assert.match(card, /k\('payNow', \{ amount: coachingRate\.amount \}\)/);
  assert.match(card, /k\('essentialBody', \{ rate: coachingRate\.rate \}\)/);
});

test('The Family Squares shows its real next start in the member time zone', () => {
  const now = new Date('2026-10-03T18:00:00Z');
  const formatted = formatNextCallTime('2026-10-06T02:00:00+00:00', { now, locale: 'en-US', timeZone: 'America/New_York' });
  assert.ok(formatted, 'formats an upcoming call');
  assert.match(formatted!, /Oct 5/);
  assert.match(formatted!, /10:00/);
  assert.match(formatted!, /PM/);
  assert.match(formatted!, /EDT/);
  const pacific = formatNextCallTime('2026-10-06 02:00:00+00', { now, locale: 'en-US', timeZone: 'America/Los_Angeles' });
  assert.match(pacific!, /7:00/);
  assert.match(pacific!, /PDT/);
  // Still "next" during the call's hour; over after it.
  assert.ok(formatNextCallTime('2026-10-06T02:00:00Z', { now: new Date('2026-10-06T02:30:00Z'), locale: 'en-US' }));
  assert.equal(formatNextCallTime('2026-10-06T02:00:00Z', { now: new Date('2026-10-06T03:00:00Z'), locale: 'en-US' }), null);
  assert.equal(formatNextCallTime(null, { now }), null);
  assert.equal(formatNextCallTime('not a date', { now }), null);
  // An unknown zone name falls back to the device zone instead of failing.
  assert.ok(formatNextCallTime('2026-10-06T02:00:00Z', { now, locale: 'en-US', timeZone: 'Not/AZone' }));
  assert.ok(formatNextCallTime('2026-10-06T02:00:00Z', { now, locale: 'es', timeZone: 'America/Mexico_City' }));
  assert.equal(isFamilySquaresSession({ title: 'The Family Squares' }), true);
  assert.equal(isFamilySquaresSession({ title: 'Monday Night Family Support' }), true);
  assert.equal(isFamilySquaresSession({ title: 'First 90 Days After Intervention' }), false);
  assert.equal(isFamilySquaresSession(null), false);
  for (const lang of ['en', 'es']) {
    const common = JSON.parse(read(`src/locales/${lang}/common.json`));
    assert.match(common.familySquares.scheduleFallback, /7:00/);
    assert.match(common.familySquares.rsvpNote, /soberhelpline\.com/);
  }
});

test('a soberhelpline.com membership is recognised from either website grant', () => {
  const now = new Date('2026-10-03T00:00:00Z');
  const web = { source: 'web', tier: 'essential', expires_at: '2026-11-01T00:00:00Z' };
  const imported = { source: 'scholarship', tier: 'essential', expires_at: null, granted_by: WEBSITE_MEMBERSHIP_GRANT };
  const scholarship = { source: 'scholarship', tier: 'essential', expires_at: null, granted_by: null };
  const store = { source: 'revenuecat', tier: 'premium', expires_at: '2026-11-01T00:00:00Z' };
  assert.equal(isWebsiteEntitlement(web), true);
  assert.equal(isWebsiteEntitlement(imported), true);
  assert.equal(isWebsiteEntitlement(scholarship), false);
  assert.equal(isWebsiteMembership([web], 'essential', now), true);
  assert.equal(isWebsiteMembership([imported], 'essential', now), true);
  assert.equal(isWebsiteMembership([scholarship], 'essential', now), false);
  assert.equal(isWebsiteMembership([{ ...web, expires_at: '2026-10-01T00:00:00Z' }], 'essential', now), false, 'expired');
  // Premier from the App Store is not the website's membership.
  assert.equal(isWebsiteMembership([web, store], 'premium', now), false);
  assert.equal(isWebsiteMembership([], 'essential', now), false);

  const settings = read('app/settings.tsx');
  assert.match(settings, /granted_by:raw->>granted_by/);
  assert.match(settings, /t\('membership\.websiteSource'\)/);
  assert.match(settings, /t\('account\.websiteLogin'\)/);
  for (const lang of ['en', 'es']) {
    const copy = JSON.parse(read(`src/locales/${lang}/settings.json`));
    assert.match(copy.membership.websiteSource, /soberhelpline\.com/);
    assert.match(copy.account.websiteLogin, /soberhelpline\.com/);
    // Separate website accounts: the app login does not work there directly.
    assert.doesNotMatch(copy.account.websiteLogin, /also works|también funciona/);
    assert.match(copy.account.websiteLogin, /Forgot password\?/);
  }
});

test('the phone line is (458) 298-8008; the WhatsApp number is never dialed', () => {
  const support = read('app/(tabs)/support.tsx');
  assert.match(support, /const CRISIS_LINE_TEL = 'tel:\+14582988008';/);
  assert.match(support, /const CRISIS_LINE_DISPLAY = '\(458\) 298-8008';/);
  assert.doesNotMatch(support, /tel:\+?1?5038362136/);
});

test('email confirmation lands on soberhelpline.com', () => {
  assert.match(read('app/(auth)/sign-up.tsx'), /emailRedirectTo: 'https:\/\/soberhelpline\.com\/app-confirmed\.html'/);
  assert.match(read('supabase/functions/confirm-landing/index.ts'), /'https:\/\/soberhelpline\.com\/app-confirmed\.html'/);
  assert.match(read('supabase/config.toml'), /additional_redirect_urls = \[\n\s+"https:\/\/soberhelpline\.com\/app-confirmed\.html"/);
});

test('store builds ship on the production update channel', () => {
  const eas = JSON.parse(read('eas.json'));
  assert.equal(eas.build.production.channel, 'production');
  assert.equal(eas.build['release-4-2-0'].extends, 'production');
  assert.equal(eas.build['release-4-2-0'].autoIncrement, false);
  const app = JSON.parse(read('app.json'));
  assert.equal(app.expo.version, '4.2');
  assert.equal(app.expo.ios.buildNumber, '1');
  assert.deepEqual(app.expo.runtimeVersion, { policy: 'appVersion' });
  assert.match(app.expo.updates.url, /^https:\/\/u\.expo\.dev\//);
});

test('in Spanish, education and recordings open on ayudasobria.com with the same app context and token', () => {
  assert.equal(
    siteUrlFor(WEBSITE_PATHS.familyEducation, 'es', 'tok-1'),
    `https://ayudasobria.com/recursos?${APP}&sso_token=tok-1`,
  );
  assert.equal(siteUrlFor(WEBSITE_PATHS.zoomRecordings, 'es-MX'), `https://ayudasobria.com/grabaciones?${APP}`);
  // Booking keeps Matt's real time slots on soberhelpline.com; the forum has no Spanish twin.
  assert.equal(
    siteUrlFor(WEBSITE_PATHS.bookConsultation, 'es', 't'),
    `https://soberhelpline.com/book-consultation?${APP}&sso_token=t`,
  );
  assert.equal(siteUrlFor(WEBSITE_PATHS.familyForum, 'es'), `https://soberhelpline.com/family-forum?${APP}`);
  // English (or unknown) always stays on soberhelpline.com; odd paths never leave either site.
  assert.equal(siteUrlFor(WEBSITE_PATHS.zoomRecordings, 'en', 't'), websiteUrl(WEBSITE_PATHS.zoomRecordings, 't'));
  assert.equal(siteUrlFor('constructor', 'es'), `https://soberhelpline.com/?${APP}`);
  assert.equal(siteUrlFor('//evil.example', 'es'), `https://soberhelpline.com/?${APP}`);
});
