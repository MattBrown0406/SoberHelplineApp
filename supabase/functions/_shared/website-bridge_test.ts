import {
  buildAttendees,
  cleanQuestions,
  ensureRegistrationRequest,
  ensureWebsiteRegistration,
  exportPage,
  interpretEnsureRegistration,
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
  websiteMeetingCancelled,
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

Deno.test('the sync reply says whether the Monday that was sent is cancelled, or says nothing', () => {
  const sent = '2026-11-23';
  assertEquals(websiteMeetingCancelled({ ok: true, upserted: 3, cancelled: true }, sent), true);
  assertEquals(websiteMeetingCancelled({ ok: true, upserted: 3, cancelled: false }, sent), false);
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: sent, cancelled: true }, sent), true);
  // A refusal of the whole sync because that Monday is cancelled is the same answer.
  assertEquals(websiteMeetingCancelled({ ok: false, error: 'meeting_cancelled' }, sent), true);
  // No field, not a boolean, not an object: nothing is known, so nothing is recorded.
  assertEquals(websiteMeetingCancelled({ ok: true, upserted: 3 }, sent), null);
  assertEquals(websiteMeetingCancelled({ ok: true, cancelled: 'yes' }, sent), null);
  assertEquals(websiteMeetingCancelled({ ok: true, cancelled: 1 }, sent), null);
  assertEquals(websiteMeetingCancelled({ ok: false, error: 'server_error' }, sent), null);
  assertEquals(websiteMeetingCancelled(null, sent), null);
  assertEquals(websiteMeetingCancelled([{ cancelled: true }], sent), null);
  assertEquals(websiteMeetingCancelled('cancelled', sent), null);
  // An answer about another Monday says nothing about this one.
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: '2026-11-16', cancelled: true }, sent), null);
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: '2026-11-16', cancelled: false }, sent), null);
  assertEquals(websiteMeetingCancelled({ ok: false, meeting_date: '2026-11-30', error: 'meeting_cancelled' }, sent), null);
});

Deno.test('the sync reply is about the Monday sent when it names no date, or names it with a time', () => {
  const sent = '2026-11-23';
  // Today's live website: the exact date that was sent.
  const live = { ok: true, upserted: 2, removed: 0, skipped: 0, meeting_date: sent, details: [] };
  assertEquals(websiteMeetingCancelled({ ...live, cancelled: true }, sent), true);
  assertEquals(websiteMeetingCancelled({ ...live, cancelled: false }, sent), false);
  // No meeting_date at all (or not a string): still about the meeting sent.
  assertEquals(websiteMeetingCancelled({ ok: true, cancelled: true }, sent), true);
  assertEquals(websiteMeetingCancelled({ ok: true, cancelled: false }, sent), false);
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: null, cancelled: true }, sent), true);
  // The same date written as a timestamp: only the first ten characters count.
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: '2026-11-23T00:00:00.000Z', cancelled: true }, sent), true);
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: '2026-11-23T00:00:00+00:00', cancelled: false }, sent), false);
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: '2026-11-23 19:00', cancelled: true }, sent), true);
  // Another date, however it is written, says nothing.
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: '2026-11-16T00:00:00.000Z', cancelled: true }, sent), null);
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: '2026-11-2', cancelled: true }, sent), null);
  assertEquals(websiteMeetingCancelled({ ok: true, meeting_date: '', cancelled: true }, sent), null);
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

// ── One person: "may this member have a seat?" ──────────────────────────────

const MONDAY = '2026-11-23';

Deno.test('the one-person question is the one family-squares-register asks', () => {
  assertEquals(ensureRegistrationRequest(MONDAY, ' Mom@Example.COM ', 'Ana Family'), {
    action: 'ensure-registration',
    meeting_date: MONDAY,
    attendee: { email: 'mom@example.com', name: 'Ana Family' },
  });
});

