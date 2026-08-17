import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  MONDAY_FAMILY_CALL_URL,
  boundaryCardHtml,
  isResourceActionCancellation,
  mondayCallShareMessage,
} from '../src/lib/passItOnResources';

test('Monday call share copy uses the public registration URL and no private account data', () => {
  assert.equal(MONDAY_FAMILY_CALL_URL, 'https://soberhelpline.com/monday-zoom-registration');
  const english = mondayCallShareMessage('en');
  const spanish = mondayCallShareMessage('es');
  assert.match(english, /Monday/i);
  assert.match(english, /7:00 PM Pacific/);
  assert.match(english, new RegExp(MONDAY_FAMILY_CALL_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(spanish, /lunes/i);
  assert.match(spanish, /7:00 p\. m\. del Pacífico/);
  for (const message of [english, spanish]) {
    assert.doesNotMatch(message, /account|check-?in|mood|crisis history|loved one/i);
  }
});

test('printable boundary card is branded, bilingual, practical, and safety-aware', () => {
  const english = boundaryCardHtml('en');
  const spanish = boundaryCardHtml('es');
  for (const html of [english, spanish]) {
    assert.match(html, /Sober Helpline/);
    assert.match(html, /monday-zoom-registration/);
    assert.match(html, /@page/);
    assert.match(html, /911/);
    assert.doesNotMatch(html, /{{|undefined|null/);
  }
  assert.match(english, /A boundary is what I will do/i);
  assert.match(english, /When/i);
  assert.match(english, /I will/i);
  assert.match(spanish, /Un límite es lo que yo haré/i);
});

test('ordinary browser-share and iOS-print dismissal are neutral cancellations', () => {
  const browserDismissal = new Error('Share dismissed');
  browserDismissal.name = 'AbortError';
  assert.equal(isResourceActionCancellation(browserDismissal), true);
  assert.equal(isResourceActionCancellation(new Error('Printing did not complete')), true);
  assert.equal(isResourceActionCancellation(new Error('Printer unavailable')), false);
  assert.equal(isResourceActionCancellation('not an error'), false);
});

test('Today surfaces both distribution actions with explicit accessibility state', () => {
  const today = readFileSync(resolve('app/(tabs)/index.tsx'), 'utf8');
  const card = readFileSync(resolve('src/components/today/PassItOnCard.tsx'), 'utf8');
  const funnel = readFileSync(resolve('src/lib/funnel.ts'), 'utf8');
  assert.ok((today.match(/<PassItOnCard/g) ?? []).length >= 2);
  assert.match(card, /Share\.share/);
  assert.match(card, /navigator\.share/);
  assert.match(card, /navigator\.clipboard/);
  assert.match(card, /Print\.printAsync/);
  assert.match(card, /window\.open/);
  assert.match(card, /accessibilityRole="button"/);
  assert.match(card, /accessibilityState=\{\{ disabled, busy:/);
  assert.match(card, /accessibilityLiveRegion="polite"/);
  assert.match(card, /isResourceActionCancellation/);
  assert.match(card, /monday_call_share_requested/);
  assert.match(card, /boundary_card_print_requested/);
  assert.match(funnel, /monday_call_share_requested/);
  assert.match(funnel, /boundary_card_print_requested/);
});
