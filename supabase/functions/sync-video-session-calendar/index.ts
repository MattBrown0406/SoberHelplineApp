// deno-lint-ignore-file no-import-prefix
import { createClient } from 'npm:@supabase/supabase-js@2';
import { saveCalendarSync } from '../_shared/calendar-sync-state.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPSERT_STATES = new Set(['scheduled']);
const TERMINAL_STATES = new Set(['cancelled', 'no_show']);
const UPSERT_ACTIONS = new Set(['upsert', 'create', 'patch', 'confirmed', 'rescheduled']);
const DELETE_ACTIONS = new Set(['delete', 'cancel', 'cancelled', 'completed', 'no_show']);
const ALLOWED_ACTIONS = new Set(['auto', ...UPSERT_ACTIONS, ...DELETE_ACTIONS]);

type VideoSession = {
  id: string;
  account_id: string;
  assigned_coach_id: string | null;
  scheduled_for: string | null;
  duration_minutes: number | null;
  status: string;
  calendar_event_id: string | null;
  version: number;
  calendar_lease_token: string | null;
  calendar_lease_version: number | null;
};

type AccountName = { id: string; first_name: string | null; last_name: string | null };
type Operation = 'upsert' | 'delete' | 'noop';

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed', message: 'Use POST.' }, 405, { Allow: 'POST, OPTIONS' });

  let session: VideoSession | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

  try {
    const env = requiredEnvironment();
    admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authorization = req.headers.get('Authorization') ?? '';
    const bearer = parseBearer(authorization);
    if (!bearer || !constantTimeEqual(bearer, env.serviceRoleKey)) {
      throw new HttpError(401, 'service_role_required', 'Calendar synchronization is server managed.');
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      throw new HttpError(400, 'invalid_json', 'The request body must be valid JSON.');
    }
    if (!isRecord(payload)) throw new HttpError(400, 'invalid_body', 'The request body must be an object.');

    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    const leaseToken = typeof payload.leaseToken === 'string' ? payload.leaseToken.trim() : '';
    const leaseVersion = typeof payload.version === 'number' && Number.isInteger(payload.version) ? payload.version : -1;
    const action = typeof payload.action === 'string' ? payload.action.trim().toLowerCase() : 'auto';
    if (!UUID_RE.test(sessionId) || !UUID_RE.test(leaseToken) || leaseVersion < 0) {
      throw new HttpError(400, 'invalid_lease', 'sessionId, version, and leaseToken are required.');
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new HttpError(400, 'invalid_action', 'action is not supported.', {
        field: 'action',
        allowed: [...ALLOWED_ACTIONS],
      });
    }

    const { data: sessionRow, error: sessionError } = await admin
      .from('video_sessions')
      .select('id, account_id, assigned_coach_id, scheduled_for, duration_minutes, status, calendar_event_id, version, calendar_lease_token, calendar_lease_version')
      .eq('id', sessionId)
      .eq('version', leaseVersion)
      .eq('calendar_lease_version', leaseVersion)
      .eq('calendar_lease_token', leaseToken)
      .maybeSingle<VideoSession>();
    if (sessionError) throw new HttpError(500, 'session_lookup_failed', 'Could not load the video session.');
    if (!sessionRow) throw new HttpError(404, 'session_not_found', 'Video session not found.');
    const currentSession: VideoSession = sessionRow;
    session = currentSession;

    const authorizationKind = 'service_role';

    const operation = resolveOperation(currentSession, action);
    const validation = validateSession(currentSession, operation);
    if (!validation.valid) {
      throw new HttpError(422, 'session_not_syncable', 'The video session is not valid for the requested calendar operation.', validation);
    }

    const names = operation === 'upsert' ? await fetchNames(admin, currentSession) : { member: 'Member', coach: 'Coach' };
    const accessToken = operation === 'noop' ? '' : await googleAccessToken(env.clientId, env.clientSecret, env.refreshToken);
    const calendarId = encodeURIComponent(env.calendarId);
    const eventId = currentSession.calendar_event_id || deterministicEventId(currentSession.id);

    let googleResult: 'created' | 'updated' | 'deleted' | 'already_absent' | 'unchanged';
    if (operation === 'upsert') {
      const event = calendarEvent(currentSession, names.member, names.coach);
      googleResult = await upsertGoogleEvent(calendarId, eventId, accessToken, event, Boolean(currentSession.calendar_event_id));
      await saveSync(admin, currentSession, { calendar_event_id: eventId, calendar_sync_status: 'synced', calendar_sync_error: null, calendar_synced_at: new Date().toISOString() });
    } else if (operation === 'delete') {
      googleResult = await deleteGoogleEvent(calendarId, eventId, accessToken);
      await saveSync(admin, currentSession, { calendar_event_id: null, calendar_sync_status: 'cancelled', calendar_sync_error: null, calendar_synced_at: new Date().toISOString() });
    } else {
      googleResult = 'unchanged';
      await saveSync(admin, currentSession, { calendar_sync_status: currentSession.status === 'completed' && currentSession.calendar_event_id ? 'synced' : 'not_synced', calendar_sync_error: null });
    }

    return json({
      ok: true,
      sessionId: currentSession.id,
      operation,
      googleResult,
      calendarEventId: operation === 'upsert' ? eventId : null,
      authorization: authorizationKind,
      validation,
    });
  } catch (error) {
    const httpError = error instanceof HttpError
      ? error
      : new HttpError(500, 'internal_error', 'Calendar sync failed unexpectedly.');

    if (session && admin) {
      try {
        await saveSync(admin, session, {
          calendar_sync_status: 'failed',
          calendar_sync_error: safeErrorForStorage(httpError),
        });
      } catch (saveError) {
        console.error('Could not store calendar sync failure:', safeLogError(saveError));
      }
    }
    console.error('sync-video-session-calendar:', httpError.code, safeLogError(error));
    return json({ error: httpError.code, message: httpError.message, details: httpError.details }, httpError.status);
  }
});

