// notify-coaching-request — Supabase Edge Function
//
// Triggered by a Database Webhook on coaching_bookings INSERT.
// Sends an email to matt@soberhelpline.com via Resend.
//
// Setup:
//   1. Get a free API key at https://resend.com
//   2. Verify your sending domain (soberhelpline.com) in the Resend dashboard
//   3. supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
//   4. supabase functions deploy notify-coaching-request
//   5. Dashboard → Database → Webhooks → Create webhook:
//        Table: coaching_bookings  |  Event: INSERT
//        URL: https://<project-ref>.supabase.co/functions/v1/notify-coaching-request
//        HTTP method: POST  |  Add header: Authorization: Bearer <service-role-key>

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

Deno.serve(async (req: Request) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  try {
    const payload = await req.json();
    const booking = payload.record;

    if (!booking) {
      return new Response('no record', { status: 400 });
    }

    // Fetch the account's name for context
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: account } = await supabase
      .from('accounts')
      .select('first_name, last_name')
      .eq('id', booking.account_id)
      .single();

    const name = [account?.first_name, account?.last_name].filter(Boolean).join(' ') || 'A user';

    // Extract email from the "Contact: ..." line if the user provided one
    const contactLine = (booking.note ?? '').split('\n').find((l: string) => l.startsWith('Contact:'));
    const contactValue = contactLine ? contactLine.replace('Contact:', '').trim() : '';
    const userEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue) ? contactValue : null;

    const html = `
      <h2>New 1:1 Coaching Request</h2>
      <p><strong>From:</strong> ${escapeHtml(name)}</p>
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
        ...(userEmail ? { cc: [userEmail] } : {}),
        subject: `New coaching request from ${name}`,
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
