// Pure logic for the server-to-server bridge between soberhelpline.com and the
// app backend (every call carries MEMBERSHIP_SYNC_SECRET; see sync-secret.ts):
//
// - Contract C: family-squares-web-sync sends the website the complete set of
//   app members who RSVP'd to / asked a question for the next Monday call.
// - Contract D: family-squares-push-reachable tells the website which of its
//   reminder recipients the app already reminds by push.
// - Contract E: membership-export / membership-import replace the website's
//   direct reads and writes of the app database.
//
// Only verified app login emails ever cross; they are compared lower-cased and
// trimmed. Never log the emails these helpers handle.

export const DEFAULT_WEBSITE_FUNCTIONS_URL = 'https://anwqprmpzmcqbkttmxos.supabase.co/functions/v1';
export const MAX_ATTENDEES = 2000;
export const MAX_QUESTIONS_PER_PERSON = 5;
export const MAX_QUESTION_LENGTH = 500;
export const MAX_NAME_LENGTH = 100;
// No first name: send none; the website greets them as "Friend".
export const NEUTRAL_NAME = '';
export const MAX_REACHABLE_EMAILS = 1000;
export const MAX_EXPORT_LIMIT = 1000;
export const MAX_IMPORT_MEMBERS = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lower-cased, trimmed email, or null when the value can't be one. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 320 && email.includes('@') ? email : null;
}

/** The website function URL; WEBSITE_FUNCTIONS_URL overrides the base (…/functions/v1). */
export function websiteFunctionUrl(name: string, base?: string | null): string {
  const root = (base?.trim() || DEFAULT_WEBSITE_FUNCTIONS_URL).replace(/\/+$/, '');
  return `${root}/${name}`;
}

// ── Contract C ──────────────────────────────────────────────────────────────

export type Rsvp = 'going' | 'declined' | null;

export interface Attendee {
  email: string;
  name: string;
  rsvp: Rsvp;
  questions: string[];
  app_reminders: boolean;
}

export class TooManyAttendeesError extends Error {
  constructor(readonly count: number) {
    super(`too many attendees: ${count}`);
  }
}

/** Trimmed, non-empty questions of at most 500 characters; the newest five, newest last. */
export function cleanQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const questions = value
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.trim().slice(0, MAX_QUESTION_LENGTH).trim())
    .filter((q) => q.length > 0);
  return questions.slice(-MAX_QUESTIONS_PER_PERSON);
}

/**
 * Turn the service_family_squares_attendees rows (already verified-email only,
 * questions oldest first) into the website payload. One entry per email; a row
 * with neither an RSVP nor a question says nothing and is dropped. Throws when
 * the set is larger than the website accepts — a truncated "complete" set would
 * make the website delete registrations that are still wanted.
 */
export function buildAttendees(rows: unknown): Attendee[] {
  if (!Array.isArray(rows)) throw new Error('attendee rows must be an array');
  const byEmail = new Map<string, Attendee>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const email = normalizeEmail(row.email);
    if (!email || byEmail.has(email)) continue;
    const rsvp: Rsvp = row.rsvp === 'going' || row.rsvp === 'declined' ? row.rsvp : null;
    const questions = cleanQuestions(row.questions);
    if (rsvp === null && questions.length === 0) continue;
    const name = typeof row.name === 'string' ? row.name.trim().slice(0, MAX_NAME_LENGTH).trim() : '';
    byEmail.set(email, {
      email,
      name: name || NEUTRAL_NAME,
      rsvp,
      questions,
      app_reminders: row.app_reminders === true,
    });
  }
  if (byEmail.size > MAX_ATTENDEES) throw new TooManyAttendeesError(byEmail.size);
  return [...byEmail.values()];
}

/** Counts only — safe to log and return. */
export function summarizeAttendees(attendees: Attendee[]) {
  return {
    attendees: attendees.length,
    going: attendees.filter((a) => a.rsvp === 'going').length,
    declined: attendees.filter((a) => a.rsvp === 'declined').length,
    questions_only: attendees.filter((a) => a.rsvp === null).length,
    with_questions: attendees.filter((a) => a.questions.length > 0).length,
    app_reminders: attendees.filter((a) => a.app_reminders).length,
  };
}

/** The website's { ok, upserted, removed, skipped } as counts (skipped may be a list). */
export function summarizeWebsiteSyncResponse(body: unknown): {
  upserted: number | null;
  removed: number | null;
  skipped: number | null;
} {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const count = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.length;
    return null;
  };
  return { upserted: count(record.upserted), removed: count(record.removed), skipped: count(record.skipped) };
}