function requiredEnvironment() {
  const values = {
    supabaseUrl: Deno.env.get('SUPABASE_URL'),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    clientId: Deno.env.get('GOOGLE_CLIENT_ID'),
    clientSecret: Deno.env.get('GOOGLE_CLIENT_SECRET'),
    refreshToken: Deno.env.get('GOOGLE_REFRESH_TOKEN'),
    calendarId: Deno.env.get('GOOGLE_CALENDAR_ID') || 'primary',
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new HttpError(500, 'server_misconfigured', 'Required server configuration is missing.');
  return values as { [K in keyof typeof values]: string };
}

function parseBearer(header: string): string | null {
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

function resolveOperation(session: VideoSession, action: string): Operation {
  const normalizedStatus = session.status.trim().toLowerCase();
  if (action === 'auto') {
    if (UPSERT_STATES.has(normalizedStatus)) return 'upsert';
    if (normalizedStatus === 'requested') return session.calendar_event_id ? 'delete' : 'noop';
    if (normalizedStatus === 'completed') return 'noop';
    if (TERMINAL_STATES.has(normalizedStatus)) return 'delete';
  } else if (UPSERT_ACTIONS.has(action) && UPSERT_STATES.has(normalizedStatus)) {
    return 'upsert';
  } else if (DELETE_ACTIONS.has(action) && TERMINAL_STATES.has(normalizedStatus)) {
    return 'delete';
  }
  throw new HttpError(409, 'action_status_conflict', 'The requested action is not permitted for the current session status.', {
    action,
    status: normalizedStatus,
    upsertStatuses: [...UPSERT_STATES],
    terminalStatuses: [...TERMINAL_STATES],
  });
}

function validateSession(session: VideoSession, operation: Operation) {
  const errors: Array<{ field: string; message: string }> = [];
  let startUtc: string | null = null;
  let endUtc: string | null = null;

  if (operation === 'upsert') {
    if (!session.scheduled_for) {
      errors.push({ field: 'confirmed_start_at', message: 'A confirmed start time is required.' });
    } else {
      const start = new Date(session.scheduled_for);
      if (!Number.isFinite(start.getTime())) errors.push({ field: 'confirmed_start_at', message: 'Start time must be RFC3339-compatible.' });
      else startUtc = start.toISOString();
    }
    if (!Number.isInteger(session.duration_minutes) || (session.duration_minutes ?? 0) < 1 || (session.duration_minutes ?? 0) > 1440) {
      errors.push({ field: 'duration_minutes', message: 'Duration must be an integer from 1 through 1440 minutes.' });
    } else if (startUtc) {
      endUtc = new Date(new Date(startUtc).getTime() + session.duration_minutes! * 60_000).toISOString();
    }
    if (!session.assigned_coach_id) errors.push({ field: 'assigned_coach_id', message: 'An assigned coach is required.' });
  }

  return { valid: errors.length === 0, status: session.status, operation, startUtc, endUtc, errors };
}

async function fetchNames(admin: ReturnType<typeof createClient>, session: VideoSession) {
  const ids = [session.account_id, session.assigned_coach_id].filter((id): id is string => Boolean(id));
  const { data, error } = await admin.from('accounts').select('id, first_name, last_name').in('id', ids);
  if (error) throw new HttpError(500, 'name_lookup_failed', 'Could not load calendar participant names.');
  const accounts = (data ?? []) as AccountName[];
  const member = accounts.find((account) => account.id === session.account_id);
  const coach = accounts.find((account) => account.id === session.assigned_coach_id);
  if (!member || (session.assigned_coach_id && !coach)) {
    throw new HttpError(422, 'participant_not_found', 'A session participant account could not be found.');
  }
  return { member: safeName(member, 'Member'), coach: safeName(coach, 'Coach') };
}

function safeName(account: AccountName | undefined, fallback: string): string {
  const value = [account?.first_name, account?.last_name]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  const cleaned = safeText(value, 100);
  return cleaned || fallback;
}

function safeText(value: string, maxLength: number): string {
  const printable = [...value.normalize('NFKC')]
    .map((character) => {
      const code = character.charCodeAt(0);
      return character === '<' || character === '>' || code < 32 || code === 127 ? ' ' : character;
    })
    .join('');
  return printable.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function calendarEvent(session: VideoSession, memberName: string, coachName: string) {
  const start = new Date(session.scheduled_for!);
  const end = new Date(start.getTime() + session.duration_minutes! * 60_000);
  return {
    summary: 'Private appointment',
    description: 'Private scheduled video support session. Open the secure staff application for session access and details.',
    start: { dateTime: start.toISOString(), timeZone: 'UTC' },
    end: { dateTime: end.toISOString(), timeZone: 'UTC' },
    visibility: 'private',
    extendedProperties: { private: { videoSessionId: session.id } },
  };
}

function deterministicEventId(sessionId: string): string {
  return `vsession${sessionId.replaceAll('-', '').toLowerCase()}`;
}

async function googleAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await response.json().catch(() => null) as { access_token?: string } | null;
  if (!response.ok || !body?.access_token) throw new HttpError(502, 'google_auth_failed', 'Google Calendar authentication failed.');
  return body.access_token;
}

async function upsertGoogleEvent(calendarId: string, eventId: string, token: string, event: unknown, knownEvent: boolean): Promise<'created' | 'updated'> {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  if (knownEvent) {
    const patch = await googleRequest(`${base}/${encodeURIComponent(eventId)}`, token, 'PATCH', event);
    if (patch.status !== 404) {
      if (!patch.ok) throw googleApiError(patch, 'update');
      return 'updated';
    }
  }

  const insert = await googleRequest(base, token, 'POST', { ...(event as Record<string, unknown>), id: eventId });
  if (insert.status === 409) {
    const patch = await googleRequest(`${base}/${encodeURIComponent(eventId)}`, token, 'PATCH', event);
    if (!patch.ok) throw googleApiError(patch, 'update');
    return 'updated';
  }
  if (!insert.ok) throw googleApiError(insert, 'create');
  return 'created';
}

async function deleteGoogleEvent(calendarId: string, eventId: string, token: string): Promise<'deleted' | 'already_absent'> {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}`;
  const response = await googleRequest(url, token, 'DELETE');
  if (response.status === 404 || response.status === 410) return 'already_absent';
  if (!response.ok) throw googleApiError(response, 'delete');
  return 'deleted';
}

function googleRequest(url: string, token: string, method: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function googleApiError(response: Response, operation: string) {
  return new HttpError(502, 'google_calendar_failed', `Google Calendar could not ${operation} the event.`, { googleStatus: response.status });
}

async function saveSync(admin: ReturnType<typeof createClient>, session: VideoSession, values: Record<string, unknown>) {
  const result = await saveCalendarSync(admin, session, values);
  if (result === 'error') throw new HttpError(500, 'sync_state_save_failed', 'Calendar changed, but its sync state could not be saved.');
  if (result === 'stale') throw new HttpError(409, 'stale_calendar_lease', 'A newer calendar synchronization superseded this response.');
}

function safeErrorForStorage(error: HttpError): string {
  return safeText(`${error.code}: ${error.message}`, 1000);
}

function safeLogError(error: unknown): string {
  return error instanceof Error ? safeText(error.message, 500) : safeText(String(error), 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
