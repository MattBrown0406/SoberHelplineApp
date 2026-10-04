import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNextCallTime, isFamilySquaresSession } from '../lib/familySquaresSchedule';

type ScheduledSession = { title: string; schedule_label: string | null; next_at: string | null };

/**
 * When a session meets, as shown to the member. The Family Squares shows its
 * real next start (sessions.next_at) in the device's time zone, falling back
 * to "Mondays · 7:00 PM Pacific"; other sessions keep their schedule label.
 */
export function useSessionSchedule() {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return useCallback((session: ScheduledSession): string => {
    if (!isFamilySquaresSession(session)) return session.schedule_label ?? '';
    return formatNextCallTime(session.next_at, { locale }) ?? t('familySquares.scheduleFallback');
  }, [locale, t]);
}
