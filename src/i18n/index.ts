import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import enCommon from '../locales/en/common.json';
import enToday from '../locales/en/today.json';
import enScripts from '../locales/en/scripts.json';
import esCommon from '../locales/es/common.json';
import esToday from '../locales/es/today.json';
import esScripts from '../locales/es/scripts.json';

export type SupportedLanguage = 'en' | 'es';

export const SUPPORTED_LANGUAGES: Array<{
  code: SupportedLanguage;
  nativeLabel: string;
}> = [
  { code: 'en', nativeLabel: 'English' },
  { code: 'es', nativeLabel: 'Español' },
];

const LANGUAGE_KEY = '@sh:language';

export async function initI18n(): Promise<void> {
  if (i18n.isInitialized) return;

  const stored = await getStoredLanguage();
  const deviceCode = Localization.getLocales()[0]?.languageCode ?? 'en';
  const lng: SupportedLanguage =
    stored ?? (deviceCode.startsWith('es') ? 'es' : 'en');

  await i18n.use(initReactI18next).init({
    resources: {
      en: { common: enCommon, today: enToday, scripts: enScripts },
      es: { common: esCommon, today: esToday, scripts: esScripts },
    },
    lng,
    fallbackLng: 'en',
    ns: ['common', 'today', 'scripts'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  });
}

export async function getStoredLanguage(): Promise<SupportedLanguage | null> {
  try {
    const val = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (val === 'en' || val === 'es') return val;
    return null;
  } catch {
    return null;
  }
}

export async function setLanguage(lang: SupportedLanguage): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_KEY, lang);
  await i18n.changeLanguage(lang);
}

export default i18n;
