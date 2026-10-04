// notify-coaching-request — Supabase Edge Function
//
// Called on every coaching_bookings INSERT by the migration-managed trigger
// shl_notify_coaching_request (20261004100000_notify_webhooks_vault_key.sql),
// with the Database Webhook body and the vault service key.
// Sends an email to matt@soberhelpline.com via Resend (RESEND_API_KEY).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const NOTIFY_TO = 'matt@soberhelpline.com';
const NOTIFY_FROM = 'notifications@soberhelpline.com';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** "Member — $125" for the member price, "$150" otherwise. */
function coachingPriceLine(rateCents: unknown): string {
  return Number(rateCents) === 12500 ? 'Member — $125' : '$150';
}

Deno.serve(async (req: Request) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  try {
    const payload = await req.json();
    const booking = payload.record;

    if (!booking) {
      return new Response('no record', { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // A $150 plan-review booking is paid online and managed in Admin; this
    // "we'll send payment details" email would invite a second payment request.
    const { data: planReview } = await supabase
      .from('video_sessions')
      .select('id')
      .eq('coaching_booking_id', booking.id)
      .maybeSingle();
    if (planReview) return new Response('plan review booking', { status: 200 });

    // Fetch the account's name for context
    const { data: account } = await supabase
      .from('accounts')
      .select('first_name, last_name')
      .eq('id', booking.account_id)
      .single();

    // The rate the server recorded for this request ($125 member price or
    // $150), from the row itself rather than the webhook body.
    const { data: saved } = await supabase
      .from('coaching_bookings')
      .select('rate_cents')
      .eq('id', booking.id)
      .maybeSingle();
    const price = coachingPriceLine(saved?.rate_cents ?? booking.rate_cents);

    const name = [account?.first_name, account?.last_name].filter(Boolean).join(' ') || 'A user';

    // Extract email from the "Contact: ..." line if the user provided one
    const contactLine = (booking.note ?? '').split('\n').find((l: string) => l.startsWith('Contact:'));
    const contactValue = contactLine ? contactLine.replace('Contact:', '').trim() : '';
    const userEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue) ? contactValue : null;

    const html = `
      <h2>New 1:1 Coaching Request</h2>
      <p><strong>From:</strong> ${escapeHtml(name)}</p>
      <p><strong>Rate quoted:</strong> ${escapeHtml(price)}</p>
      <p><strong>Available times:</strong><br>${escapeHtml(booking.preferred_times).replace(/\n/g, '<br>')}</p>
      ${booking.note ? `<p><strong>Notes / contact:</strong><br>${escapeHtml(booking.note).replace(/\n/g, '<br>')}</p>` : ''}
      <p><strong>Submitted:</strong> ${new Date(booking.created_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
      <hr>
      <p style="color:#666;font-size:12px;">Reply to this email or reach the user via the contact info above.</p>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        // Reply-to, never CC: the address is typed by the member, and a CC
        // would send this internal notification to any address they enter.
        ...(userEmail ? { reply_to: [userEmail] } : {}),
        subject: `New coaching request from ${name} (${price})`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[notify-coaching-request] Resend error:', err);
      return new Response('email failed', { status: 500 });
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('[notify-coaching-request] unexpected error:', err);
    return new Response('error', { status: 500 });
  }
});