Deno.test('only an explicit yes for the meeting asked about is a registration', () => {
  assertEquals(
    interpretEnsureRegistration(200, { ok: true, already_registered: false, meeting_date: MONDAY }, MONDAY),
    { outcome: 'registered', alreadyRegistered: false },
  );
  assertEquals(
    interpretEnsureRegistration(200, { ok: true, already_registered: true, meeting_date: MONDAY }, MONDAY),
    { outcome: 'registered', alreadyRegistered: true },
  );
  // None of these is a yes. A 2xx the app cannot read is the website's
  // trouble, not hers: another week, a missing repeat flag, not JSON.
  const trouble = { outcome: 'unavailable', reason: 'website_error' };
  assertEquals(interpretEnsureRegistration(200, { ok: true, already_registered: false, meeting_date: '2026-11-16' }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(200, { ok: true, meeting_date: MONDAY }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(200, null, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(200, [], MONDAY), trouble);
  // A yes on an error status is an error.
  assertEquals(interpretEnsureRegistration(500, { ok: true, already_registered: true, meeting_date: MONDAY }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(404, null, MONDAY), { outcome: 'unavailable', reason: 'not_deployed' });
});

Deno.test('a website in trouble is not one member\'s problem; only a 4xx JSON reply is about her', () => {
  const trouble = { outcome: 'unavailable', reason: 'website_error' };
  const aboutHer = { outcome: 'unavailable', reason: 'unexpected_reply' };
  // An outage or an overloaded website: any 5xx that is not the recognised
  // registration_failed JSON, a 429, an HTML error page.
  assertEquals(interpretEnsureRegistration(500, { ok: false, error: 'server_error' }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(500, null, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(500, '<html>Internal Server Error</html>', MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(502, 'Bad Gateway', MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(502, { message: 'bad gateway' }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(503, { ok: false, error: 'unavailable' }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(504, null, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(429, { ok: false, error: 'rate_limited' }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(429, null, MONDAY), trouble);
  // A rejected secret or a timeout is never about one member either.
  assertEquals(interpretEnsureRegistration(401, { ok: false, error: 'unauthorized' }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(408, { ok: false, error: 'timeout' }, MONDAY), trouble);
  // A 4xx that is not JSON came from something in front of the website.
  assertEquals(interpretEnsureRegistration(400, null, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(403, '<html>Forbidden</html>', MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(400, [{ error: 'invalid_attendee' }], MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(302, { ok: false }, MONDAY), trouble);
  // A 4xx JSON reply is the website turning down the question about her:
  // an attendee it will not take, or a website without the one-person question.
  assertEquals(interpretEnsureRegistration(400, { ok: false, error: 'invalid_attendee' }, MONDAY), aboutHer);
  assertEquals(interpretEnsureRegistration(422, { ok: false, error: 'invalid_attendee' }, MONDAY), aboutHer);
  assertEquals(interpretEnsureRegistration(400, { ok: false, error: 'attendees_required' }, MONDAY), aboutHer);
  assertEquals(interpretEnsureRegistration(403, { ok: false, error: 'forbidden' }, MONDAY), aboutHer);
  assertEquals(interpretEnsureRegistration(409, { ok: false }, MONDAY), aboutHer);
});

Deno.test('a 500 registration_failed is "no objection": the website checked her and could not write its own row', () => {
  // Today's live website: not cancelled, not blocked, then its own write fails.
  assertEquals(
    interpretEnsureRegistration(500, { ok: false, error: 'registration_failed' }, MONDAY),
    { outcome: 'no_objection' },
  );
  assertEquals(interpretEnsureRegistration(500, { error: 'registration_failed' }, MONDAY), { outcome: 'no_objection' });
  // Only that status with that error. The same word on another status, or a
  // reply that also claims success, is not an answer.
  const trouble = { outcome: 'unavailable', reason: 'website_error' };
  assertEquals(interpretEnsureRegistration(200, { ok: false, error: 'registration_failed' }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(503, { ok: false, error: 'registration_failed' }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(500, { ok: true, error: 'registration_failed' }, MONDAY), trouble);
  assertEquals(interpretEnsureRegistration(400, { ok: false, error: 'registration_failed' }, MONDAY),
    { outcome: 'unavailable', reason: 'unexpected_reply' });
  assertEquals(interpretEnsureRegistration(404, { ok: false, error: 'registration_failed' }, MONDAY),
    { outcome: 'unavailable', reason: 'not_deployed' });
  // The website's two decisions still win, whatever the status.
  assertEquals(interpretEnsureRegistration(500, { ok: false, error: 'meeting_cancelled' }, MONDAY), { outcome: 'meeting_cancelled' });
  assertEquals(
    interpretEnsureRegistration(500, { ok: false, error: 'registration_unavailable' }, MONDAY),
    { outcome: 'registration_unavailable' },
  );
});

Deno.test('a cancelled Monday and a blocked attendee are the website\'s decisions', () => {
  assertEquals(interpretEnsureRegistration(409, { ok: false, error: 'meeting_cancelled' }, MONDAY), { outcome: 'meeting_cancelled' });
  assertEquals(
    interpretEnsureRegistration(403, { ok: false, error: 'registration_unavailable' }, MONDAY),
    { outcome: 'registration_unavailable' },
  );
});

Deno.test('asking the website: one POST with the shared secret; an outage is "no answer", never a throw', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = (status: number, body: unknown): typeof fetch => (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
  };
  const ask = (fetcher: typeof fetch) =>
    ensureWebsiteRegistration({
      url: 'https://website.invalid/app-family-squares-sync',
      secret: 'server-secret',
      meetingDate: MONDAY,
      email: 'Mom@Example.com',
      name: 'Ana',
      timeoutMs: 1000,
      fetcher,
    });

  assertEquals(
    await ask(reply(200, { ok: true, already_registered: false, meeting_date: MONDAY })),
    { outcome: 'registered', alreadyRegistered: false },
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, 'https://website.invalid/app-family-squares-sync');
  assertEquals(calls[0].init.method, 'POST');
  assertEquals((calls[0].init.headers as Record<string, string>)['x-membership-sync-secret'], 'server-secret');
  assertEquals(JSON.parse(String(calls[0].init.body)), {
    action: 'ensure-registration',
    meeting_date: MONDAY,
    attendee: { email: 'mom@example.com', name: 'Ana' },
  });

  assertEquals(await ask(reply(409, { ok: false, error: 'meeting_cancelled' })), { outcome: 'meeting_cancelled' });
  assertEquals(await ask(reply(500, { ok: false, error: 'registration_failed' })), { outcome: 'no_objection' });
  assertEquals(await ask(reply(500, 'Internal Server Error')), { outcome: 'unavailable', reason: 'website_error' });
  assertEquals(await ask(reply(503, 'Service Unavailable')), { outcome: 'unavailable', reason: 'website_error' });
  assertEquals(await ask(reply(429, { ok: false, error: 'rate_limited' })), { outcome: 'unavailable', reason: 'website_error' });
  assertEquals(await ask(reply(200, 'not json')), { outcome: 'unavailable', reason: 'website_error' });
  assertEquals(await ask(reply(400, { ok: false, error: 'invalid_attendee' })), { outcome: 'unavailable', reason: 'unexpected_reply' });
  assertEquals(await ask(reply(404, 'Not Found')), { outcome: 'unavailable', reason: 'not_deployed' });
  assertEquals(
    await ask(() => Promise.reject(new Error('offline'))),
    { outcome: 'unavailable', reason: 'unreachable' },
  );
});
