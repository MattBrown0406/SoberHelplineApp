import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_REVIEW_PROMPT_STATE,
  parseReviewPromptState,
  recordReviewPromptAttempt,
  reviewPromptDecision,
  type ReviewPromptState,
} from '../src/lib/reviewPromptPolicy';

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

test('blocks crisis contexts and difficult check-ins', () => {
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

test('parses only valid history and records a bounded attempt', () => {
  const parsed = parseReviewPromptState(JSON.stringify({
    attempts: [
      { requestedAt: 'bad', appVersion: '3.5', milestone: 'check_in_streak_7' },
      { requestedAt: '2026-01-01T00:00:00.000Z', appVersion: '3.5', milestone: 'check_in_streak_7' },
      { requestedAt: '2026-02-01T00:00:00.000Z', appVersion: '3.5', milestone: 'unknown' },
    ],
  }));
  assert.equal(parsed.attempts.length, 1);

  const next = recordReviewPromptAttempt(parsed, {
    requestedAt: NOW.toISOString(),
    appVersion: '3.6',
    milestone: 'safety_wallet_ready',
  });
  assert.equal(next.attempts.length, 2);
  assert.equal(next.attempts.at(-1)?.milestone, 'safety_wallet_ready');
  assert.deepEqual(parseReviewPromptState('{bad'), EMPTY_REVIEW_PROMPT_STATE);
});
