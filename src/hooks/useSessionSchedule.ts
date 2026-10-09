import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LA_SOBREMESA_CALL_LENGTH_MS,
  formatNextCallTime,
  isFamilySquaresSession,
  isLaSobremesaSession,
} from '../lib/familySquaresSchedule';

type ScheduledSession = { title: string; schedule_label: string | null; next_at: string | null };

/**
 * When a session meets, as shown to the member. The Family Squares shows its
 * real next start (sessions.next_at) in the device's time zone, falling back
 * to "Mondays · 7:00 PM Pacific"; La Sobremesa (Spanish) the same at 8:00 PM;
 * other sessions keep their schedule label.
 */
export function useSessionSchedule() {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return useCallback((session: ScheduledSession): string => {
    if (isLaSobremesaSession(session)) {
      return formatNextCallTime(session.next_at, { locale, lengthMs: LA_SOBREMESA_CALL_LENGTH_MS })
        ?? t('laSobremesa.scheduleFallback');
    }
    if (!isFamilySquaresSession(session)) return session.schedule_label ?? '';
    return formatNextCallTime(session.next_at, { locale }) ?? t('familySquares.scheduleFallback');
  }, [locale, t]);
}
