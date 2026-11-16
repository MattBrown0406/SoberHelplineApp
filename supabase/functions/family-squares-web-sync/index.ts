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
// A cancelled Monday is learned here too. The website's reply says whether
// the meeting date that was sent is cancelled; that answer is kept
// (family_squares_meeting_status) on every run, so the reminders, the Monday
// morning note and the Tuesday follow-up all stay quiet for a cancelled
// meeting, and start again if it is put back on. The sync reply is the
// authority: when it says the meeting is on, one member's "cancelled" answer
// later in the same run does not change the status. And when it says the
// meeting is cancelled, members who saved a seat, and members whose weekly
// seat had not been saved yet, are told once
// (service_family_squares_announce_cancelled).
//
// "Save my seat every Monday" is also done here, after a sync the website
// accepted: for each member who asked for a weekly seat and has no RSVP for
// the coming meeting, the website is asked the same question
// family-squares-register asks. Her seat is saved when it says yes or has no
// objection; a cancelled Monday or a blocked attendee is the website's
// decision, so no seat (and no "your seat is saved" reminder) appears for
// either. The rules are in _shared/family-squares-weekly-seats.ts.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { familySquaresSyncWindow } from '../_shared/family-squares-time.ts';
import { saveWeeklySeats, type WeeklySeatSummary } from '../_shared/family-squares-weekly-seats.ts';
import {
  type Attendee,
  buildAttendees,
  ensureWebsiteRegistration,
  summarizeAttendees,
  summarizeWebsiteSyncResponse,
  TooManyAttendeesError,
  websiteFunctionUrl,
  websiteMeetingCancelled,
} from '../_shared/website-bridge.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// pg_cron waits 20 seconds for this function. Weekly seats use only what is
// left of that after the sync; anyone not reached is asked about next run.
const RUN_BUDGET_MS = 17_000;

/**
 * Keeps what the website said about that Monday. True when it was kept. A
 * failure is logged and changes nothing else: the pushes go on as before.
 */
async function noteMeetingStatus(supabase: SupabaseClient, meetingDate: string, cancelled: boolean): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('service_family_squares_note_meeting_status', {
      p_meeting_date: meetingDate,
      p_cancelled: cancelled,
    });
    if (!error) return true;
    console.error('family-squares-web-sync: meeting status not kept', error.code ?? 'error');
  } catch {
    console.error('family-squares-web-sync: meeting status not kept');
  }
  return false;
}

/**
 * Queues the one "there's no Family Squares this Monday" note for members who
 * saved a seat or were waiting for their weekly seat. Called on every run
 * while the sync reply says cancelled; the database allows one note per
 * member per meeting. A failure is logged and changes nothing else. The count
 * only is logged, never who.
 */
async function announceCancelled(supabase: SupabaseClient, meetingDate: string): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('service_family_squares_announce_cancelled', {
      p_meeting_date: meetingDate,
    });
    if (error) console.error('family-squares-web-sync: cancelled notes not queued', error.code ?? 'error');
    else if (typeof data === 'number' && data > 0) console.log('family-squares-web-sync cancelled notes queued', data);
  } catch {
    console.error('family-squares-web-sync: cancelled notes not queued');
  }
}

/**
 * The real database and website behind saveWeeklySeats (the rules are in
 * _shared/family-squares-weekly-seats.ts). `saidCancelled` is what this run's
 * sync reply said about that Monday, or null when it did not say. Counts only
 * are returned and logged, never who.
 */
function weeklySeats(
  supabase: SupabaseClient,
  secret: string,
  meetingDate: string,
  deadline: number,
  saidCancelled: boolean | null,
): Promise<WeeklySeatSummary> {
  const url = websiteFunctionUrl('app-family-squares-sync', Deno.env.get('WEBSITE_FUNCTIONS_URL'));
  return saveWeeklySeats({
    // The sync reply is the authority on whether that Monday is on.
    syncSaidOn: saidCancelled === false,
    meetingCancelled: async () => {
      // What the website said a moment ago; otherwise what it said in the
      // last six hours (the database applies that limit). If neither is
      // known the meeting is taken to be on, and the website still decides
      // when it is asked about each member.
      if (saidCancelled !== null) return saidCancelled;
      try {
        const { data, error } = await supabase.rpc('family_squares_meeting_cancelled', { p_meeting_date: meetingDate });
        return !error && data === true;
      } catch {
        return false;
      }
    },
    candidates: async () => {
      const { data, error } = await supabase.rpc('service_family_squares_weekly_seat_candidates', {
        p_meeting_date: meetingDate,
      });
      if (!error && Array.isArray(data)) return data;
      console.error('family-squares-web-sync: weekly seat lookup failed', error?.code ?? 'invalid_response');
      return null;
    },
    timeLeftMs: () => deadline - Date.now(),
    // The meeting ended while this ran: the seat would be for the wrong Monday.
    sameMeeting: () => familySquaresSyncWindow(new Date()).meetingDate === meetingDate,
    ask: (member, timeoutMs) =>
      ensureWebsiteRegistration({ url, secret, meetingDate, email: member.email, name: member.name, timeoutMs }),
    save: async (accountId) => {
      const { data, error } = await supabase.rpc('service_family_squares_save_weekly_seat', {
        p_account_id: accountId,
        p_meeting_date: meetingDate,
      });
      if (error) console.error('family-squares-web-sync: weekly seat not saved', error.code ?? 'error');
      return !error && data === true;
    },
    hold: async (accountId, reason) => {
      const { error } = await supabase.rpc('service_family_squares_hold_weekly_seat', {
        p_account_id: accountId,
        p_meeting_date: meetingDate,
        p_reason: reason,
      });
      if (error) console.error('family-squares-web-sync: weekly seat answer not kept', error.code ?? 'error');
    },
    noteCancelled: async () => {
      await noteMeetingStatus(supabase, meetingDate, true);
    },
  });
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
  const accepted = res.ok && !(body && typeof body === 'object' && (body as { ok?: unknown }).ok === false);
  // What the website says about that Monday, kept on every run so a meeting
  // that is put back on is announced again. "On" is believed only from a sync
  // it accepted; a reply that does not say changes nothing.
  const saidCancelled = websiteMeetingCancelled(body, window.meetingDate);
  if (saidCancelled === true || (saidCancelled === false && accepted)) {
    const kept = await noteMeetingStatus(supabase, window.meetingDate, saidCancelled);
    // Cancelled, on the sync reply's word: members expecting a seat are told once.
    if (kept && saidCancelled) await announceCancelled(supabase, window.meetingDate);
  }
  if (!accepted) {
    console.error('family-squares-web-sync: website rejected the sync', res.status);
    return json({ ok: false, ...summary, error: `website_${res.status}` }, 502);
  }
  const website = { ...summarizeWebsiteSyncResponse(body), cancelled: saidCancelled };
  console.log('family-squares-web-sync', JSON.stringify({ ...summary, ...website }));

  // Only after a sync the website accepted, so an outage costs it no extra
  // calls. A failure here never changes the answer for the sync above.
  let seats: WeeklySeatSummary | null = null;
  try {
    seats = await weeklySeats(supabase, secret, window.meetingDate, deadline, saidCancelled);
    // Quiet when there was nobody to ask about, and on a cancelled Monday.
    if (seats.asked > 0 && seats.stopped !== 'meeting_cancelled') {
      console.log('family-squares-web-sync weekly seats', JSON.stringify(seats));
    }
  } catch {
    console.error('family-squares-web-sync: weekly seats failed');
  }
  return json({ ok: true, ...summary, website, weekly_seats: seats });
});
