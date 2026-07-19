import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  const { data: tokens } = await supabase.rpc('get_session_rsvp_push_tokens', {
    p_session_title: 'The Family Squares',
  });

  if (!tokens?.length) return new Response('no subscribers', { status: 200 });

  const messages = (tokens as { push_token: string }[]).map((row) => ({
    to: row.push_token,
    title: 'Starting in 15 minutes',
    body: 'The Family Squares is tonight at 7:00 PM Pacific — tap to join',
    data: { screen: 'support' },
  }));

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });

  return new Response('ok', { status: 200 });
});
