// Rehearsal Partner — Supabase Edge Function
//
// The Rehearsal Room's backend. Three modes, each metered per member per day
// by consume_rehearsal_quota():
//   reply   — the AI plays the loved one and returns its next line
//             (optionally with spoken audio via ElevenLabs when `voice` is set)
//   debrief — coach feedback on the transcript, strict JSON
//   stt     — transcribe the user's recorded speech (OpenAI Whisper)
// plus the optional whisper coach: when a reply request sets `whisper: true`,
// a second small model call runs concurrently with the in-character reply and
// returns a short `hint` (metered as 'whisper'; never voiced).
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
//          REHEARSAL_WHISPER_MODEL (default: gpt-4o-mini — the whisper coach's hint)
//
// Prompts and input sanitizing live in ../_shared/rehearsal-prompts.ts (unit tested).
//
// Requires an authenticated user. No API key ever ships to clients.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  breakTextFor,
  crisisKind,
  debriefGate,
  MAX_MODERATION_CHARS,
  moderationIndicatesCrisis,
  MODERATION_TIMEOUT_MS,
  normalizeDebrief,
  partnerReplyUnsafe,
  replyGate,
  spokenBeyond,
} from '../_shared/rehearsal-safety.ts';
import { DISFLUENCY_PROMPT, isLikelySilence, stripPromptEcho, type WhisperSegment } from '../_shared/rehearsal-stt.ts';
import {
  MAX_AUDIO_B64,
  MAX_MESSAGE_CHARS,
  SAFE_FALLBACK_LINES,
  sanitizeScreeningText,
  STRICT_RETRY_INSTRUCTION,
  type Scenario,
  debriefSystemPrompt,
  debriefTranscript,
  labelHint,
  MAX_PRACTICE_TEXT_CHARS,
  normalizeHint,
  parseBreak,
  partnerSystemPrompt,
  sanitizeScenario,
  sanitizeTurns,
  turnsForPartner,
  type Turn,
  type VoiceChoice,
  WARMUP_MAX_USER_TURNS,
  whisperSystemPrompt,
  whisperUserMessage,
} from '../_shared/rehearsal-prompts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TTS_CHARS = 900;

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

// ---------------- LLM (OpenAI preferred, Anthropic fallback) ----------------

// Upstream APIs (OpenAI, ElevenLabs) throw transient 429s/5xx under load.
// One blip should never surface as "couldn't reach your practice partner" —
// retry with a short backoff before giving up.
async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (i >= attempts - 1) throw e; // network-level failure on final attempt
    }
    if (res) {
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || i >= attempts - 1) return res;
      await res.text().catch(() => {}); // drain the body before retrying
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
}

type ModelChoice = { openai?: string; anthropic?: string };

