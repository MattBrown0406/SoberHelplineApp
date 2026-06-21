import { createClient } from 'npm:@supabase/supabase-js@2';
import { bandsForAccounts } from '../_shared/situation.ts';

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
      'This stretch has looked heavy. Be kind to yourself today — and remember a coach is one tap away if you want one.',
    morningTitle: 'Good morning',
    genericMorning: 'A quiet moment for you this morning: take one breath before the day begins.',
  },
  es: {
    mondayTitle: 'Llamada familiar hoy',
    mondayBody:
      'Es lunes — únete esta noche a la reunión de Zoom The Family Squares a las 7:00 PM (Pacífico). Acompáñate de quienes entienden lo que estás viviendo.',
    supportTitle: 'Un comienzo suave',
    supportBody:
      'Esta etapa se ha visto difícil. Sé amable contigo hoy — y recuerda que un coach está a un toque si lo deseas.',
    morningTitle: 'Buenos días',
    genericMorning: 'Un momento de calma para ti esta mañana: respira una vez antes de empezar el día.',
  },
};

const DAILY_CHALLENGES = [
  'Practice saying "no" once today — and resist the urge to explain yourself afterward.',
  'Write down one limit you\'ve held this week, even if it was hard. Notice how it felt.',
  'Take a 20-minute walk without your phone. Just you and your thoughts.',
  'Tell someone who supports you "I appreciate you" today — a text counts.',
  'Identify one responsibility you\'ve been carrying that truly belongs to someone else.',
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
  'Notice one thing today that you\'re grateful for that has nothing to do with recovery.',
  'Write one sentence you would say to a close friend in your exact situation.',
  'Identify a relationship in your life that genuinely energizes you. Invest in it today.',
  'Celebrate one small win from this week — no matter how minor it seems.',
  'Spend 10 minutes in complete silence. No phone. No background noise. Just you.',
  'Write down three things you love about yourself that have nothing to do with caregiving.',
  'Let yourself feel what you\'re feeling today without trying to fix or change it.',
  'Choose one thing today that is purely for your own joy — and do not apologize for it.',
];

function dayOfYear(d: Date): number {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
}

interface Acct {
  id: string;
  push_token: string;
  language: string;
}

Deno.serve(async () => {
  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('id, push_token, language')
    .not('push_token', 'is', null);

  if (error || !accounts?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const challenge = DAILY_CHALLENGES[dayOfYear(now) % DAILY_CHALLENGES.length];
  const bands = await bandsForAccounts(
    supabase,
    (accounts as Acct[]).map((a) => a.id),
  );

  // Monday: free-call reminder for everyone. Otherwise: a supportive nudge for
  // an elevated/crisis band, else the daily challenge (en) / a gentle line (es).
  const messages = (accounts as Acct[]).map((a) => {
    const c = COPY[a.language] ?? COPY.en;
    const band = bands.get(a.id) ?? 'calm';

    if (isMonday) {
      return { to: a.push_token, title: c.mondayTitle, body: c.mondayBody, sound: 'default', data: { screen: 'support' } };
    }
    if (band === 'elevated' || band === 'crisis') {
      return { to: a.push_token, title: c.supportTitle, body: c.supportBody, sound: 'default', data: { screen: 'support' } };
    }
    const body = a.language === 'es' ? c.genericMorning : challenge;
    return { to: a.push_token, title: c.morningTitle, body, sound: 'default', data: { screen: 'boundaries' } };
  });

  // Expo push limit is 100 messages per request
  for (let i = 0; i < messages.length; i += 100) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }

  return new Response(JSON.stringify({ sent: messages.length }), { status: 200 });
});
