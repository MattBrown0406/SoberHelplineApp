import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type RawMessage  = { id: string; sender_role: 'member' | 'coach'; body: string; created_at: string };
type RawReaction = { message_id: string; account_id: string; reaction: string };

export interface ReactionSummary {
  emoji: string;
  count: number;
  byMe: boolean;
}

export interface ChatMessage {
  id: string;
  sender_role: 'member' | 'coach';
  body: string;
  created_at: string;
  reactions: ReactionSummary[];
}

function mergeReactions(raw: RawReaction[], msgId: string, myAccountId: string | null): ReactionSummary[] {
  const byEmoji = new Map<string, { count: number; byMe: boolean }>();
  for (const r of raw) {
    if (r.message_id !== msgId) continue;
    const curr = byEmoji.get(r.reaction) ?? { count: 0, byMe: false };
    byEmoji.set(r.reaction, {
      count: curr.count + 1,
      byMe: curr.byMe || r.account_id === myAccountId,
    });
  }
  return Array.from(byEmoji.entries()).map(([emoji, { count, byMe }]) => ({ emoji, count, byMe }));
}

export function useThread(accountId: string | null) {
  const [threadId, setThreadId]       = useState<string | null>(null);
  const [rawMessages, setRawMessages] = useState<RawMessage[]>([]);
  const [rawReactions, setRawReactions] = useState<RawReaction[]>([]);
  const [loading, setLoading]         = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const messages = useMemo<ChatMessage[]>(
    () => rawMessages.map((msg) => ({
      ...msg,
      reactions: mergeReactions(rawReactions, msg.id, accountId),
    })),
    [rawMessages, rawReactions, accountId],
  );

  const subscribeToThread = useCallback((tid: string) => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = supabase
      .channel(`thread-${tid}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${tid}` },
        (payload) => {
          const msg = payload.new as RawMessage;
          setRawMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
          );
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const r = payload.new as RawReaction;
          setRawReactions((prev) => {
            if (prev.some((x) => x.message_id === r.message_id && x.account_id === r.account_id && x.reaction === r.reaction)) return prev;
            return [...prev, r];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const r = payload.old as RawReaction;
          setRawReactions((prev) =>
            prev.filter((x) => !(x.message_id === r.message_id && x.account_id === r.account_id && x.reaction === r.reaction)),
          );
        },
      )
      .subscribe();
  }, []);

  const loadThread = useCallback(async (accId: string): Promise<string | null> => {
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

    const msgs = (history ?? []) as RawMessage[];
    setThreadId(tid);
    setRawMessages(msgs);

    if (msgs.length > 0) {
      const { data: reactions } = await supabase
        .from('message_reactions')
        .select('message_id, account_id, reaction')
        .in('message_id', msgs.map((m) => m.id));
      setRawReactions((reactions ?? []) as RawReaction[]);
    } else {
      setRawReactions([]);
    }

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

  const send = useCallback(async (body: string) => {
    if (!threadId || !body.trim()) return;
    const { data } = await supabase
      .from('messages')
      .insert({ thread_id: threadId, sender_role: 'member', body: body.trim() })
      .select('id, sender_role, body, created_at')
      .single();
    if (data) {
      setRawMessages((prev) =>
        prev.some((m) => m.id === (data as RawMessage).id) ? prev : [...prev, data as RawMessage],
      );
    }
  }, [threadId]);

  const archive = useCallback(async (): Promise<void> => {
    if (!threadId || !accountId) return;
    await supabase.rpc('archive_thread', { p_thread_id: threadId });
    setThreadId(null);
    setRawMessages([]);
    setRawReactions([]);
    setLoading(true);
    await loadThread(accountId);
  }, [threadId, accountId, loadThread]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string): Promise<void> => {
    await supabase.rpc('toggle_reaction', { p_message_id: messageId, p_reaction: emoji });
  }, []);

  return { messages, send, archive, toggleReaction, loading };
}
