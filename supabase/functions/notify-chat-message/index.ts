// notify-chat-message — Supabase Edge Function
//
// Triggered by a Database Webhook on messages INSERT.
// Sends an Expo push notification:
//   - member sends  → notify Matt (the coach)
//   - coach replies → notify the member
//
// Setup:
//   1. supabase functions deploy notify-chat-message
//   2. Dashboard → Database → Webhooks → Create webhook:
//        Table: messages  |  Event: INSERT
//        URL: https://<project-ref>.supabase.co/functions/v1/notify-chat-message
//        HTTP method: POST
//        Add header: Authorization: Bearer <service-role-key>

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const COACH_EMAIL = 'matt@soberhelpline.com';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendExpoPush(to: string, title: string, body: string): Promise<void> {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to, title, body, sound: 'default' }),
  });
  if (!res.ok) {
    console.error('[notify-chat-message] Expo push error:', await res.text());
  }
}

Deno.serve(async (req: Request) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  try {
    const payload = await req.json();
    const message = payload.record;

    if (!message?.thread_id) {
      return new Response('no record', { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve the member attached to this thread
    const { data: memberRows } = await supabase.rpc('get_thread_member_info', {
      p_thread_id: message.thread_id,
    });
    const member = memberRows?.[0];

    if (message.sender_role === 'member') {
      // A user sent a message — notify the coach
      const { data: coachToken } = await supabase.rpc('get_account_push_token_by_email', {
        p_email: COACH_EMAIL,
      });
      if (coachToken) {
        const name = member?.first_name ?? 'Someone';
        await sendExpoPush(
          coachToken,
          `Message from ${name}`,
          'Open Sober Helpline to read this private message.',
        );
      } else {
        console.warn('[notify-chat-message] coach has no push token yet');
      }
    } else if (message.sender_role === 'coach') {
      // Coach replied — notify the member
      if (member?.push_token) {
        await sendExpoPush(
          member.push_token,
          'New message from your coach',
          'Open Sober Helpline to read this private message.',
        );
      } else {
        console.warn('[notify-chat-message] member has no push token');
      }
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('[notify-chat-message] unexpected error:', err);
    return new Response('error', { status: 500 });
  }
});
