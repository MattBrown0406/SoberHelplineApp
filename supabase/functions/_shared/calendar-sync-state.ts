export type CalendarLease = {
  id: string;
  version: number;
  calendar_lease_version: number | null;
  calendar_lease_token: string | null;
};

export type SyncSaveResult = 'saved' | 'stale' | 'error';

// Deliberately small structural interface so this contract can be tested without
// a network client while remaining compatible with the Supabase query builder.
type SyncAdmin = {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): unknown;
    };
  };
};

export function calendarSyncUpdate(values: Record<string, unknown>): Record<string, unknown> {
  return {
    ...values,
    calendar_lease_token: null,
    calendar_lease_version: null,
    calendar_lease_expires_at: null,
  };
}

export async function saveCalendarSync(
  admin: unknown,
  session: CalendarLease,
  values: Record<string, unknown>,
): Promise<SyncSaveResult> {
  // Supabase builders are thenable; keep the complete conditional chain here so
  // production and tests exercise the same stale-response protection.
  const client = admin as SyncAdmin;
  const query = client.from('video_sessions').update(calendarSyncUpdate(values)) as any;
  const { data, error } = await query
    .eq('id', session.id)
    .eq('version', session.version)
    .eq('calendar_lease_version', session.calendar_lease_version)
    .eq('calendar_lease_token', session.calendar_lease_token)
    .select('id')
    .maybeSingle();
  if (error) return 'error';
  return data ? 'saved' : 'stale';
}
