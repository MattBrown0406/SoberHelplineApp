// Zoom link sync — Supabase Edge Function
//
// Finds the next upcoming "Family Squares" meeting on the Zoom account and
// writes its join URL + start time onto the Monday Night Family Support
// session row, so the app's Join button always points at this week's call.
//
// Setup (one time):
//   1. marketplace.zoom.us → Develop → Build App → Server-to-Server OAuth
//      (on the matt@soberhelpline.com account). Scope: meeting:read:list_meetings.
//      Copy Account ID, Client ID, Client Secret.
//   2. supabase secrets set ZOOM_ACCOUNT_ID=... ZOOM_CLIENT_ID=... ZOOM_CLIENT_SECRET=...
//   3. supabase functions deploy zoom-sync
//   4. Schedule daily (Dashboard → Edge Functions → zoom-sync → Schedules → "0 14 * * *").
//
// NOTE: unnecessary if the meeting becomes a true recurring Zoom meeting
// (fixed ID) — prefer that when possible.

import { createClient } from 'npm:@supabase/supabase-js@2';

const MEETING_TOPIC_MATCH = Deno.env.get('ZOOM_TOPIC_MATCH') ?? 'Family Squares';
// Tolerant match: the prod row is titled 'The Family Squares'; older seeds used
// 'Monday Night Family Support'. Matching only the old title silently updated
// zero rows.
const SESSION_TITLES = ['The Family Squares', 'Monday Night Family Support'];

async function zoomToken(): Promise<string> {
  const id = Deno.env.get('ZOOM_CLIENT_ID')!;
  const secret = Deno.env.get('ZOOM_CLIENT_SECRET')!;
  const account = Deno.env.get('ZOOM_ACCOUNT_ID')!;
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${account}`,
    { method: 'POST', headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}` } },
  );
  if (!res.ok) throw new Error(`zoom token: ${res.status}`);
  return (await res.json()).access_token as string;
}

Deno.serve(async () => {
  try {
    const token = await zoomToken();
    const res = await fetch(
      'https://api.zoom.us/v2/users/me/meetings?type=upcoming&page_size=30',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return new Response(`zoom list: ${res.status}`, { status: 500 });
    const { meetings } = await res.json();

    const next = (meetings ?? [])
      .filter((m: { topic?: string; join_url?: string; start_time?: string }) =>
        (m.topic ?? '').includes(MEETING_TOPIC_MATCH) && m.join_url && m.start_time)
      .sort((a: { start_time: string }, b: { start_time: string }) =>
        a.start_time.localeCompare(b.start_time))[0];

    if (!next) return new Response('no upcoming match — nothing updated');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: updated, error } = await supabase
      .from('sessions')
      .update({ zoom_url: next.join_url, next_at: next.start_time })
      .in('title', SESSION_TITLES)
      .select('id');
    if (error) return new Response(error.message, { status: 500 });
    if (!updated?.length) {
      return new Response('no session row matched — zoom link NOT saved', { status: 500 });
    }

    return new Response(`updated ${updated.length} row(s) → ${next.start_time}`);
  } catch (e) {
    return new Response(String(e), { status: 500 });
  }
});
