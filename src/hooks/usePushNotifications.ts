import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';
import { supabase } from '../lib/supabase';
import { getCheckIn } from '../storage/checkIn';
import { AsyncWriteBarrier } from '../lib/appFlowGuards';
import { getPushDestination, shouldHandlePushResponse } from '../lib/pushRouting';
import { settlePendingPushTokenRevoke } from '../lib/pendingPushTokenRevoke';
import { isDeviceSignedIn } from '../lib/pushDevice';
import { shouldDeferPushRouting } from '../lib/pushColdStart';
import { requestFamilySpaceRefresh } from '../lib/familySpaceRefresh';
import { joinFamilySquaresFromPush, planReminderJoin, reminderJoinSessionId } from '../lib/familySquaresPushJoin';
import type { ReminderTapPlan } from '../lib/familySquaresJoin';
import { useAccount } from '../contexts/AccountContext';
import { canAccessFeature } from '../lib/featureAccess';
import type { Entitlements } from '../api/types';
export const LEGACY_NUDGE_PREFIX = 'legacy-daily-nudge:v1:';
const LEGACY_OPT_IN_KEY = 'legacy-daily-nudge-opt-in:v1:';

export async function isDailyNudgeEnabled(accountId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(LEGACY_OPT_IN_KEY + accountId)) === 'true';
}

/** Mirrors the device's explicit daily-reminder choice to the server morning push. */
async function setServerDailyOptIn(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_daily_push_opt_in', { p_enabled: enabled });
  if (error) throw error;
}

/** Mirrors the chosen reminder hour, which decides who sends the daily note. */
async function setServerDailyHour(hour: number): Promise<void> {
  const { error } = await supabase.rpc('set_daily_push_hour', { p_hour: hour });
  if (error) throw error;
}

export async function disableDailyNudges(accountId: string): Promise<void> {
  await setServerDailyOptIn(false);
  await AsyncStorage.setItem(LEGACY_OPT_IN_KEY + accountId, 'false');
  await rearmDailyNudge();
}

Notifications.setNotificationHandler({
  handleNotification: async () => {
    // Nobody signed in on this device: never surface a member's notification.
    const show = isDeviceSignedIn();
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };
  },
});

const REMINDER_HOUR_KEY = 'reminderHour';
export const DEFAULT_REMINDER_HOUR = 9;
// notify-daily-morning sends its note at the chosen hour only before noon.
const MORNING_NOTE_BEFORE_HOUR = 12;
/**
 * Push features this build understands (accounts.push_app_contract):
 * 1 = the hour-before reminder's ask=question and Today's "this week's one
 *     thing";
 * 2 = this build logs Family Squares attendance before it leaves for Zoom
 *     (the 'attended' funnel event is sent, and waited for, ahead of the
 *     meeting link opening), so the server can tell "saved a seat and never
 *     joined" from "joined" and may use the kinder "we missed you" wording in
 *     Tuesday's note. A build that reports 1 may have joined without the
 *     server hearing of it, so it is never told it was missed.
 */
export const PUSH_APP_CONTRACT = 2;
const NUDGE_DAYS = 7; // schedule a week of nudges ahead so non-openers still get pinged
const pushWriteBarrier = new AsyncWriteBarrier();
let activePushAccountId: string | null = null;
// The Expo token this device registered for an account. accounts.push_token
// holds one token (the last device opened), so the server morning note only
// covers this device's daily nudge when that token is this device's.
let devicePushToken: { accountId: string; token: string } | null = null;
let nudgeRearmQueue: Promise<void> = Promise.resolve();
const WEEK_REVIEW_ID = LEGACY_NUDGE_PREFIX + 'weekly';
// Whether this account's Today shows the week review (the paid Today). Unknown
// (null) until the account's access has settled after a cold start.
let weekReviewAccess: { accountId: string; canSee: boolean } | null = null;

/**
 * The Sunday 6pm "Your week, at a glance" note points at the week review on
 * Today, which only the paid Today shows. It is scheduled only for someone
 * who will find that card when she taps it.
 */
export function shouldScheduleWeekReview(input: { canSeeWeekReview: boolean | null }): boolean {
  return input.canSeeWeekReview === true;
}

