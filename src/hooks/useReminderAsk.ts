import { useCallback, useEffect, useRef, useState } from 'react';
import { invitationThisVisit, noteVisitAsk } from '../membershipInvitations/visitAsks';
import { AppState, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { registerForPushNotifications } from './usePushNotifications';
import { withTimeoutFallback } from '../lib/authBootstrap';
import {
  recordsTodayShowing,
  reminderAskResult,
  reminderNotNowChange,
  seatReminderAsk,
  todayReminderAsk,
  type ReminderAskKind,
  type ReminderAskMemory,
  type ReminderPermission,
} from '../lib/reminderAsk';
import {
  REMINDERS_SUPPORTED,
  isSeatReminderAskShowing,
  loadReminderAskMemory,
  readReminderPermission,
  rememberReminderAsk,
  reminderPermissionChanged,
  setSeatReminderAskShowing,
  subscribeReminderAsk,
} from '../lib/reminderAskStore';

/**
 * What an ask shows: the question ('ask'), the "off in Settings" line
 * ('settings'), or how her tap went ('on', or 'failed' when the permission was
 * given but this device could not be registered just now).
 */
export type ReminderAskView = ReminderAskKind | 'on' | 'failed';

export interface ReminderAsk {
  view: ReminderAskView | null;
  busy: boolean;
  /** The only thing that ever opens the system permission dialog. */
  remindMe: () => void;
  notNow: () => void;
  openSettings: () => void;
}

/**
 * Switches her Monday reminder on after her own "Remind me" tap. True only
 * when the server kept it: an error, no connection or no answer in ten
 * seconds is false, and the ask then says it could not turn reminders on.
 */
async function turnMondayRemindersOn(): Promise<boolean> {
  return withTimeoutFallback(
    Promise.resolve(supabase.rpc('set_family_call_reminders', { p_enabled: true })).then((result) => !result?.error),
    10_000,
    false,
  );
}

/** `memory` is null when the device's storage could not be read: then nothing is asked. */
type Decide = (permission: ReminderPermission | null, memory: ReminderAskMemory | null, now: Date) => ReminderAskKind | null;

/** Shared by the ask under a saved seat and Today's second chance. */
function useReminderAskCore(accountId: string | null, dismissedField: 'seatDismissedAt' | 'todayDismissedAt') {
  const [view, setViewState] = useState<ReminderAskView | null>(null);
  const [busy, setBusy] = useState(false);
  const viewRef = useRef<ReminderAskView | null>(null);
  const busyRef = useRef(false);
  const identity = useRef(accountId);
  identity.current = accountId;
  // Whether the screen this ask is on is the one in front. Today and Support
  // both stay mounted, so "on screen" has to mean the focused one.
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);

  const setView = useCallback((next: ReminderAskView | null) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  /**
   * Permission is given: register this device's push token, the way onboarding
   * does. `askSystem` is true only for her own "Remind me" tap.
   */
  const register = useCallback(async (askSystem: boolean): Promise<void> => {
    if (!accountId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const registered = await registerForPushNotifications(accountId, askSystem).catch(() => false);
    const permission = registered ? 'granted' : await readReminderPermission();
    // She tapped "Remind me": make sure the Monday reminder is not switched
    // off in Settings. ONLY for that tap: finding permission already granted
    // (back from device Settings, or answered on the other tab) registers the
    // device but never turns back on a reminder she switched off herself.
    // "Reminders are on" is said only once that change was saved; if it was
    // not, she is told reminders could not be turned on (reminderAskResult).
    const preferenceSaved = registered && askSystem ? await turnMondayRemindersOn() : false;
    busyRef.current = false;
    if (identity.current !== accountId) return;
    setBusy(false);
    setView(reminderAskResult({ registered, herTap: askSystem, preferenceSaved, permission }));
    reminderPermissionChanged();
  }, [accountId, setView]);

  const remindMe = useCallback(() => { void register(true); }, [register]);

  const notNow = useCallback(() => {
    const said = viewRef.current;
    setView(null);
    // "Not now" on the "off in Settings" line is a lasting no (reminderAsk).
    if (accountId) void rememberReminderAsk(accountId, reminderNotNowChange(dismissedField, said === 'settings' ? 'settings' : 'ask', new Date()));
  }, [accountId, dismissedField, setView]);

  const openSettings = useCallback(() => {
    // Coming back with notifications allowed is picked up when the app is in front again.
    void Linking.openSettings().catch(() => undefined);
  }, []);

  /**
   * Looks again while an ask is on screen: she may have allowed notifications
   * in device Settings, or answered the same ask on the other tab.
   */
  const recheck = useCallback(async (decide: Decide): Promise<void> => {
    const current = viewRef.current;
    if (!accountId || busyRef.current || (current !== 'ask' && current !== 'settings')) return;
    const [permission, memory] = await Promise.all([readReminderPermission(), loadReminderAskMemory(accountId)]);
    if (identity.current !== accountId || viewRef.current !== current || busyRef.current) return;
    if (permission === 'granted') {
      await register(false);
      return;
    }
    setView(decide(permission, memory, new Date()));
  }, [accountId, register, setView]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    setFocused(true);
    return () => {
      focusedRef.current = false;
      setFocused(false);
      // "Reminders are on" is for this visit: gone the next time the screen is opened.
      if (viewRef.current === 'on' || viewRef.current === 'failed') setView(null);
    };
  }, [setView]));

  return { view, viewRef, busy, busyRef, identity, focused, focusedRef, setView, remindMe, notNow, openSettings, recheck };
}