async function callModel(system: string, turns: Turn[], maxTokens: number, models: ModelChoice = {}): Promise<string> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  // Turns arrive already capped by sanitizeTurns (a delivered letter may be
  // longer than an ordinary line); this is only the last-resort bound.
  const messages = turns.map((t) => ({
    role: t.role === 'user' ? 'user' : 'assistant',
    content: t.text.slice(0, MAX_PRACTICE_TEXT_CHARS),
  }));

  if (openaiKey) {
    const model = models.openai ?? Deno.env.get('REHEARSAL_MODEL') ?? 'gpt-4o-mini';
    const res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
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
    const model = models.anthropic ?? Deno.env.get('REHEARSAL_MODEL') ?? 'claude-sonnet-4-5';
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
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

// Expressiveness per temperament: lower stability + higher style = more emotion.
// Defensive is deliberately steadier than volatile — it argues cold and
// controlled, while volatile erupts. Keeping them far apart in voice is half
// of what makes the two modes feel different.
const VOICE_EMOTION: Record<string, { stability: number; style: number }> = {
  guarded: { stability: 0.45, style: 0.3 },
  defensive: { stability: 0.5, style: 0.4 },
  volatile: { stability: 0.18, style: 0.85 },
  tearful: { stability: 0.3, style: 0.65 },
};

async function synthesize(
  text: string,
  voice: VoiceChoice | undefined,
  temperament?: string,
): Promise<string | null> {
  const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
  if (!apiKey) return null; // voice not configured — text-only mode still works
  const voiceId = voiceIdFor(voice);
  const model = Deno.env.get('ELEVENLABS_MODEL') ?? 'eleven_multilingual_v2';
  const emotion = VOICE_EMOTION[temperament ?? 'guarded'] ?? VOICE_EMOTION.guarded;
  const res = await fetchWithRetry(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({
      text: text.slice(0, MAX_TTS_CHARS),
      model_id: model,
      voice_settings: {
        stability: emotion.stability,
        similarity_boost: 0.8,
        style: emotion.style,
        use_speaker_boost: true,
      },
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

/** Returns '' (not an error) for silence — a slipped finger is a no-op, not a failure. */
async function transcribe(audioB64: string, format: string, language?: string): Promise<string> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('stt_not_configured');
  const bytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
  const ext = ['m4a', 'mp4', 'mp3', 'wav', 'webm'].includes(format) ? format : 'm4a';
  const form = new FormData();
  form.append('file', new Blob([bytes]), `speech.${ext}`);
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json'); // exposes per-segment no_speech_prob
  form.append('temperature', '0');
  const lang = language === 'es' ? 'es' : 'en';
  form.append('language', lang);
  form.append('prompt', DISFLUENCY_PROMPT[lang]);
  const res = await fetchWithRetry('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    console.error('whisper_error', res.status, (await res.text()).slice(0, 300));
    throw new Error('stt_error');
  }
  const data = await res.json();
  // Whisper marks probable non-speech per segment; those are dropped, then a
  // prompt echo or a lone known silence hallucination counts as silence.
  const segments: WhisperSegment[] | null = Array.isArray(data?.segments)
    ? (data.segments as WhisperSegment[]).filter((s) => (s?.no_speech_prob ?? 0) < 0.6)
    : null;
  const text = (segments ? segments.map((s) => s?.text ?? '').join(' ') : (data?.text ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  const spoken = stripPromptEcho(text, DISFLUENCY_PROMPT[lang]);
  if (isLikelySilence(spoken, segments)) return '';
  return spoken;
}

/**
 * Defense in depth where the patterns are the only screen (a letter read
 * aloud, the part of a long spoken turn past the one-line cap, the debrief):
 * OpenAI's free moderation endpoint. Bounded input, a 3-second timeout, and
 * any failure (no key, network, error) falls back to the patterns alone.
 */
async function moderationCrisis(text: string | undefined): Promise<boolean> {
  const input = text?.trim().slice(0, MAX_MODERATION_CHARS);
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!input || !apiKey) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODERATION_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'omni-moderation-latest', input }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error('moderation_error', res.status);
      await res.body?.cancel();
      return false;
    }
    return moderationIndicatesCrisis(await res.json());
  } catch {
    console.error('moderation_unavailable');
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- Handler ----------------

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

// Service-role client for the few lookups the caller's RLS can't see (org
// status, practice-call events). Null when the key isn't configured.
function serviceClient(): SupabaseClient<any> | null {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) return null;
  return createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Whisper coach: one short hint about the user's latest line, or null. A label
// ("addict", "alcoholic") gets the canned hint for free; anything else is a
// small model call metered as 'whisper'. Never fails the reply it rides with.
async function whisperHint(
  supabase: SupabaseClient<any>,
  scenario: ReturnType<typeof sanitizeScenario>,
  turns: Turn[],
): Promise<string | null> {
  const lastUser = [...turns].reverse().find((t) => t.role === 'user');
  if (!lastUser) return null;
  const canned = labelHint(lastUser.text, scenario.language);
  if (canned) return canned;
  const message = whisperUserMessage(turns);
  if (!message) return null;
  try {
    const { data: allowed, error } = await supabase.rpc('consume_rehearsal_quota', { p_mode: 'whisper' });
    if (error || allowed !== true) return null;
    const raw = await callModel(whisperSystemPrompt(scenario), [{ role: 'user', text: message }], 60, {
      openai: Deno.env.get('REHEARSAL_WHISPER_MODEL') ?? 'gpt-4o-mini',
      anthropic: 'claude-haiku-4-5',
    });
    return normalizeHint(raw);
  } catch (e) {
    console.error('whisper_hint_failed', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

/**
 * Deterministic output guard: an in-character line that crosses a hard limit
 * (a self-harm/suicide threat or a threat of violence) is regenerated once
 * with a stricter instruction; if the retry still crosses it, a safe
 * in-character line replaces it. The retry is rare and bounded to one call.
 */
async function guardedLine(raw: string, scenario: Scenario, replyTurns: Turn[]): Promise<string> {
  if (!partnerReplyUnsafe(raw)) return raw;
  console.error('partner_reply_guarded', { temperament: scenario.temperament ?? 'guarded' });
  try {
    const retry = await callModel(`${partnerSystemPrompt(scenario)}\n\n${STRICT_RETRY_INSTRUCTION}`, replyTurns, 300);
    if (!parseBreak(retry).breakCharacter && !partnerReplyUnsafe(retry)) return retry;
  } catch {
    // fall through to the safe line
  }
  const lang = scenario.language === 'es' ? 'es' : 'en';
  return SAFE_FALLBACK_LINES[lang][scenario.temperament ?? 'guarded'];
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

  // Entitlement gate: the AI practice partner is an Essentials/Premium feature.
  // (The classic record-and-playback rehearsal is free and never calls this API.)
  // Queries run under the caller's RLS, mirroring what the app itself can read.
  const allowEmails = (Deno.env.get('REHEARSAL_ALLOW_EMAILS') ?? 'matt@soberhelpline.com,matt@freedominterventions.com')
    .toLowerCase()
    .split(',')
    .map((e) => e.trim());
  const { data: account } = await supabase
    .from('accounts')
    .select('id, type, org_id')
    .eq('user_id', userData.user.id)
    .single();
  if (!account) return json(403, { ok: false, code: 'account_required' });

  let entitled = allowEmails.includes((userData.user.email ?? '').toLowerCase().trim());
  // An attached (org) account counts as paid only while its org is active —
  // the same rule as has_active_textline_access(). Members can't read orgs
  // under RLS, so the status comes from the service role; without it, fail
  // closed and fall through to the member's own entitlements.
  if (!entitled && account.type === 'attached' && account.org_id) {
    const admin = serviceClient();
    if (admin) {
      const { data: org, error: orgError } = await admin
        .from('orgs')
        .select('status')
        .eq('id', account.org_id)
        .maybeSingle();
      if (orgError) console.error('org_status_lookup_failed', orgError.message);
      entitled = org?.status === 'active';
    } else {
      console.error('org_status_lookup_skipped: SUPABASE_SERVICE_ROLE_KEY missing');
    }
  }
  if (!entitled) {
    const { data: rows } = await supabase
      .from('entitlements')
      .select('tier, expires_at')
      .eq('account_id', account.id);
    const now = Date.now();
    entitled = (rows ?? []).some(
      (r: { tier: string; expires_at: string | null }) =>
        (r.tier === 'essential' || r.tier === 'premium') &&
        (!r.expires_at || new Date(r.expires_at).getTime() > now),
    );
  }
  if (!entitled) return json(403, { ok: false, code: 'upgrade_required' });

  let payload: {
    mode?: string;
    scenario?: unknown;
    messages?: unknown;
    audio?: string;
    format?: string;
    text?: string;
    practiceEventId?: string;
    whisper?: boolean;
    /** Screening only: what was actually said while reading prepared text aloud. Never sent to a model. */
    screeningText?: unknown;
    /** stt: 'delivery' when the clip is the member reading their prepared text aloud. */
    purpose?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, code: 'bad_json' });
  }

  const scenario = sanitizeScenario(payload.scenario ?? {});

  // Server-side daily caps (see consume_rehearsal_quota). The app's 12-turn
  // limit is a UX guide, not a cost control.
  const spend = async (mode: 'reply' | 'stt' | 'debrief'): Promise<Response | null> => {
    const { data: allowed, error } = await supabase.rpc('consume_rehearsal_quota', { p_mode: mode });
    if (error) throw new Error('quota_check_failed');
    return allowed === true ? null : json(429, { ok: false, code: 'daily_limit_reached' });
  };

  try {
    // ---- speech-to-text ----
    if (payload.mode === 'stt') {
      if (typeof payload.audio !== 'string' || !payload.audio || payload.audio.length > MAX_AUDIO_B64) {
        return json(400, { ok: false, code: 'bad_audio' });
      }
      const limited = await spend('stt');
      if (limited) return limited;
      const text = await transcribe(payload.audio, payload.format ?? 'm4a', scenario.language);
      // Every spoken clip is screened in full the moment it is transcribed —
      // before the app trims a long turn to fit one line, and whether or not
      // it is ever sent as a line. Reading prepared text aloud: only what was
      // said beyond the text is screened (the letter itself may quote words
      // like "I want to die" and must stay practicable).
      const delivery = payload.purpose === 'delivery' && !!scenario.practiceText;
      const screened = delivery ? spokenBeyond(text, scenario.practiceText!) : text;
      // (A line that fits is moderated again, in full, when it is sent.)
      const needsModeration = delivery ? screened.length > 0 : screened.length > MAX_MESSAGE_CHARS;
      const kind = crisisKind(screened) ?? (needsModeration && await moderationCrisis(screened) ? 'self_harm' : null);
      if (kind) {
        return json(200, { ok: true, text, breakCharacter: true, crisisKind: kind, breakText: breakTextFor(kind, scenario.language) });
      }
      return json(200, { ok: true, text });
    }

    const { turns, droppedUserTurns, userScreenTexts } = sanitizeTurns(payload.messages, scenario);
    const userTurnCount = turns.filter((t) => t.role === 'user').length;
    // A debrief transcript normally ends with the partner's line; it only needs
    // at least one user turn to evaluate. Replies require the user to speak last —
    // EXCEPT the incoming-call opening: with no prior turns the character opens
    // the call itself, already mid-crisis.
    const incomingOpening = scenario.mode === 'incoming_call' && turns.length === 0;
    // Every member line (typed or spoken, plus any read-aloud transcript) also
    // goes to moderation — started here, awaited alongside the partner call so
    // it adds no latency. Fails open to the patterns.
    let lineModeration: Promise<boolean> = Promise.resolve(false);
    if (payload.mode === 'debrief') {
      if (userTurnCount === 0) {
        return json(400, { ok: false, code: 'no_user_message' });
      }
      // A disclosure of crisis is never sent off for coaching — patterns
      // first, then moderation as a second opinion on everything they said.
      const screenable = userScreenTexts.filter((t): t is string => t !== null);
      const flagged = debriefGate(screenable) === 'safety_break' ||
        debriefGate([], await moderationCrisis(screenable.join('\n'))) === 'safety_break';
      if (flagged) {
        return json(409, { ok: false, code: 'safety_break' });
      }
    } else if (!incomingOpening && (turns.length === 0 || turns[turns.length - 1].role !== 'user')) {
      return json(400, { ok: false, code: 'no_user_message' });
    } else {
      // A first-person crisis disclosure short-circuits the performance
      // entirely — checked first, on the untrimmed line and on any read-aloud
      // transcript: no model call, no voice, no coaching hint, and the app
      // shows its crisis card. Only then can a warm-up be "complete".
      const lastUserRaw = userScreenTexts[userScreenTexts.length - 1] ?? undefined;
      const rawScreening = sanitizeScreeningText(payload.screeningText);
      // A read-aloud transcript: screen only what was said beyond the prepared text.
      const screeningText = rawScreening && scenario.practiceText
        ? spokenBeyond(rawScreening, scenario.practiceText) || undefined
        : rawScreening;
      const gateInput = {
        incomingOpening,
        lastUserRaw,
        screeningText,
        // The warm-up is three exchanges by design; the app ends it there too.
        warmupOver: !!scenario.warmup && userTurnCount + droppedUserTurns > WARMUP_MAX_USER_TURNS,
      };
      const gate = replyGate(gateInput);
      if (gate === 'crisis' || gate === 'abuse') {
        const kind = gate === 'abuse' ? 'abuse' : 'self_harm';
        return json(200, {
          ok: true,
          text: breakTextFor(kind, scenario.language),
          breakCharacter: true,
          crisisKind: kind,
          audio: null,
          hint: null,
        });
      }
      if (gate === 'warmup_complete') return json(400, { ok: false, code: 'warmup_complete' });
      const toModerate = incomingOpening ? '' : [lastUserRaw, screeningText].filter(Boolean).join('\n');
      if (toModerate) lineModeration = moderationCrisis(toModerate);
    }

    // ---- debrief ----
    if (payload.mode === 'debrief') {
      const limited = await spend('debrief');
      if (limited) return limited;
      const raw = await callModel(
        debriefSystemPrompt(scenario),
        [{ role: 'user', text: `Here is the practice transcript:\n\n${debriefTranscript(turns, scenario)}` }],
        scenario.warmup ? 500 : 900,
        { openai: Deno.env.get('REHEARSAL_DEBRIEF_MODEL') ?? 'gpt-4o' },
      );
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('bad_debrief');
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      } catch {
        throw new Error('bad_debrief');
      }
      const debrief = normalizeDebrief(parsed, turns.filter((t) => t.role === 'user').map((t) => t.text));
      if (!debrief) throw new Error('bad_debrief');
      // Indices are relative to the turns the model saw; shift them back onto
      // the client's full transcript if the oldest turns were trimmed.
      if (droppedUserTurns > 0) {
        debrief.workOnTurns = debrief.workOnTurns.map((i) => (i === null ? null : i + droppedUserTurns));
      }
      return json(200, { ok: true, debrief });
    }

    // ---- reply (default), with optional spoken audio ----
    // Incoming-call opening: there is no user turn yet. Send a kickoff user
    // message (never shown to the user) so every provider has something to
    // answer — the system prompt's INCOMING CALL MODE section shapes the line.
    const replyTurns: Turn[] = incomingOpening
      ? [{ role: 'user', text: '[They pick up the phone. Open the call.]' }]
      : turnsForPartner(turns, scenario);

    // Cached push-call openings replay their text for free; voice still spends.
    const eventId = typeof payload.practiceEventId === 'string' ? payload.practiceEventId : '';
    const validEventId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId);
    let admin: SupabaseClient<any> | null = null;
    let generationLock: string | null = null;

    if (incomingOpening && eventId) {
      if (!validEventId) return json(400, { ok: false, code: 'invalid_practice_event' });
      admin = serviceClient();
      if (!admin) return json(503, { ok: false, code: 'service_not_configured' });
      const { data: event, error: eventError } = await admin
        .from('practice_push_events')
        .select('event_id, expires_at, answered_at, generation_started_at, opening_text, break_character')
        .eq('event_id', eventId)
        .eq('account_id', account.id)
        .maybeSingle();
      if (eventError) throw new Error('practice_event_lookup_failed');
      if (!event || !event.answered_at || new Date(event.expires_at).getTime() <= Date.now()) {
        return json(409, { ok: false, code: 'practice_event_unavailable' });
      }
      if (event.opening_text) {
        // The text is cached but its voice is synthesized per request, so a
        // replayed opening still spends quota when it asks for audio.
        const wantsAudio = !event.break_character && !!scenario.voice;
        if (wantsAudio) {
          const limited = await spend('reply');
          if (limited) return limited;
        }
        const cachedAudio = wantsAudio && scenario.voice
          ? await synthesize(event.opening_text, scenario.voice, scenario.temperament)
          : null;
        return json(200, {
          ok: true,
          text: event.opening_text,
          breakCharacter: !!event.break_character,
          audio: cachedAudio,
          hint: null,
        });
      }

      const startedAt = event.generation_started_at ? new Date(event.generation_started_at).getTime() : 0;
      if (startedAt > Date.now() - 2 * 60 * 1000) {
        return json(409, { ok: false, code: 'opening_in_progress' });
      }
      generationLock = new Date().toISOString();
      let lockQuery = admin
        .from('practice_push_events')
        .update({ generation_started_at: generationLock })
        .eq('event_id', eventId)
        .eq('account_id', account.id)
        .is('opening_text', null);
      lockQuery = event.generation_started_at
        ? lockQuery.eq('generation_started_at', event.generation_started_at)
        : lockQuery.is('generation_started_at', null);
      const { data: locked, error: lockError } = await lockQuery.select('event_id').maybeSingle();
      if (lockError) throw new Error('practice_event_lock_failed');
      if (!locked) return json(409, { ok: false, code: 'opening_in_progress' });
    }

    // Unlock a push-call opening that won't be generated now, so a retry can.
    const releaseGenerationLock = async () => {
      if (!admin || !eventId || !generationLock) return;
      await admin
        .from('practice_push_events')
        .update({ generation_started_at: null })
        .eq('event_id', eventId)
        .eq('account_id', account.id)
        .eq('generation_started_at', generationLock)
        .is('opening_text', null);
    };

    const moderationBreak = () =>
      json(200, {
        ok: true,
        text: breakTextFor('self_harm', scenario.language),
        breakCharacter: true,
        crisisKind: 'self_harm',
        audio: null,
        hint: null,
      });

    try {
      const limited = await spend('reply');
      if (limited) {
        await releaseGenerationLock();
        // Out of replies today, but a disclosure still gets the crisis break.
        if (await lineModeration) return moderationBreak();
        return limited;
      }
      // The whisper coach runs alongside the in-character reply, never after it.
      // No hint on the delivery of a prepared letter — the coaching starts after it.
      const lastIsDelivery = userScreenTexts.length > 0 && userScreenTexts[userScreenTexts.length - 1] === null;
      const wantsHint = payload.whisper === true && !incomingOpening && !lastIsDelivery;
      const [raw, hint, flagged] = await Promise.all([
        callModel(partnerSystemPrompt(scenario), replyTurns, 300),
        wantsHint ? whisperHint(supabase, scenario, turns) : Promise.resolve(null),
        lineModeration,
      ]);
      // Moderation saw a crisis the patterns missed: the break replaces the reply.
      if (flagged) return moderationBreak();
      // The model may emit the token after a stray character or line; honor it
      // anywhere and speak only the out-of-character sentence that follows.
      // Its :SELF_HARM / :ABUSE marker (if any) picks the crisis card's headline.
      const parsed = parseBreak(raw, scenario.language);
      const breakCharacter = parsed.breakCharacter;
      const text = breakCharacter ? parsed.text : await guardedLine(raw, scenario, replyTurns);
      if (admin && eventId && generationLock) {
        const { error: cacheError } = await admin
          .from('practice_push_events')
          .update({ opening_text: text, break_character: breakCharacter })
          .eq('event_id', eventId)
          .eq('account_id', account.id)
          .eq('generation_started_at', generationLock);
        if (cacheError) throw new Error('opening_cache_failed');
      }
      // Never voice the safety break — it reads as the app, not the character.
      // The hint is text-only by design and is dropped with a safety break.
      const audio = !breakCharacter && scenario.voice ? await synthesize(text, scenario.voice, scenario.temperament) : null;
      return json(200, {
        ok: true,
        text,
        breakCharacter,
        ...(breakCharacter && parsed.kind ? { crisisKind: parsed.kind } : {}),
        audio,
        hint: breakCharacter ? null : hint,
      });
    } catch (error) {
      await releaseGenerationLock();
      throw error;
    }
  } catch (e) {
    const code = e instanceof Error ? e.message : 'unknown';
    const status = code === 'missing_api_key' || code === 'stt_not_configured' ? 503 : 502;
    return json(status, { ok: false, code });
  }
});
