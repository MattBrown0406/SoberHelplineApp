import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const WEBSITE_CHECKOUT_URL = 'https://soberhelpline.com/coaching-checkout';

function b64url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function encodeJson(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)));
}
async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, code: 'method_not_allowed' }), { status: 405, headers: corsHeaders });

  const secret = Deno.env.get('APP_PAYMENT_BRIDGE_SECRET') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!secret || secret.length < 32) return new Response(JSON.stringify({ ok: false, code: 'bridge_not_configured' }), { status: 503, headers: corsHeaders });

  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return new Response(JSON.stringify({ ok: false, code: 'not_authenticated' }), { status: 401, headers: corsHeaders });
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return new Response(JSON.stringify({ ok: false, code: 'not_authenticated' }), { status: 401, headers: corsHeaders });

  let sessionId = '';
  // 'apply_membership' only converts a pending one-off for a member who now
  // has Premier; it never returns a checkout URL.
  let intent: 'checkout' | 'apply_membership' = 'checkout';
  try {
    const body = await req.json();
    sessionId = typeof body?.session_id === 'string' ? body.session_id : '';
    if (body?.intent === 'apply_membership') intent = 'apply_membership';
  } catch { /* handled below */ }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sessionId)) return new Response(JSON.stringify({ ok: false, code: 'invalid_session' }), { status: 400, headers: corsHeaders });

  const { data: accountId } = await userClient.rpc('my_account_id');
  if (typeof accountId !== 'string') return new Response(JSON.stringify({ ok: false, code: 'account_not_found' }), { status: 404, headers: corsHeaders });
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: session } = await admin.from('video_sessions')
    .select('id,account_id,booking_purpose,appointment_type,payment_status,status,coaching_booking_id')
    .eq('id', sessionId).eq('account_id', accountId).maybeSingle();
  if (!session || session.booking_purpose !== 'plan_review' || session.appointment_type !== 'one_off_150' || !session.coaching_booking_id) {
    return new Response(JSON.stringify({ ok: false, code: 'checkout_not_available' }), { status: 404, headers: corsHeaders });
  }
  if (session.payment_status === 'paid') return new Response(JSON.stringify({ ok: false, code: 'already_paid' }), { status: 409, headers: corsHeaders });
  if (session.payment_status !== 'pending_payment' || !['requested', 'proposed'].includes(session.status)) {
    return new Response(JSON.stringify({ ok: false, code: 'checkout_not_available' }), { status: 409, headers: corsHeaders });
  }

  // A member who upgraded to Premier after booking must not pay $150 for a
  // review Premier includes: convert it instead of opening checkout. The RPC
  // re-checks Premier access (has_active_private_video_access) server-side.
  const { data: conversion, error: conversionError } = await admin.rpc('service_convert_plan_review_to_included', {
    p_session_id: session.id,
  });
  if (conversionError) {
    return new Response(JSON.stringify({ ok: false, code: 'checkout_unavailable' }), { status: 500, headers: corsHeaders });
  }
  if (conversion === 'converted') {
    return new Response(JSON.stringify({ ok: true, included: true, checkout_url: null }), { status: 200, headers: corsHeaders });
  }
  if (intent === 'apply_membership') {
    return new Response(JSON.stringify({ ok: false, code: 'premier_not_active' }), { status: 200, headers: corsHeaders });
  }

  // Members get $25 off ($125). Only quoted once the website accepts the member
  // price (PLAN_REVIEW_MEMBER_PRICE=on); the session remembers the quote so the
  // $125 capture is accepted when PayPal reports it.
  const memberPriceOn = (Deno.env.get('PLAN_REVIEW_MEMBER_PRICE') ?? '').toLowerCase() === 'on';
  const { data: quotedCents, error: quoteError } = await admin.rpc('service_plan_review_checkout_cents', {
    p_session_id: session.id,
    p_member_price: memberPriceOn,
  });
  if (quoteError || (quotedCents !== 15000 && quotedCents !== 12500)) {
    return new Response(JSON.stringify({ ok: false, code: 'checkout_unavailable' }), { status: 500, headers: corsHeaders });
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    bref: session.id,
    aref: accountId,
    cents: quotedCents,
    cur: 'USD',
    svc: 'plan_review_coaching',
    nonce: crypto.randomUUID(),
    exp: now + 15 * 60,
    ...(quotedCents === 12500 ? { member: true } : {}),
  };
  const header = encodeJson({ alg: 'HS256', typ: 'SHC' });
  const encodedPayload = encodeJson(payload);
  const unsigned = `${header}.${encodedPayload}`;
  const token = `${unsigned}.${await sign(secret, unsigned)}`;
  const checkoutUrl = `${WEBSITE_CHECKOUT_URL}?token=${encodeURIComponent(token)}`;
  return new Response(JSON.stringify({ ok: true, checkout_url: checkoutUrl, expires_at: new Date(payload.exp * 1000).toISOString() }), { status: 200, headers: corsHeaders });
});
