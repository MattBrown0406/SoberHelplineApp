// Invitation Coach — Supabase Edge Function
//
// Drafts three short CRAFT-style invitation lines (love + specific observation
// + invitation + offer of help; no ultimatums, no labels) in the family's own
// words. The pattern map is read under the caller's RLS — the client never
// supplies it — and every call is metered with consume_rehearsal_quota('invitation').
//
// Responses:
//   200 { ok: true, lines: [{ style, text }] }   (1–3 validated lines; the app
//        fills any missing style from its editable templates)
//   401 unauthorized · 403 upgrade_required · 409 safety_first | pattern_map_required
//   409 { code: 'crisis', field, source } — field names the free text that
//        tripped the screen (source 'patterns' or 'moderation'); either can be
//        set aside by the member's "I'm safe right now" (acknowledgedCrisis)
//   429 daily_limit_reached · 503 ai_unavailable · 502 ai_invalid
//
// Deploy:  supabase functions deploy invitation-coach
// Secrets: OPENAI_API_KEY (preferred) or ANTHROPIC_API_KEY.
//          Optional INVITATION_MODEL overrides the default model.

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildCoachPrompt,
  parseCoachLines,
  sanitizeCoachProfile,
  sanitizeCoachRequest,
} from '../_shared/invitation-coach.ts';
import { invitationTextInCrisis } from '../_shared/invitation-crisis.ts';
import { fieldsToScreen, invitationCrisisGate, moderateInvitationTexts } from '../_shared/invitation-moderation.ts';
import { SCREENED_FIELDS, screenInvitationFields } from '../_shared/invitation-screen.ts';
import { userInCrisis } from '../_shared/rehearsal-safety.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 2): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || i >= attempts - 1) return res;
      await res.text().catch(() => {});
    } catch (error) {
      if (i >= attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
  }
}

class ModelUnavailable extends Error {}

// Same provider order as rehearsal-partner's callModel: OpenAI preferred,
// Anthropic as the fallback.
async function callModel(system: string, user: string, maxTokens: number): Promise<string> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');

  if (openaiKey) {
    const model = Deno.env.get('INVITATION_MODEL') ?? 'gpt-4o-mini';
    const res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: maxTokens,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      console.error('openai_error', res.status);
      throw new ModelUnavailable('model_error');
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new ModelUnavailable('empty_reply');
    return text;
  }

  if (anthropicKey) {
    const model = Deno.env.get('INVITATION_MODEL') ?? 'claude-sonnet-4-5';
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, system, messages: [{ role: 'user', content: user }], max_tokens: maxTokens }),
    });
    if (!res.ok) {
      console.error('anthropic_error', res.status);
      throw new ModelUnavailable('model_error');
    }
    const data = await res.json();
    const text = (data?.content ?? [])
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('')
      .trim();
    if (!text) throw new ModelUnavailable('empty_reply');
    return text;
  }

  throw new ModelUnavailable('no_model_configured');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { ok: false, code: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData?.user) return json(401, { ok: false, code: 'unauthorized' });

  // Entitlement + safety from the same server snapshot the app renders.
  const { data: snapshot, error: snapshotError } = await supabase.rpc('my_invitation_engine', {});
  if (snapshotError || !snapshot || typeof snapshot !== 'object') {
    return json(403, { ok: false, code: 'account_required' });
  }
  const snap = snapshot as {
    has_access?: boolean;
    profile?: { completed?: boolean; safety_concern?: string };
    safety_first?: boolean;
  };
  if (snap.has_access !== true) return json(403, { ok: false, code: 'upgrade_required' });
  // The caller's own safety answer; an unknown flag is treated as safety-first.
  if (snap.safety_first !== false || snap.profile?.safety_concern === 'serious') {
    return json(409, { ok: false, code: 'safety_first' });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json(400, { ok: false, code: 'bad_json' });
  }
  const request = sanitizeCoachRequest(rawBody);

  const { data: profileRow, error: profileError } = await supabase
    .from('loved_one_profiles')
    .select('name, relationship, substances, use_triggers, what_use_gives, costs_they_feel, sober_moments, usual_phrases, recent_incidents, completed_at')
    .maybeSingle();
  if (profileError) return json(500, { ok: false, code: 'profile_unavailable' });
  if (!profileRow?.completed_at) return json(409, { ok: false, code: 'pattern_map_required' });

  // Crisis screen before any quota or model call, over EVERY free-text field
  // that would reach the model: today's observation, the next step, and each
  // pattern-map list. Violence, threats, weapons or self-harm → no lines; the
  // app shows 911 / 988 / DV hotline instead. Her safety answer is untouched.
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const screenedFields = {
    observation: request.observation,
    next_step: request.nextStep,
    recent_incidents: list(profileRow.recent_incidents),
    usual_phrases: list(profileRow.usual_phrases),
    costs_they_feel: list(profileRow.costs_they_feel),
    what_use_gives: list(profileRow.what_use_gives),
    sober_moments: list(profileRow.sober_moments),
    use_triggers: list(profileRow.use_triggers),
  };
  // Patterns first, then extra recall: one moderation call, every screened
  // text its own input (a violence verdict counts unless the text is clearly
  // property-only; fails open to the patterns). Either hit names its field so
  // the app can point to it. Her explicit "I'm safe right now" sets aside the
  // hits she was shown — the map fields — but an observation or next step
  // that changed since she tapped it is still screened.
  const screen = fieldsToScreen(SCREENED_FIELDS, request.acknowledgedCrisis, [
    { field: 'observation', current: request.observation, acknowledgedText: request.acknowledgedObservation },
    { field: 'next_step', current: request.nextStep, acknowledgedText: request.acknowledgedNextStep },
  ]);
  const crisis = await invitationCrisisGate({
    screen,
    texts: SCREENED_FIELDS.flatMap((field) => {
      const value = screenedFields[field];
      return (typeof value === 'string' ? [value] : value).map((text) => ({ field, text }));
    }),
    patternField: (fields) => screenInvitationFields(
      Object.fromEntries(fields.map((field) => [field, screenedFields[field]])),
      (text) => invitationTextInCrisis(text) || userInCrisis(text),
    ),
    moderate: (texts) => moderateInvitationTexts(texts, Deno.env.get('OPENAI_API_KEY')),
  });
  if (crisis) {
    return json(409, { ok: false, code: 'crisis', field: crisis.field, source: crisis.source });
  }

  if (!Deno.env.get('OPENAI_API_KEY') && !Deno.env.get('ANTHROPIC_API_KEY')) {
    return json(503, { ok: false, code: 'ai_unavailable' });
  }

  const { data: allowed, error: quotaError } = await supabase.rpc('consume_rehearsal_quota', { p_mode: 'invitation' });
  if (quotaError) return json(500, { ok: false, code: 'quota_check_failed' });
  if (allowed !== true) return json(429, { ok: false, code: 'daily_limit_reached' });

  const { system, user } = buildCoachPrompt(sanitizeCoachProfile(profileRow), request);
  try {
    const raw = await callModel(system, user, 600);
    const lines = parseCoachLines(raw);
    if (!lines.length) return json(502, { ok: false, code: 'ai_invalid' });
    return json(200, { ok: true, lines });
  } catch (error) {
    if (error instanceof ModelUnavailable) return json(503, { ok: false, code: 'ai_unavailable' });
    console.error('invitation_coach_error');
    return json(503, { ok: false, code: 'ai_unavailable' });
  }
});
