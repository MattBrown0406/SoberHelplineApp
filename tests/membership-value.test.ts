import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { walletMembershipCopy } from '../src/content/walletMembershipCopy';
const support = readFileSync('app/(tabs)/support.tsx', 'utf8');
const sheet = readFileSync('src/components/plans/UpgradeSheet.tsx', 'utf8');
const card = readFileSync('src/components/plans/PlansCard.tsx', 'utf8');
const teaser = readFileSync('src/components/plans/PlansTeaserCard.tsx', 'utf8');
test('purchase surface never substitutes hardcoded locale prices for StoreKit', () => {
  // Every plans surface: a missing store price reads "price unavailable", never a number from copy.
  for (const source of [support, sheet, card, teaser]) {
    assert.doesNotMatch(source, /\$\d/);
    assert.doesNotMatch(source, /subscriptionPrices[^\n]+\?\? t\(/);
  }
  assert.match(sheet, /const priceAvailable = !!price;/);
  assert.match(sheet, /const priceLabel = price \?\? tPlans\('priceUnavailable'\);/);
  assert.match(sheet, /disabled=\{purchasing \|\| !priceAvailable\}/);
  assert.match(card, /disabled=\{purchasing \|\| !subscriptionPrices\[tier\]\}/);
  assert.match(card, /onPress=\{retryPrices\}/);
  assert.match(support, /retryPrices/);
  for (const lang of ['en', 'es']) {
    const raw = readFileSync(`src/locales/${lang}/plans.json`, 'utf8');
    // No amount of any kind in the plans copy: prices are the store's, the coaching rate is the app's.
    assert.doesNotMatch(raw, /[$€£]\s?\d|\d+[.,]\d{2}|USD/, `${lang}: an amount in plans.json`);
    const plans = JSON.parse(raw);
    assert.match(plans.perMonth, /\{\{price\}\}/);
    assert.ok(plans.priceUnavailable && plans.retryPrices);
  }
});
test('benefits route to working tools and service rate comes from the member-aware coaching price', () => {
  assert.match(support, /useCoachingRate\(\)/);
  assert.match(support, /fillCoachingRates\(copy\.service, \{ rate: coachingRate\.hourly, memberRate: COACHING_MEMBER_PRICE \}\)/);
  assert.match(support, /copy\.service/);
  assert.match(support, /copy\.manage/);
  // What each plan includes is the one list (plans.json), not a paragraph of its own here.
  assert.match(support, /<BenefitList plan="essential" \/>[\s\S]*<BenefitList plan="premier" \/>/);
  for (const language of ['en', 'es']) {
    const copy = walletMembershipCopy(language);
    assert.ok(copy.service.includes('{rate}'));
    assert.ok(copy.service.includes('{memberRate}'));
    assert.doesNotMatch(copy.service, /\$\d/);
    assert.ok(copy.free.length > 30);
    assert.equal('essential' in copy, false, 'no second description of Essential');
    assert.equal('premier' in copy, false, 'no second description of Premier');
  }
});
