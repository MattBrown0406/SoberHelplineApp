// draft-ai-response — dormant future AI response engine scaffold
//
// This function is intentionally NOT wired to a Database Webhook, trigger, or
// client call. It exists so the future FamilyBridge-style AI layer has a safe
// starting point without changing current Emergency Text Line behavior.
//
// Future activation requirements:
// 1. Add an explicit admin/product toggle for threads.ai_enabled.
// 2. Add provider secrets and model selection.
// 3. Add crisis/escalation tests before any auto-send path exists.
// 4. Keep AI replies labeled as AI/system, never as Matt.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function assessRisk(text: string): 'normal' | 'elevated' | 'crisis' {
  const lowered = text.toLowerCase();
  if (/\b(suicide|kill myself|overdose|911|gun|weapon|violence|violent|danger right now)\b/.test(lowered)) {
    return 'crisis';
  }
  if (/\b(relapse|using again|detox|withdrawal|threatening|disappeared|homeless|jail|arrested)\b/.test(lowered)) {
    return 'elevated';
  }
  return 'normal';
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const payload = await req.json().catch(() => ({}));
  const threadId = payload.thread_id as string | undefined;
  const messageId = payload.message_id as string | undefined;

  if (!threadId) return json({ error: 'missing_thread_id' }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: thread } = await admin
    .from('threads')
    .select('id, ai_enabled')
    .eq('id', threadId)
    .maybeSingle();

  // Dormant safety gate: even if somebody calls this endpoint, do nothing until
  // a future migration/product decision deliberately enables thread AI.
  if (!thread?.ai_enabled) {
    return json({ ok: true, skipped: 'ai_disabled' });
  }

  const { data: messages } = await admin
    .from('messages')
    .select('id, sender_role, body, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(30);

  const latestMember = (messages ?? []).find((m) => m.sender_role === 'member');
  const latestText = latestMember?.body ?? '';
  const risk = assessRisk(latestText);

  // Placeholder draft, not a model call and not sent to the member. The future
  // implementation should replace this with provider output after policy tests.
  const draft = risk === 'crisis'
    ? 'This needs human review before any response is sent. If there is immediate danger, call emergency services now.'
    : 'Draft placeholder: future AI response will be generated here after the feature is explicitly enabled.';

  const { data: inserted, error } = await admin
    .from('ai_response_drafts')
    .insert({
      thread_id: threadId,
      message_id: messageId ?? latestMember?.id ?? null,
      draft_body: draft,
      risk_level: risk,
      model: 'disabled-placeholder',
      prompt_version: 'future-v0',
    })
    .select('id')
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, draft_id: inserted.id, risk_level: risk });
});
