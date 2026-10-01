import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  familyJoinErrorKey,
  familyJoinFailure,
  hasOwnStoreSubscription,
  providerCodeErrorKey,
  providerCodeFailure,
} from '../src/lib/inviteCodeErrors';
import { shouldDeferPushRouting } from '../src/lib/pushColdStart';
import { entitlementsForAccountState } from '../src/lib/featureAccess';
import { calendarSyncSummary, CALENDAR_SYNC_MAX_ATTEMPTS } from '../src/lib/calendarSyncStatus';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');
const json = (file: string) => JSON.parse(read(file)) as Record<string, any>;
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

// ── F1: join and provider-code errors are told apart ────────────────────────
test('family join distinguishes unknown code, rate limit and existing membership', () => {
  assert.equal(familyJoinFailure(null, 'space-id'), null);
  assert.equal(familyJoinFailure(null, null), 'invalid_code');
  assert.equal(familyJoinFailure({ code: '22023', message: 'invalid_invite_code' }, null), 'invalid_code');
  assert.equal(familyJoinFailure({ code: '54000', message: 'too_many_attempts' }, null), 'too_many_attempts');
  assert.equal(familyJoinFailure({ code: '23505', message: 'already_in_family_space' }, null), 'already_in_family_space');
  assert.equal(familyJoinFailure({ message: 'too_many_attempts' }, null), 'too_many_attempts', 'message alone is enough');
  assert.equal(familyJoinFailure({ code: '08006', message: 'Failed to fetch' }, null), 'error');
  assert.equal(familyJoinErrorKey('invalid_code'), 'joinError');
  assert.equal(familyJoinErrorKey('too_many_attempts'), 'joinErrorTooManyAttempts');
  assert.equal(familyJoinErrorKey('already_in_family_space'), 'joinErrorAlreadyInFamily');
  assert.equal(familyJoinErrorKey('error'), 'joinErrorNetwork');
});

test('provider code distinguishes unknown code from rate limit', () => {
  assert.equal(providerCodeFailure(null, 'Hope Recovery'), null);
  assert.equal(providerCodeFailure(null, null), 'invalid_code');
  assert.equal(providerCodeFailure({ code: '54000', message: 'too_many_attempts' }, null), 'too_many_attempts');
  assert.equal(providerCodeFailure({ message: 'network' }, null), 'error');
  assert.equal(providerCodeErrorKey('invalid_code'), 'invite.errorInvalid');
  assert.equal(providerCodeErrorKey('too_many_attempts'), 'invite.errorTooManyAttempts');
  assert.equal(providerCodeErrorKey('error'), 'invite.errorNetwork');
});

test('every join/provider error message exists in English and Spanish', () => {
  for (const lang of ['en', 'es']) {
    const alignment = json(`src/locales/${lang}/alignment.json`);
    for (const reason of ['invalid_code', 'too_many_attempts', 'already_in_family_space', 'error'] as const) {
      assert.equal(typeof alignment[familyJoinErrorKey(reason)], 'string', `${lang} alignment ${reason}`);
    }
    const onboarding = json(`src/locales/${lang}/onboarding.json`);
    for (const reason of ['invalid_code', 'too_many_attempts', 'error'] as const) {
      const [ns, key] = providerCodeErrorKey(reason).split('.');
      assert.equal(typeof onboarding[ns][key], 'string', `${lang} onboarding ${reason}`);
    }
  }
  assert.match(read('app/(tabs)/boundaries.tsx'), /familyJoinErrorKey\(result\.reason\)/);
  assert.match(read('app/(onboarding)/invite-code.tsx'), /providerCodeErrorKey\(failure\)/);
});

