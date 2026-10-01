/**
 * Locale keys for Invitation Engine values (namespace "invitation"), kept pure
 * so tests can prove every value the engine can produce has copy in EN and ES.
 */
import type { ForecastReason } from './invitationForecast';
import type { InvitationMove } from './invitationMoves';

export type CopyRef = { key: string; params?: Record<string, string | number> };

export function forecastReasonCopy(reason: ForecastReason): CopyRef {
  switch (reason.code) {
    case 'consequenceWindow':
      return { key: 'forecast.reasons.consequenceWindow', params: { count: reason.params?.hours ?? 1 } };
    case 'consistent':
    case 'buildingConsistency':
    case 'restingUntil':
      return { key: `forecast.reasons.${reason.code}`, params: { count: reason.params?.days ?? 0 } };
    case 'soberTimeNow':
    case 'soberTimeLater':
    case 'soberTimeOther':
      return { key: `forecast.reasons.${reason.code}.${reason.params?.period ?? 'evening'}` };
    default:
      return { key: `forecast.reasons.${reason.code}` };
  }
}

export function moveCopy(move: InvitationMove): { title: string; body: string; example: string; category: string } {
  return {
    title: `moves.${move.id}.title`,
    body: `moves.${move.id}.body`,
    example: `moves.${move.id}.example`,
    category: `moves.category.${move.category}`,
  };
}

/** Readable local date (YYYY-MM-DD → "Sat, Oct 4") in the app language. */
export function formatLocalDate(localDate: string, language: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return localDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  try {
    return new Intl.DateTimeFormat(language.startsWith('es') ? 'es' : 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return localDate;
  }
}
