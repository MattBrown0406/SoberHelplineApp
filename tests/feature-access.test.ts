import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { AccountState, ProductFeature } from '../src/api/types';
import {
  canAccessFeature,
  entitlementsForAccountState,
  FEATURE_ENTITLEMENT_MAP,
} from '../src/lib/featureAccess';

const here = dirname(fileURLToPath(import.meta.url));
const states: AccountState[] = ['direct-free', 'direct-essential', 'direct-premium', 'attached'];
const essentialFeatures: ProductFeature[] = [
  'todayFull', 'aiRehearsal', 'community', 'diyIntervention', 'practicePush', 'planReview',
];
const premierFeatures: ProductFeature[] = ['crisisCommandPlan', 'includedPlanReview'];

test('central entitlement matrix keeps tracker free', () => {
  for (const accountState of states) {
    const entitlements = entitlementsForAccountState(accountState);
    assert.equal(canAccessFeature({ feature: 'tracker', entitlements }), true);
  }
});

test('central entitlement matrix grants Essential+ product features', () => {
  for (const feature of essentialFeatures) {
    const free = entitlementsForAccountState('direct-free');
    assert.equal(canAccessFeature({ feature, entitlements: free }), false, feature);
    for (const accountState of states.slice(1)) {
      const entitlements = entitlementsForAccountState(accountState);
      assert.equal(canAccessFeature({ feature, entitlements }), true, `${feature}:${accountState}`);
    }
  }
});

test('Gate policy reads entitlement booleans, not account-state tiers', () => {
  const entitlements = entitlementsForAccountState('direct-free');
  entitlements.canAccessGroups = true;
  assert.equal(canAccessFeature({ feature: 'community', entitlements }), true);
  entitlements.canAccessGroups = false;
  assert.equal(canAccessFeature({ feature: 'community', entitlements }), false);
});

test('Premier-only capabilities stay locked for Essential', () => {
  for (const feature of premierFeatures) {
    assert.equal(canAccessFeature({
      feature,
      entitlements: entitlementsForAccountState('direct-essential'),
    }), false, feature);
    assert.equal(canAccessFeature({
      feature,
      entitlements: entitlementsForAccountState('direct-premium'),
    }), true, feature);
  }
});

test('admin QA access is expressed through centralized entitlements', () => {
  const entitlements = entitlementsForAccountState('direct-free', true);
  for (const feature of [...essentialFeatures, ...premierFeatures]) {
    assert.equal(canAccessFeature({ feature, entitlements }), true);
  }
  assert.equal(entitlements.canMessageOnCallCoach, true);
  assert.equal(entitlements.canAccessPrivateVideo, true);
});

test('feature-to-entitlement map is complete and immutable', () => {
  assert.deepEqual(Object.keys(FEATURE_ENTITLEMENT_MAP).sort(), [
    'aiRehearsal', 'community', 'crisisCommandPlan', 'diyIntervention',
    'includedPlanReview', 'planReview', 'practicePush', 'todayFull', 'tracker',
  ]);
  assert.equal(Object.isFrozen(FEATURE_ENTITLEMENT_MAP), true);
});

test('gated route shells use Gate and do not re-derive paid access', async () => {
  const routes: Array<[string, ProductFeature]> = [
    ['app/(tabs)/tracker.tsx', 'tracker'],
    ['app/community.tsx', 'community'],
    ['app/diy-intervention-planner.tsx', 'diyIntervention'],
    ['app/rehearsal-live.tsx', 'aiRehearsal'],
    ['app/rehearsal-incoming.tsx', 'aiRehearsal'],
    ['app/rehearsal-history.tsx', 'aiRehearsal'],
  ];
  for (const [path, feature] of routes) {
    const source = await readFile(resolve(here, '..', path), 'utf8');
    assert.match(source, new RegExp(`<Gate\\s+(?:[^>]*\\s)?feature=["']${feature}["']`), path);
    assert.doesNotMatch(source, /isAdminEmail\s*\(/, path);
    assert.doesNotMatch(source, /accountState\s*[!=]==?\s*['"]direct-free['"]/, path);
  }
});
