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
import { bandsForAccounts, type Band } from '../_shared/situation.ts';
import { requireServiceRole } from '../_shared/service-auth.ts';

const NUDGE_HOUR_LOCAL = 9;

// State-aware copy: a gentler, support-forward nudge when the band is elevated
// or in crisis; the standard streak nudge otherwise.
const COPY: Record<string, { normal: { title: string; body: string }; support: { title: string; body: string } }> = {
  en: {
    normal: { title: 'Your 90 seconds', body: 'A quick check-in keeps the castle strong. How are you holding up today?' },
    support: { title: 'Your 90 seconds', body: 'A quick check-in can help you pause and notice what you need today.' },
  },
  es: {
    normal: { title: 'Tus 90 segundos', body: 'Un registro rápido mantiene fuerte el castillo. ¿Cómo estás hoy?' },
    support: { title: 'Tus 90 segundos', body: 'Un registro rápido puede ayudarte a pausar y notar lo que necesitas hoy.' },
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

  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('id, push_token, language, timezone')
    .not('push_token', 'is', null);
  if (error) return new Response(error.message, { status: 500 });

  const now = new Date();
  const candidates = (accounts ?? []).filter((a) => {
    const localHour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', hour12: false, timeZone: a.timezone || 'America/New_York',
      }).format(now),
    );
    return localHour === NUDGE_HOUR_LOCAL;
  });
  if (candidates.length === 0) return new Response('no candidates this hour');

  // Exclude members who already checked in on their own account-local day.
  const localDate = (timezone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const candidateIds = candidates.map((account) => account.id);
  const candidateDates = candidates.map((account) => localDate(account.timezone)).sort();
  const { data: checked } = await supabase
    .from('checkins')
    .select('account_id, checkin_date')
    .in('account_id', candidateIds)
    .gte('checkin_date', candidateDates[0])
    .lte('checkin_date', candidateDates[candidateDates.length - 1]);
  const done = new Set((checked ?? []).map((checkin) => `${checkin.account_id}:${checkin.checkin_date}`));

  const recipients = candidates.filter((account) => !done.has(`${account.id}:${localDate(account.timezone)}`));
  const bands = await bandsForAccounts(supabase, recipients.map((a) => a.id));

  const messages = recipients.map((a) => {
    const band = bands.get(a.id) ?? 'calm';
    const copy = copyFor(a.language, band);
    return {
      to: a.push_token,
      title: copy.title,
      body: copy.body,
      sound: 'default',
      data: { screen: band === 'elevated' || band === 'crisis' ? 'support' : 'today' },
    };
  });

  // Expo push API accepts batches of 100
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  return new Response(`sent ${messages.length}`);
});
