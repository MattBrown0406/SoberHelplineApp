/** The one thing Matt wrote for this week's Family Squares call. */
export interface FamilyCallTakeaway {
  meetingDate: string;
  body: string;
}

/** Validates the family_call_takeaway() reply; anything else is "none written". */
export function parseFamilyCallTakeaway(value: unknown): FamilyCallTakeaway | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const body = typeof row.body === 'string' ? row.body.trim() : '';
  const meetingDate = typeof row.meeting_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.meeting_date)
    ? row.meeting_date
    : '';
  return body && meetingDate ? { meetingDate, body: body.slice(0, 280) } : null;
}
