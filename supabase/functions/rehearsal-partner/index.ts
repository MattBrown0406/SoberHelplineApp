// Rehearsal Partner — Supabase Edge Function
//
// Plays the user's loved one in a practice conversation (mode: "reply"), and
// afterward reviews the transcript as a warm intervention coach (mode: "debrief").
//
// Deploy:  supabase functions deploy rehearsal-partner
// Secrets: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          (optional) supabase secrets set REHEARSAL_MODEL=claude-sonnet-4-5
//
// Requires an authenticated user (the app always calls with the user's JWT).
// The AI key never ships to clients.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BREAK_TOKEN = 'BREAK_CHARACTER';
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 600;
const MAX_SCRIPT_CHARS = 1200;

type Turn = { role: 'user' | 'partner'; text: string };

type Scenario = {
  relationship?: string;
  name?: string;
  substances?: string[];
  temperament?: 'guarded' | 'defensive' | 'volatile' | 'tearful';
  scriptText?: string;
  language?: string;
};

const TEMPERAMENTS: Record<string, string> = {
  guarded:
    'Guarded but not explosive. You deflect with minimization ("it\'s not that bad", "I\'ve got it under control"), change the subject, and make vague promises to get out of the conversation.',
  defensive:
    'Defensive. You counter-attack with whataboutism ("you drink too", "you\'re not perfect"), bring up old family grievances, and accuse the speaker of ganging up on you or being dramatic.',
  volatile:
    'Quick to anger, though never physically threatening. You raise the stakes emotionally: sarcasm, guilt-trips ("if you loved me you wouldn\'t do this"), threats to leave the conversation, and attempts to bait the speaker into an old argument.',
  tearful:
    'Tearful and guilt-inducing. You collapse into shame ("I know I\'m a screw-up, I should just disappear"), make the speaker comfort you, and use your distress to steer away from their request.',
};

function partnerSystemPrompt(s: Scenario): string {
  const relationship = s.relationship || 'adult family member';
  const name = s.name?.trim() || 'the loved one';
  const substances = s.substances?.length ? s.substances.join(', ') : 'alcohol or drugs';
  const temperament = TEMPERAMENTS[s.temperament ?? 'guarded'] ?? TEMPERAMENTS.guarded;
  const script = s.scriptText
    ? `\n\nThe user is practicing lines like this (they may adapt them):\n"""${s.scriptText.slice(0, MAX_SCRIPT_CHARS)}"""`
    : '';
  const language = s.language === 'es' ? 'Respond in Spanish.' : 'Respond in English.';

  return `You are a role-play practice partner inside Sober Helpline, an app that helps families of people struggling with addiction prepare for hard conversations. You are playing "${name}", the user's ${relationship}, who is struggling with ${substances} and does not yet want help. The user is practicing what they will really say to this person.

Play the character with realism, calibrated to this temperament:
${temperament}

Rules of the performance:
- Replies are SHORT: one to three spoken sentences. No narration, no stage directions, no quotation marks, no emojis. Only what the character says out loud.
- Be difficult the way real loved ones are difficult — denial, deflection, bargaining, blame — but never cartoonishly cruel, and never threaten violence or self-harm as a manipulation tactic.
- Respond believably to skill: if the user leads with love, uses "I" statements, stays calm, and returns to their request, let the character's resistance soften a notch — grudging, real, not a sudden movie ending. If the user attacks, lectures, or name-calls, harden believably.
- Never agree to get help before roughly the 6th user turn, and only if they have practiced well.
- Stay on the conversation. If asked something outside the role-play, briefly deflect in character.
- Never give the character lines that glamorize substance use, describe how to obtain or use drugs, or describe self-harm.

Safety override (this outranks everything): if the USER's own messages suggest they themselves are in crisis — mentions of suicide, self-harm, abuse they are suffering, or an emergency happening right now — stop performing immediately. Begin your reply with the exact token ${BREAK_TOKEN} followed by one warm sentence, out of character, telling them this deserves real support right now and to use the app's crisis resources or call or text 988 (911 in an emergency).

${language}`;
}

