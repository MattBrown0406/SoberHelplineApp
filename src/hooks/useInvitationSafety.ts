import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { fetchOwnSafetyConcern } from '../lib/invitationApi';
import { safetyGateFrom, type SafetyGate } from '../lib/invitationSafetyGate';
import { captureAppError } from '../lib/monitoring';

type State = { accountId: string | null; status: 'loading' | 'ready' | 'error'; safetyConcern: string | null };

/**
 * The member's own safety answer for willingness-window content, refetched
 * every time the screen gains focus (so a change made in setup applies when
 * she comes back). Fails closed: while revalidating a non-serious answer the
 * gate reads 'loading', and a failed read is 'unknown' — neither may show the
 * "say this / leave now" invitation.
 */
export function useInvitationSafety(accountId: string | null): { gate: SafetyGate; reload: () => Promise<void> } {
  const [state, setState] = useState<State>({ accountId: null, status: 'loading', safetyConcern: null });
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    if (!accountId) {
      setState({ accountId: null, status: 'loading', safetyConcern: null });
      return;
    }
    // A known 'serious' answer stays up while revalidating; anything else hides.
    setState((current) => (
      current.accountId === accountId && current.status === 'ready' && current.safetyConcern === 'serious'
        ? current
        : { accountId, status: 'loading', safetyConcern: null }
    ));
    try {
      const safetyConcern = await fetchOwnSafetyConcern(accountId);
      if (id === request.current) setState({ accountId, status: 'ready', safetyConcern });
    } catch (error) {
      captureAppError(error);
      if (id === request.current) setState({ accountId, status: 'error', safetyConcern: null });
    }
  }, [accountId]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]));

  return { gate: state.accountId === accountId ? safetyGateFrom(state) : 'loading', reload: load };
}
