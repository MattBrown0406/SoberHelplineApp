import type { PrivateVideoSession } from '../hooks/usePrivateVideoSessions';

export const detectedTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function formatInTimeZone(value: string | Date, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(value));
}

function googleTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function googleCalendarUrl(
  session: PrivateVideoSession,
  labels: { title: string; details: string } = {
    title: 'Sober Helpline video session',
    details: 'Open the Sober Helpline app at the confirmed time to join your private video session.',
  },
): string | null {
  if (!session.scheduled_for) return null;
  const start = new Date(session.scheduled_for);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + session.duration_minutes * 60_000);
  const query = new URLSearchParams({
    action: 'TEMPLATE',
    text: labels.title,
    dates: `${googleTimestamp(start)}/${googleTimestamp(end)}`,
    details: labels.details,
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}