/**
 * Tells the scheduler whether this account can see the week review, then
 * re-arms: a plan that ended has its Sunday note cancelled, a new one gets it.
 */
export function setWeekReviewAccess(accountId: string | null, canSee: boolean | null): Promise<void> {
  const next = accountId && canSee !== null ? { accountId, canSee } : null;
  if (next?.accountId === weekReviewAccess?.accountId && next?.canSee === weekReviewAccess?.canSee) return Promise.resolve();
  weekReviewAccess = next;
  // Only for the account this device is registered for. Before registration
  // (app start) a re-arm would cancel her reminders with nothing to put back;
  // registering re-arms by itself and reads the access noted here.
  if (!next || activePushAccountId !== next.accountId) return Promise.resolve();
  return rearmDailyNudge();
}

/** Null this account's server-side push token (used to settle an offline sign-out). */
export async function revokePushToken(accountId: string): Promise<void> {
  const { error } = await supabase.from('accounts').update({ push_token: null }).eq('id', accountId);
  if (error) throw error;
}

/**
 * An offline sign-out leaves a revoke pending; settle it before registering
 * so a fresh registration is never nulled by the late revoke. Returns whether
 * the device should (re)register afterwards.
 */
export async function settleRevokeThenRegister(accountId: string): Promise<boolean> {
  const settled = await settlePendingPushTokenRevoke(accountId, revokePushToken);
  if (settled === 'retry') return false;
  return registerForPushNotifications(accountId, false);
}

/** Invalidate token acquisition and wait for an already-started write to settle. */
export async function cancelPushRegistration(accountId: string): Promise<void> {
  if (activePushAccountId === accountId) activePushAccountId = null;
  if (devicePushToken?.accountId === accountId) devicePushToken = null;
  await pushWriteBarrier.cancelAndWait(accountId);
  await rearmDailyNudge();
}

