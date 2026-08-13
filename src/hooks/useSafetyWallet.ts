import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureAppError } from '../lib/monitoring';
import {
  DEFAULT_FAMILY_COMMAND,
  DEFAULT_SAFETY_BOUNDARY,
  DEFAULT_SAFETY_PLAN,
  SAFETY_STORAGE_SUFFIXES,
  parseStoredIncidents,
  parseStoredRecord,
  safetyStorageKey,
  type FamilyCommandPlan,
  type SafetyBoundary,
  type SafetyIncident,
  type SafetyPlan,
} from '../lib/safetyWallet';

export function useSafetyWallet(accountId: string | null, canPersistCommand = false) {
  const [plan, setPlan] = useState<SafetyPlan>(DEFAULT_SAFETY_PLAN);
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [boundary, setBoundary] = useState<SafetyBoundary>(DEFAULT_SAFETY_BOUNDARY);
  const [command, setCommand] = useState<FamilyCommandPlan>(DEFAULT_FAMILY_COMMAND);
  const [hydratedAccountId, setHydratedAccountId] = useState<string | null>(null);

  useEffect(() => {
    setHydratedAccountId(null);
    if (!accountId) {
      setPlan(DEFAULT_SAFETY_PLAN);
      setIncidents([]);
      setBoundary(DEFAULT_SAFETY_BOUNDARY);
      setCommand(DEFAULT_FAMILY_COMMAND);
      return;
    }

    const currentAccountId = accountId;
    let cancelled = false;
    async function load() {
      try {
        const [planRaw, incidentsRaw, boundaryRaw, commandRaw] = await Promise.all([
          AsyncStorage.getItem(safetyStorageKey(currentAccountId, 'plan')),
          AsyncStorage.getItem(safetyStorageKey(currentAccountId, 'incidents')),
          AsyncStorage.getItem(safetyStorageKey(currentAccountId, 'boundary')),
          AsyncStorage.getItem(safetyStorageKey(currentAccountId, 'command')),
        ]);
        if (cancelled) return;
        setPlan(parseStoredRecord(planRaw, DEFAULT_SAFETY_PLAN));
        setIncidents(parseStoredIncidents(incidentsRaw));
        setBoundary(parseStoredRecord(boundaryRaw, DEFAULT_SAFETY_BOUNDARY));
        setCommand(parseStoredRecord(commandRaw, DEFAULT_FAMILY_COMMAND));
      } catch (error) {
        captureAppError(error);
        if (cancelled) return;
        setPlan(DEFAULT_SAFETY_PLAN);
        setIncidents([]);
        setBoundary(DEFAULT_SAFETY_BOUNDARY);
        setCommand(DEFAULT_FAMILY_COMMAND);
      }
      if (!cancelled) setHydratedAccountId(currentAccountId);
    }
    void load();
    return () => { cancelled = true; };
  }, [accountId]);

  useEffect(() => {
    if (!accountId || hydratedAccountId !== accountId) return;
    void AsyncStorage.setItem(safetyStorageKey(accountId, 'plan'), JSON.stringify(plan)).catch(captureAppError);
  }, [accountId, hydratedAccountId, plan]);

  useEffect(() => {
    if (!accountId || hydratedAccountId !== accountId) return;
    void AsyncStorage.setItem(safetyStorageKey(accountId, 'incidents'), JSON.stringify(incidents)).catch(captureAppError);
  }, [accountId, hydratedAccountId, incidents]);

  useEffect(() => {
    if (!accountId || hydratedAccountId !== accountId) return;
    void AsyncStorage.setItem(safetyStorageKey(accountId, 'boundary'), JSON.stringify(boundary)).catch(captureAppError);
  }, [accountId, boundary, hydratedAccountId]);

  useEffect(() => {
    if (!accountId || !canPersistCommand || hydratedAccountId !== accountId) return;
    void AsyncStorage.setItem(safetyStorageKey(accountId, 'command'), JSON.stringify(command)).catch(captureAppError);
  }, [accountId, canPersistCommand, command, hydratedAccountId]);

  const addIncident = useCallback((incident: SafetyIncident) => {
    setIncidents((current) => [incident, ...current].slice(0, 25));
  }, []);

  const clear = useCallback(async () => {
    if (!accountId) return;
    await Promise.all(
      SAFETY_STORAGE_SUFFIXES.map((suffix) => AsyncStorage.removeItem(safetyStorageKey(accountId, suffix))),
    );
    setPlan(DEFAULT_SAFETY_PLAN);
    setIncidents([]);
    setBoundary(DEFAULT_SAFETY_BOUNDARY);
    setCommand(DEFAULT_FAMILY_COMMAND);
  }, [accountId]);

  return {
    plan,
    setPlan,
    incidents,
    setIncidents,
    addIncident,
    boundary,
    setBoundary,
    command,
    setCommand,
    hydrated: !!accountId && hydratedAccountId === accountId,
    clear,
  };
}
