import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  EMPTY_REVIEW_PROMPT_STATE,
  parseReviewPromptState,
  recordReviewPromptAttempt,
  reviewPromptDecision,
  isNewBoundaryWin,
  isNewInterventionLetterCompletion,
  buildAuthoritativeReviewSafety,
  type ReviewPromptState,
} from '../src/lib/reviewPromptPolicy';
import { interventionLetterReadyToFinish } from '../src/lib/interventionLetter';
import type { LetterDraft } from '../src/api/types';

const NOW = new Date('2026-08-07T16:00:00.000Z');

test('allows a positive milestone with no prompt history', () => {
  assert.deepEqual(reviewPromptDecision({
    state: EMPTY_REVIEW_PROMPT_STATE,
    appVersion: '3.6',
    now: NOW,
    safety: {
      situationBand: 'watch',
      checkIn: {
        moodScore: 4,
        capacityScore: 3,
        pressureScore: 3,
        supportNeed: 'steady',
      },
    },
  }), { eligible: true });
});

test('blocks crisis, purchase, and difficult check-in contexts', () => {
  assert.deepEqual(reviewPromptDecision({
    state: EMPTY_REVIEW_PROMPT_STATE,
    appVersion: '3.6',
    now: NOW,
    safety: { inCrisisFlow: true },
  }), { eligible: false, reason: 'crisis_flow' });

  assert.deepEqual(reviewPromptDecision({
    state: EMPTY_REVIEW_PROMPT_STATE,
    appVersion: '3.6',
    now: NOW,
    safety: { inPurchaseFlow: true },
  }), { eligible: false, reason: 'purchase_flow' });

  assert.deepEqual(reviewPromptDecision({
    state: EMPTY_REVIEW_PROMPT_STATE,
    appVersion: '3.6',
    now: NOW,
    safety: { situationBand: 'crisis' },
  }), { eligible: false, reason: 'crisis_band' });

  assert.deepEqual(reviewPromptDecision({
    state: EMPTY_REVIEW_PROMPT_STATE,
    appVersion: '3.6',
    now: NOW,
    safety: { recentCrisisAt: '2026-08-06T12:00:00.000Z' },
  }), { eligible: false, reason: 'recent_crisis' });

  assert.deepEqual(reviewPromptDecision({
    state: EMPTY_REVIEW_PROMPT_STATE,
    appVersion: '3.6',
    now: NOW,
    safety: {
      checkIn: {
        moodScore: 2,
        capacityScore: 4,
        pressureScore: 2,
        supportNeed: 'connection',
      },
    },
  }), { eligible: false, reason: 'difficult_check_in' });
});

test('limits automatic requests by version and cooldown', () => {
  const recent: ReviewPromptState = {
    schemaVersion: 1,
    attempts: [{
      requestedAt: '2026-06-01T12:00:00.000Z',
      appVersion: '3.5',
      milestone: 'support_call_attended',
    }],
  };
  assert.deepEqual(reviewPromptDecision({ state: recent, appVersion: '3.6', now: NOW }), {
    eligible: false,
    reason: 'cooldown',
  });

  const oldSameVersion: ReviewPromptState = {
    schemaVersion: 1,
    attempts: [{
      requestedAt: '2025-01-01T12:00:00.000Z',
      appVersion: '3.6',
      milestone: 'check_in_streak_7',
    }],
  };
  assert.deepEqual(reviewPromptDecision({ state: oldSameVersion, appVersion: '3.6', now: NOW }), {
    eligible: false,
    reason: 'version_already_requested',
  });
});

test('enforces the annual automatic prompt limit', () => {
  const state: ReviewPromptState = {
    schemaVersion: 1,
    attempts: [
      { requestedAt: '2025-09-01T00:00:00.000Z', appVersion: '3.4', milestone: 'check_in_streak_7' },
      { requestedAt: '2026-01-01T00:00:00.000Z', appVersion: '3.5', milestone: 'support_call_attended' },
    ],
  };
  assert.deepEqual(reviewPromptDecision({ state, appVersion: '3.7', now: NOW }), {
    eligible: false,
    reason: 'annual_limit',
  });
});