// ── E1: own App Store subscription warning before redeeming ─────────────────
test('only members paying the store directly are warned before joining a provider', () => {
  assert.equal(hasOwnStoreSubscription('direct-essential'), true);
  assert.equal(hasOwnStoreSubscription('direct-premium'), true);
  assert.equal(hasOwnStoreSubscription('direct-free'), false);
  assert.equal(hasOwnStoreSubscription('attached'), false);
  assert.equal(hasOwnStoreSubscription(undefined), false);
  const screen = read('app/(onboarding)/invite-code.tsx');
  assert.match(screen, /hasOwnStoreSubscription\(accountState\) && !acknowledged/);
  assert.match(screen, /Linking\.openURL\(SUBSCRIPTION_MANAGEMENT_URL\)/);
  // The warning is shown before the RPC is called.
  assert.ok(screen.indexOf('setSubscriptionWarning(true)') < screen.indexOf("supabase.rpc('redeem_invite_code'"));
});

// ── F4: cold-start push routing waits for entitlements ──────────────────────
test('a gated tap during enrichment is deferred; ungated taps and settled accounts route now', () => {
  const free = entitlementsForAccountState('direct-free');
  const video = { kind: 'member_video_live', session_id: SESSION_ID };
  assert.equal(shouldDeferPushRouting(video, free, false), true, 'video join could open up after enrichment');
  assert.equal(shouldDeferPushRouting(video, free, true), false, 'settled entitlements route immediately');
  assert.equal(shouldDeferPushRouting(video, entitlementsForAccountState('direct-premium'), false), false, 'already entitled');
  assert.equal(shouldDeferPushRouting({ kind: 'coach_message' }, free, false), false, 'Chat serves every tier');
  assert.equal(shouldDeferPushRouting({ kind: 'morning_note', screen: 'boundaries' }, free, false), false, 'ungated');
  assert.equal(shouldDeferPushRouting({ kind: 'admin_textline_message', thread_id: SESSION_ID }, free, false), false, 'admin alerts are not gated');
  assert.equal(shouldDeferPushRouting({ kind: 'winback' }, null, false), false);
});

test('the push hook holds deferred taps without marking them handled', () => {
  const hook = read('src/hooks/usePushNotifications.ts');
  const deferAt = hook.indexOf('shouldDeferPushRouting(data, entitlements, entitlementsSettled)');
  assert.ok(deferAt > 0);
  assert.ok(deferAt < hook.indexOf('shouldHandlePushResponse(data'), 'deferral happens before de-duplication');
  assert.match(hook, /\[accountId, navigationReady, router, entitlements, entitlementsSettled\]/);
  const context = read('src/contexts/AccountContext.tsx');
  assert.match(context, /setEntitlementsSettled\(false\);/);
  assert.match(context, /setUser\(enriched\);\s*setEntitlementsSettled\(true\);/);
});

// ── A: admin calendar sync status ───────────────────────────────────────────
const base = {
  status: 'scheduled', calendar_sync_status: 'synced', calendar_sync_error: null,
  calendar_synced_at: '2026-10-01T12:00:00Z', calendar_sync_attempts: 0, calendar_next_attempt_at: null,
};

test('synced, pending and failed sync states read clearly', () => {
  const synced = calendarSyncSummary(base);
  assert.equal(synced.tone, 'ok');
  assert.equal(synced.label, 'Calendar: synced');
  assert.equal(synced.canRetry, false);

  const pending = calendarSyncSummary({ ...base, calendar_sync_status: 'pending' });
  assert.equal(pending.tone, 'pending');
  assert.equal(pending.canRetry, false);

  const failed = calendarSyncSummary({ ...base, calendar_sync_status: 'failed', calendar_sync_attempts: 2,
    calendar_sync_error: 'google_calendar_failed: Google Calendar could not create the event.', calendar_next_attempt_at: '2026-10-01T12:20:00Z' });
  assert.equal(failed.tone, 'failed');
  assert.equal(failed.canRetry, true);
  assert.match(failed.detail ?? '', /^Attempt 2 of 6/);
  assert.match(failed.detail ?? '', /google_calendar_failed/);

  const exhausted = calendarSyncSummary({ ...base, calendar_sync_status: 'failed', calendar_sync_attempts: CALENDAR_SYNC_MAX_ATTEMPTS });
  assert.match(exhausted.detail ?? '', /^Gave up after 6 attempts/);
  assert.equal(exhausted.canRetry, true);

  assert.equal(calendarSyncSummary({ ...base, calendar_sync_status: 'not_synced' }).canRetry, true, 'a confirmed session missing from the calendar can be queued');
  assert.equal(calendarSyncSummary({ ...base, status: 'requested', calendar_sync_status: 'not_synced' }).canRetry, false);
});

