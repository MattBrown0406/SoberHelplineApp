import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';
import { supabase } from '../lib/supabase';

// Server-sent pushes (group live, practice calls, reminders) read
// accounts.locale; keep it in step with the language the member picks.
async function syncServerLocale(lang: SupportedLanguage): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user.id) return;
  await supabase.from('accounts').update({ locale: lang }).eq('user_id', session.user.id);
}

export interface UseLanguageResult {
  current: SupportedLanguage;
  change: (lang: SupportedLanguage) => Promise<void>;
  languages: typeof SUPPORTED_LANGUAGES;
}

export function useLanguage(): UseLanguageResult {
  const { i18n } = useTranslation();
  const current: SupportedLanguage = i18n.language.startsWith('es') ? 'es' : 'en';
  const change = useCallback(async (lang: SupportedLanguage) => {
    await setLanguage(lang);
    await syncServerLocale(lang).catch(() => undefined);
  }, []);
  return { current, change, languages: SUPPORTED_LANGUAGES };
}

/**
 * Keeps accounts.locale in step with the language this device shows, once per
 * signed-in launch and on every change. The server uses it for push copy and to
 * show the Monday call in the member's language (The Family Squares in English,
 * La Sobremesa in Spanish). Best effort; a failed write is retried next launch.
 */
export function useServerLocaleSync(): void {
  const { i18n } = useTranslation();
  const lang: SupportedLanguage = i18n.language.startsWith('es') ? 'es' : 'en';
  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user.id) return;
      const { data } = await supabase.from('accounts').select('locale').eq('user_id', session.user.id).maybeSingle();
      if (data && data.locale !== lang) await syncServerLocale(lang);
    })().catch(() => undefined);
  }, [lang]);
}
