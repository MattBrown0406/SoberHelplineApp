import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  engineForecastInput,
  engineStage,
  localClock,
  type EngineSnapshot,
  type EngineStage,
} from '../lib/invitationEngine';
import { scoreReceptivity, type Forecast, type QuickCheck } from '../lib/invitationForecast';
import { selectDailyMoves, type InvitationMove } from '../lib/invitationMoves';
import {
  fetchEngineSnapshot,
  recordForecast,
  setMoveDone,
  setQuickCheck,
  setWindowPush,
} from '../lib/invitationApi';
import { captureAppError } from '../lib/monitoring';
import { useFeatureAccess } from './useFeatureAccess';

const CLOCK_TICK_MS = 5 * 60 * 1000;

/**
 * Forecasts already sent this app session, per account and day (best rank).
 * Shared by every screen using the engine, so Today, the engine screen and
 * the 5-minute clock tick never re-send what the server already has.
 */
const sentForecastRank = new Map<string, number>();

export function forecastRank(forecast: { level: string; score: number }): number {
  const base = forecast.level === 'good' ? 3000 : forecast.level === 'possible' ? 2000 : 1000;
  return base + forecast.score;
}

export type InvitationEngineController = ReturnType<typeof useInvitationEngine>;

/**
 * The engine's live state for one member: the server snapshot, today's two
 * moves (family plan), the receptivity forecast (recomputed as the local
 * clock moves), and the one-tap actions. Reloads whenever the screen regains
 * focus so Today reflects work done inside the engine.
 */
