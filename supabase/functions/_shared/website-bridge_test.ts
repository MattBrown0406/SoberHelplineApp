import {
  buildAttendees,
  cleanQuestions,
  exportPage,
  MAX_ATTENDEES,
  NEUTRAL_NAME,
  normalizeEmail,
  parseEmailBatch,
  parseExportRequest,
  parseImportRequest,
  summarizeAttendees,
  summarizeWebsiteSyncResponse,
  TooManyAttendeesError,
  websiteFunctionUrl,
} from './website-bridge.ts';

function assertEquals(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
}

Deno.test('emails are compared lower-cased and trimmed', () => {
  assertEquals(normalizeEmail('  Mom@Example.COM '), 'mom@example.com');
  assertEquals(normalizeEmail('not-an-email'), null);
  assertEquals(normalizeEmail(''), null);
  assertEquals(normalizeEmail(42), null);
});

Deno.test('the website function URL can be overridden', () => {
  assertEquals(websiteFunctionUrl('app-family-squares-sync'),
    'https://anwqprmpzmcqbkttmxos.supabase.co/functions/v1/app-family-squares-sync');
  assertEquals(websiteFunctionUrl('app-family-squares-sync', 'http://127.0.0.1:54321/functions/v1/'),
    'http://127.0.0.1:54321/functions/v1/app-family-squares-sync');
  assertEquals(websiteFunctionUrl('x', '  '), 'https://anwqprmpzmcqbkttmxos.supabase.co/functions/v1/x');
});

Deno.test('questions are trimmed, capped at 500 characters, and only the newest five go (newest last)', () => {
  const long = 'x'.repeat(600);
  assertEquals(cleanQuestions(['  one ', '', '   ', 'two', 'three', 'four', 'five', 'six', long, 7]),
    ['three', 'four', 'five', 'six', 'x'.repeat(500)]);
  assertEquals(cleanQuestions(null), []);
});

Deno.test('attendees: one entry per email, neutral name fallback, empty rows dropped', () => {
  const attendees = buildAttendees([
    { email: 'A@x.com', name: ' Ana ', rsvp: 'going', questions: [], app_reminders: true },
    { email: 'a@x.com ', name: 'Duplicate', rsvp: 'declined', questions: ['q'], app_reminders: false },
    { email: 'b@x.com', name: null, rsvp: 'declined', questions: null, app_reminders: false },
    { email: 'c@x.com', name: '   ', rsvp: null, questions: ['  How do I start? '], app_reminders: 'yes' },
    { email: 'd@x.com', name: 'Dee', rsvp: null, questions: ['   '], app_reminders: true },
    { email: 'e@x.com', name: 'Eve', rsvp: 'maybe', questions: [], app_reminders: true },
    { email: null, name: 'No email', rsvp: 'going', questions: [], app_reminders: true },
  ]);
  assertEquals(attendees, [
    { email: 'a@x.com', name: 'Ana', rsvp: 'going', questions: [], app_reminders: true },
    { email: 'b@x.com', name: NEUTRAL_NAME, rsvp: 'declined', questions: [], app_reminders: false },
    { email: 'c@x.com', name: NEUTRAL_NAME, rsvp: null, questions: ['How do I start?'], app_reminders: false },
  ]);
  assertEquals(summarizeAttendees(attendees),
    { attendees: 3, going: 1, declined: 1, questions_only: 1, with_questions: 1, app_reminders: 1 });
});

Deno.test('more attendees than the website accepts is an error, never a truncated "complete" set', () => {
  const rows = Array.from({ length: MAX_ATTENDEES + 1 }, (_, i) => ({ email: `p${i}@x.com`, rsvp: 'going' }));
  let thrown: unknown = null;
  try {
    buildAttendees(rows);
  } catch (error) {
    thrown = error;
  }
  assertEquals(thrown instanceof TooManyAttendeesError, true);
  assertEquals(buildAttendees(rows.slice(0, MAX_ATTENDEES)).length, MAX_ATTENDEES);
});

Deno.test('the website sync response is reduced to counts', () => {
  assertEquals(summarizeWebsiteSyncResponse({ ok: true, upserted: 3, removed: 1, skipped: ['blocked@x.com'] }),
    { upserted: 3, removed: 1, skipped: 1 });
  assertEquals(summarizeWebsiteSyncResponse(null), { upserted: null, removed: null, skipped: null });
});

