import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';

const ATTACHMENT_BUCKET = 'chat-attachments';

type RawMessage  = { id: string; sender_role: 'member' | 'coach' | 'ai' | 'system'; body: string; created_at: string };
type RawReaction = { message_id: string; account_id: string; reaction: string };
type RawAttachment = {
  id: string;
  message_id: string;
  thread_id: string;
  storage_path: string;
  mime_type: string;
  file_name: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  created_at: string;
};

export interface PendingAttachment {
  uri: string;
  mimeType: string;
  fileName: string;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
}

export interface ChatAttachment extends RawAttachment {
  signedUrl: string | null;
  localUri?: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  byMe: boolean;
}

export interface ChatMessage {
  id: string;
  sender_role: 'member' | 'coach' | 'ai' | 'system';
  body: string;
  created_at: string;
  reactions: ReactionSummary[];
  attachments: ChatAttachment[];
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

function sanitizeFileName(name: string): string {
  return (name || `attachment-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 90);
}

async function signedAttachment(raw: RawAttachment, localUri?: string): Promise<ChatAttachment> {
  const { data } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(raw.storage_path, 60 * 60);
  return { ...raw, signedUrl: data?.signedUrl ?? null, localUri };
}

async function uploadAttachment(
  accountId: string,
  threadId: string,
  messageId: string,
  attachment: PendingAttachment,
): Promise<ChatAttachment | null> {
  const fileName = sanitizeFileName(attachment.fileName);
  const storagePath = `${accountId}/${threadId}/${messageId}/${Date.now()}-${fileName}`;

  // Read as base64 and upload raw bytes. React Native's fetch(file://).blob()
  // is the classic zero-byte-upload trap with supabase-js — never use it here.
  const base64 = await FileSystem.readAsStringAsync(attachment.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(storagePath, bytes.buffer as ArrayBuffer, {
      contentType: attachment.mimeType,
      upsert: false,
    });

  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('message_attachments')
    .insert({
      message_id: messageId,
      thread_id: threadId,
      storage_path: storagePath,
      mime_type: attachment.mimeType,
      file_name: fileName,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      size_bytes: attachment.sizeBytes ?? null,
    })
    .select('id, message_id, thread_id, storage_path, mime_type, file_name, width, height, size_bytes, created_at')
    .single();

  if (error || !data) throw error ?? new Error('attachment insert failed');
  return signedAttachment(data as RawAttachment, attachment.uri);
}

export function useThread(accountId: string | null, enabled = true) {
  const [threadId, setThreadId]       = useState<string | null>(null);
  const [rawMessages, setRawMessages] = useState<RawMessage[]>([]);
  const [rawReactions, setRawReactions] = useState<RawReaction[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [loading, setLoading]         = useState(true);
  const [sending, setSending]         = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const messages = useMemo<ChatMessage[]>(
    () => rawMessages.map((msg) => ({
      ...msg,
      reactions: mergeReactions(rawReactions, msg.id, accountId),
      attachments: attachments.filter((att) => att.message_id === msg.id),
    })),
    [rawMessages, rawReactions, attachments, accountId],
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
        { event: 'INSERT', schema: 'public', table: 'message_attachments', filter: `thread_id=eq.${tid}` },
        (payload) => {
          void signedAttachment(payload.new as RawAttachment).then((att) => {
            setAttachments((prev) => prev.some((x) => x.id === att.id) ? prev : [...prev, att]);
          });
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
      const { data: created, error } = await supabase
        .from('threads')
        .insert({ account_id: accId, kind: 'oncall' })
        .select('id')
        .single();
      if (error) throw error;
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
      const [reactionRes, attachmentRes] = await Promise.all([
        supabase
          .from('message_reactions')
          .select('message_id, account_id, reaction')
          .in('message_id', msgs.map((m) => m.id)),
        supabase
          .from('message_attachments')
          .select('id, message_id, thread_id, storage_path, mime_type, file_name, width, height, size_bytes, created_at')
          .eq('thread_id', tid),
      ]);
      setRawReactions((reactionRes.data ?? []) as RawReaction[]);
      const signed = await Promise.all(((attachmentRes.data ?? []) as RawAttachment[]).map((att) => signedAttachment(att)));
      setAttachments(signed);
    } else {
      setRawReactions([]);
      setAttachments([]);
    }

    setLoading(false);
    subscribeToThread(tid);
    return tid;
  }, [subscribeToThread]);

  useEffect(() => {
    if (!accountId || !enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    loadThread(accountId).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [accountId, enabled, loadThread]);

  const send = useCallback(async (body: string, pendingAttachments: PendingAttachment[] = []) => {
    if (!threadId || !accountId) return;
    const trimmed = body.trim();
    if (!trimmed && pendingAttachments.length === 0) return;

    setSending(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({
          thread_id: threadId,
          sender_role: 'member',
          body: trimmed || 'Attached screenshot/image',
        })
        .select('id, sender_role, body, created_at')
        .single();
      if (error) throw error;

      const msg = data as RawMessage;
      setRawMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
      );

      if (pendingAttachments.length > 0) {
        const uploaded = await Promise.all(
          pendingAttachments.map((att) => uploadAttachment(accountId, threadId, msg.id, att)),
        );
        setAttachments((prev) => {
          const next = [...prev];
          for (const att of uploaded) {
            if (att && !next.some((x) => x.id === att.id)) next.push(att);
          }
          return next;
        });
      }
    } finally {
      setSending(false);
    }
  }, [threadId, accountId]);

  const archive = useCallback(async (): Promise<void> => {
    if (!threadId || !accountId) return;
    await supabase.rpc('archive_thread', { p_thread_id: threadId });
    setThreadId(null);
    setRawMessages([]);
    setRawReactions([]);
    setAttachments([]);
    setLoading(true);
    await loadThread(accountId);
  }, [threadId, accountId, loadThread]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string): Promise<void> => {
    await supabase.rpc('toggle_reaction', { p_message_id: messageId, p_reaction: emoji });
  }, []);

  return { messages, send, archive, toggleReaction, loading, sending, threadId };
}
