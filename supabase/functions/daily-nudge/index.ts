// Daily check-in nudge — Supabase Edge Function
//
// Sends the daily push via Expo to every account with a push_token that has
// NOT checked in today (their local day, by stored timezone).
//
// Deploy:   supabase functions deploy daily-nudge
// Schedule: supabase/config.toml or Dashboard → Edge Functions → Schedules,
//           cron "0 * * * *" (hourly; the timezone filter below makes it fire
//           for each member around 9 AM their local time).
//
// Uses the service role key (available to edge functions by default) — never
// shipped to clients.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { type Band } from '../_shared/situation.ts';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { dailyNudgeData } from '../_shared/push-data.ts';

import {
  checked,
  dayDeadline,
  deliverLegacy,
  freshDailyAccount,
  localDay,
  localHour,
  recordDelivery,
  remaining,
  tally,
} from '../_shared/legacy-sender-boundary.ts';

const NUDGE_HOUR_LOCAL = 9;

// State-aware copy: a gentler, support-forward nudge when the band is elevated
// or in crisis; the standard streak nudge otherwise.
const COPY: Record<
  string,
  { normal: { title: string; body: string }; support: { title: string; body: string } }
> = {
  en: {
    normal: {
      title: 'Your 90 seconds',
      body: 'A quick check-in keeps the castle strong. How are you holding up today?',
    },
    support: {
      title: 'Your 90 seconds',
      body: 'A quick check-in can help you pause and notice what you need today.',
    },
  },
  es: {
    normal: {
      title: 'Tus 90 segundos',
      body: 'Un registro rápido mantiene fuerte el castillo. ¿Cómo estás hoy?',
    },
    support: {
      title: 'Tus 90 segundos',
      body: 'Un registro rápido puede ayudarte a pausar y notar lo que necesitas hoy.',
    },
  },
};

function copyFor(language: string, band: Band) {
  const set = COPY[language] ?? COPY.en;
  return band === 'elevated' || band === 'crisis' ? set.support : set.normal;
}

Deno.serve(async (req) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const started = Date.now();
    const accounts: { id: string; timezone: string | null }[] = [];
    let after: string | undefined;
    for (;;) {
      let query = supabase.from('accounts').select('id, timezone')
        .not('push_token', 'is', null).eq('daily_push_opt_in', true).order('id').limit(1000);
      if (after) query = query.gt('id', after);
      const page = await checked(query);
      if (!page?.length) break;
      accounts.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1].id;
    }
    const candidates = (accounts ?? []).filter((a) =>
      localHour(started, a.timezone) === NUDGE_HOUR_LOCAL
    );
    if (!candidates.length) return new Response('no candidates this hour');
    const counts = tally();
    for (const candidate of candidates) {
      // Pin the original local day before IO; "today" cannot become tomorrow.
      const day = localDay(started, candidate.timezone);
      const deadline = dayDeadline(started, candidate.timezone);
      if (!remaining(deadline)) {
        counts.skipped++;
        continue;
      }
      try {
        const a = await freshDailyAccount(supabase, candidate.id, day);
        if (
          !a?.push_token || !a.daily_push_opt_in || a.checkedIn ||
          localDay(Date.now(), a.timezone) !== day ||
          localHour(Date.now(), a.timezone) !== NUDGE_HOUR_LOCAL
        ) {
          counts.skipped++;
          continue;
        }
        const band = a.band;
        const copy = copyFor(a.locale, band);
        recordDelivery(
          counts,
          await deliverLegacy({
            to: a.push_token,
            ...copy,
            sound: 'default',
            data: dailyNudgeData(band === 'elevated' || band === 'crisis' ? 'support' : 'today'),
          }, deadline),
        );
      } catch {
        counts.failed++;
        counts.retryable++;
      }
    }
    // Successful text contract stays unchanged. A failure is never "sent".
    if (counts.failed) return new Response(JSON.stringify(counts), { status: 500 });
    return new Response(`sent ${counts.sent}`);
  } catch {
    return new Response('lookup_failed', { status: 500 });
  }
});
