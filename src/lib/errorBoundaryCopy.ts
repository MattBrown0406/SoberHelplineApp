import enCommon from '../locales/en/common.json';
import esCommon from '../locales/es/common.json';

export type ErrorBoundaryCopy = { title: string; body: string; retry: string };

/**
 * The root error boundary may render before i18n has initialised or after it
 * has broken, so its copy is read straight from the bundled locale files.
 * 988 and 911 stay as numbers in both languages.
 */
export function errorBoundaryCopy(language: string | null | undefined): ErrorBoundaryCopy {
  return (language ?? '').toLowerCase().startsWith('es') ? esCommon.errorBoundary : enCommon.errorBoundary;
}
