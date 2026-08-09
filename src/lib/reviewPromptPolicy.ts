import type { CaregiverSupportNeed, MoodScore } from '../api/types';

export type ReviewMilestone =
  | 'check_in_streak_7'
  | 'safety_wallet_ready'
  | 'support_call_attended'
  | 'boundary_follow_through'
  | 'stabilization_program_completed';

export type ReviewPromptAttempt = {
  requestedAt: string;
  appVersion: string;
  milestone: ReviewMilestone;
};

export type ReviewPromptState = {
  schemaVersion: 1;
  attempts: ReviewPromptAttempt[];
};

export type ReviewSafetyContext = {
  inCrisisFlow?: boolean;
  situationBand?: 'calm' | 'watch' | 'elevated' | 'crisis' | null;
  recentCrisisAt?: string | null;
  checkIn?: {
    moodScore: MoodScore;
    capacityScore: MoodScore;
    pressureScore: MoodScore;
    supportNeed: CaregiverSupportNeed;
  } | null;
};

export type ReviewPromptDecision =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | 'crisis_flow'
        | 'crisis_band'
        | 'recent_crisis'
        | 'difficult_check_in'
        | 'version_already_requested'
        | 'cooldown'
        | 'annual_limit';
    };

export const REVIEW_PROMPT_COOLDOWN_MS = 180 * 24 * 60 * 60 * 1000;
export const REVIEW_PROMPT_ANNUAL_LIMIT = 2;
export const RECENT_CRISIS_WINDOW_MS = 72 * 60 * 60 * 1000;

export const EMPTY_REVIEW_PROMPT_STATE: ReviewPromptState = {
  schemaVersion: 1,
  attempts: [],
};

export function parseReviewPromptState(raw: string | null): ReviewPromptState {
  if (!raw) return { ...EMPTY_REVIEW_PROMPT_STATE, attempts: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ...EMPTY_REVIEW_PROMPT_STATE, attempts: [] };
    }
    const attempts = (value as { attempts?: unknown }).attempts;
    if (!Array.isArray(attempts)) return { ...EMPTY_REVIEW_PROMPT_STATE, attempts: [] };
    return {
      schemaVersion: 1,
      attempts: attempts.filter(isReviewPromptAttempt),
    };
  } catch {
    return { ...EMPTY_REVIEW_PROMPT_STATE, attempts: [] };
  }
}

export function reviewPromptDecision({
  state,
  appVersion,
  safety,
  now = new Date(),
}: {
  state: ReviewPromptState;
  appVersion: string;
  safety?: ReviewSafetyContext;
  now?: Date;
}): ReviewPromptDecision {
  if (safety?.inCrisisFlow) return { eligible: false, reason: 'crisis_flow' };
  if (safety?.situationBand === 'crisis') return { eligible: false, reason: 'crisis_band' };

  if (safety?.recentCrisisAt) {
    const recentCrisisAt = Date.parse(safety.recentCrisisAt);
    if (Number.isFinite(recentCrisisAt)
      && now.getTime() - recentCrisisAt < RECENT_CRISIS_WINDOW_MS) {
      return { eligible: false, reason: 'recent_crisis' };
    }
  }

  if (safety?.checkIn && isDifficultCheckIn(safety.checkIn)) {
    return { eligible: false, reason: 'difficult_check_in' };
  }

  if (state.attempts.some((attempt) => attempt.appVersion === appVersion)) {
    return { eligible: false, reason: 'version_already_requested' };
  }

  const timestamps = state.attempts
    .map((attempt) => Date.parse(attempt.requestedAt))
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  const latest = timestamps[0];
  if (latest != null && now.getTime() - latest < REVIEW_PROMPT_COOLDOWN_MS) {
    return { eligible: false, reason: 'cooldown' };
  }

  const lastYear = timestamps.filter((timestamp) => now.getTime() - timestamp < 365 * 24 * 60 * 60 * 1000);
  if (lastYear.length >= REVIEW_PROMPT_ANNUAL_LIMIT) {
    return { eligible: false, reason: 'annual_limit' };
  }

  return { eligible: true };
}

export function recordReviewPromptAttempt(
  state: ReviewPromptState,
  attempt: ReviewPromptAttempt,
): ReviewPromptState {
  const cutoff = Date.parse(attempt.requestedAt) - 2 * 365 * 24 * 60 * 60 * 1000;
  return {
    schemaVersion: 1,
    attempts: [
      ...state.attempts.filter((item) => {
        const timestamp = Date.parse(item.requestedAt);
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      }),
      attempt,
    ],
  };
}

export function isDifficultCheckIn(checkIn: NonNullable<ReviewSafetyContext['checkIn']>): boolean {
  return checkIn.supportNeed === 'safety'
    || checkIn.moodScore <= 2
    || checkIn.capacityScore <= 2
    || checkIn.pressureScore >= 4;
}

function isReviewPromptAttempt(value: unknown): value is ReviewPromptAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const attempt = value as Partial<ReviewPromptAttempt>;
  return typeof attempt.requestedAt === 'string'
    && Number.isFinite(Date.parse(attempt.requestedAt))
    && typeof attempt.appVersion === 'string'
    && isReviewMilestone(attempt.milestone);
}

function isReviewMilestone(value: unknown): value is ReviewMilestone {
  return value === 'check_in_streak_7'
    || value === 'safety_wallet_ready'
    || value === 'support_call_attended'
    || value === 'boundary_follow_through'
    || value === 'stabilization_program_completed';
}
