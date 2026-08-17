import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as StoreReview from 'expo-store-review';
import { Linking } from 'react-native';
import { captureAppError } from './monitoring';
import { logFunnelEvent } from './funnel';
import { supabase } from './supabase';
import {
  parseReviewPromptState,
  buildAuthoritativeReviewSafety,
  recordReviewPromptAttempt,
  reviewPromptDecision,
  type ReviewMilestone,
  type ReviewSafetyContext,
} from './reviewPromptPolicy';

const STATE_KEY_PREFIX = '@sh:review-prompt:';
const QUEUE_KEY_PREFIX = '@sh:review-prompt-queue:';
const SUPPORT_CALL_MINIMUM_MS = 10 * 60 * 1000;
const SUPPORT_CALL_MAXIMUM_MS = 3 * 60 * 60 * 1000;

type QueuedReviewMilestone = {
  schemaVersion: 1;
  milestone: 'support_call_attended';
  queuedAt: string;
  safety?: ReviewSafetyContext;
};

export type ReviewPromptOutcome =
  | 'requested'
  | 'not_eligible'
  | 'unavailable'
  | 'failed';

const requestsInFlight = new Map<string, Promise<ReviewPromptOutcome>>();
let currentRouteIsCrisis = false;
let currentRouteIsPaywall = false;
let embeddedPaywallVisible = false;
let purchaseFlowDepth = 0;

export function setReviewPromptRoute(routePath: string): void {
  currentRouteIsCrisis = routePath.includes('crisis-mode')
    || routePath.includes('safety-wallet');
  currentRouteIsPaywall = routePath.includes('paywall') || routePath.includes('upgrade');
}

export function setReviewPromptPurchaseFlow(active: boolean): void {
  purchaseFlowDepth = active ? purchaseFlowDepth + 1 : Math.max(0, purchaseFlowDepth - 1);
}

export function setReviewPromptPaywallVisible(visible: boolean): void {
  embeddedPaywallVisible = visible;
}

