import { calendarSyncUpdate, saveCalendarSync } from './calendar-sync-state.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function fakeAdmin(result: { data: unknown; error: unknown }) {
  const state = { table: '', update: {} as Record<string, unknown>, predicates: [] as Array<[string, unknown]> };
  const builder = {
    eq(column: string, value: unknown) { state.predicates.push([column, value]); return builder; },
    select(_columns: string) { return builder; },
    async maybeSingle() { return result; },
  };
  return {
    state,
    client: {
      from(table: string) {
        state.table = table;
        return {
          update(values: Record<string, unknown>) { state.update = values; return builder; },
        };
      },
    },
  };
}

const lease = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 7,
  calendar_lease_version: 7,
  calendar_lease_token: '22222222-2222-4222-8222-222222222222',
};

Deno.test('successful calendar callback clears lease and matches all concurrency fields', async () => {
  const fake = fakeAdmin({ data: { id: lease.id }, error: null });
  const result = await saveCalendarSync(fake.client, lease, { calendar_sync_status: 'synced' });
  assert(result === 'saved', 'expected saved result');
  assert(fake.state.table === 'video_sessions', 'must update video_sessions');
  assert(fake.state.update.calendar_sync_status === 'synced', 'must preserve callback values');
  assert(fake.state.update.calendar_lease_token === null, 'must clear lease token');
  assert(fake.state.update.calendar_lease_version === null, 'must clear lease version');
  assert(fake.state.update.calendar_lease_expires_at === null, 'must clear lease expiry');
  const expected = [
    ['id', lease.id],
    ['version', lease.version],
    ['calendar_lease_version', lease.calendar_lease_version],
    ['calendar_lease_token', lease.calendar_lease_token],
  ];
  assert(JSON.stringify(fake.state.predicates) === JSON.stringify(expected), 'must condition callback on ID, version, and lease token');
});

Deno.test('stale callback is reported when conditional update matches no row', async () => {
  const fake = fakeAdmin({ data: null, error: null });
  assert(await saveCalendarSync(fake.client, lease, { calendar_sync_status: 'synced' }) === 'stale', 'expected stale result');
});

Deno.test('database callback failure is distinguished from stale response', async () => {
  const fake = fakeAdmin({ data: null, error: { message: 'database unavailable' } });
  assert(await saveCalendarSync(fake.client, lease, { calendar_sync_status: 'failed' }) === 'error', 'expected error result');
});

Deno.test('callback values cannot retain an active lease', () => {
  const update = calendarSyncUpdate({
    calendar_sync_status: 'failed',
    calendar_lease_token: 'attacker-value',
    calendar_lease_version: 99,
    calendar_lease_expires_at: '2099-01-01T00:00:00Z',
  });
  assert(update.calendar_lease_token === null, 'token must be cleared');
  assert(update.calendar_lease_version === null, 'version must be cleared');
  assert(update.calendar_lease_expires_at === null, 'expiry must be cleared');
});