test('parses valid and legacy history without accepting unknown milestones', () => {
  const parsed = parseReviewPromptState(JSON.stringify({
    attempts: [
      { requestedAt: 'bad', appVersion: '3.5', milestone: 'check_in_streak_7' },
      { requestedAt: '2026-01-01T00:00:00.000Z', appVersion: '3.5', milestone: 'check_in_streak_7' },
      { requestedAt: '2025-12-01T00:00:00.000Z', appVersion: '3.4', milestone: 'safety_wallet_ready' },
      { requestedAt: '2025-06-01T00:00:00.000Z', appVersion: '3.3', milestone: 'stabilization_program_completed' },
      { requestedAt: '2026-02-01T00:00:00.000Z', appVersion: '3.5', milestone: 'unknown' },
    ],
  }));
  assert.equal(parsed.attempts.length, 3);

  const next = recordReviewPromptAttempt(parsed, {
    requestedAt: NOW.toISOString(),
    appVersion: '3.6',
    milestone: 'boundary_follow_through',
  });
  assert.equal(next.attempts.at(-1)?.milestone, 'boundary_follow_through');
  assert.deepEqual(parseReviewPromptState('{bad'), EMPTY_REVIEW_PROMPT_STATE);
});

test('recognizes only new boundary and intervention-letter wins', () => {
  assert.equal(isNewBoundaryWin(null, 'held'), true);
  assert.equal(isNewBoundaryWin('mostly', 'held'), true);
  assert.equal(isNewBoundaryWin('held', 'held'), false);
  assert.equal(isNewBoundaryWin('held', 'mostly'), false);
  assert.equal(isNewInterventionLetterCompletion(false, true), true);
  assert.equal(isNewInterventionLetterCompletion(true, true), false);
  assert.equal(isNewInterventionLetterCompletion(true, false), false);
});

test('authoritative safety rechecks current mood and active consequence windows', () => {
  const calm = { band: 'watch', drivers: { willingness_window_active: false } };
  const difficult = {
    mood: 2,
    capacity: 4,
    pressure: 2,
    support_need: 'connection',
    created_at: '2026-08-07T15:30:00.000Z',
  };
  const difficultContext = buildAuthoritativeReviewSafety(calm, difficult, NOW);
  assert.equal(difficultContext?.checkIn?.moodScore, 2);
  assert.deepEqual(reviewPromptDecision({
    state: EMPTY_REVIEW_PROMPT_STATE,
    appVersion: '3.7',
    now: NOW,
    safety: difficultContext ?? undefined,
  }), { eligible: false, reason: 'difficult_check_in' });

  const consequenceContext = buildAuthoritativeReviewSafety({
    band: 'elevated',
    drivers: {
      willingness_window_active: true,
      latest_consequence_at: '2026-08-07T14:00:00.000Z',
    },
  }, null, NOW);
  assert.deepEqual(reviewPromptDecision({
    state: EMPTY_REVIEW_PROMPT_STATE,
    appVersion: '3.7',
    now: NOW,
    safety: consequenceContext ?? undefined,
  }), { eligible: false, reason: 'recent_crisis' });

  const explicitCrisis = buildAuthoritativeReviewSafety({
    band: 'elevated',
    drivers: { loved_one_status: 'crisis', willingness_window_active: false },
  }, null, NOW);
  assert.equal(explicitCrisis?.situationBand, 'crisis');

  const lowMoodHistory = buildAuthoritativeReviewSafety({
    band: 'watch',
    drivers: { low_mood_days: 1, avg_mood: 2, willingness_window_active: false },
  }, null, NOW);
  assert.deepEqual(reviewPromptDecision({
    state: EMPTY_REVIEW_PROMPT_STATE,
    appVersion: '3.7',
    now: NOW,
    safety: lowMoodHistory ?? undefined,
  }), { eligible: false, reason: 'recent_low_mood' });

  assert.equal(buildAuthoritativeReviewSafety({ band: 'unknown' }, null, NOW), null);
  assert.equal(buildAuthoritativeReviewSafety(calm, { ...difficult, mood: 9 }, NOW), null);
});

