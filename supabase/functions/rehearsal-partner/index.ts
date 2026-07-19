// Rehearsal Partner — Supabase Edge Function
//
// The Rehearsal Room's backend. Four modes:
//   reply   — the AI plays the loved one and returns its next line
//             (optionally with spoken audio via ElevenLabs when `voice` is set)
//   debrief — coach feedback on the transcript, strict JSON
//   stt     — transcribe the user's recorded speech (OpenAI Whisper)
//   tts     — synthesize arbitrary partner text (used for replays)
//
// Deploy:  supabase functions deploy rehearsal-partner
// Secrets: supabase secrets set OPENAI_API_KEY=sk-...          # LLM + speech-to-text
//          supabase secrets set ELEVENLABS_API_KEY=...         # voices
//          (either OPENAI_API_KEY or ANTHROPIC_API_KEY works for the LLM;
//           OpenAI is preferred when both are set)
// Optional overrides:
//          REHEARSAL_MODEL        (default: gpt-4o-mini — cheapest with a convincing performance;
//                                  set to gpt-4o if the character ever feels flat)
//          ELEVENLABS_MODEL       (default: eleven_multilingual_v2 — covers EN + ES)
//          REHEARSAL_VOICE_MAP    (JSON: {"male":{"young":"voiceId",...},"female":{...}})
//
// Requires an authenticated user. No API key ever ships to clients.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BREAK_TOKEN = 'BREAK_CHARACTER';
const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 600;
const MAX_SCRIPT_CHARS = 1200;
const MAX_TTS_CHARS = 900;
const MAX_AUDIO_B64 = 2_000_000; // ~1.5MB of recorded speech per STT request

type Turn = { role: 'user' | 'partner'; text: string };

type VoiceChoice = { gender?: 'male' | 'female'; age?: 'young' | 'middle' | 'older' };

type Scenario = {
  relationship?: string;
  name?: string;
  substances?: string[];
  temperament?: 'guarded' | 'defensive' | 'volatile' | 'tearful';
  scriptText?: string;
  language?: string;
  voice?: VoiceChoice;
};

// Default ElevenLabs premade voices per gender × age. These are widely available
// premade voice IDs; swap any of them via the REHEARSAL_VOICE_MAP secret using
// picks from your own Voice Library (Dashboard → Voices → ID).
const DEFAULT_VOICE_MAP: Record<string, Record<string, string>> = {
  male: {
    young: 'TxGEqnHWrfWFTfGW9XjX', // Josh — younger adult male
    middle: 'pNInz6obpgDQGcFmaJgB', // Adam — middle-aged male
    older: 'VR6AewLTigWG4xSOukaG', // Arnold — older, rougher male
  },
  female: {
    young: 'EXAVITQu4vr4xnSDxMaL', // Sarah/Bella — younger adult female
    middle: '21m00Tcm4TlvDq8ikWAM', // Rachel — middle-aged female
    older: 'pFZP5JQG7iQjIQuC4Bku', // Lily — warm older female
  },
};

function voiceIdFor(choice: VoiceChoice | undefined): string {
  let map = DEFAULT_VOICE_MAP;
  const override = Deno.env.get('REHEARSAL_VOICE_MAP');
  if (override) {
    try {
      map = { ...DEFAULT_VOICE_MAP, ...JSON.parse(override) };
    } catch {
      console.error('bad REHEARSAL_VOICE_MAP JSON — using defaults');
    }
  }
  const gender = choice?.gender === 'female' ? 'female' : 'male';
  const age = choice?.age === 'young' || choice?.age === 'older' ? choice.age : 'middle';
  return map[gender]?.[age] ?? DEFAULT_VOICE_MAP[gender][age];
}

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

const AGE_DESCRIPTIONS: Record<string, string> = {
  young: 'in their twenties or early thirties',
  middle: 'in their forties or fifties',
  older: 'in their sixties or beyond',
};