// ── Contract D ──────────────────────────────────────────────────────────────

/**
 * `{ emails: string[] }` (≤ 1000) → the distinct normalized emails, or null when
 * the body is malformed. Strings that can't be emails are dropped (they can't
 * match an app account).
 */
export function parseEmailBatch(body: unknown, max = MAX_REACHABLE_EMAILS): string[] | null {
  const emails = body && typeof body === 'object' ? (body as Record<string, unknown>).emails : undefined;
  if (!Array.isArray(emails) || emails.length > max) return null;
  if (emails.some((e) => typeof e !== 'string')) return null;
  return [...new Set(emails.map(normalizeEmail).filter((e): e is string => e !== null))];
}

// ── Contract E1: membership-export ──────────────────────────────────────────

export type ExportTier = 'essential' | 'premier' | 'org';

export interface ExportMember {
  email: string;
  tier: ExportTier;
  expires_at: string | null;
}

/** `{ cursor?, limit? }` → validated paging, or null when malformed. */
export function parseExportRequest(body: unknown): { cursor: string | null; limit: number } | null {
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (body !== null && body !== undefined && record === null) return null;
  const cursor = record?.cursor ?? null;
  if (cursor !== null && (typeof cursor !== 'string' || !UUID.test(cursor))) return null;
  const rawLimit = record?.limit ?? MAX_EXPORT_LIMIT;
  if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit)) return null;
  const limit = Math.min(MAX_EXPORT_LIMIT, Math.max(1, Math.floor(rawLimit)));
  return { cursor: cursor as string | null, limit };
}

/**
 * service_membership_export rows (account_id order) → the response page. The
 * cursor is the last account id; it is only returned when the page is full.
 */
export function exportPage(rows: unknown, limit: number): { members: ExportMember[]; next_cursor: string | null } {
  if (!Array.isArray(rows)) throw new Error('export rows must be an array');
  const members: ExportMember[] = [];
  let last: string | null = null;
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    if (typeof row?.account_id === 'string') last = row.account_id;
    const email = normalizeEmail(row?.email);
    const tier = row?.tier;
    if (!email || (tier !== 'essential' && tier !== 'premier' && tier !== 'org')) continue;
    const expires = typeof row.expires_at === 'string' ? new Date(row.expires_at) : null;
    members.push({ email, tier, expires_at: expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : null });
  }
  return { members, next_cursor: rows.length >= limit ? last : null };
}

// ── Contract E2: membership-import ──────────────────────────────────────────

export interface ImportMember {
  email: string;
  expires_at: string | null;
}

export type ImportRequest = {
  members: ImportMember[];
  dryRun: boolean;
  allowMassRevoke: boolean;
};

/**
 * `{ members: [{ email, expires_at }], complete: true, dry_run?, allow_mass_revoke? }`.
 * The list drives revocation, so anything malformed rejects the whole call
 * (an error string) instead of being skipped. Emails are normalized but not
 * otherwise judged: one that matches no verified app account is "unmatched".
 */
export function parseImportRequest(body: unknown): ImportRequest | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body must be an object';
  const record = body as Record<string, unknown>;
  if (record.complete !== true) return 'complete must be true (members is the complete list)';
  if (!Array.isArray(record.members)) return 'members must be an array';
  if (record.members.length > MAX_IMPORT_MEMBERS) return `at most ${MAX_IMPORT_MEMBERS} members per call`;
  for (const flag of ['dry_run', 'allow_mass_revoke']) {
    if (record[flag] !== undefined && typeof record[flag] !== 'boolean') return `${flag} must be a boolean`;
  }
  const members: ImportMember[] = [];
  for (let i = 0; i < record.members.length; i += 1) {
    const member = record.members[i];
    if (!member || typeof member !== 'object' || Array.isArray(member)) return `members[${i}] must be an object`;
    const { email, expires_at: expiresAt } = member as Record<string, unknown>;
    if (typeof email !== 'string') return `members[${i}].email must be a string`;
    if (expiresAt !== null && typeof expiresAt !== 'string') return `members[${i}].expires_at must be a string or null`;
    let expires: string | null = null;
    if (typeof expiresAt === 'string') {
      const at = new Date(expiresAt);
      if (Number.isNaN(at.getTime())) return `members[${i}].expires_at is not a timestamp`;
      expires = at.toISOString();
    }
    members.push({ email: email.trim().toLowerCase(), expires_at: expires });
  }
  return {
    members,
    dryRun: record.dry_run === true,
    allowMassRevoke: record.allow_mass_revoke === true,
  };
}
