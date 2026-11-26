import { supabase } from './supabase';
import { familySquaresSyncWindow } from '../../supabase/functions/_shared/family-squares-time';
import { markFamilySquaresCancelled } from './familySquaresCancelled';
import { websiteDeclineReason, type WebsiteDeclineReason } from './familySquaresCard';

/** i18n key of the repeat-registration message. */
export const FAMILY_SQUARES_ALREADY_REGISTERED = 'common:familySquares.alreadyRegistered';
/**
 * `reason: 'website_declined'` is the website itself refusing (a cancelled
 * Monday, or an attendee it will not register): not a connection problem, and
 * trying again will not help. `websiteReason` is why, when the server says
 * (older servers do not). Any other failure carries no reason.
 */
export type FamilySquaresResult =
  | { ok: true; alreadyRegistered: boolean; meetingDate: string }
  | { ok: false; reason?: 'website_declined'; websiteReason?: WebsiteDeclineReason };

/**
 * functions.invoke gives `data: null` for a non-2xx answer; the function's own
 * `{ error, reason }` is only on the error's Response. An answer only for a
 * readable `website_declined` (with its reason, if it gave one): anything else
 * stays an ordinary failure (null).
 */
async function websiteDeclined(error: unknown): Promise<{ websiteReason?: WebsiteDeclineReason } | null> {
  const context = (error as { context?: { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> } } | null)?.context;
  try {
    const body = (await (context?.clone ? context.clone().json() : context?.json?.())) as { error?: unknown; reason?: unknown } | undefined;
    if (body?.error !== 'website_declined') return null;
    const websiteReason = websiteDeclineReason(body.reason);
    return websiteReason ? { websiteReason } : {};
  } catch {
    // Not a JSON answer (a network failure).
    return null;
  }
}

/** A legacy/stale going row is not a confirmed registration for this occurrence. */
export function familySquaresRsvpIsCurrent(meetingDate: unknown, now = new Date()): boolean {
  return meetingDate === familySquaresSyncWindow(now).meetingDate;
}

// The meeting date the website would not save a seat for, as it last answered
// a Save tap from this account on this device (this run of the app only). The
// weekly seat is not saved for her that week either, so the panel does not
// say it will be (FamilySquaresSeatPanel, seatPanelView's weeklyNoteHeld).
const refusedMeetingDate = new Map<string, string>();
const refusedListeners = new Set<() => void>();

function noteSeatAnswer(accountId: string, refusedDate: string | null): void {
  if ((refusedMeetingDate.get(accountId) ?? null) === refusedDate) return;
  if (refusedDate) refusedMeetingDate.set(accountId, refusedDate);
  else refusedMeetingDate.delete(accountId);
  for (const listener of [...refusedListeners]) {
    try {
      listener();
    } catch {
      // One screen failing must not stop the others.
    }
  }
}

/** True when this device's own Save tap for the COMING meeting was refused by the website. */
export function familySquaresSeatRefusedHere(accountId: string | null | undefined, now = new Date()): boolean {
  return !!accountId && refusedMeetingDate.get(accountId) === familySquaresSyncWindow(now).meetingDate;
}

/** Today and Support both show the panel: each hears a refusal (or a seat saved after one). */
export function subscribeFamilySquaresSeatRefused(listener: () => void): () => void {
  refusedListeners.add(listener);
  return () => {
    refusedListeners.delete(listener);
  };
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
    const declined = current?.user.id === session.user.id && error ? await websiteDeclined(error) : null;
    if (declined) {
      // The website said the coming meeting is cancelled: every screen on this
      // device knows from now on, without asking again.
      if (declined.websiteReason === 'meeting_cancelled') markFamilySquaresCancelled();
      // It will not register her for this meeting (or an older server did not
      // say why): her weekly seat is not saved for it either.
      else noteSeatAnswer(accountId, familySquaresSyncWindow(new Date()).meetingDate);
      return { ok: false, reason: 'website_declined', ...declined };
    }
    if (current?.user.id !== session.user.id || error || data?.ok !== true
      || typeof data.already_registered !== 'boolean'
      || !familySquaresRsvpIsCurrent(data.meeting_date)) return { ok: false };
    noteSeatAnswer(accountId, null);
    return { ok: true, alreadyRegistered: data.already_registered, meetingDate: data.meeting_date };
  } catch {
    return { ok: false };
  }
}
