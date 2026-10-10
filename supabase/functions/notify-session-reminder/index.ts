import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { sessionReminderData } from '../_shared/push-data.ts';
import { isFamilySquaresReminderHour } from '../_shared/family-squares-time.ts';
import {
  checked,
  deliverLegacy,
  recordDelivery,
  remaining,
  sessionDeadline,
  tally,
} from '../_shared/legacy-sender-boundary.ts';
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const COPY = {
  en: {
    title: 'Starting in 15 minutes',
    body: 'The Family Squares is tonight at 7:00 PM Pacific — tap to join',
  },
};
Deno.serve(async (req) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  const { force } = await req.json().catch(() => ({ force: false }));
  const started = Date.now();
  if (!force && !isFamilySquaresReminderHour(new Date(started))) {
    return new Response('outside reminder hour');
  }
  // Explicit operator force retains its off-schedule test contract. Its short
  // window is pinned once; normal scheduled requests use the actual call time.
  const deadline = force ? started + 15 * 60000 : sessionDeadline(started);
  const counts = tally();
  try {
    const sessionId = await checked(supabase.rpc('family_squares_session_id'));
    if (!sessionId) return new Response('no subscribers');
    // Discover stable identities, never reverse-map a cached token list. A token
    // rotating during discovery must not silently lose an otherwise valid RSVP.
    const candidates: { id: string }[] = [];
    let after: string | undefined;
    for (;;) {
      let query = supabase.from('session_rsvps').select('account_id')
        .eq('session_id', sessionId).eq('status', 'going')
        .order('account_id').limit(1000);
      if (after) query = query.gt('account_id', after);
      const page = await checked(query);
      if (!page?.length) break;
      candidates.push(...page.map((r) => ({ id: r.account_id as string })));
      if (page.length < 1000) break;
      after = page[page.length - 1].account_id;
    }
    if (!candidates.length) return new Response('no subscribers');
    const seen = new Set<string>();
    for (const candidate of candidates ?? []) {
      if (!remaining(deadline)) {
        counts.skipped++;
        continue;
      }
      try {
        const currentSession = await checked(supabase.rpc('family_squares_session_id'));
        if (currentSession !== sessionId) {
          counts.skipped++;
          continue;
        }
        // Single database snapshot binds consent, account existence and device.
        // Consent is the Monday call reminder switch (accounts.family_call_reminders),
        // exactly as the dispatcher's own Monday reminders require; a "going"
        // RSVP alone is not consent.
        const row = await checked(
          supabase.from('session_rsvps')
            .select('account_id, accounts!inner(id, push_token, locale, family_call_reminders)')
            .eq('account_id', candidate.id).eq('session_id', sessionId).eq('status', 'going')
            .maybeSingle(),
        );
        const a = row?.accounts as unknown as {
          id: string;
          push_token: string | null;
          locale: string | null;
          family_call_reminders: boolean | null;
        } | null;
        // Spanish members are invited to La Sobremesa (8 PM), never The Family
        // Squares; notify-la-sobremesa reminds them.
        if (
          !a?.push_token || a.id !== candidate.id || a.family_call_reminders !== true ||
          seen.has(a.push_token) || String(a.locale ?? '').toLowerCase().startsWith('es')
        ) {
          counts.skipped++;
          continue;
        }
        seen.add(a.push_token);
        const copy = COPY.en;
        recordDelivery(
          counts,
          await deliverLegacy({
            to: a.push_token,
            ...copy,
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
