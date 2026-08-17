import { useCallback, useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { supabase } from '../lib/supabase';
import {
  parseFamilyOutcome,
  type FamilyOutcome,
  type FamilyOutcomeDraft,
} from '../lib/familyOutcomes';

const SELECT_COLUMNS = 'id,client_event_id,event,occurred_on,level_of_care,pathway,pathway_note,created_at,updated_at';

function rpcPayload(draft: FamilyOutcomeDraft) {
  return {
    p_event: draft.event,
    p_occurred_on: draft.occurredOn,
    p_level_of_care: draft.levelOfCare,
    p_pathway: draft.pathway,
    p_pathway_note: draft.pathwayNote.trim() || null,
  };
}

export function useFamilyOutcomes(accountId: string | null) {
  const [outcomes, setOutcomes] = useState<FamilyOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [operationError, setOperationError] = useState(false);
  const generation = useRef(0);
  const currentAccountId = useRef(accountId);
  const pendingCreate = useRef<{ fingerprint: string; clientEventId: string } | null>(null);
  currentAccountId.current = accountId;

  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!accountId) {
      setOutcomes([]);
      setLoading(false);
      setLoadError(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('family_outcomes')
      .select(SELECT_COLUMNS)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    if (request !== generation.current) return;
    setOutcomes(error ? [] : (data ?? []).map((row) => parseFamilyOutcome(row)).filter((row): row is FamilyOutcome => !!row));
    setLoadError(!!error);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    setSaving(false);
    setOperationError(false);
    pendingCreate.current = null;
    void load();
    return () => { ++generation.current; };
  }, [load]);

  const create = useCallback(async (draft: FamilyOutcomeDraft) => {
    if (!accountId || saving) return null;
    const requestAccountId = accountId;
    const payload = rpcPayload(draft);
    const fingerprint = JSON.stringify(payload);
    if (!pendingCreate.current || pendingCreate.current.fingerprint !== fingerprint) {
      pendingCreate.current = { fingerprint, clientEventId: Crypto.randomUUID() };
    }
    setSaving(true);
    setOperationError(false);
    const { data, error } = await supabase.rpc('record_family_outcome', {
      p_client_event_id: pendingCreate.current.clientEventId,
      ...payload,
    });
    if (currentAccountId.current !== requestAccountId) return null;
    const parsed = parseFamilyOutcome(data as Record<string, unknown> | null);
    setSaving(false);
    if (error || !parsed) {
      setOperationError(true);
      return null;
    }
    pendingCreate.current = null;
    await load();
    return parsed;
  }, [accountId, load, saving]);

  const update = useCallback(async (id: string, draft: FamilyOutcomeDraft) => {
    if (!accountId || saving) return null;
    const requestAccountId = accountId;
    setSaving(true);
    setOperationError(false);
    const { data, error } = await supabase.rpc('update_family_outcome', {
      p_id: id,
      ...rpcPayload(draft),
    });
    if (currentAccountId.current !== requestAccountId) return null;
    const parsed = parseFamilyOutcome(data as Record<string, unknown> | null);
    setSaving(false);
    if (error || !parsed) {
      setOperationError(true);
      return null;
    }
    await load();
    return parsed;
  }, [accountId, load, saving]);

  const remove = useCallback(async (id: string) => {
    if (!accountId || saving) return false;
    const requestAccountId = accountId;
    setSaving(true);
    setOperationError(false);
    const { data, error } = await supabase.rpc('delete_family_outcome', { p_id: id });
    if (currentAccountId.current !== requestAccountId) return false;
    setSaving(false);
    if (error || data !== true) {
      setOperationError(true);
      return false;
    }
    await load();
    return true;
  }, [accountId, load, saving]);

  return {
    outcomes,
    loading,
    saving,
    loadError,
    operationError,
    reload: load,
    create,
    update,
    remove,
  };
}