export async function getReminderHour(): Promise<number> {
  const raw = await AsyncStorage.getItem(REMINDER_HOUR_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : DEFAULT_REMINDER_HOUR;
}

export async function setReminderHour(hour: number): Promise<void> {
  await AsyncStorage.setItem(REMINDER_HOUR_KEY, String(hour));
  await rearmDailyNudge();
}

function nudgeBodies(): string[] {
  const arr = i18n.t('settings:notifications.dailyNudgeBodies', { returnObjects: true });
  if (Array.isArray(arr) && arr.length) return arr as string[];
  return [i18n.t('settings:notifications.dailyNudgeBody')];
}

/**
 * (Re)schedules the daily check-in nudge. Three behaviours that make it feel
 * like a supportive companion rather than a nag:
 *   1. Skips today entirely if the user has already checked in.
 *   2. Rotates the message copy so it never reads the same two days running.
 *   3. Fires at the user's chosen hour (Settings), defaulting to 9am.
 * Schedules a rolling week so users who don't open the app daily still get
 * reminders. Safe to call repeatedly (it cancels and re-arms).
 */
async function performDailyNudgeRearm(): Promise<void> {
  const accountId = activePushAccountId;
  const generation = accountId ? pushWriteBarrier.begin(accountId) : -1;
  const current = () => !!accountId && activePushAccountId === accountId
    && pushWriteBarrier.isCurrent(accountId, generation);
  const canSeeWeekReview = accountId && weekReviewAccess?.accountId === accountId ? weekReviewAccess.canSee : null;
  // Known not to see the week review (free, or a plan that ended): cancel a
  // Sunday note that is already scheduled, even if the account read below
  // fails offline and nothing else is touched.
  if (canSeeWeekReview === false) {
    await Notifications.cancelScheduledNotificationAsync(WEEK_REVIEW_ID).catch(() => undefined);
  }
  // Resolve the account before touching the schedule: offline the lookup
  // fails, and cancelling first would leave the week with no reminders.
  const { data: { session } } = await supabase.auth.getSession();
  type DailyAccount = {
    id: string; timezone: string | null; daily_push_opt_in: boolean;
    daily_push_hour: number | null; push_token: string | null;
  };
  let account: DailyAccount | null = null;
  // The server morning note reaches her (via the token on file) at this hour.
  let serverMorningNote = false;
  if (accountId && session?.user.id) {
    const { data, error } = await supabase.from('accounts')
      .select('id, timezone, daily_push_opt_in, daily_push_hour, push_token')
      .eq('user_id', session.user.id).maybeSingle();
    if (error) return;
    account = data as DailyAccount | null;
    // Only an explicit opt-in on this device consents to the server's daily
    // push; keep the server in step (older builds never reported it).
    const optedIn = await isDailyNudgeEnabled(accountId);
    let serverOptIn = account?.daily_push_opt_in ?? false;
    if (account?.id === accountId && serverOptIn !== optedIn && current()) {
      serverOptIn = await setServerDailyOptIn(optedIn).then(() => optedIn, () => serverOptIn);
    }
    const chosenHour = await getReminderHour();
    let serverHour = account?.daily_push_hour ?? DEFAULT_REMINDER_HOUR;
    if (account?.id === accountId && serverHour !== chosenHour && current()) {
      serverHour = await setServerDailyHour(chosenHour).then(() => chosenHour, () => serverHour);
    }
    serverMorningNote = account?.id === accountId && serverOptIn && !!account.push_token
      && devicePushToken?.accountId === accountId && devicePushToken.token === account.push_token
      && serverHour === chosenHour && chosenHour < MORNING_NOTE_BEFORE_HOUR;
  }

  // Only cancel identifiers this scheduler owns; unknown pre-namespace requests
  // cannot safely be attributed to us. Never infer feature consent from OS permission.
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  for (const request of pending) {
    if (request.identifier.startsWith(LEGACY_NUDGE_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }

  if (!accountId || !current() || !(await isDailyNudgeEnabled(accountId))) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' || !current()) return;

  const hour = await getReminderHour();
  const title = i18n.t('settings:notifications.dailyNudgeTitle');
  const bodies = nudgeBodies();
  if (!account || account.id !== accountId) return;
  const storageOwner = account.id;
  // AccountContext normalizes a null timezone to UTC; the check-in date key
  // must be computed the same way or "checked in today" never matches.
  const timezone = account.timezone || 'UTC';
  if (!session?.user.id || !current()) return;
  const checkedInToday = (await getCheckIn(storageOwner, new Date(), timezone)) !== null;
  const now = new Date();

  // A morning hour is covered by the server's morning note at that hour; a
  // second, local notification at the same moment would be a duplicate.
  for (let i = 0; i < (serverMorningNote ? 0 : NUDGE_DAYS); i++) {
    const fire = new Date();
    fire.setHours(hour, 0, 0, 0);
    fire.setDate(fire.getDate() + i);
    if (fire <= now) continue; // today's slot already passed
    if (i === 0 && checkedInToday) continue; // already checked in → don't nag today
    if (!current()) return;
    await Notifications.scheduleNotificationAsync({
      identifier: LEGACY_NUDGE_PREFIX + 'daily-' + i,
      content: { title, body: bodies[i % bodies.length] },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fire },
    });
  }

  // Sunday 6pm week-in-review — the weekly payoff that pairs with the
  // WeekReviewCard on Today. One-shot; re-armed on every foreground. Only for
  // members whose Today shows that card: for anyone else the one scheduled
  // earlier was cancelled above and is not put back.
  if (!shouldScheduleWeekReview({ canSeeWeekReview })) return;
  const sunday = new Date();
  sunday.setHours(18, 0, 0, 0);
  sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7));
  if (sunday <= now) sunday.setDate(sunday.getDate() + 7);
  if (!current()) return;
  await Notifications.scheduleNotificationAsync({
    identifier: WEEK_REVIEW_ID,
    content: {
      title: i18n.t('settings:notifications.weekReviewTitle'),
      body: i18n.t('settings:notifications.weekReviewBody'),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: sunday },
  });
}

/** Serialize re-arms so overlapping foreground/save/settings events cannot interleave. */
export function rearmDailyNudge(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  const task = nudgeRearmQueue.then(performDailyNudgeRearm, performDailyNudgeRearm);
  nudgeRearmQueue = task.catch(() => undefined);
  return task;
}

