// Family Squares RSVPs and questions → soberhelpline.com (service role only).
//
// Scheduled every 15 minutes by pg_cron (shl-family-squares-web-sync). Sends
// the website's app-family-squares-sync the COMPLETE current set of app
// members (verified emails only) who RSVP'd going/declined to the next Monday
// call, or asked a question for it, since the previous call ended — with their
// first name, questions, and whether the app reminds them by push. The website
// keeps one registration per person and removes app registrations that are no
// longer in the set, so a partial set is never sent.
//
// 404 means the website function isn't deployed yet: a quiet no-op.
//
// "Save my seat every Monday" is also done here, after a sync the website
// accepted: for each member who asked for a weekly seat and has no RSVP for
// the coming meeting, the website is asked the same question
// family-squares-register asks, and her seat is saved only when it says yes.
// A cancelled Monday or a blocked attendee is the website's decision, so no
// seat (and no "your seat is saved" reminder) appears for either.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { familySquaresSyncWindow } from '../_shared/family-squares-time.ts';
import {
  type Attendee,
  buildAttendees,
  ensureWebsiteRegistration,
  normalizeEmail,
  summarizeAttendees,
  summarizeWebsiteSyncResponse,
  TooManyAttendeesError,
  websiteFunctionUrl,
} from '../_shared/website-bridge.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// pg_cron waits 20 seconds for this function. Weekly seats use only what is
// left of that after the sync; anyone not reached is asked about next run.
const RUN_BUDGET_MS = 17_000;
const SEAT_CALL_TIMEOUT_MS = 8_000;

type WeeklySeatSummary = {
  /** Website calls made this run: at most one per member. */
  asked: number;
  saved: number;
  /** The website will not register her; not asked again for this meeting. */
  refused: number;
  /** Why the run ended before everyone was asked, if it did. */
  stopped: 'meeting_cancelled' | 'website_unavailable' | 'lookup_failed' | 'out_of_time' | null;
};

/**
 * Saves the coming meeting's seat for members who asked for one every Monday.
 * Nothing is written unless the website accepts: a refusal is remembered (so
 * the website is not asked again every 15 minutes), and no answer at all
 * (not deployed, unreachable, an error) ends the run and is tried again next
 * time. Counts only are returned and logged, never who.
 */
async function saveWeeklySeats(
  supabase: SupabaseClient,
  secret: string,
  meetingDate: string,
  deadline: number,
): Promise<WeeklySeatSummary> {
  const summary: WeeklySeatSummary = { asked: 0, saved: 0, refused: 0, stopped: null };
  const { data, error } = await supabase.rpc('service_family_squares_weekly_seat_candidates', {
    p_meeting_date: meetingDate,
  });
  if (error || !Array.isArray(data)) {
    console.error('family-squares-web-sync: weekly seat lookup failed', error?.code ?? 'invalid_response');
    return { ...summary, stopped: 'lookup_failed' };
  }
  const url = websiteFunctionUrl('app-family-squares-sync', Deno.env.get('WEBSITE_FUNCTIONS_URL'));
  const asked = new Set<string>();
  for (const raw of data) {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const accountId = typeof row.account_id === 'string' ? row.account_id : null;
    const email = normalizeEmail(row.email);
    if (!accountId || !email || asked.has(accountId)) continue;
    const timeLeft = deadline - Date.now();
    // The meeting ended while this ran: the seat would be for the wrong Monday.
    if (timeLeft < 2_000 || familySquaresSyncWindow(new Date()).meetingDate !== meetingDate) {
      return { ...summary, stopped: 'out_of_time' };
    }
    asked.add(accountId);
    summary.asked += 1;
    const answer = await ensureWebsiteRegistration({
      url,
      secret,
      meetingDate,
      email,
      name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Family',
      timeoutMs: Math.min(SEAT_CALL_TIMEOUT_MS, timeLeft),
    });
    if (answer.outcome === 'registered') {
      // The row is only ever added: an answer she gave meanwhile stands.
      const { data: saved, error: saveError } = await supabase.rpc('service_family_squares_save_weekly_seat', {
        p_account_id: accountId,
        p_meeting_date: meetingDate,
      });
      if (saveError) console.error('family-squares-web-sync: weekly seat not saved', saveError.code ?? 'error');
      else if (saved === true) summary.saved += 1;
      continue;
    }
    if (answer.outcome === 'unavailable') {
      // Nothing is written; every member is asked about again next run.
      return { ...summary, stopped: 'website_unavailable' };
    }
    const { error: holdError } = await supabase.rpc('service_family_squares_hold_weekly_seat', {
      p_account_id: accountId,
      p_meeting_date: meetingDate,
      p_reason: answer.outcome,
    });
    if (holdError) console.error('family-squares-web-sync: weekly seat answer not kept', holdError.code ?? 'error');
    // A cancelled Monday is cancelled for everyone: nobody else is asked.
    if (answer.outcome === 'meeting_cancelled') return { ...summary, stopped: 'meeting_cancelled' };
    summary.refused += 1;
  }
  return summary;
}

