import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ChatMessage {
  id: string;
  sender_role: 'member' | 'coach';
  body: string;
  created_at: string;
}

/**
 * Get-or-create the member's on-call thread, load history, and subscribe to
 * new messages via Supabase Realtime. Coach replies arrive through the
 * provider dashboard (service role) and appear live here.
 */
export function useThread(accountId: string | null) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    async function init() {
      // get-or-create
      const { data: existing } = await supabase
        .from('threads')
        .select('id')
        .eq('kind', 'oncall')
        .maybeSingle();

      let tid = existing?.id as string | undefined;
      if (!tid) {
        const { data: created } = await supabase
          .from('threads')
          .insert({ account_id: accountId, kind: 'oncall' })
          .select('id')
          .single();
        tid = created?.id;
      }
      if (!tid || cancelled) return;
      setThreadId(tid);

      const { data: history } = await supabase
        .from('messages')
        .select('id, sender_role, body, created_at')
        .eq('thread_id', tid)
        .order('created_at', { ascending: true })
        .limit(200);
      if (!cancelled) {
        setMessages((history as ChatMessage[]) ?? []);
        setLoading(false);
      }

      channelRef.current = supabase
        .channel(`thread-${tid}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${tid}` },
          (payload) => {
            const msg = payload.new as ChatMessage;
            setMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
            );
          },
        )
        .subscribe();
    }

    init();
    return () => {
      cancelled = true;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [accountId]);

  const send = useCallback(
    async (body: string) => {
      if (!threadId || !body.trim()) return;
      const { data } = await supabase
        .from('messages')
        .insert({ thread_id: threadId, sender_role: 'member', body: body.trim() })
        .select('id, sender_role, body, created_at')
        .single();
      if (data) {
        setMessages((prev) =>
          prev.some((m) => m.id === (data as ChatMessage).id)
            ? prev
            : [...prev, data as ChatMessage],
        );
      }
    },
    [threadId],
  );

  return { messages, send, loading };
}
