import { useCallback } from 'react';
import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { siteUrlFor } from '../lib/websiteLinks';

/**
 * Opens a soberhelpline.com page (or, in Spanish, its ayudasobria.com equivalent)
 * signed in as the current member.
 *
 * `Linking.openURL` hands the URL to the system browser (Safari on iOS), not an
 * in-app web view: PayPal checkout and the website's own session cookies work
 * there. The app only opens non-`/app` paths, so this never loops back into the
 * app through a universal link.
 *
 * Resolves true when the browser opened. It never rejects, so callers can
 * `void` it from a press handler; a token failure falls back to the plain page
 * (the website then offers its own sign-in).
 */
export function useWebSSO() {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const openWithSSO = useCallback(
    async (accountId: string | null | undefined, next: string): Promise<boolean> => {
      const directUrl = siteUrlFor(next, language);
      const open = async (url: string) => {
        try {
          await Linking.openURL(url);
          return true;
        } catch {
          return false;
        }
      };
      if (!accountId) return open(directUrl);

      try {
        const { data: tokenId, error } = await supabase.rpc('create_web_sso_token');
        if (error || typeof tokenId !== 'string' || !tokenId) {
          console.error('[useWebSSO] token create failed');
          return open(directUrl);
        }
        // Pass the token directly to the destination — no redirect chain.
        return open(siteUrlFor(next, language, tokenId));
      } catch {
        console.error('[useWebSSO] unexpected error, falling back');
        return open(directUrl);
      }
    },
    [language],
  );

  return { openWithSSO };
}
