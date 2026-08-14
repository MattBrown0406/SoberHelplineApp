import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  consequenceOccurredAt,
  parseConsequenceEvent,
  type ConsequenceEvent,
  type ConsequenceEventType,
  type ConsequenceTiming,
} from '../lib/willingnessWindow';

export function useWillingnessWindow(accountId: string | null) {
  const [latestEvent, setLatestEvent] = useState<ConsequenceEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [operationError, setOperationError] = useState(false);
  const [loadedAccountId, setLoadedAccountId] = useState<string | null>(null);
  const generation = useRef(0);
  const currentAccountId = useRef(accountId);
  currentAccountId.current = accountId;

  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!accountId) {
      setLatestEvent(null);
      setLoadedAccountId(null);
      setLoading(false);
      setLoadError(false);
      setOperationError(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('consequence_events')
      .select('id,event_type,occurred_at')
      .eq('account_id', accountId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (request !== generation.current) return;
    setLatestEvent(error ? null : parseConsequenceEvent(data));
    setLoadedAccountId(accountId);
    setLoadError(!!error);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    setSaving(false);
    void load();
    return () => { ++generation.current; };
  }, [load]);

  const logEvent = useCallback(async (
    eventType: ConsequenceEventType,
    timing: ConsequenceTiming,
  ) => {
    if (!accountId || saving) return false;
    const requestAccountId = accountId;
    setSaving(true);
    setOperationError(false);
    const occurredAt = consequenceOccurredAt(timing);
    const { data, error } = await supabase.rpc('log_consequence_event', {
      p_event_type: eventType,
      p_occurred_at: occurredAt,
    });
    const row = Array.isArray(data) ? data[0] : data;
    const parsed = parseConsequenceEvent(row);
    if (currentAccountId.current !== requestAccountId) return false;
    if (error || !parsed) {
      setOperationError(true);
      setSaving(false);
      return false;
    }
    setLatestEvent(parsed);
    setSaving(false);
    return true;
  }, [accountId, saving]);

  const removeLatestEvent = useCallback(async () => {
    if (!accountId || !latestEvent || saving) return false;
    const requestAccountId = accountId;
    setSaving(true);
    setOperationError(false);
    const { error } = await supabase
      .from('consequence_events')
      .delete()
      .eq('account_id', accountId)
      .eq('id', latestEvent.id);
    if (currentAccountId.current !== requestAccountId) return false;
    if (error) {
      setOperationError(true);
      setSaving(false);
      return false;
    }
    setSaving(false);
    await load();
    return true;
  }, [accountId, latestEvent, load, saving]);

  return {
    latestEvent: loadedAccountId === accountId ? latestEvent : null,
    loading: loading || loadedAccountId !== accountId,
    saving,
    loadError,
    operationError,
    retry: load,
    logEvent,
    removeLatestEvent,
  };
}
