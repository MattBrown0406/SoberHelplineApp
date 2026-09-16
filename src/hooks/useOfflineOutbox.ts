import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { addAppBreadcrumb, captureAppError } from '../lib/monitoring';
import {
  emitOutboxReplay,
  offlineOutbox,
  type OutboxHandlers,
  type OutboxReplayResult,
} from '../lib/offlineOutbox';

const handlers: OutboxHandlers = {
  async checkin(payload) {
    const { error } = await supabase.from('checkins').insert(payload);
    if (error) throw error;
  },
  async journal(payload) {
    const { error } = await supabase.from('family_journal_entries').insert(payload);
    if (error) throw error;
  },
};

/** Replays one account's queued writes; safe to call repeatedly. */
export async function replayOfflineOutbox(accountId: string): Promise<OutboxReplayResult> {
  const result = await offlineOutbox.replay(accountId, handlers);
  if (result.synced.length || result.dropped.length) {
    addAppBreadcrumb(result.dropped.length ? 'outbox.replay_dropped_items' : 'outbox.replay_synced',
      result.dropped.length ? 'warning' : 'info');
    emitOutboxReplay(accountId, result);
  }
  return result;
}

/**
 * Mount once under AccountProvider. Mirrors the offline-account retry pattern:
 * replay when the account becomes known, whenever the app returns to the
 * foreground, and whenever the auth session refreshes (a token refresh after
 * connectivity returns is the earliest reliable "we are online again" signal).
 */
export function useOfflineOutbox(accountId: string | null): void {
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  const accountRef = useRef(accountId);
  accountRef.current = accountId;

  const replay = useCallback(() => {
    const id = accountRef.current;
    if (!id || inFlightRef.current) return;
    const task = replayOfflineOutbox(id)
      .catch(captureAppError)
      .finally(() => { if (inFlightRef.current === task) inFlightRef.current = null; });
    inFlightRef.current = task;
  }, []);

  useEffect(() => {
    if (!accountId) return;
    replay();
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') replay();
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') replay();
    });
    return () => {
      appState.remove();
      subscription.unsubscribe();
    };
  }, [accountId, replay]);
}
