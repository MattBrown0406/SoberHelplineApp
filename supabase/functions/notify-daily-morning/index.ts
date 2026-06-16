import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const MONDAY_CHALLENGE =
  "It's Monday — join The Family Squares Zoom meeting tonight at 7:00 PM Pacific. Be with people who understand what you're going through.";

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

function getTodayChallenge(): string {
  const now = new Date();
  if (now.getUTCDay() === 1) return MONDAY_CHALLENGE;
  return DAILY_CHALLENGES[dayOfYear(now) % DAILY_CHALLENGES.length];
}

Deno.serve(async () => {
  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('push_token')
    .not('push_token', 'is', null);

  if (error || !accounts?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const challenge = getTodayChallenge();
  const tokens = accounts.map((a: { push_token: string }) => a.push_token);

  // Expo push limit is 100 messages per request
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100).map((token: string) => ({
      to: token,
      title: 'Good morning',
      body: challenge,
      sound: 'default',
      data: { screen: 'boundaries' },
    }));

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
  }

  return new Response(JSON.stringify({ sent: tokens.length }), { status: 200 });
});