Deno.test('push-reachable lookups take at most 1000 string emails', () => {
  assertEquals(parseEmailBatch({ emails: [' A@x.com', 'a@x.com', 'b@x.com', 'junk'] }), ['a@x.com', 'b@x.com']);
  assertEquals(parseEmailBatch({ emails: [] }), []);
  assertEquals(parseEmailBatch({ emails: ['a@x.com', 7] }), null);
  assertEquals(parseEmailBatch({ emails: 'a@x.com' }), null);
  assertEquals(parseEmailBatch(null), null);
  assertEquals(parseEmailBatch({ emails: Array.from({ length: 1001 }, (_, i) => `p${i}@x.com`) }), null);
  assertEquals(parseEmailBatch({ emails: Array.from({ length: 1000 }, (_, i) => `p${i}@x.com`) })?.length, 1000);
});

Deno.test('export paging: optional uuid cursor, limit clamped to 1..1000', () => {
  assertEquals(parseExportRequest({}), { cursor: null, limit: 1000 });
  assertEquals(parseExportRequest(null), { cursor: null, limit: 1000 });
  assertEquals(parseExportRequest({ cursor: null, limit: 50 }), { cursor: null, limit: 50 });
  assertEquals(parseExportRequest({ limit: 5000 }), { cursor: null, limit: 1000 });
  assertEquals(parseExportRequest({ limit: 0 }), { cursor: null, limit: 1 });
  assertEquals(parseExportRequest({ cursor: '27000000-0000-0000-0000-000000000002' }),
    { cursor: '27000000-0000-0000-0000-000000000002', limit: 1000 });
  assertEquals(parseExportRequest({ cursor: 'a@x.com' }), null);
  assertEquals(parseExportRequest({ limit: '10' }), null);
  assertEquals(parseExportRequest([]), null);
});

Deno.test('export page: members without ids, next cursor only on a full page', () => {
  const rows = [
    { account_id: '00000000-0000-0000-0000-000000000001', email: 'a@x.com', tier: 'premier', expires_at: null },
    { account_id: '00000000-0000-0000-0000-000000000002', email: 'b@x.com', tier: 'essential', expires_at: '2026-11-01T00:00:00+00:00' },
  ];
  assertEquals(exportPage(rows, 2), {
    members: [
      { email: 'a@x.com', tier: 'premier', expires_at: null },
      { email: 'b@x.com', tier: 'essential', expires_at: '2026-11-01T00:00:00.000Z' },
    ],
    next_cursor: '00000000-0000-0000-0000-000000000002',
  });
  assertEquals(exportPage(rows, 3).next_cursor, null);
  assertEquals(exportPage([], 1000), { members: [], next_cursor: null });
});

Deno.test('import requires the complete list and rejects anything malformed', () => {
  assertEquals(parseImportRequest({ members: [], complete: true }), { members: [], dryRun: false, allowMassRevoke: false });
  assertEquals(parseImportRequest({
    members: [{ email: ' Mom@X.com ', expires_at: '2026-11-01T00:00:00Z' }, { email: 'b@x.com', expires_at: null }],
    complete: true,
    dry_run: true,
    allow_mass_revoke: true,
  }), {
    members: [{ email: 'mom@x.com', expires_at: '2026-11-01T00:00:00.000Z' }, { email: 'b@x.com', expires_at: null }],
    dryRun: true,
    allowMassRevoke: true,
  });
  const rejects = (body: unknown) => assertEquals(typeof parseImportRequest(body), 'string', JSON.stringify(body));
  rejects({ members: [] });
  rejects({ members: [], complete: 'true' });
  rejects({ members: {}, complete: true });
  rejects({ members: [{ email: 'a@x.com' }], complete: true });
  rejects({ members: [{ email: 'a@x.com', expires_at: 'soon' }], complete: true });
  rejects({ members: [{ email: 7, expires_at: null }], complete: true });
  rejects({ members: ['a@x.com'], complete: true });
  rejects({ members: [], complete: true, dry_run: 'yes' });
  rejects({ members: Array.from({ length: 5001 }, () => ({ email: 'a@x.com', expires_at: null })), complete: true });
  rejects(null);
});
