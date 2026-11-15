import { useEffect, useState } from 'react';
import { knownBereavedOnDevice, loadBereavedOnDevice, subscribeBereavedOnDevice } from '../lib/bereavedDevice';

/**
 * "Her loved one died", from the device's copy (bereavedDevice): true, false,
 * or undefined while this device does not know. Follows the copy as Today
 * updates it, so marking or undoing it there reaches Support and the
 * invitations at once. Signed out, there is nobody to be bereaved: false.
 */
export function useBereavedOnDevice(accountId: string | null): boolean | undefined {
  const [state, setState] = useState<{ accountId: string | null; bereaved: boolean | undefined }>(
    () => ({ accountId, bereaved: accountId ? knownBereavedOnDevice(accountId) : false }),
  );

  useEffect(() => {
    if (!accountId) {
      setState({ accountId, bereaved: false });
      return undefined;
    }
    let active = true;
    setState({ accountId, bereaved: knownBereavedOnDevice(accountId) });
    void loadBereavedOnDevice(accountId).then((bereaved) => {
      if (active) setState({ accountId, bereaved });
    });
    const unsubscribe = subscribeBereavedOnDevice((changedAccount, bereaved) => {
      if (active && changedAccount === accountId) setState({ accountId, bereaved });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [accountId]);

  return state.accountId === accountId ? state.bereaved : undefined;
}
