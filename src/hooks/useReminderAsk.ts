import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { registerForPushNotifications } from './usePushNotifications';
import {
  seatReminderAsk,
  startsTodayShowing,
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

  const setView = useCallback((next: ReminderAskView | null) => {
    viewRef.current = next;
    setViewState(next);
  }, []);

  /** Permission is given: register this device's push token, the way onboarding does. */
  const register = useCallback(async (askSystem: boolean): Promise<void> => {
    if (!accountId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const registered = await registerForPushNotifications(accountId, askSystem).catch(() => false);
    const permission = registered ? 'granted' : await readReminderPermission();
    // She asked to be reminded about Monday: make sure that reminder is not
    // switched off in Settings. Best effort; it is on unless she turned it off.
    if (registered) void Promise.resolve(supabase.rpc('set_family_call_reminders', { p_enabled: true })).catch(() => undefined);
    busyRef.current = false;
    if (identity.current !== accountId) return;
    setBusy(false);
    setView(registered ? 'on' : permission === 'blocked' ? 'settings' : permission === 'granted' ? 'failed' : 'ask');
    reminderPermissionChanged();
  }, [accountId, setView]);

  const remindMe = useCallback(() => { void register(true); }, [register]);

  const notNow = useCallback(() => {
    setView(null);
    if (accountId) void rememberReminderAsk(accountId, { [dismissedField]: new Date().toISOString() });
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

  // "Reminders are on" is for this visit: gone the next time the screen is opened.
  useFocusEffect(useCallback(() => () => {
    if (viewRef.current === 'on' || viewRef.current === 'failed') setView(null);
  }, [setView]));

  return { view, viewRef, busy, busyRef, identity, setView, remindMe, notNow, openSettings, recheck };
}

/**
 * The ask under a Family Squares seat she has just saved (Today's call card
 * and Support). It appears when her seat goes from not saved to saved while
 * the panel is on screen, never for a seat that was already saved.
 */
export function useSeatReminderAsk(
  accountId: string | null,
  rsvp: 'going' | 'declined' | 'none',
  enabled: boolean,
): ReminderAsk {
  const core = useReminderAskCore(accountId, 'seatDismissedAt');
  const { view, viewRef, setView, recheck } = core;
  const previous = useRef(rsvp);
  const panel = useRef({}).current;

  const decide = useCallback<Decide>((permission, memory, now) => (
    memory ? seatReminderAsk({ supported: REMINDERS_SUPPORTED, justSaved: true, permission, memory, now }) : null
  ), []);

  useEffect(() => {
    const was = previous.current;
    previous.current = rsvp;
    if (rsvp !== 'going') {
      setView(null);
      return undefined;
    }
    if (!enabled || !accountId || was === 'going') return undefined;
    let active = true;
    void Promise.all([readReminderPermission(), loadReminderAskMemory(accountId)]).then(([permission, memory]) => {
      if (active && viewRef.current === null) setView(decide(permission, memory, new Date()));
    });
    return () => { active = false; };
  }, [rsvp, enabled, accountId, decide, setView, viewRef]);

  const showing = view === 'ask' || view === 'settings';
  useEffect(() => { setSeatReminderAskShowing(panel, showing); }, [panel, showing]);
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
 * welcome-back card is showing.
 */
export function useTodayReminderAsk(
  accountId: string | null,
  joinedAt: string | null | undefined,
  holdBack: boolean,
): ReminderAsk {
  const core = useReminderAskCore(accountId, 'todayDismissedAt');
  const { view, viewRef, busyRef, identity, setView, recheck } = core;

  const decide = useCallback<Decide>((permission, memory, now) => (memory ? todayReminderAsk({
    supported: REMINDERS_SUPPORTED,
    permission,
    memory,
    joinedAt,
    now,
    seatAskShowing: isSeatReminderAskShowing(),
    welcomeBackShowing: holdBack,
  }) : null), [joinedAt, holdBack]);

  const evaluate = useCallback(async (): Promise<void> => {
    if (!accountId || !REMINDERS_SUPPORTED || busyRef.current) return;
    const current = viewRef.current;
    // How her tap went stays until she leaves the screen.
    if (current === 'on' || current === 'failed') return;
    // Back from device Settings with notifications allowed: finish the job.
    if (current === 'settings') {
      await recheck(decide);
      if (viewRef.current !== 'settings') return;
    }
    const [permission, memory] = await Promise.all([readReminderPermission(), loadReminderAskMemory(accountId)]);
    if (identity.current !== accountId || busyRef.current || viewRef.current === 'on' || viewRef.current === 'failed') return;
    const now = new Date();
    const kind = decide(permission, memory, now);
    setView(kind);
    if (kind && memory && startsTodayShowing(memory, now)) {
      await rememberReminderAsk(accountId, { todayShownAt: now.toISOString() });
    }
  }, [accountId, busyRef, decide, identity, recheck, setView, viewRef]);

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
