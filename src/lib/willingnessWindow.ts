export const WILLINGNESS_WINDOW_HOURS = 72;
export const WILLINGNESS_WINDOW_MS = WILLINGNESS_WINDOW_HOURS * 60 * 60 * 1000;

export const CONSEQUENCE_EVENT_TYPES = [
  'legal',
  'medical',
  'employment',
  'relationship',
  'housing',
  'financial',
  'other',
] as const;

export type ConsequenceEventType = typeof CONSEQUENCE_EVENT_TYPES[number];
export type ConsequenceTiming = 'now' | 'earlier_today' | 'yesterday' | 'two_days_ago';

export type ConsequenceEvent = {
  id: string;
  eventType: ConsequenceEventType;
  occurredAt: string;
};

export type WillingnessWindowState = {
  active: boolean;
  hoursRemaining: number;
  elapsedHours: number;
  endsAt: string | null;
};

export function isConsequenceEventType(value: unknown): value is ConsequenceEventType {
  return typeof value === 'string'
    && (CONSEQUENCE_EVENT_TYPES as readonly string[]).includes(value);
}

export function consequenceOccurredAt(
  timing: ConsequenceTiming,
  now = new Date(),
): string {
  const offsetHours = timing === 'earlier_today'
    ? 6
    : timing === 'yesterday'
      ? 24
      : timing === 'two_days_ago'
        ? 48
        : 0;
  return new Date(now.getTime() - offsetHours * 60 * 60 * 1000).toISOString();
}

export function willingnessWindowState(
  occurredAt: string | null,
  now = new Date(),
): WillingnessWindowState {
  if (!occurredAt) {
    return { active: false, hoursRemaining: 0, elapsedHours: 0, endsAt: null };
  }
  const occurred = new Date(occurredAt);
  if (!Number.isFinite(occurred.getTime())) {
    return { active: false, hoursRemaining: 0, elapsedHours: 0, endsAt: null };
  }
  const elapsedMs = now.getTime() - occurred.getTime();
  const endsAt = new Date(occurred.getTime() + WILLINGNESS_WINDOW_MS);
  const remainingMs = endsAt.getTime() - now.getTime();
  const active = elapsedMs >= -5 * 60 * 1000 && remainingMs > 0;
  return {
    active,
    hoursRemaining: active ? Math.ceil(remainingMs / (60 * 60 * 1000)) : 0,
    elapsedHours: Math.max(0, Math.floor(elapsedMs / (60 * 60 * 1000))),
    endsAt: endsAt.toISOString(),
  };
}

export function parseConsequenceEvent(value: unknown): ConsequenceEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string'
      || !isConsequenceEventType(row.event_type)
      || typeof row.occurred_at !== 'string'
      || !Number.isFinite(new Date(row.occurred_at).getTime())) {
    return null;
  }
  return {
    id: row.id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
  };
}