test('persists intervention-letter completions as valid review milestones', () => {
  const state = recordReviewPromptAttempt(EMPTY_REVIEW_PROMPT_STATE, {
    requestedAt: NOW.toISOString(),
    appVersion: '3.7',
    milestone: 'intervention_letter_completed',
  });
  const parsed = parseReviewPromptState(JSON.stringify(state));
  assert.equal(parsed.attempts[0]?.milestone, 'intervention_letter_completed');
});

function completeLetter(): LetterDraft {
  return {
    recipientName: 'Sam',
    p1Body: 'I love you and remember the person beneath this disease.',
    p2OpenerLabel: 'Your substance use has affected me in these ways.',
    p2Experiences: [{ when: 'When the hospital called,', felt: 'I felt terrified.' }],
    p3Request: 'Please accept treatment today.',
    p3Hope: 'I hope we can rebuild trust.',
    p3HealthySupport: 'I will attend family sessions.',
    p3ConfirmedBoundaryIds: [],
    p3ClosingQuestion: 'Will you accept help today?',
    status: 'draft',
    updatedAt: NOW.toISOString(),
  };
}

test('a letter becomes finishable only after meaningful required content fits one page', () => {
  const draft = completeLetter();
  assert.equal(interventionLetterReadyToFinish(draft), true);
  assert.equal(interventionLetterReadyToFinish({ ...draft, p1Body: '' }), false);
  assert.equal(interventionLetterReadyToFinish({ ...draft, p2Experiences: [{ when: 'When it happened', felt: '' }] }), false);
  assert.equal(interventionLetterReadyToFinish({ ...draft, p3Hope: '' }), false);
  assert.equal(interventionLetterReadyToFinish({ ...draft, p1Body: 'x'.repeat(1600) }), false);
});

test('post-win producers are wired after durable success and avoid unsafe false positives', () => {
  const today = readFileSync(resolve('app/(tabs)/index.tsx'), 'utf8');
  const holdHook = readFileSync(resolve('src/hooks/useHoldLog.ts'), 'utf8');
  const letter = readFileSync(resolve('app/letter.tsx'), 'utf8');
  const prompt = readFileSync(resolve('src/lib/reviewPrompt.ts'), 'utf8');
  const iap = readFileSync(resolve('src/hooks/useIAP.ts'), 'utf8');
  const support = readFileSync(resolve('app/(tabs)/support.tsx'), 'utf8');
  const safetyWallet = readFileSync(resolve('app/safety-wallet.tsx'), 'utf8');
  const situationCard = readFileSync(resolve('src/components/today/SituationCard.tsx'), 'utf8');
  const continueLetter = readFileSync(resolve('src/components/today/ContinueLetterCard.tsx'), 'utf8');

  assert.match(holdHook, /select\('result'\)[\s\S]*await load\(\);[\s\S]*newlyHeld/);
  assert.match(today, /newlyHeld = await holdLog\.save/);
  assert.match(today, /milestone: 'boundary_follow_through'/);
  assert.match(letter, /await updateDraft\(\{ status: 'complete' \}\)/);
  assert.match(letter, /milestone: 'intervention_letter_completed'/);
  assert.doesNotMatch(letter.match(/async function shareExport[\s\S]*?\n  \}/)?.[0] ?? '', /maybeRequestReview/);
  assert.ok((prompt.match(/authoritativeReviewSafety\(accountId\)/g) ?? []).length >= 2);
  assert.match(prompt, /cancelQueuedSupportCallReview/);
  assert.match(iap, /setReviewPromptPurchaseFlow\(true\)[\s\S]*setReviewPromptPurchaseFlow\(false\)/);
  assert.match(support, /function openUpgrade[\s\S]*setReviewPromptPaywallVisible\(true\)/);
  assert.match(support, /function closeUpgrade[\s\S]*setReviewPromptPaywallVisible\(false\)/);
  assert.doesNotMatch(safetyWallet, /maybeRequestReview|safety_wallet_ready/);
  assert.match(situationCard, /onSupportCallJoin[\s\S]*catch[\s\S]*Linking\.openURL/);
  assert.match(continueLetter, /useFocusEffect/);
});