export async function registerForPushNotifications(accountId: string, requestPermission = true, optInDailyNudges = false): Promise<boolean> {
  activePushAccountId = accountId;
  const generation = pushWriteBarrier.begin(accountId);
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted' && requestPermission) {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return false;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) throw new Error('EAS project ID is not configured');
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return false;
    if (!pushWriteBarrier.isCurrent(accountId, generation) || activePushAccountId !== accountId) return false;

    // Transfer this device token to the current authenticated account in one
    // server transaction so account switching cannot leave two owners.
    // p_app_contract tells the server this build understands the newer pushes
    // (the hour-before reminder's question sheet, Today's one thing). A
    // backend without that argument yet (PGRST202) gets the older call.
    const tokenWrite = pushWriteBarrier.track(accountId, Promise.resolve(supabase.rpc(
      'register_push_device',
      { p_token: token, p_locale: i18n.language ?? 'en', p_app_contract: PUSH_APP_CONTRACT },
    )).then(async (result) => (result.error?.code === 'PGRST202'
      ? await supabase.rpc('register_push_device', { p_token: token, p_locale: i18n.language ?? 'en' })
      : result)));
    const { data, error } = await tokenWrite;
    if (error || data !== true) throw error ?? new Error('push_token_not_registered');
    if (!pushWriteBarrier.isCurrent(accountId, generation) || activePushAccountId !== accountId) return false;
    devicePushToken = { accountId, token };

    // Only onboarding/daily-reminder Settings actions pass this third flag.
    // RSVP, practice pushes and automatic device registration are not daily consent.
    if (optInDailyNudges && requestPermission) {
      await pushWriteBarrier.track(accountId, setServerDailyOptIn(true));
      await pushWriteBarrier.track(accountId, AsyncStorage.setItem(LEGACY_OPT_IN_KEY + accountId, 'true'));
      if (!pushWriteBarrier.isCurrent(accountId, generation) || activePushAccountId !== accountId) return false;
    }
    await rearmDailyNudge().catch((error) => {
      console.warn('[push] local nudge rearm failed', error);
    });
    return true;
  } catch (error) {
    // Includes native permission/channel calls so callers never receive an
    // unhandled rejection or remain stuck in a busy state.
    console.warn('[push] registration failed', error);
    return false;
  }
}

