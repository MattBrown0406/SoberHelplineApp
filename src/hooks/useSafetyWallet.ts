import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureAppError } from '../lib/monitoring';
import {
  DEFAULT_FAMILY_COMMAND, DEFAULT_SAFETY_BOUNDARY, DEFAULT_SAFETY_PLAN,
  SAFETY_STORAGE_SUFFIXES, parseStoredIncidents, parseStoredRecord, safetyStorageKey,
  type FamilyCommandPlan, type SafetyBoundary, type SafetyIncident, type SafetyPlan,
} from '../lib/safetyWallet';

type Wallet = { plan: SafetyPlan; incidents: SafetyIncident[]; boundary: SafetyBoundary; command: FamilyCommandPlan };
const defaults = (): Wallet => ({ plan: { ...DEFAULT_SAFETY_PLAN }, incidents: [], boundary: { ...DEFAULT_SAFETY_BOUNDARY }, command: { ...DEFAULT_FAMILY_COMMAND } });
type Store = { value: Wallet; hydrated: boolean; error: Error | null; generation: number; listeners: Set<() => void>; loading?: Promise<void> };
const stores = new Map<string, Store>();
let storageQueue: Promise<unknown> = Promise.resolve();
function queueStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.catch(() => undefined).then(operation);
  storageQueue = result;
  return result;
}
function storeFor(id: string): Store {
  let store = stores.get(id);
  if (!store) { store = { value: defaults(), hydrated: false, error: null, generation: 0, listeners: new Set() }; stores.set(id, store); }
  return store;
}
function notify(store: Store) { store.listeners.forEach((listener) => listener()); }
function fail(store: Store, error: unknown) {
  store.error = error instanceof Error ? error : new Error('safety_wallet_storage_failed');
  store.hydrated = false;
  captureAppError(error);
  notify(store);
}
// Invalid records are not empty records: block all writes rather than silently
// discard fields/incident rows and overwrite the only stored copy.
function decode(raw: string | null, suffix: keyof Wallet): Wallet[keyof Wallet] {
  if (raw === null) return defaults()[suffix];
  const parsed: unknown = JSON.parse(raw);
  if (suffix === 'incidents') {
    if (!Array.isArray(parsed) || parseStoredIncidents(raw).length !== parsed.length) throw new Error('invalid_wallet_incidents');
    return parsed as SafetyIncident[];
  }
  const fallback = defaults()[suffix];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_wallet_record');
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in fallback) || typeof value !== 'string') throw new Error('unsupported_wallet_field');
  }
  return parseStoredRecord(raw, fallback);
}
function hydrate(id: string, store: Store): Promise<void> {
  if (store.loading) return store.loading;
  const generation = ++store.generation;
  store.hydrated = false; store.error = null; notify(store);
  const loading = queueStorage(async () => {
    try {
      const raw = await Promise.all(SAFETY_STORAGE_SUFFIXES.map((suffix) => AsyncStorage.getItem(safetyStorageKey(id, suffix))));
      const value = Object.fromEntries(SAFETY_STORAGE_SUFFIXES.map((suffix, i) => [suffix, decode(raw[i], suffix)])) as Wallet;
      if (generation !== store.generation) return;
      store.value = value; store.hydrated = true;
    } catch (error) { if (generation === store.generation) fail(store, error); }
    finally { if (generation === store.generation) { store.loading = undefined; notify(store); } }
  });
  store.loading = loading;
  return loading;
}

export function useSafetyWallet(accountId: string | null, canPersistCommand = false) {
  const [, redraw] = useState(0);
  const owner = useRef({ accountId, active: true });
  if (owner.current.accountId !== accountId) owner.current = { accountId, active: true };
  const store = accountId ? storeFor(accountId) : null;
  const currentStore = useRef(store);
  currentStore.current = store;
  useEffect(() => {
    owner.current.active = true;
    if (!accountId || !store) return;
    const listener = () => redraw((v) => v + 1);
    store.listeners.add(listener);
    if (!store.hydrated && !store.error) void hydrate(accountId, store);
    return () => {
      store.listeners.delete(listener);
      owner.current = { accountId: owner.current.accountId, active: false };
      // Drop sensitive memory after the last screen leaves; queued writes retain
      // their own store and complete before a future instance's disk read.
      if (!store.listeners.size && stores.get(accountId) === store) stores.delete(accountId);
    };
  }, [accountId, store]);
  const update = useCallback(<K extends keyof Wallet>(key: K, action: SetStateAction<Wallet[K]>) => {
    if (!accountId || !store || currentStore.current !== store || owner.current.accountId !== accountId || !owner.current.active || !store.hydrated || store.error) return;
    if (key === 'command' && !canPersistCommand) return;
    const next = typeof action === 'function' ? (action as (v: Wallet[K]) => Wallet[K])(store.value[key]) : action;
    if (JSON.stringify(next) === JSON.stringify(store.value[key])) return;
    store.value = { ...store.value, [key]: next }; notify(store);
    const generation = store.generation;
    const serialized = JSON.stringify(next);
    void queueStorage(async () => {
      if (generation !== store.generation || store.error) return;
      try { await AsyncStorage.setItem(safetyStorageKey(accountId, key), serialized); }
      catch (error) { fail(store, error); }
    });
  }, [accountId, store, canPersistCommand]);
  const setPlan = useCallback((v: SetStateAction<SafetyPlan>) => update('plan', v), [update]);
  const setIncidents = useCallback((v: SetStateAction<SafetyIncident[]>) => update('incidents', v), [update]);
  const setBoundary = useCallback((v: SetStateAction<SafetyBoundary>) => update('boundary', v), [update]);
  const setCommand = useCallback((v: SetStateAction<FamilyCommandPlan>) => update('command', v), [update]);
  const addIncident = useCallback((v: SafetyIncident) => setIncidents((current) => [v, ...current].slice(0, 25)), [setIncidents]);
  const reload = useCallback(() => { if (accountId && store && currentStore.current === store && owner.current.accountId === accountId && owner.current.active) void hydrate(accountId, store); }, [accountId, store]);
  const clear = useCallback(async () => {
    if (!accountId || !store || currentStore.current !== store || owner.current.accountId !== accountId || !owner.current.active) return;
    ++store.generation; store.hydrated = false; notify(store);
    await queueStorage(async () => {
      try {
        await Promise.all(SAFETY_STORAGE_SUFFIXES.map((suffix) => AsyncStorage.removeItem(safetyStorageKey(accountId, suffix))));
        store.value = defaults(); store.error = null; store.hydrated = true; store.loading = undefined; notify(store);
      } catch (error) { fail(store, error); throw error; }
    });
  }, [accountId, store]);
  const hydrated = !!store?.hydrated;
  return { ...(hydrated ? store.value : defaults()), setPlan, setIncidents, setBoundary, setCommand, addIncident, hydrated, loadError: store?.error ?? null, reload, clear };
}