test('the admin video card shows sync status with a staff retry and an owner-only manual payment', () => {
  const card = read('src/components/admin/VideoSessionManager.tsx');
  assert.match(card, /<CalendarSyncRow session=\{session\}/);
  assert.match(card, /label="Retry sync"/);
  assert.match(card, /isOwner && !history && session\.appointment_type === 'one_off_150' && session\.payment_status === 'pending_payment'/);
  const hook = read('src/hooks/useAdminVideoSessions.ts');
  assert.match(hook, /'admin_retry_video_calendar_sync'/);
  assert.match(hook, /'admin_mark_plan_review_paid', \{ p_note: note\.trim\(\) \}/);
});

// ── C: plan-review client handling ──────────────────────────────────────────
test('the plan-review card never offers payment once Premier includes the review', () => {
  const card = read('src/components/video/PlanReviewBookingCard.tsx');
  assert.match(card, /existing\.payment_status === 'pending_payment' && isPremier \?/);
  assert.match(card, /controller\.applyPremierToPlanReview\(existing\)/);
  const hook = read('src/hooks/usePrivateVideoSessions.ts');
  assert.match(hook, /data\?\.included/);
  assert.match(hook, /intent: 'checkout' \| 'apply_membership'/);
  for (const lang of ['en', 'es']) {
    const crisis = json(`src/locales/${lang}/crisis.json`);
    for (const key of ['includedNowBody', 'applyPremier', 'convertedToIncluded', 'dateField', 'timeField']) {
      assert.equal(typeof crisis.planReview[key], 'string', `${lang} planReview.${key}`);
    }
    for (const code of ['premier_not_active', 'start_time_in_past', 'invalid_session', 'not_authenticated']) {
      assert.equal(typeof crisis.planReview.errors[code], 'string', `${lang} planReview.errors.${code}`);
    }
    assert.equal(typeof crisis.premierVideo.errors.start_time_in_past, 'string');
    assert.equal(typeof json(`src/locales/${lang}/support.json`).privateVideo.scheduling.errors.start_time_in_past, 'string');
  }
});

test('My bookings uses the member RPC and the member timezone', () => {
  const screen = read('app/book-coaching.tsx');
  assert.match(screen, /supabase\.rpc\('member_get_coaching_bookings', \{ p_limit: 10 \}\)/);
  assert.match(screen, /formatBookingTime\(b\.scheduled_at, user\?\.timezone, i18n\.language\)/);
  assert.doesNotMatch(screen, /new Date\(b\.scheduled_at\)\.toLocaleString\(\)/);
});

// ── Trajectory "Share with coach" ───────────────────────────────────────────
test('trajectory share is gated on coach messaging and never creates a thread on open', () => {
  const screen = read('app/trajectory.tsx');
  assert.match(screen, /const canMessageCoach = !!user && entitlements\.canMessageOnCallCoach;/);
  // Not enabled on mount; read-only for members without the Text Line.
  assert.match(screen, /useThread\(user\?\.id \?\? null, threadWanted && canMessageCoach, \{ readOnly: !canMessageCoach \}\)/);
  assert.match(screen, /useState\(false\)[\s\S]*setThreadWanted\(true\)/);
  assert.doesNotMatch(screen, /disabled=\{!threadId\}/);
  assert.match(screen, /!canMessageCoach \? \([\s\S]*router\.push\('\/situation-brief'/);
  for (const lang of ['en', 'es']) {
    const tracker = json(`src/locales/${lang}/tracker.json`);
    for (const key of ['shareNotIncluded', 'shareBriefLink', 'sharePlansLink']) {
      assert.equal(typeof tracker.trajectory[key], 'string', `${lang} trajectory.${key}`);
    }
  }
});
