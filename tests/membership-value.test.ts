import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { walletMembershipCopy } from '../src/content/walletMembershipCopy';
const support = readFileSync('app/(tabs)/support.tsx', 'utf8');
test('purchase surface never substitutes hardcoded locale prices for StoreKit', () => {
  assert.doesNotMatch(support, /subscriptionPrices[^\n]+\?\? t\(/);
  assert.match(support, /priceAvailable=/);
  assert.match(support, /retryPrices/);
});
test('benefits route to working tools and service rate comes from the member-aware coaching price', () => {
  assert.match(support, /useCoachingRate\(\)/);
  assert.match(support, /fillCoachingRates\(copy\.service, \{ rate: coachingRate\.hourly, memberRate: COACHING_MEMBER_PRICE \}\)/);
  assert.match(support, /copy\.service/);
  assert.match(support, /copy\.manage/);
  for (const language of ['en', 'es']) {
    const copy = walletMembershipCopy(language);
    assert.ok(copy.service.includes('{rate}'));
    assert.ok(copy.service.includes('{memberRate}'));
    assert.doesNotMatch(copy.service, /\$\d/);
    assert.ok(copy.free.length > 30);
    assert.ok(copy.essential.length > 100 && copy.premier.length > 100);
  }
});