/**
 * The ask under a Family Squares seat she has just saved (Today's call card
 * and Support). It appears only after her own Save tap on that screen has
 * saved the seat (`savedHere` goes up, see useTodayFeed / useSessions), while
 * that screen is in front. Never for a seat that was already saved, and never
 * for one that simply arrived: her weekly seat on a re-read, a seat saved on
 * the other tab or in Settings, a failed read followed by a good one.
 */
export function useSeatReminderAsk(
  accountId: string | null,
  rsvp: 'going' | 'declined' | 'none',
  enabled: boolean,
  savedHere = 0,
): ReminderAsk {
  const core = useReminderAskCore(accountId, 'seatDismissedAt');
  const { view, viewRef, focused, focusedRef, setView, recheck } = core;
  const seenSave = useRef(savedHere);
  const panel = useRef({}).current;

  const decide = useCallback<Decide>((permission, memory, now) => (
    memory ? seatReminderAsk({ supported: REMINDERS_SUPPORTED, justSaved: true, permission, memory, now }) : null
  ), []);

  useEffect(() => {
    // A Save tap counts once, whatever comes of it.
    const justSavedHere = savedHere !== seenSave.current;
    seenSave.current = savedHere;
    if (rsvp !== 'going') {
      setView(null);
      return undefined;
    }
    if (!enabled || !accountId || !justSavedHere || !focusedRef.current) return undefined;
    let active = true;
    void Promise.all([readReminderPermission(), loadReminderAskMemory(accountId)]).then(([permission, memory]) => {
      // One ask per visit: a visit that had a membership invitation gets no reminder ask.
      if (active && viewRef.current === null && !invitationThisVisit(accountId)) setView(decide(permission, memory, new Date()));
    });
    return () => { active = false; };
  }, [rsvp, enabled, accountId, savedHere, decide, focusedRef, setView, viewRef]);

  // Only an ask on the screen in front counts as showing: an unanswered ask on
  // the Support tab must not hold back Today's for the whole session.
  const showing = (view === 'ask' || view === 'settings') && focused;
  useEffect(() => { setSeatReminderAskShowing(panel, showing); }, [panel, showing]);
  // One ask per visit: a reminder ask on screen keeps the membership invitation away this visit.
  useEffect(() => { if (showing) noteVisitAsk(accountId); }, [accountId, showing]);
  useEffect(() => () => setSeatReminderAskShowing(panel, false), [panel]);

  useEffect(() => {
    const look = () => { void recheck(decide); };
    const unsubscribe = subscribeReminderAsk(look);
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') look(); });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [recheck, decide]);

  return { view, busy: core.busy, remindMe: core.remindMe, notNow: core.notNow, openSettings: core.openSettings };
}

/**
 * Today's gentle second chance for someone using the app without reminders
 * (rules in todayReminderAsk). `holdBack` keeps it away while the
 * welcome-back card is showing. `welcomeBackDecided` is asked first every
 * time: coming back to the app, both this and the welcome-back look start at
 * once, and without the wait this ask could show (and use up its one showing)
 * a moment before the welcome-back card pushed it off the screen.
 */
export function useTodayReminderAsk(
  accountId: string | null,
  joinedAt: string | null | undefined,
  holdBack: boolean,
  welcomeBackDecided?: () => Promise<boolean>,
  /** The coming Monday's meeting is known cancelled: no reminder is offered for it. */
  meetingCancelled = false,
): ReminderAsk {
  const core = useReminderAskCore(accountId, 'todayDismissedAt');
  const { view, viewRef, busyRef, identity, focusedRef, setView, recheck } = core;

  const decide = useCallback<Decide>((permission, memory, now) => (memory ? todayReminderAsk({
    supported: REMINDERS_SUPPORTED,
    permission,
    memory,
    joinedAt,
    now,
    seatAskShowing: isSeatReminderAskShowing(),
    welcomeBackShowing: holdBack,
    meetingCancelled,
  }) : null), [joinedAt, holdBack, meetingCancelled]);

  const evaluate = useCallback(async (): Promise<void> => {
    if (!accountId || !REMINDERS_SUPPORTED || busyRef.current) return;
    const current = viewRef.current;
    // How her tap went stays until she leaves the screen.
    if (current === 'on' || current === 'failed') return;
    // Welcome-back is decided first; on such a visit this ask stays away.
    const welcomed = welcomeBackDecided ? await welcomeBackDecided().catch(() => false) : false;
    if (identity.current !== accountId || busyRef.current) return;
    // Back from device Settings with notifications allowed: finish the job.
    if (viewRef.current === 'settings') {
      await recheck(decide);
      if (viewRef.current !== 'settings') return;
    }
    const [permission, memory] = await Promise.all([readReminderPermission(), loadReminderAskMemory(accountId)]);
    if (identity.current !== accountId || busyRef.current || viewRef.current === 'on' || viewRef.current === 'failed') return;
    const now = new Date();
    // One ask per visit: none on a visit that had a membership invitation (or while one is up).
    const kind = welcomed || invitationThisVisit(accountId) ? null : decide(permission, memory, now);
    setView(kind);
    // This look runs on every return to the app and every store notice,
    // whichever tab is in front. The showing is recorded (and its 14 days
    // used) only when Today is the screen in front and the ask is on it;
    // otherwise the next look, when she opens Today, records it.
    if (recordsTodayShowing({ kind, focused: focusedRef.current, showing: viewRef.current, memory, now })) {
      await rememberReminderAsk(accountId, { todayShownAt: now.toISOString() });
    }
  }, [accountId, busyRef, decide, focusedRef, identity, recheck, setView, viewRef, welcomeBackDecided]);

  useEffect(() => {
    setView(null);
  }, [accountId, setView]);
  useFocusEffect(useCallback(() => { void evaluate(); }, [evaluate]));
  useEffect(() => {
    const look = () => { void evaluate(); };
    const unsubscribe = subscribeReminderAsk(look);
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') look(); });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [evaluate]);

  return { view, busy: core.busy, remindMe: core.remindMe, notNow: core.notNow, openSettings: core.openSettings };
}
