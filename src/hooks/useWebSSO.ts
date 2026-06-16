import { useCallback } from 'react';
import { Linking } from 'react-native';
import { supabase } from '../lib/supabase';

const WEBSITE_BASE = 'https://soberhelpline.com';

export function useWebSSO() {
  const openWithSSO = useCallback(
    async (accountId: string | null | undefined, next: string) => {
      const directUrl = `${WEBSITE_BASE}${next}`;
      try {
        if (!accountId) {
          await Linking.openURL(directUrl);
          return;
        }

        const { data: tokenId, error } = await supabase.rpc('create_web_sso_token');

        if (error || !tokenId) {
          console.error('[useWebSSO] token create failed:', error);
          await Linking.openURL(directUrl);
          return;
        }

        // Pass token directly to the destination — no redirect chain.
        const url = `${WEBSITE_BASE}${next}?sso_token=${tokenId as string}`;
        await Linking.openURL(url);
      } catch (err) {
        console.error('[useWebSSO] unexpected error, falling back:', err);
        await Linking.openURL(directUrl);
      }
    },
    [],
  );

  return { openWithSSO };
}