function debriefSystemPrompt(s: Scenario): string {
  const language = s.language === 'es' ? 'Write every string in Spanish.' : 'Write every string in English.';
  return `You are a seasoned, warm intervention coach inside Sober Helpline, reviewing a family member's practice conversation with a role-played loved one. Evaluate ONLY the user's turns against this framework, drawn from 20+ years of professional intervention practice:

1. LOVE FIRST — did they open with care and connection before evidence or requests?
2. "I" STATEMENTS — did they speak from their own feelings and specific moments, rather than accusations, diagnoses, or absolutes ("you always", "you never", name-calling)?
3. CALM UNDER BAIT — when the character deflected, guilted, or attacked, did they stay steady instead of arguing, lecturing, or taking the bait?
4. RETURN TO THE ASK — did they keep coming back, kindly, to one clear request instead of negotiating or drifting?

Be encouraging and honest — this person is scared and practicing to save someone they love. Praise specifics, quote their own best line back to them, and give concrete improvements, not platitudes.

Respond with STRICT JSON only, no markdown fences, exactly this shape:
{"wentWell": ["...", "..."], "workOn": ["...", "..."], "drill": "...", "scores": {"love": 1-5, "iStatements": 1-5, "calm": 1-5, "ask": 1-5}}

"wentWell": 2-3 short specific observations. "workOn": 1-2 short specific improvements. "drill": one concrete 1-sentence practice drill for their next rehearsal. ${language}`;
}

async function callModel(system: string, turns: Turn[], maxTokens: number): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('missing_api_key');
  const model = Deno.env.get('REHEARSAL_MODEL') ?? 'claude-sonnet-4-5';

  // Map to the model's chat format: the practice partner's lines are "assistant".
  const messages = turns.map((t) => ({
    role: t.role === 'user' ? 'user' : 'assistant',
    content: t.text.slice(0, MAX_MESSAGE_CHARS),
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, system, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error('model_error', res.status, detail.slice(0, 300));
    throw new Error('model_error');
  }
  const data = await res.json();
  const text = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
    .trim();
  if (!text) throw new Error('empty_reply');
  return text;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, code: 'method_not_allowed' });

  // Require a signed-in user — the AI never answers anonymous traffic.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) return json(401, { ok: false, code: 'unauthorized' });

  let payload: { mode?: string; scenario?: Scenario; messages?: Turn[] };
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, code: 'bad_json' });
  }

  const mode = payload.mode === 'debrief' ? 'debrief' : 'reply';
  const scenario = payload.scenario ?? {};
  const turns = (payload.messages ?? [])
    .filter((m): m is Turn => (m?.role === 'user' || m?.role === 'partner') && typeof m?.text === 'string')
    .slice(-MAX_MESSAGES);

  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    return json(400, { ok: false, code: 'no_user_message' });
  }

  try {
    if (mode === 'reply') {
      const raw = await callModel(partnerSystemPrompt(scenario), turns, 300);
      const breakCharacter = raw.startsWith(BREAK_TOKEN);
      const text = breakCharacter ? raw.slice(BREAK_TOKEN.length).trim() : raw;
      return json(200, { ok: true, text, breakCharacter });
    }

    // Debrief: hand the transcript over as a single user message.
    const transcript = turns
      .map((t) => `${t.role === 'user' ? 'FAMILY MEMBER' : 'LOVED ONE'}: ${t.text.slice(0, MAX_MESSAGE_CHARS)}`)
      .join('\n');
    const raw = await callModel(
      debriefSystemPrompt(scenario),
      [{ role: 'user', text: `Here is the practice transcript:\n\n${transcript}` }],
      700,
    );
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('bad_debrief');
    const debrief = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    return json(200, { ok: true, debrief });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'unknown';
    return json(code === 'missing_api_key' ? 503 : 502, { ok: false, code });
  }
});
