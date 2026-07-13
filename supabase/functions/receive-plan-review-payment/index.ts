import { createClient } from 'npm:@supabase/supabase-js@2';

const jsonHeaders = { 'Content-Type': 'application/json' };
function b64url(bytes: Uint8Array): string {
  let value = '';
  for (let i = 0; i < bytes.length; i++) value += String.fromCharCode(bytes[i]);
  return btoa(value).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function signature(secret: string, timestamp: string, nonce: string, body: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  let hashHex = '';
  for (let i = 0; i < hash.length; i++) hashHex += hash[i].toString(16).padStart(2, '0');
  const canonical = `${timestamp}.${nonce}.${hashHex}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical))));
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, code: 'method_not_allowed' }), { status: 405, headers: jsonHeaders });
  const secret = Deno.env.get('APP_PAYMENT_BRIDGE_SECRET') ?? '';
  if (!secret || secret.length < 32) return new Response(JSON.stringify({ ok: false, code: 'bridge_not_configured' }), { status: 503, headers: jsonHeaders });

  const eventId = req.headers.get('X-Event-Id') ?? '';
  const timestamp = req.headers.get('X-Timestamp') ?? '';
  const nonce = req.headers.get('X-Nonce') ?? '';
  const provided = req.headers.get('X-Signature') ?? '';
  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!eventId || eventId.length > 255 || !Number.isInteger(ts) || Math.abs(now - ts) > 300 || nonce.length < 16 || nonce.length > 255 || provided.length < 32) {
    return new Response(JSON.stringify({ ok: false, code: 'invalid_callback_headers' }), { status: 401, headers: jsonHeaders });
  }

  const bodyText = await req.text();
  if (!bodyText || bodyText.length > 10000) return new Response(JSON.stringify({ ok: false, code: 'invalid_payload' }), { status: 400, headers: jsonHeaders });
  const expected = await signature(secret, timestamp, nonce, bodyText);
  if (!safeEqual(expected, provided)) return new Response(JSON.stringify({ ok: false, code: 'invalid_signature' }), { status: 401, headers: jsonHeaders });

  let body: Record<string, unknown>;
  try { body = JSON.parse(bodyText); } catch { return new Response(JSON.stringify({ ok: false, code: 'invalid_payload' }), { status: 400, headers: jsonHeaders }); }
  if (body.event_id !== eventId) return new Response(JSON.stringify({ ok: false, code: 'event_id_mismatch' }), { status: 400, headers: jsonHeaders });
  const bookingId = typeof body.booking_id === 'string' ? body.booking_id : '';
  const orderId = typeof body.order_id === 'string' ? body.order_id : '';
  const captureId = typeof body.capture_id === 'string' ? body.capture_id : '';
  const status = typeof body.status === 'string' ? body.status : '';
  if (!bookingId || !orderId || !captureId || !['captured', 'refunded', 'reversed', 'failed'].includes(status)
      || body.amount_cents !== 15000 || body.currency !== 'USD') {
    return new Response(JSON.stringify({ ok: false, code: 'invalid_payload' }), { status: 400, headers: jsonHeaders });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const { data, error } = await admin.rpc('apply_plan_review_payment_event', {
    p_event_id: eventId,
    p_session_id: bookingId,
    p_order_id: orderId,
    p_capture_id: captureId,
    p_status: status,
    p_amount_cents: 15000,
    p_currency: 'USD',
    p_occurred_at: body.captured_at ?? body.occurred_at ?? null,
  });
  if (error) {
    const known = ['session_not_found', 'invalid_payment_event', 'capture_conflict', 'invalid_payment_transition'];
    const code = known.find((item) => error.message.includes(item)) ?? 'payment_event_failed';
    return new Response(JSON.stringify({ ok: false, code }), { status: code === 'payment_event_failed' ? 500 : 400, headers: jsonHeaders });
  }
  return new Response(JSON.stringify({ ok: true, duplicate: data?.duplicate ?? false, status: data?.status ?? status }), { status: 200, headers: jsonHeaders });
});
