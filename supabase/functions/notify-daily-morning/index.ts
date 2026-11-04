import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  dayDeadline,
  deliverLegacy,
  freshDailyAccount,
  localDay,
  localHour,
  recordDelivery,
  remaining,
  tally,
} from '../_shared/legacy-sender-boundary.ts';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { morningNoteData } from '../_shared/push-data.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Bilingual copy for the Monday free-call reminder and the state-aware
// supportive variant. The English daily-challenge pool below is used for calm/
// watch English members; Spanish members get a localized generic morning line.
const COPY: Record<
  string,
  {
    mondayTitle: string;
    mondayBody: string;
    supportTitle: string;
    supportBody: string;
    morningTitle: string;
    genericMorning: string;
  }
> = {
  en: {
    mondayTitle: 'Family call tonight',
    mondayBody:
      "It's Monday — join The Family Squares Zoom meeting tonight at 7:00 PM Pacific. Be with people who understand what you're going through.",
    supportTitle: 'A gentle start',
    supportBody:
      'Take one quiet breath before the day begins. Open the app whenever you want support.',
    morningTitle: 'Good morning',
    genericMorning: 'A quiet moment for you this morning: take one breath before the day begins.',
  },
  es: {
    mondayTitle: 'La Sobremesa es hoy',
    mondayBody:
      'Es lunes — únete esta noche a La Sobremesa, nuestra reunión en español por Zoom, a las 8:00 PM (Pacífico). Acompáñate de quienes entienden lo que estás viviendo.',
    supportTitle: 'Un comienzo suave',
    supportBody: 'Respira con calma antes de empezar el día. Abre la app cuando quieras apoyo.',
    morningTitle: 'Buenos días',
    genericMorning:
      'Un momento de calma para ti esta mañana: respira una vez antes de empezar el día.',
  },
};

const DAILY_CHALLENGES = [
  'Practice saying "no" once today — and resist the urge to explain yourself afterward.',
  "Write down one limit you've held this week, even if it was hard. Notice how it felt.",
  'Take a 20-minute walk without your phone. Just you and your thoughts.',
  'Tell someone who supports you "I appreciate you" today — a text counts.',
  "Identify one responsibility you've been carrying that truly belongs to someone else.",
  'Make a nourishing meal just for yourself today. Sit down and actually taste it.',
  'Write a single sentence you can say the next time someone pressures you.',
  'Do something for 30 minutes that has nothing to do with your loved one.',
  'Check in with your body — are you running on empty? Do one thing to refuel.',
  'Name one enabling behavior you want to change. Write it down, just for you.',
  'Reach out to one person in your support network today, even just to say hello.',
  'When you feel the urge to rescue someone today, pause and ask: "Is this mine to carry?"',
  'Give yourself permission to rest today — no problem-solving, just rest.',
  'Write down your three most important values. Are your actions reflecting them today?',
  'Plan one small thing to look forward to this week. Put it in your calendar.',
  'Tell yourself out loud: "I am doing the best I can. That is enough."',
  'Identify one situation where you said yes when you wanted to say no. What stopped you?',
  'Set a technology-free hour this evening. Read, draw, or just sit.',
  'Write two sentences about why you are doing this hard work.',
  'Do a physical reset: stretch, take a bath, or breathe deeply for five minutes.',
  'Reflect on one moment this week when a limit you held helped keep the peace.',
  "Notice one thing today that you're grateful for that has nothing to do with recovery.",
  'Write one sentence you would say to a close friend in your exact situation.',
  'Identify a relationship in your life that genuinely energizes you. Invest in it today.',
  'Celebrate one small win from this week — no matter how minor it seems.',
  'Spend 10 minutes in complete silence. No phone. No background noise. Just you.',
  'Write down three things you love about yourself that have nothing to do with caregiving.',
  "Let yourself feel what you're feeling today without trying to fix or change it.",
  'Choose one thing today that is purely for your own joy — and do not apologize for it.',
];

function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
}

// When it is sent. Production's cron 'daily-morning-notification' calls this
// hourly with {"mode":"local"}: each member gets it at her chosen reminder hour
// (accounts.daily_push_hour, default 9 AM) her own time, and only for a morning
// hour — for Midday/Evening/Night the app sends her check-in nudge instead.
// An empty body ("daily" run, once at 16:00 UTC) still works as a fallback but
// skips anyone for whom it is not 6:00 AM–12:59 PM. "It's Monday" means Monday
// where she is.
const DAILY_RUN_MORNING = { from: 6, until: 13 };
const LOCAL_MORNING_HOUR = 9;

