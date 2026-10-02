// Family Squares link sync — Supabase Edge Function (service role only).
//
// soberhelpline.com owns the Monday call: it creates each week's Zoom meeting
// (auto-create-monday-zoom) and can swap tonight's (replace-tonight-zoom-meeting),
// publishing the current join link in its public site_settings. This copies
// that link onto the app's Family Squares session row, with the next Monday
// 7 PM Pacific start, so the app's Join button always matches the website.
// Scheduled every 10 minutes by pg_cron (shl-family-squares-link-sync).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { nextFamilySquaresStart, validZoomJoinUrl } from '../_shared/family-squares-time.ts';

// soberhelpline.com's public (publishable) project values — the same ones the
// app uses for the provider directory. site_settings rows read here are public.
const WEBSITE_URL = Deno.env.get('WEBSITE_SUPABASE_URL') ?? 'https://anwqprmpzmcqbkttmxos.supabase.co';
const WEBSITE_ANON_KEY = Deno.env.get('WEBSITE_SUPABASE_ANON_KEY')
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFud3Fwcm1wem1jcWJrdHRteG9zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwMDE1MTcsImV4cCI6MjA3OTU3NzUxN30.zvikfr-0JzQwwqMgOcoZFMuU-w0VyGL28pxB3AXVj2k';

Deno.serve(async (req) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  try {
    const res = await fetch(
      `${WEBSITE_URL}/rest/v1/site_settings?select=key,value&key=eq.monday_zoom_link`,
      { headers: { apikey: WEBSITE_ANON_KEY, Authorization: `Bearer ${WEBSITE_ANON_KEY}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return new Response(`website settings: ${res.status}`, { status: 502 });
    const rows = await res.json() as Array<{ key: string; value: unknown }>;
    const link = validZoomJoinUrl(rows.find((row) => row.key === 'monday_zoom_link')?.value);
    if (!link) return new Response('website has no valid Monday link — nothing updated', { status: 502 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: sessionId, error: idError } = await supabase.rpc('family_squares_session_id');
    if (idError || typeof sessionId !== 'string') {
      return new Response('no Family Squares session row — link NOT saved', { status: 500 });
    }
    const nextAt = nextFamilySquaresStart(new Date()).toISOString();
    const { data: current } = await supabase.from('sessions').select('zoom_url, next_at').eq('id', sessionId).maybeSingle();
    const sameNext = current?.next_at && new Date(current.next_at as string).toISOString() === nextAt;
    if (current?.zoom_url === link && sameNext) return new Response('unchanged');

    const { error } = await supabase.from('sessions').update({ zoom_url: link, next_at: nextAt }).eq('id', sessionId);
    if (error) return new Response('update failed', { status: 500 });
    return new Response(`updated → ${nextAt}${current?.zoom_url === link ? '' : ' (new link)'}`);
  } catch {
    return new Response('sync failed', { status: 500 });
  }
});
