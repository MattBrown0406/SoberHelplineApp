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

const NUDGE_HOUR_LOCAL = 9;

const COPY: Record<string, { title: string; body: string }> = {
  en: { title: 'Your 90 seconds', body: 'A quick check-in keeps the castle strong. How are you holding up today?' },
  es: { title: 'Tus 90 segundos', body: 'Un registro rápido mantiene fuerte el castillo. ¿Cómo estás hoy?' },
};

Deno.serve(async () => {
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

  // Exclude anyone who already checked in today (UTC day — close enough for v1)
  const today = now.toISOString().slice(0, 10);
  const { data: checked } = await supabase
    .from('checkins')
    .select('account_id')
    .gte('created_at', `${today}T00:00:00Z`);
  const done = new Set((checked ?? []).map((c) => c.account_id));

  const messages = candidates
    .filter((a) => !done.has(a.id))
    .map((a) => ({
      to: a.push_token,
      title: (COPY[a.language] ?? COPY.en).title,
      body: (COPY[a.language] ?? COPY.en).body,
      sound: 'default',
    }));

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
