// Invitation Engine — "Tonight may be a window".
//
// pg_cron calls public.dispatch_invitation_window_push() hourly at :20 UTC,
// which POSTs here with the service-role key (vault lookup, same pattern as
// set_host_live). Each run:
//   1. asks invitation_window_push_candidates() for members who opted in inside
//      the engine, finished setup, have a device, have paid access, are not on
//      the safety-first path, were not pushed in the last 48 hours and whose
//      local clock reads 5 PM right now;
//   2. scores each with the shared receptivity forecast;
//   3. enqueues a localized push into push_outbox for "good" windows only
//      (enqueue_invitation_window_push re-checks opt-in, safety and the 48h cap
//      under a row lock). send-engagement-push's drain delivers it.
//
// Deploy: supabase functions deploy invitation-window-push

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';
import {
  evaluateWindowCandidate,
  type WindowCandidate,
  windowPushCopy,
} from '../_shared/invitation-window.ts';

/** Member-local hour at which tonight's window is evaluated (5 PM). */
const EVENING_HOUR = 17;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json(500, { error: 'supabase_env_missing' });
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  const { data, error } = await supabase.rpc('invitation_window_push_candidates', {
    p_now: now.toISOString(),
    p_local_hour: EVENING_HOUR,
  });
  if (error) {
    console.error('[invitation-window] candidate query failed', { code: error.code });
    return json(500, { error: 'candidates_failed' });
  }

  const candidates = (Array.isArray(data) ? data : []) as WindowCandidate[];
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  let queued = 0;

  for (const candidate of candidates) {
    const decision = evaluateWindowCandidate(candidate, now.getTime());
    if (!decision.push) {
      skip(decision.skipped ?? 'other');
      continue;
    }
    const copy = windowPushCopy(candidate.locale);
    const { data: enqueued, error: enqueueError } = await supabase.rpc('enqueue_invitation_window_push', {
      p_account_id: candidate.account_id,
      p_local_date: candidate.local_date,
      p_score: decision.forecast.score,
      p_sources: decision.forecast.sources,
      p_title: copy.title,
      p_body: copy.body,
      p_now: now.toISOString(),
    });
    if (enqueueError) {
      // Never log member ids or copy; the next evening retries naturally.
      console.error('[invitation-window] enqueue failed', { code: enqueueError.code });
      skip('error');
      continue;
    }
    if (enqueued === true) queued += 1;
    else skip('rechecked');
  }

  return json(200, { success: true, candidates: candidates.length, queued, skipped });
});
