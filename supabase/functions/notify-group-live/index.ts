import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const GROUP_NAMES: Record<string, string> = {
  'shp-parents': 'Parents of Addicted Young Adults',
  'shp-spouses': 'Spouses & Partners',
  'shp-boundaries': 'Setting & Holding Boundaries',
  'shp-treatment': 'Finding the Right Treatment Program',
};

Deno.serve(async (req) => {
  const payload = await req.json();

  // Only fire when is_live flips from false → true
  if (!payload.record?.is_live || payload.old_record?.is_live === true) {
    return new Response('skip', { status: 200 });
  }

  const roomName = payload.record.room_name as string;
  const groupName = GROUP_NAMES[roomName] ?? 'Your group';

  const { data: tokens } = await supabase.rpc('get_group_rsvp_push_tokens', {
    p_room_name: roomName,
  });

  if (!tokens?.length) return new Response('no subscribers', { status: 200 });

  const messages = (tokens as { push_token: string }[]).map((row) => ({
    to: row.push_token,
    title: 'Live session starting now',
    body: `${groupName} just went live — tap to join`,
    data: { screen: 'support' },
  }));

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });

  return new Response('ok', { status: 200 });
});
