// Database INSERT webhook. Never trust webhook copy or a cached device token.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireServiceRole } from '../_shared/service-auth.ts';
import { ADMIN_EMAILS } from '../_shared/admin.ts';
import { coachMessageData, memberMessageData } from '../_shared/push-data.ts';
import { checked, deliverLegacy } from '../_shared/legacy-sender-boundary.ts';

Deno.serve(async (req: Request) => {
  const authError = requireServiceRole(req);
  if (authError) return authError;
  try {
    const { record } = await req.json();
    if (!record?.id || !record?.thread_id) return new Response('no record', { status: 400 });
    const db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    // A single snapshot binds source, thread ownership, account, locale/device.
    const source = async () =>
      await checked(
        db.from('messages')
          .select(
            'id, thread_id, sender_role, created_at, threads!inner(account_id, accounts!inner(id, first_name, push_token, locale))',
          )
          .eq('id', record.id).eq('thread_id', record.thread_id).maybeSingle(),
      );
    const message = await source();
    if (!message) return new Response('ok');
    type Thread = {
      account_id: string;
      accounts: {
        id: string;
        first_name: string | null;
        push_token: string | null;
        locale: string | null;
      };
    };
    if (message.sender_role === 'member') {
      let failed = false;
      for (const email of ADMIN_EMAILS) {
        const current = await source();
        if (!current || current.sender_role !== 'member') continue;
        const thread = current.threads as unknown as Thread;
        if (!thread?.accounts || thread.accounts.id !== thread.account_id) continue;
        const token = await checked(db.rpc('get_account_push_token_by_email', { p_email: email }));
        if (!token) continue;
        const result = await deliverLegacy({
          to: token,
          title: `Message from ${thread.accounts.first_name ?? 'Someone'}`,
          body: 'Open Sober Helpline to read this private message.',
          sound: 'default',
          data: memberMessageData(message.thread_id),
        });
        if (!result.ok && !result.skipped) failed = true;
      }
      if (failed) return new Response('provider_failed', { status: 502 });
    } else if (message.sender_role === 'coach') {
      const thread = message.threads as unknown as Thread;
      const member = thread?.accounts;
      if (!member?.push_token || member.id !== thread.account_id) return new Response('ok');
      const es = String(member.locale ?? '').startsWith('es');
      const result = await deliverLegacy({
        to: member.push_token,
        title: es ? 'Nuevo mensaje de tu coach' : 'New message from your coach',
        body: es
          ? 'Abre Sober Helpline para leer este mensaje privado.'
          : 'Open Sober Helpline to read this private message.',
        sound: 'default',
        data: coachMessageData(message.thread_id),
      });
      if (!result.ok && !result.skipped) return new Response('provider_failed', { status: 502 });
    }
    return new Response('ok');
  } catch {
    return new Response('lookup_failed', { status: 500 });
  }
});