function accountKey(prefix: string, accountId: string): string {
  return `${prefix}${encodeURIComponent(accountId)}`;
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

/**
 * Requests the native rating sheet only after a positive milestone. Apple and
 * Google retain final control over whether the sheet is actually displayed.
 */
export function maybeRequestReview({
  accountId,
  milestone,
  safety,
}: {
  accountId: string | null;
  milestone: ReviewMilestone;
  safety?: ReviewSafetyContext;
}): Promise<ReviewPromptOutcome> {
  if (!accountId) return Promise.resolve('not_eligible');
  const existing = requestsInFlight.get(accountId);
  if (existing) return existing;

  const request = runReviewRequest(accountId, milestone, safety).finally(() => {
    if (requestsInFlight.get(accountId) === request) requestsInFlight.delete(accountId);
  });
  requestsInFlight.set(accountId, request);
  return request;
}

async function runReviewRequest(
  accountId: string,
  milestone: ReviewMilestone,
  safety?: ReviewSafetyContext,
): Promise<ReviewPromptOutcome> {
  try {
    const authoritativeSafety = await authoritativeReviewSafety(accountId);
    // Automatic rating prompts fail closed when current safety posture cannot
    // be verified. A store prompt is never important enough to guess here.
    if (!authoritativeSafety) return 'not_eligible';
    const key = accountKey(STATE_KEY_PREFIX, accountId);
    const state = parseReviewPromptState(await AsyncStorage.getItem(key));
    const version = appVersion();
    const decision = reviewPromptDecision({
      state,
      appVersion: version,
      safety: mergedReviewSafety(authoritativeSafety, safety),
    });
    if (!decision.eligible) return 'not_eligible';

    logFunnelEvent('review_eligible', { milestone, app_version: version });
    if (!(await StoreReview.isAvailableAsync())) {
      logFunnelEvent('review_unavailable', { milestone, app_version: version });
      return 'unavailable';
    }

    // Persist before invoking the native API so a crash or OS interruption
    // cannot cause another prompt on the next launch.
    const now = new Date().toISOString();
    await AsyncStorage.setItem(key, JSON.stringify(recordReviewPromptAttempt(state, {
      requestedAt: now,
      appVersion: version,
      milestone,
    })));

    // Recheck identity, safety, route, and paywall state after every awaited
    // eligibility step. If anything changed, consume the local attempt but do
    // not risk showing a prompt in the wrong context.
    const finalAuthoritativeSafety = await authoritativeReviewSafety(accountId);
    if (!finalAuthoritativeSafety || !reviewPromptDecision({
      state,
      appVersion: version,
      safety: mergedReviewSafety(finalAuthoritativeSafety, safety),
    }).eligible) return 'not_eligible';

    logFunnelEvent('review_prompt_requested', { milestone, app_version: version });
    await StoreReview.requestReview();
    return 'requested';
  } catch (error) {
    captureAppError(error);
    return 'failed';
  }
}

function mergedReviewSafety(
  authoritativeSafety: ReviewSafetyContext,
  safety?: ReviewSafetyContext,
): ReviewSafetyContext {
  return {
    ...safety,
    ...authoritativeSafety,
    checkIn: authoritativeSafety.checkIn ?? safety?.checkIn ?? null,
    recentCrisisAt: mostRecentTimestamp(
      authoritativeSafety.recentCrisisAt,
      safety?.recentCrisisAt,
    ),
    recentLowMood: authoritativeSafety.recentLowMood || safety?.recentLowMood,
    inCrisisFlow: currentRouteIsCrisis || safety?.inCrisisFlow,
    inPurchaseFlow: purchaseFlowDepth > 0 || currentRouteIsPaywall
      || embeddedPaywallVisible || safety?.inPurchaseFlow,
  };
}

function mostRecentTimestamp(first?: string | null, second?: string | null): string | null {
  const values = [first, second]
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return values[0] ?? null;
}

async function authoritativeReviewSafety(accountId: string): Promise<ReviewSafetyContext | null> {
  const [accountResult, situationResult, checkInResult] = await Promise.all([
    supabase.rpc('my_account_id'),
    supabase.rpc('my_situation'),
    supabase
      .from('checkins')
      .select('mood, capacity, pressure, support_need, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (accountResult.error || accountResult.data !== accountId
    || situationResult.error || checkInResult.error
    || !situationResult.data || typeof situationResult.data !== 'object') return null;

  return buildAuthoritativeReviewSafety(situationResult.data, checkInResult.data);
}

/** Queue a review request until the member returns from the external meeting. */
export async function queueSupportCallReview({
  accountId,
  safety,
}: {
  accountId: string | null;
  safety?: ReviewSafetyContext;
}): Promise<void> {
  if (!accountId) return;
  const queued: QueuedReviewMilestone = {
    schemaVersion: 1,
    milestone: 'support_call_attended',
    queuedAt: new Date().toISOString(),
    safety,
  };
  await AsyncStorage.setItem(
    accountKey(QUEUE_KEY_PREFIX, accountId),
    JSON.stringify(queued),
  );
}

export async function cancelQueuedSupportCallReview(accountId: string | null): Promise<void> {
  if (!accountId) return;
  try {
    await AsyncStorage.removeItem(accountKey(QUEUE_KEY_PREFIX, accountId));
  } catch (error) {
    captureAppError(error);
  }
}

/**
 * Called when the app returns to the foreground. A very short visit does not
 * count as attendance, and a stale queue never creates an unrelated prompt.
 */
export async function flushQueuedSupportCallReview(
  accountId: string | null,
): Promise<ReviewPromptOutcome | 'none'> {
  if (!accountId) return 'none';
  const key = accountKey(QUEUE_KEY_PREFIX, accountId);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return 'none';
    const queued = parseQueuedMilestone(raw);
    await AsyncStorage.removeItem(key);
    if (!queued) return 'none';

    const elapsed = Date.now() - Date.parse(queued.queuedAt);
    if (elapsed < SUPPORT_CALL_MINIMUM_MS || elapsed > SUPPORT_CALL_MAXIMUM_MS) return 'none';
    return maybeRequestReview({
      accountId,
      milestone: queued.milestone,
      safety: queued.safety,
    });
  } catch (error) {
    captureAppError(error);
    return 'failed';
  }
}

/** A user-initiated Settings action; it is not part of automatic prompt limits. */
export async function openStoreReviewFromSettings(): Promise<boolean> {
  try {
    logFunnelEvent('review_manual_opened', { source: 'settings', app_version: appVersion() });
    const url = StoreReview.storeUrl();
    if (url) {
      await Linking.openURL(url);
      return true;
    }
    if (await StoreReview.hasAction()) {
      await StoreReview.requestReview();
      return true;
    }
    return false;
  } catch (error) {
    captureAppError(error);
    return false;
  }
}

function parseQueuedMilestone(raw: string): QueuedReviewMilestone | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const queued = value as Partial<QueuedReviewMilestone>;
    if (queued.schemaVersion !== 1
      || queued.milestone !== 'support_call_attended'
      || typeof queued.queuedAt !== 'string'
      || !Number.isFinite(Date.parse(queued.queuedAt))) return null;
    return queued as QueuedReviewMilestone;
  } catch {
    return null;
  }
}