/**
 * The hour she chose for her daily reminder (accounts.daily_push_hour, NULL =
 * the 9 AM default), or null when it is not a morning hour: the app then
 * sends her own check-in nudge at that time instead, and this morning note
 * would be a second notification at the wrong time.
 */
function morningNoteHour(dailyPushHour: number | null | undefined): number | null {
  const hour = dailyPushHour ?? LOCAL_MORNING_HOUR;
  return hour < 12 ? hour : null;
}

/** Day of the week (0 = Sunday) where she is. */
function localWeekday(now: number, timezone: string | null): number {
  return new Date(`${localDay(now, timezone)}T00:00:00Z`).getUTCDay();
}

interface Acct {
  id: string;
  push_token: string;
  locale: string | null;
  timezone: string | null;
  daily_push_hour: number | null;
}

const PAGE_SIZE = 1000;

// Only members who opted into daily reminders; paged past PostgREST's row cap.
async function optedInAccounts(): Promise<Acct[] | null> {
  const rows: Acct[] = [];
  let after: string | undefined;
  for (;;) {
    let query = supabase
      .from('accounts')
      .select('id, push_token, locale, timezone, daily_push_hour')
      .not('push_token', 'is', null)
      .eq('daily_push_opt_in', true)
      .order('id')
      .limit(PAGE_SIZE);
    if (after) query = query.gt('id', after);
    const { data, error } = await query;
    if (error) return null;
    rows.push(...((data ?? []) as Acct[]));
    if (!data || data.length < PAGE_SIZE) return rows;
    after = data[data.length - 1].id;
  }
}

Deno.serve(async (req) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  const { mode } = await req.json().catch(() => ({}));
  const hourly = mode === 'local';
  // Pin copy/day before discovery IO, not after a delayed account scan.
  const now = new Date();
  const started = now.getTime();
  const dailyDeadline = dayDeadline(started, 'UTC');
  const all = await optedInAccounts().catch(() => null);
  if (all === null) {
    return new Response(JSON.stringify({ error: 'accounts_unavailable' }), { status: 500 });
  }
  const accounts = all.filter((a) => {
    const target = morningNoteHour(a.daily_push_hour);
    return target !== null && (!hourly || localHour(started, a.timezone) === target);
  });
  if (!accounts.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const challenge = DAILY_CHALLENGES[dayOfYear(now) % DAILY_CHALLENGES.length];
  const counts = tally();
  for (const candidate of accounts) {
    // Her own day, pinned before IO: "today" cannot become tomorrow.
    const day = localDay(started, candidate.timezone);
    const deadline = hourly ? dayDeadline(started, candidate.timezone) : dailyDeadline;
    if (!remaining(deadline)) {
      counts.skipped++;
      continue;
    }
    try {
      const a = await freshDailyAccount(supabase, candidate.id);
      if (!a?.push_token || !a.daily_push_opt_in) {
        counts.skipped++;
        continue;
      }
      // Re-checked at send time with her current time zone and chosen hour.
      const hour = localHour(Date.now(), a.timezone);
      const target = morningNoteHour(a.daily_push_hour);
      if (
        target === null || (hourly
          ? hour !== target || localDay(Date.now(), a.timezone) !== day
          : hour < DAILY_RUN_MORNING.from || hour >= DAILY_RUN_MORNING.until)
      ) {
        counts.skipped++;
        continue;
      }
      const isMonday = localWeekday(Date.now(), a.timezone) === 1;
      const band = a.band;
      const lang = a.locale === 'es' ? 'es' : 'en';
      const c = COPY[lang];
      const support = band === 'elevated' || band === 'crisis';
      // After her loved one died the daily boundaries challenge stops; she
      // keeps a neutral morning line (her app schedules no local nudge for
      // this hour) and Monday's call note.
      const bereaved = a.bereaved;
      const copy = isMonday
        ? { title: c.mondayTitle, body: c.mondayBody }
        : bereaved
        ? { title: c.morningTitle, body: c.genericMorning }
        : support
        ? { title: c.supportTitle, body: c.supportBody }
        : { title: c.morningTitle, body: lang === 'es' ? c.genericMorning : challenge };
      recordDelivery(
        counts,
        await deliverLegacy({
          to: a.push_token,
          ...copy,
          sound: 'default',
          data: morningNoteData(isMonday || support || bereaved ? 'support' : 'boundaries'),
        }, deadline),
      );
    } catch {
      counts.failed++;
      counts.retryable++;
    }
  }
  return new Response(JSON.stringify(counts), { status: counts.failed ? 500 : 200 });
});
