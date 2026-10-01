import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { addAppBreadcrumb, captureAppError } from '../lib/monitoring';
import {
  emitOutboxReplay,
  offlineOutbox,
  type OutboxHandlers,
  type OutboxReplayResult,
} from '../lib/offlineOutbox';

/** Replays one account's queued writes within a single auth/owner lifetime. */
export async function replayOfflineOutbox(
  accountId: string,
  isCurrent: () => boolean = () => true,
): Promise<OutboxReplayResult> {
  let invalidated = false;
  let expectedAuthId: string | undefined;
  let observedAuthId: string | undefined;
  // Subscribe BEFORE any await. Sticky invalidation catches A -> B -> A,
  // whereas comparing only the session returned by getSession cannot.
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const id = session?.user.id;
    if (event === 'SIGNED_OUT'
      || (expectedAuthId !== undefined && id !== expectedAuthId)
      || (observedAuthId !== undefined && id !== observedAuthId)) invalidated = true;
    observedAuthId = id;
  });
  const active = () => !invalidated && isCurrent();
  const pending = async (): Promise<OutboxReplayResult> => ({
    synced: [], dropped: [], remaining: await offlineOutbox.list(accountId),
  });
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    expectedAuthId = session?.user.id;
    if (error || !session || !active()
      || (observedAuthId !== undefined && observedAuthId !== expectedAuthId)
      || (session.expires_at != null && session.expires_at * 1000 <= Date.now())) return await pending();

    const currentSession = async () => {
      if (!active()) return null;
      try {
        const { data: { session: current }, error: sessionError } = await supabase.auth.getSession();
        if (current?.user.id !== expectedAuthId) invalidated = true;
        if (!active() || sessionError || !current?.access_token
          || (current.expires_at != null && current.expires_at * 1000 <= Date.now())) return null;
        return current;
      } catch {
        return null;
      }
    };

    // Account IDs are NOT Auth user IDs. Confirm their relation, rather than
    // trusting the caller's possibly stale AccountProvider snapshot. RLS is
    // still authoritative; this lookup is only a conservative replay guard.
    const { data: account, error: accountError } = await supabase.from('accounts')
      .select('id').eq('id', accountId).eq('user_id', expectedAuthId!)
      .maybeSingle().setHeader('Authorization', `Bearer ${session.access_token}`);
    if (accountError || !account || !await currentSession()) return await pending();

    const insert = async (request: (authorization: string) => PromiseLike<{ error: unknown }>) => {
      const current = await currentSession();
      if (!current || !active()) throw new Error('outbox_replay_lifetime_changed');
      // A per-request header is supported by PostgRESTBuilder. Supabase's
      // fetchWithAuth preserves it even if its asynchronous token lookup sees
      // a different account. This does NOT revoke/cancel an in-flight request.
      const { error: insertError } = await request(`Bearer ${current.access_token}`);
      if (insertError) throw insertError;
    };
    const handlers: OutboxHandlers = {
      checkin: payload => insert(authorization => supabase.from('checkins').insert(payload)
        .setHeader('Authorization', authorization)),
      journal: payload => insert(authorization => supabase.from('family_journal_entries').insert(payload)
        .setHeader('Authorization', authorization)),
    };
    const result = await offlineOutbox.replay(accountId, handlers, async () => !!await currentSession());
    // Persistence is another await boundary. Never notify a stale owner/UI.
    if (await currentSession() && active() && (result.synced.length || result.dropped.length)) {
      addAppBreadcrumb(result.dropped.length ? 'outbox.replay_dropped_items' : 'outbox.replay_synced',
        result.dropped.length ? 'warning' : 'info');
      emitOutboxReplay(accountId, result);
    }
    return result;
  } finally {
    subscription.unsubscribe();
  }
}

/** Retry on mount, foreground and same-account authentication refresh. */
export function useOfflineOutbox(accountId: string | null): void {
  const ownerRef = useRef({ accountId });
  // Render-time identity fence also invalidates work before effect cleanup,
  // including an A -> B -> A transition whose final ID looks unchanged.
  if (ownerRef.current.accountId !== accountId) ownerRef.current = { accountId };
  const owner = ownerRef.current;

  useEffect(() => {
    if (!accountId) return;
    let mounted = true;
    let inFlight: Promise<unknown> | null = null;
    const isCurrent = () => mounted && ownerRef.current === owner;
    const replay = () => {
      if (!isCurrent() || inFlight) return;
      // Auth callbacks must remain synchronous (do not await Auth's lock).
      const task = Promise.resolve().then(() => {
        if (isCurrent()) return replayOfflineOutbox(accountId, isCurrent);
      }).catch(error => { if (isCurrent()) captureAppError(error); })
        .finally(() => { if (inFlight === task) inFlight = null; });
      inFlight = task;
    };
    replay();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') replay();
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') replay();
    });
    return () => {
      mounted = false;
      appState.remove();
      subscription.unsubscribe();
    };
  }, [accountId, owner]);
}
