import { useCallback } from 'react';
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
