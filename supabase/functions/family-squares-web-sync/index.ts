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

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { familySquaresSyncWindow } from '../_shared/family-squares-time.ts';
import {
  type Attendee,
  buildAttendees,
  summarizeAttendees,
  summarizeWebsiteSyncResponse,
  TooManyAttendeesError,
  websiteFunctionUrl,
} from '../_shared/website-bridge.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;

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
  return json({ ok: true, ...summary, website });
});