export function usePushNotifications(
  accountId: string | null,
  navigationReady: boolean,
  entitlements: Entitlements | null = null,
): void {
  const router = useRouter();
  const { entitlementsSettled } = useAccount();
  // A tap held back until entitlements settle (see shouldDeferPushRouting).
  const deferredResponse = useRef<Notifications.NotificationResponse | null>(null);
  // Who this hook is live for right now, whichever run of the effect below is
  // current. A reminder tap that is waiting on its lookup stays hers while
  // this still matches, even if the effect has re-run meanwhile.
  const live = useRef({ accountId, navigationReady, mounted: true });
  live.current.accountId = accountId;
  live.current.navigationReady = navigationReady;
  useEffect(() => {
    const state = live.current;
    state.mounted = true;
    return () => { state.mounted = false; };
  }, []);
  const routerRef = useRef(router);
  routerRef.current = router;
  // One lookup per reminder tap, shared by every run of the effect that sees it.
  const joinPlans = useRef(new Map<string, Promise<ReminderTapPlan>>());

  useEffect(() => {
    if (!accountId) return;
    // Mount may register an already-authorized device, but never opens a prompt.
    void settleRevokeThenRegister(accountId).catch(() => false);

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void rearmDailyNudge().catch(error => console.warn('[push] rearm failed', error));
      // A revoke that could not be settled at mount (still offline) is retried
      // here; a successful late revoke re-registers the device.
      void settlePendingPushTokenRevoke(accountId, revokePushToken)
        .then((settled) => (settled === 'revoked' ? registerForPushNotifications(accountId, false) : false))
        .catch(() => false);
    });
    return () => {
      appStateSub.remove();
      void cancelPushRegistration(accountId).catch(error => console.warn('[push] cleanup failed', error));
    };
  }, [accountId]);

  // The Sunday week-review note follows what her plan lets her see on Today.
  // Not decided while the entitlements are still a cold-start fallback.
  const canSeeWeekReview = entitlements && entitlementsSettled
    ? canAccessFeature({ feature: 'todayFull', entitlements })
    : null;
  useEffect(() => {
    void setWeekReviewAccess(accountId, canSeeWeekReview).catch(error => console.warn('[push] rearm failed', error));
  }, [accountId, canSeeWeekReview]);

  useEffect(() => {
    if (!accountId || !navigationReady) return;
    let effectActive = true;

    const openNotification = async (
      response: Notifications.NotificationResponse,
    ): Promise<boolean> => {
      const rawData = response.notification.request.content.data ?? {};
      const data = rawData as Record<string, unknown>;
      // During a cold start the entitlements may still be the free-tier
      // fallback. Leave a gated tap unhandled (not de-duplicated, not cleared);
      // this effect re-runs when the account finishes enriching.
      if (shouldDeferPushRouting(data, entitlements, entitlementsSettled)) {
        deferredResponse.current = response;
        return false;
      }
      const destination = getPushDestination(data, { entitlements });
      // Only an expired or malformed practice call is discarded; everything else opens the app.
      if (!destination) return true;

      if (destination.pathname === '/rehearsal-incoming') {
        const { data: valid, error } = await supabase.rpc('validate_practice_push_event', {
          p_event_id: destination.params.eventId,
        });
        if (!effectActive) return false;
        if (error) {
          console.warn('[push] practice event validation failed', error);
          return false;
        }
        if (valid !== true) return true;
      }

      // "Tap to join": a Family Squares reminder opens the meeting itself when
      // it is about to start or under way, and Today's call card otherwise.
      // Looked up before the duplicate check below, so Zoom opens only once.
      let route = destination;
      let meetingUrl: string | null = null;
      const joinSessionId = reminderJoinSessionId(destination);
      if (joinSessionId) {
        const tapKey = `${response.notification.request.identifier}:${joinSessionId}`;
        let lookup = joinPlans.current.get(tapKey);
        if (!lookup) {
          const plans = joinPlans.current;
          lookup = planReminderJoin(joinSessionId).finally(() => { plans.delete(tapKey); });
          plans.set(tapKey, lookup);
        }
        const plan = await lookup;
        if (plan.action !== 'default') route = { pathname: '/(tabs)' };
        if (plan.action === 'open_meeting') meetingUrl = plan.url;
      }

      // The effect can re-run while the lookup is out (the entitlements settle
      // on a cold start). That alone must not drop the tap: nothing would pick
      // it up again. It is still hers while the same account is signed in and
      // navigation is ready. If the newer run is handling the same tap too,
      // the duplicate check below lets exactly one of them act.
      const stillHers = effectActive
        || (live.current.mounted && live.current.accountId === accountId && live.current.navigationReady);
      if (!stillHers) return false;
      if (!shouldHandlePushResponse(data, response.notification.request.identifier)) return true;
      // A relative's backup notice opens Practice's Boundaries part (and Today
      // keeps its own copy): re-read the family space now.
      if (data.kind === 'family_backup') requestFamilySpaceRefresh();
      try {
        // A tab (Today, Practice, Tools, Support) is returned to, never pushed:
        // from a pushed screen (Settings, the Tracker, a letter) both push and
        // navigate append a second copy of the tabs (expo-router reuses a stack
        // route on NAVIGATE only when it is already in front). dismissTo pops
        // back to the existing tabs and hands the tab its params, the same as
        // app/guided-journey.tsx.
        const pathname = typeof route === 'string' ? route : (route as { pathname?: string }).pathname ?? '';
        if (pathname.startsWith('/(tabs)')) routerRef.current.dismissTo(route as never);
        else routerRef.current.push(route as never);
      } catch (error) {
        console.warn('[push] notification navigation failed', error);
        return false;
      }
      // Today is underneath, so that is where she is when she comes back from Zoom.
      if (meetingUrl) void joinFamilySquaresFromPush(accountId, meetingUrl);
      return true;
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      void openNotification(response);
    });
    const deferred = deferredResponse.current;
    deferredResponse.current = null;
    if (deferred) void openNotification(deferred);
    void Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (!response) return;
        const shouldClear = await openNotification(response);
        if (shouldClear) await Notifications.clearLastNotificationResponseAsync();
      })
      .catch((error) => console.warn('[push] cold-start response failed', error));

    return () => {
      effectActive = false;
      responseSub.remove();
    };
  }, [accountId, navigationReady, router, entitlements, entitlementsSettled]);
}