function partnerSystemPrompt(s: Scenario): string {
  const relationship = s.relationship || 'adult family member';
  const name = s.name?.trim() || 'the loved one';
  const substances = s.substances?.length ? s.substances.join(', ') : 'alcohol or drugs';
  const temperament = TEMPERAMENTS[s.temperament ?? 'guarded'] ?? TEMPERAMENTS.guarded;
  const age = AGE_DESCRIPTIONS[s.voice?.age ?? 'middle'] ?? AGE_DESCRIPTIONS.middle;
  const gender = s.voice?.gender === 'female' ? 'She/her' : s.voice?.gender === 'male' ? 'He/him' : 'They/them';
  const script = s.scriptText
    ? `\n\nThe user is practicing lines like this (they may adapt them):\n"""${s.scriptText.slice(0, MAX_SCRIPT_CHARS)}"""`
    : '';
  const language = s.language === 'es' ? 'Respond in Spanish.' : 'Respond in English.';

  return `You are a role-play practice partner inside Sober Helpline, an app that helps families of people struggling with addiction prepare for hard conversations. You are playing "${name}", the user's ${relationship}, ${age} (${gender}), who is struggling with ${substances} and does not yet want help. The user is practicing what they will really say to this person.${script}

Play the character with realism, calibrated to this temperament:
${temperament}

Speak the way a real ${relationship} of that age would — vocabulary, references, and emotional register should fit the age and the relationship (a parent resists differently than an adult son; a spouse wounds differently than a sibling).

Rules of the performance:
- Replies are SHORT: one to three spoken sentences. No narration, no stage directions, no quotation marks, no emojis. Only what the character says out loud. Your words will be converted to speech, so write natural spoken language.
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

// ---------------- LLM (OpenAI preferred, Anthropic fallback) ----------------

async function callModel(system: string, turns: Turn[], maxTokens: number): Promise<string> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const messages = turns.map((t) => ({
    role: t.role === 'user' ? 'user' : 'assistant',
    content: t.text.slice(0, MAX_MESSAGE_CHARS),
  }));

  if (openaiKey) {
    const model = Deno.env.get('REHEARSAL_MODEL') ?? 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: maxTokens,
      }),
    });
    if (!res.ok) {
      console.error('openai_error', res.status, (await res.text()).slice(0, 300));
      throw new Error('model_error');
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty_reply');
    return text;
  }

  if (anthropicKey) {
    const model = Deno.env.get('REHEARSAL_MODEL') ?? 'claude-sonnet-4-5';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, system, messages, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      console.error('anthropic_error', res.status, (await res.text()).slice(0, 300));
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

  throw new Error('missing_api_key');
}

// ---------------- ElevenLabs text-to-speech ----------------

function b64encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function synthesize(text: string, voice: VoiceChoice | undefined): Promise<string | null> {
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) return null; // voice not configured — text-only mode still works
  const voiceId = voiceIdFor(voice);
  const model = Deno.env.get('ELEVENLABS_MODEL') ?? 'eleven_multilingual_v2';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({
      text: text.slice(0, MAX_TTS_CHARS),
      model_id: model,
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    console.error('elevenlabs_error', res.status, (await res.text()).slice(0, 300));
    return null; // degrade gracefully to text-only
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return b64encode(bytes);
}

// ---------------- OpenAI Whisper speech-to-text ----------------

async function transcribe(audioB64: string, format: string, language?: string): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('stt_not_configured');
  const bytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
  const ext = ['m4a', 'mp4', 'mp3', 'wav', 'webm'].includes(format) ? format : 'm4a';
  const form = new FormData();
  form.append('file', new Blob([bytes]), `speech.${ext}`);
  form.append('model', 'whisper-1');
  if (language === 'es' || language === 'en') form.append('language', language);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    console.error('whisper_error', res.status, (await res.text()).slice(0, 300));
    throw new Error('stt_error');
  }
  const data = await res.json();
  const text = (data?.text ?? '').trim();
  if (!text) throw new Error('stt_empty');
  return text;
}

// ---------------- Handler ----------------

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

  let payload: {
    mode?: string;
    scenario?: Scenario;
    messages?: Turn[];
    audio?: string;
    format?: string;
    text?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, code: 'bad_json' });
  }

  const scenario = payload.scenario ?? {};

  try {
    // ---- speech-to-text ----
    if (payload.mode === 'stt') {
      if (!payload.audio || payload.audio.length > MAX_AUDIO_B64) {
        return json(400, { ok: false, code: 'bad_audio' });
      }
      const text = await transcribe(payload.audio, payload.format ?? 'm4a', scenario.language);
      return json(200, { ok: true, text });
    }

    // ---- standalone synthesis (replay a line) ----
    if (payload.mode === 'tts') {
      if (!payload.text?.trim()) return json(400, { ok: false, code: 'no_text' });
      const audio = await synthesize(payload.text, scenario.voice);
      if (!audio) return json(503, { ok: false, code: 'tts_not_configured' });
      return json(200, { ok: true, audio });
    }

    const turns = (payload.messages ?? [])
      .filter((m): m is Turn => (m?.role === 'user' || m?.role === 'partner') && typeof m?.text === 'string')
      .slice(-MAX_MESSAGES);
    if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
      return json(400, { ok: false, code: 'no_user_message' });
    }

    // ---- debrief ----
    if (payload.mode === 'debrief') {
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
    }

    // ---- reply (default), with optional spoken audio ----
    const raw = await callModel(partnerSystemPrompt(scenario), turns, 300);
    const breakCharacter = raw.startsWith(BREAK_TOKEN);
    const text = breakCharacter ? raw.slice(BREAK_TOKEN.length).trim() : raw;
    // Never voice the safety break — it reads as the app, not the character.
    const audio = !breakCharacter && scenario.voice ? await synthesize(text, scenario.voice) : null;
    return json(200, { ok: true, text, breakCharacter, audio });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'unknown';
    const status = code === 'missing_api_key' || code === 'stt_not_configured' ? 503 : 502;
    return json(status, { ok: false, code });
  }
});
