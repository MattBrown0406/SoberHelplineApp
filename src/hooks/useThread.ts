import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface ChatMessage {
  id: string;
  sender_role: 'member' | 'coach';
  body: string;
  created_at: string;
}

export function useThread(accountId: string | null) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const subscribeToThread = useCallback((tid: string) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
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
  }, []);

  const loadThread = useCallback(async (accId: string): Promise<string | null> => {
    // Get the most recent active (non-archived) oncall thread.
    const { data: existing } = await supabase
      .from('threads')
      .select('id')
      .eq('account_id', accId)
      .eq('kind', 'oncall')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let tid = existing?.id as string | undefined;
    if (!tid) {
      const { data: created } = await supabase
        .from('threads')
        .insert({ account_id: accId, kind: 'oncall' })
        .select('id')
        .single();
      tid = created?.id;
    }
    if (!tid) return null;

    const { data: history } = await supabase
      .from('messages')
      .select('id, sender_role, body, created_at')
      .eq('thread_id', tid)
      .order('created_at', { ascending: true })
      .limit(200);

    setThreadId(tid);
    setMessages((history as ChatMessage[]) ?? []);
    setLoading(false);
    subscribeToThread(tid);
    return tid;
  }, [subscribeToThread]);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);

    loadThread(accountId).then(() => {
      if (cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [accountId, loadThread]);

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

  const archive = useCallback(async (): Promise<void> => {
    if (!threadId || !accountId) return;
    await supabase.rpc('archive_thread', { p_thread_id: threadId });
    // Reset and open a fresh thread.
    setThreadId(null);
    setMessages([]);
    setLoading(true);
    await loadThread(accountId);
  }, [threadId, accountId, loadThread]);

  return { messages, send, archive, loading };
}
