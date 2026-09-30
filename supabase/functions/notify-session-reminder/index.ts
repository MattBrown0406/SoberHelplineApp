import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { sessionReminderData } from '../_shared/push-data.ts';
import { isFamilySquaresReminderHour } from '../_shared/family-squares-time.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const COPY = {
  en: { title: 'Starting in 15 minutes', body: 'The Family Squares is tonight at 7:00 PM Pacific — tap to join' },
  es: { title: 'Comienza en 15 minutos', body: 'The Family Squares es esta noche a las 7:00 PM (Pacífico) — toca para unirte' },
};

Deno.serve(async (req) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  const { force } = await req.json().catch(() => ({ force: false }));
  // Scheduled at both UTC times that can be 6:45 PM Pacific; only one is.
  if (!force && !isFamilySquaresReminderHour(new Date())) {
    return new Response('outside reminder hour', { status: 200 });
  }

  const { data: targets, error } = await supabase.rpc('get_session_reminder_targets');
  if (error) return new Response(error.message, { status: 500 });
  if (!targets?.length) return new Response('no subscribers', { status: 200 });
  const { data: sessionId } = await supabase.rpc('family_squares_session_id');

  const seen = new Set<string>();
  const messages = [];
  for (const row of targets as { push_token: string; locale: string | null }[]) {
    if (seen.has(row.push_token)) continue;
    seen.add(row.push_token);
    const copy = (row.locale ?? 'en').startsWith('es') ? COPY.es : COPY.en;
    messages.push({ to: row.push_token, ...copy, sound: 'default', data: sessionReminderData(sessionId) });
  }

  // Expo accepts at most 100 messages per request.
  let failed = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    if (!res.ok) failed += Math.min(100, messages.length - i);
  }

  return new Response(JSON.stringify({ sent: messages.length - failed, failed }), { status: failed ? 502 : 200 });
});
