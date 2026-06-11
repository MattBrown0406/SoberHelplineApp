import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';

export interface UseLanguageResult {
  current: SupportedLanguage;
  change: (lang: SupportedLanguage) => Promise<void>;
  languages: typeof SUPPORTED_LANGUAGES;
}

export function useLanguage(): UseLanguageResult {
  const { i18n } = useTranslation();
  const current: SupportedLanguage = i18n.language.startsWith('es') ? 'es' : 'en';
  const change = useCallback((lang: SupportedLanguage) => setLanguage(lang), []);
  return { current, change, languages: SUPPORTED_LANGUAGES };
}
