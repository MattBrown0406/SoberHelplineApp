import { supabase } from './supabase';
import { familySquaresSyncWindow } from '../../supabase/functions/_shared/family-squares-time';

/** i18n key of the repeat-registration message. */
export const FAMILY_SQUARES_ALREADY_REGISTERED = 'common:familySquares.alreadyRegistered';
/**
 * `reason: 'website_declined'` is the website itself refusing (a cancelled
 * Monday, or an attendee it will not register): not a connection problem, and
 * trying again will not help. Any other failure carries no reason.
 */
export type FamilySquaresResult =
  | { ok: true; alreadyRegistered: boolean; meetingDate: string }
  | { ok: false; reason?: 'website_declined' };

/**
 * functions.invoke gives `data: null` for a non-2xx answer; the function's own
 * `{ error }` is only on the error's Response. True only for a readable
 * `website_declined`: anything else stays an ordinary failure.
 */
async function websiteDeclined(error: unknown): Promise<boolean> {
  const context = (error as { context?: { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> } } | null)?.context;
  try {
    const body = (await (context?.clone ? context.clone().json() : context?.json?.())) as { error?: unknown } | undefined;
    return body?.error === 'website_declined';
  } catch {
    // Not a JSON answer (a network failure).
    return false;
  }
}

/** A legacy/stale going row is not a confirmed registration for this occurrence. */
export function familySquaresRsvpIsCurrent(meetingDate: unknown, now = new Date()): boolean {
  return meetingDate === familySquaresSyncWindow(now).meetingDate;
}

// Coalesce simultaneous Today/Support/onboarding taps for the same identity.
const pending = new Map<string, Promise<FamilySquaresResult>>();
export function reserveFamilySquares(accountId: string): Promise<FamilySquaresResult> {
  const existing = pending.get(accountId);
  if (existing) return existing;
  const request = ensureRegistration(accountId).finally(() => pending.delete(accountId));
  pending.set(accountId, request);
  return request;
}

async function ensureRegistration(accountId: string): Promise<FamilySquaresResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { ok: false };
    const { data: account, error: accountError } = await supabase.from('accounts')
      .select('id').eq('user_id', session.user.id).eq('id', accountId).maybeSingle();
    if (accountError || account?.id !== accountId) return { ok: false };
    // Explicit bearer binds the request even if another account signs in mid-flight.
    const { data, error } = await supabase.functions.invoke('family-squares-register', {
      body: {}, headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const { data: { session: current } } = await supabase.auth.getSession();
    if (current?.user.id === session.user.id && error && await websiteDeclined(error)) return { ok: false, reason: 'website_declined' };
    if (current?.user.id !== session.user.id || error || data?.ok !== true
      || typeof data.already_registered !== 'boolean'
      || !familySquaresRsvpIsCurrent(data.meeting_date)) return { ok: false };
    return { ok: true, alreadyRegistered: data.already_registered, meetingDate: data.meeting_date };
  } catch {
    return { ok: false };
  }
}