export function useInvitationEngine(accountId: string | null, timezone?: string | null) {
  const [record, setRecord] = useState<{ accountId: string | null; value: EngineSnapshot | null }>({
    accountId: null,
    value: null,
  });
  const [loading, setLoading] = useState(accountId !== null);
  const [loadError, setLoadError] = useState(false);
  const [busyMove, setBusyMove] = useState<string | null>(null);
  const [checkSaving, setCheckSaving] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const [actionError, setActionError] = useState<'move' | 'check' | 'push' | null>(null);
  const [now, setNow] = useState(() => new Date());
  const request = useRef(0);
  const hasAccess = useFeatureAccess('invitationEngine');
  const clock = localClock(now, timezone);
  const localDate = clock.date;
  // Bind callbacks to one account/day lifetime, including the render before
  // effects run. Late responses and retained buttons cannot mutate its successor.
  const scopeRef = useRef({ accountId, localDate });
  if (scopeRef.current.accountId !== accountId || scopeRef.current.localDate !== localDate) {
    scopeRef.current = { accountId, localDate };
  }
  const scope = scopeRef.current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const isCurrent = useCallback(() => mounted.current && scopeRef.current === scope
    && localClock(new Date(), timezone).date === localDate, [scope, localDate, timezone]);
  useEffect(() => {
    setBusyMove(null);
    setCheckSaving(false);
    setPushSaving(false);
    setActionError(null);
  }, [scope]);

  const load = useCallback(async () => {
    if (!mounted.current || scopeRef.current !== scope) return;
    setNow(new Date());
    const id = ++request.current;
    if (!accountId) {
      setRecord({ accountId: null, value: null });
      setLoading(false);
      setLoadError(false);
      return;
    }
    setLoading(true);
    try {
      const snapshot = await fetchEngineSnapshot(localClock(new Date(), timezone).date);
      if (id !== request.current || scopeRef.current !== scope || !mounted.current) return;
      setRecord({ accountId, value: snapshot });
      setLoadError(false);
      setNow(new Date());
    } catch (error) {
      captureAppError(error);
      if (id === request.current && scopeRef.current === scope && mounted.current) {
        // Keep the last good snapshot for this account; settle "loading" either way.
        setRecord((current) => (current.accountId === accountId ? current : { accountId, value: null }));
        setLoadError(true);
      }
    } finally {
      if (id === request.current && scopeRef.current === scope && mounted.current) setLoading(false);
    }
  }, [accountId, timezone, localDate, scope]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]));

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const snapshot = record.accountId === accountId && record.value?.localDate === localDate ? record.value : null;
  const stage: EngineStage | null = snapshot ? engineStage(snapshot, hasAccess) : null;

  const moves = useMemo<[InvitationMove, InvitationMove] | null>(() => (
    snapshot
      ? selectDailyMoves({ seed: snapshot.plan.seed, localDate: snapshot.localDate, signals: snapshot.plan.signals })
      : null
  ), [snapshot]);

  const forecast = useMemo<Forecast | null>(() => (
    snapshot ? scoreReceptivity(engineForecastInput(snapshot, localClock(now, timezone), now.getTime())) : null
  ), [snapshot, now, timezone]);

  // The server keeps each day's best window. Record only when this forecast
  // beats what is already recorded for today (or sent this session).
  useEffect(() => {
    if (!isCurrent() || !accountId || !snapshot || !forecast || stage !== 'active' || forecast.paused) return;
    const key = `${accountId}:${snapshot.localDate}`;
    const rank = forecastRank(forecast);
    const best = Math.max(
      snapshot.today.forecast ? forecastRank(snapshot.today.forecast) : 0,
      sentForecastRank.get(key) ?? 0,
    );
    if (rank <= best) return;
    sentForecastRank.set(key, rank);
    recordForecast(snapshot.localDate, forecast).catch((error) => {
      if (sentForecastRank.get(key) === rank) sentForecastRank.delete(key);
      captureAppError(error);
    });
  }, [accountId, snapshot, forecast, stage, isCurrent]);

  const patch = useCallback((update: (value: EngineSnapshot) => EngineSnapshot) => {
    setRecord((current) => (
      isCurrent() && current.accountId === accountId && current.value?.localDate === localDate ? { accountId, value: update(current.value) } : current
    ));
  }, [accountId, localDate, isCurrent]);

  const toggleMove = useCallback(async (moveId: string): Promise<boolean> => {
    if (!isCurrent() || !snapshot || busyMove) return false;
    const wasDone = snapshot.today.movesDone.includes(moveId);
    const before = snapshot.today.movesDone;
    const withDone = (value: EngineSnapshot, done: string[]): EngineSnapshot => {
      const hadAny = value.today.movesDone.length > 0;
      const hasAny = done.length > 0;
      const delta = hadAny === hasAny ? 0 : hasAny ? 1 : -1;
      return {
        ...value,
        today: { ...value.today, movesDone: done },
        inputs: { ...value.inputs, moveDaysLast7: Math.max(0, Math.min(7, value.inputs.moveDaysLast7 + delta)) },
      };
    };
    setBusyMove(moveId);
    setActionError(null);
    patch((value) => withDone(value, wasDone ? before.filter((id) => id !== moveId) : [...before, moveId]));
    try {
      const done = await setMoveDone(moveId, snapshot.localDate, !wasDone);
      if (!isCurrent()) return false;
      patch((value) => withDone(value, done));
      return true;
    } catch (error) {
      captureAppError(error);
      patch((value) => withDone(value, before));
      if (isCurrent()) setActionError('move');
      return false;
    } finally {
      if (isCurrent()) setBusyMove(null);
    }
  }, [busyMove, patch, snapshot, isCurrent]);

  const setCheck = useCallback(async (mood: QuickCheck | null): Promise<boolean> => {
    if (!isCurrent() || !snapshot || checkSaving) return false;
    const before = snapshot.today.check;
    setCheckSaving(true);
    setActionError(null);
    patch((value) => ({ ...value, today: { ...value.today, check: mood } }));
    try {
      const saved = await setQuickCheck(snapshot.localDate, mood);
      if (!isCurrent()) return false;
      patch((value) => ({ ...value, today: { ...value.today, check: saved } }));
      return true;
    } catch (error) {
      captureAppError(error);
      patch((value) => ({ ...value, today: { ...value.today, check: before } }));
      if (isCurrent()) setActionError('check');
      return false;
    } finally {
      if (isCurrent()) setCheckSaving(false);
    }
  }, [checkSaving, patch, snapshot, isCurrent]);

  const setWindowPushEnabled = useCallback(async (enabled: boolean): Promise<boolean> => {
    if (!isCurrent() || !snapshot || pushSaving) return false;
    setPushSaving(true);
    setActionError(null);
    try {
      const saved = await setWindowPush(enabled);
      if (!isCurrent()) return false;
      patch((value) => ({ ...value, state: { ...value.state, windowPushOptIn: saved } }));
      return true;
    } catch (error) {
      captureAppError(error);
      if (isCurrent()) setActionError('push');
      return false;
    } finally {
      if (isCurrent()) setPushSaving(false);
    }
  }, [patch, pushSaving, snapshot, isCurrent]);

  return {
    snapshot,
    hasAccess,
    loading: loading || record.accountId !== accountId,
    loadError,
    stage,
    moves,
    forecast,
    clock,
    busyMove,
    checkSaving,
    pushSaving,
    actionError,
    reload: load,
    toggleMove,
    setCheck,
    setWindowPushEnabled,
  };
}
