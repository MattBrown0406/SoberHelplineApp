// Pure helpers for DateTimeField. On web the field is a native
// <input type="date" | "time">, whose values are local-time strings
// ("YYYY-MM-DD", "HH:MM"); on iOS/Android it is the community picker, which
// hands back a whole Date of which only the date or the time part counts.

export type DateTimeFieldMode = 'date' | 'time';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local calendar date for <input type="date">. */
export function toDateInputValue(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Local wall-clock time for <input type="time">. */
export function toTimeInputValue(value: Date): string {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function toInputValue(value: Date, mode: DateTimeFieldMode): string {
  return mode === 'date' ? toDateInputValue(value) : toTimeInputValue(value);
}

/** Keep `current`'s time of day; take the calendar date from `picked`. */
export function mergeDatePart(current: Date, picked: Date): Date {
  return new Date(picked.getFullYear(), picked.getMonth(), picked.getDate(), current.getHours(), current.getMinutes(), 0, 0);
}

/** Keep `current`'s calendar date; take the time of day from `picked`. */
export function mergeTimePart(current: Date, picked: Date): Date {
  return new Date(current.getFullYear(), current.getMonth(), current.getDate(), picked.getHours(), picked.getMinutes(), 0, 0);
}

export function mergePickedValue(current: Date, picked: Date, mode: DateTimeFieldMode): Date {
  return mode === 'date' ? mergeDatePart(current, picked) : mergeTimePart(current, picked);
}

/**
 * Apply a web input's string to the current value. Returns null for an empty
 * or malformed string (a browser clearing the field), so callers keep the
 * previous value instead of storing an invalid date.
 */
export function applyInputValue(current: Date, raw: string, mode: DateTimeFieldMode): Date | null {
  const value = raw.trim();
  if (mode === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const next = new Date(year, month - 1, day, current.getHours(), current.getMinutes(), 0, 0);
    // Reject roll-overs such as 2026-02-31.
    if (next.getFullYear() !== year || next.getMonth() !== month - 1 || next.getDate() !== day) return null;
    return next;
  }
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!match) return null;
  const [hours, minutes] = [Number(match[1]), Number(match[2])];
  if (hours > 23 || minutes > 59) return null;
  return new Date(current.getFullYear(), current.getMonth(), current.getDate(), hours, minutes, 0, 0);
}

/** The Date a part is merged into: the chosen value, else the suggestion, else now. */
export function fieldBaseValue(value: Date | null, fallback?: Date | null, now: Date = new Date()): Date {
  return value ?? fallback ?? now;
}

/** A complete local date-time from a chosen date part and a chosen time part; null until both exist. */
export function composeDateAndTime(date: Date | null, time: Date | null): Date | null {
  if (!date || !time) return null;
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.getHours(), time.getMinutes(), 0, 0);
  return Number.isFinite(next.getTime()) ? next : null;
}
