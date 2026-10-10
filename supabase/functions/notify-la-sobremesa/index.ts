// notify-la-sobremesa — "starts in 15 minutes" push for La Sobremesa (Monday
// 8:00 PM Pacific), the Spanish call. Same contract as notify-session-reminder
// for The Family Squares: cron at both UTC offsets, sends only in the Monday
// 7 PM Pacific hour, only to members who reserved a place ("going") and keep
// the Monday call reminder on. The push opens Support, where their personal
// link is.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { sessionReminderData } from '../_shared/push-data.ts';
import { isLaSobremesaReminderHour } from '../_shared/la-sobremesa.ts';
import { checked, deliverLegacy, recordDelivery, remaining, tally } from '../_shared/legacy-sender-boundary.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const COPY = {
  title: 'Comienza en 15 minutos',
  body: 'La Sobremesa es esta noche a las 8:00 PM (Pacífico). Toca para entrar con tu enlace personal.',
};

Deno.serve(async (req) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  const { force } = await req.json().catch(() => ({ force: false }));
  const started = Date.now();
  if (!force && !isLaSobremesaReminderHour(new Date(started))) {
    return new Response('outside reminder hour');
  }
  const counts = tally();
  try {
    const sessionId = await checked(supabase.rpc('la_sobremesa_session_id'));
    if (!sessionId) return new Response('no session');
    const session = await checked(
      supabase.from('sessions').select('next_at').eq('id', sessionId).maybeSingle(),
    );
    const startsAt = session?.next_at ? Date.parse(session.next_at as string) : NaN;
    // Not shown after the call starts (a short window when forced for a test).
    const deadline = force ? started + 15 * 60000 : startsAt;
    if (!Number.isFinite(deadline) || deadline <= started) return new Response('no upcoming call');

    const candidates: string[] = [];
    let after: string | undefined;
    for (;;) {
      let query = supabase.from('session_rsvps').select('account_id')
        .eq('session_id', sessionId).eq('status', 'going')
        .order('account_id').limit(1000);
      if (after) query = query.gt('account_id', after);
      const page = await checked(query);
      if (!page?.length) break;
      candidates.push(...page.map((r) => r.account_id as string));
      if (page.length < 1000) break;
      after = page[page.length - 1].account_id as string;
    }
    if (!candidates.length) return new Response('no subscribers');

    const seen = new Set<string>();
    for (const accountId of candidates) {
      if (!remaining(deadline)) {
        counts.skipped++;
        continue;
      }
      try {
        // One snapshot binds the RSVP, consent and device.
        const row = await checked(
          supabase.from('session_rsvps')
            .select('account_id, accounts!inner(id, push_token, family_call_reminders)')
            .eq('account_id', accountId).eq('session_id', sessionId).eq('status', 'going')
            .maybeSingle(),
        );
        const a = row?.accounts as unknown as {
          id: string;
          push_token: string | null;
          family_call_reminders: boolean | null;
        } | null;
        if (!a?.push_token || a.id !== accountId || a.family_call_reminders !== true || seen.has(a.push_token)) {
          counts.skipped++;
          continue;
        }
        // The push promises a personal link: only members who have one for tonight.
        const link = await checked(
          supabase.from('session_join_links').select('starts_at')
            .eq('session_id', sessionId).eq('account_id', accountId).maybeSingle(),
        );
        // Tonight's link (allow for a provider rounding the start by a few minutes).
        const linkStart = link?.starts_at ? Date.parse(link.starts_at as string) : NaN;
        if (!Number.isFinite(linkStart) || Math.abs(linkStart - startsAt) > 30 * 60_000) {
          counts.skipped++;
          continue;
        }
        seen.add(a.push_token);
        recordDelivery(
          counts,
          await deliverLegacy({
            to: a.push_token,
            ...COPY,
            sound: 'default',
            data: sessionReminderData(sessionId),
          }, deadline),
        );
      } catch {
        counts.failed++;
        counts.retryable++;
      }
    }
    return new Response(JSON.stringify(counts), { status: counts.failed ? 502 : 200 });
  } catch {
    return new Response(JSON.stringify({ ...counts, error: 'lookup_failed' }), { status: 500 });
  }
});