Deno.serve(async (req) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  const deadline = Date.now() + RUN_BUDGET_MS;

  const secret = Deno.env.get('MEMBERSHIP_SYNC_SECRET');
  if (!secret) return json({ ok: false, error: 'MEMBERSHIP_SYNC_SECRET not configured' }, 500);

  const window = familySquaresSyncWindow(new Date());
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await supabase.rpc('service_family_squares_attendees', {
    p_since: window.previousCallEnd.toISOString(),
  });
  if (error || !Array.isArray(data)) {
    console.error('family-squares-web-sync: attendee lookup failed', error?.code ?? 'invalid_response');
    return json({ ok: false, meeting_date: window.meetingDate, error: 'attendee_lookup_failed' }, 500);
  }

  let attendees: Attendee[];
  try {
    attendees = buildAttendees(data);
  } catch (err) {
    const count = err instanceof TooManyAttendeesError ? err.count : null;
    console.error('family-squares-web-sync: refusing to send a partial set', count);
    return json({ ok: false, meeting_date: window.meetingDate, error: 'too_many_attendees', count }, 500);
  }
  const summary = { meeting_date: window.meetingDate, ...summarizeAttendees(attendees) };

  let res: Response;
  try {
    res = await fetch(websiteFunctionUrl('app-family-squares-sync', Deno.env.get('WEBSITE_FUNCTIONS_URL')), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-membership-sync-secret': secret },
      body: JSON.stringify({ meeting_date: window.meetingDate, attendees }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const reason = err instanceof DOMException && err.name === 'TimeoutError' ? 'website_timeout' : 'website_unreachable';
    console.error('family-squares-web-sync:', reason);
    return json({ ok: false, ...summary, error: reason }, 502);
  }

  if (res.status === 404) {
    await res.body?.cancel();
    return json({ ok: true, ...summary, website: 'not_deployed' });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || (body && typeof body === 'object' && (body as { ok?: unknown }).ok === false)) {
    console.error('family-squares-web-sync: website rejected the sync', res.status);
    return json({ ok: false, ...summary, error: `website_${res.status}` }, 502);
  }
  const website = summarizeWebsiteSyncResponse(body);
  console.log('family-squares-web-sync', JSON.stringify({ ...summary, ...website }));

  // Only after a sync the website accepted, so an outage costs it no extra
  // calls. A failure here never changes the answer for the sync above.
  let weeklySeats: WeeklySeatSummary | null = null;
  try {
    weeklySeats = await saveWeeklySeats(supabase, secret, window.meetingDate, deadline);
    // Quiet when there was nobody to ask about, and on a cancelled Monday.
    if (weeklySeats.asked > 0 && weeklySeats.stopped !== 'meeting_cancelled') {
      console.log('family-squares-web-sync weekly seats', JSON.stringify(weeklySeats));
    }
  } catch {
    console.error('family-squares-web-sync: weekly seats failed');
  }
  return json({ ok: true, ...summary, website, weekly_seats: weeklySeats });
});
