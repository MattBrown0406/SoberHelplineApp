// request-password-reset — public (verify_jwt = false): the member is signed out.
//
// Generates a Supabase recovery code for the email and sends it through Resend
// from the soberhelpline.com domain. The app then verifies the code with
// supabase.auth.verifyOtp({ type: 'recovery' }) and sets the new password.
//
// The response is the same whether or not an account exists, so the endpoint
// cannot be used to discover members. Requests are capped per email and per IP
// (register_password_reset_request).
//
// Secrets: RESEND_API_KEY (+ optional PASSWORD_RESET_FROM).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { buildResetEmail, normalizeResetEmail, sha256Hex } from '../_shared/password-reset.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const FROM = Deno.env.get('PASSWORD_RESET_FROM') ?? 'Sober Helpline <notifications@soberhelpline.com>';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const payload = await req.json().catch(() => null) as { email?: unknown; lang?: unknown } | null;
  const email = normalizeResetEmail(payload?.email);
  const lang = payload?.lang === 'es' ? 'es' : 'en';
  if (!email) return json({ error: 'invalid_email' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Only proxy-set headers identify the client (x-forwarded-for's first hop is
  // client-supplied, its last may be a shared proxy). Without one, skip the
  // per-IP limit rather than lumping every member into one bucket; the
  // per-email and global limits still apply.
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip');
  const { data: allowed, error: limitError } = await admin.rpc('register_password_reset_request', {
    p_email_hash: await sha256Hex(email),
    p_ip_hash: await sha256Hex(ip ?? crypto.randomUUID()),
  });
  if (limitError) {
    console.error('[request-password-reset] rate limit check failed');
    return json({ error: 'unavailable' }, 503);
  }
  if (allowed !== true) return json({ error: 'too_many_requests' }, 429);

  // Answer now and do the account lookup + email in the background, so the
  // response time is the same whether or not the address has an account.
  const delivery = sendResetCode(admin, email, lang).catch(() => {
    console.error('[request-password-reset] delivery failed');
  });
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(task: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(delivery);
  else await delivery;

  return json({ ok: true });
});

// deno-lint-ignore no-explicit-any
async function sendResetCode(admin: SupabaseClient<any, any, any>, email: string, lang: 'en' | 'es'): Promise<void> {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  const code = link?.properties?.email_otp;
  // Unknown address (or any generation failure): nothing to send.
  if (linkError || !code) return;

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('[request-password-reset] RESEND_API_KEY is not configured');
    return;
  }
  const message = buildResetEmail(lang, code);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email], subject: message.subject, html: message.html, text: message.text }),
  });
  if (!res.ok) console.error('[request-password-reset] Resend error', res.status);
}
