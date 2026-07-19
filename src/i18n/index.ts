import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

import enCommon from '../locales/en/common.json';
import enToday from '../locales/en/today.json';
import enScripts from '../locales/en/scripts.json';
import enBoundaries from '../locales/en/boundaries.json';
import enAuth from '../locales/en/auth.json';
import enTracker from '../locales/en/tracker.json';
import enSupport from '../locales/en/support.json';
import enSettings from '../locales/en/settings.json';
import enAlignment from '../locales/en/alignment.json';
import enLetter from '../locales/en/letter.json';
import enRehearsal from '../locales/en/rehearsal.json';
import enRehearsalLive from '../locales/en/rehearsalLive.json';
import enOnboarding from '../locales/en/onboarding.json';
import enLive from '../locales/en/live.json';
import enLearn from '../locales/en/learn.json';
import enFinder from '../locales/en/finder.json';
import enCrisis from '../locales/en/crisis.json';
import esCommon from '../locales/es/common.json';
import esToday from '../locales/es/today.json';
import esScripts from '../locales/es/scripts.json';
import esBoundaries from '../locales/es/boundaries.json';
import esAuth from '../locales/es/auth.json';
import esTracker from '../locales/es/tracker.json';
import esSupport from '../locales/es/support.json';
import esSettings from '../locales/es/settings.json';
import esAlignment from '../locales/es/alignment.json';
import esLetter from '../locales/es/letter.json';
import esRehearsal from '../locales/es/rehearsal.json';
import esRehearsalLive from '../locales/es/rehearsalLive.json';
import esOnboarding from '../locales/es/onboarding.json';
import esLive from '../locales/es/live.json';
import esLearn from '../locales/es/learn.json';
import esFinder from '../locales/es/finder.json';
import esCrisis from '../locales/es/crisis.json';

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
      en: { common: enCommon, today: enToday, scripts: enScripts, boundaries: enBoundaries, auth: enAuth, tracker: enTracker, support: enSupport, settings: enSettings, alignment: enAlignment, letter: enLetter, rehearsal: enRehearsal, rehearsalLive: enRehearsalLive, onboarding: enOnboarding, live: enLive, learn: enLearn, finder: enFinder, crisis: enCrisis },
      es: { common: esCommon, today: esToday, scripts: esScripts, boundaries: esBoundaries, auth: esAuth, tracker: esTracker, support: esSupport, settings: esSettings, alignment: esAlignment, letter: esLetter, rehearsal: esRehearsal, rehearsalLive: esRehearsalLive, onboarding: esOnboarding, live: esLive, learn: esLearn, finder: esFinder, crisis: esCrisis },
    },
    lng,
    fallbackLng: 'en',
    ns: ['common', 'today', 'scripts', 'boundaries', 'auth', 'tracker', 'support', 'settings', 'alignment', 'letter', 'rehearsal', 'rehearsalLive', 'onboarding', 'live', 'learn'],
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
