import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { threadChannelTopic } from '../lib/realtimeTopics';
import { useAsyncScope } from './useAsyncScope';

const ATTACHMENT_BUCKET = 'chat-attachments';

type RawMessage  = { id: string; sender_role: 'member' | 'coach' | 'ai' | 'system'; body: string; created_at: string };
type RawReaction = { id: string; message_id: string; account_id: string; reaction: string };
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

const HISTORY_LIMIT = 200;
const MESSAGE_COLUMNS = 'id, sender_role, body, created_at';

// Newest HISTORY_LIMIT messages, returned oldest-first for display.
async function fetchRecentMessages(threadId: string): Promise<RawMessage[] | null> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) return null;
  return ((data ?? []) as RawMessage[]).reverse();
}

function mergeMessages(prev: RawMessage[], incoming: RawMessage[]): RawMessage[] {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export class ThreadUnavailableError extends Error {
  constructor() {
    super('thread_unavailable');
    this.name = 'ThreadUnavailableError';
  }
}

// The message itself was saved; only its attachments failed. Retrying the whole
// send would post the text twice.
export class AttachmentUploadError extends Error {
  /** Only the attachments that did not upload; the rest are already sent. */
  readonly failed: PendingAttachment[];

  constructor(cause: unknown, failed: PendingAttachment[] = []) {
    super('attachment_upload_failed');
    this.name = 'AttachmentUploadError';
    this.cause = cause;
    this.failed = failed;
  }
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
  isCurrent: () => boolean,
): Promise<ChatAttachment | null> {
  if (!isCurrent()) throw new ThreadUnavailableError();
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

  if (!isCurrent()) throw new ThreadUnavailableError();
  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(storagePath, bytes.buffer as ArrayBuffer, {
      contentType: attachment.mimeType,
      upsert: false,
    });

  if (uploadError) throw uploadError;
  if (!isCurrent()) throw new ThreadUnavailableError();

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
  if (!isCurrent()) throw new ThreadUnavailableError();
  return signedAttachment(data as RawAttachment, attachment.uri);
}

/**
 * readOnly: load the member's existing conversation without creating one and
 * without sending — members off the Text Line plan can still read replies to
 * their situation briefs.
 */
export function useThread(accountId: string | null, enabled = true, { readOnly = false }: { readOnly?: boolean } = {}) {
  const { scope, isCurrent } = useAsyncScope(JSON.stringify([accountId, enabled, readOnly]));
  const loadedScope = useRef<typeof scope | null>(null);
  const [threadId, setThreadId]       = useState<string | null>(null);
  const [rawMessages, setRawMessages] = useState<RawMessage[]>([]);
  const [rawReactions, setRawReactions] = useState<RawReaction[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [loading, setLoading]         = useState(true);
  const [sending, setSending]         = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // supabase.channel(topic) returns the existing channel for a topic, so two
  // screens on the same thread would share (and tear down) one subscription.
  const [channelInstanceId] = useState(() => Math.random().toString(36).slice(2));
  const threadIdRef = useRef<string | null>(null);
  // Account identity alone cannot fence an archived/replaced conversation.
  const threadGeneration = useRef(0);

  const messages = useMemo<ChatMessage[]>(
    () => rawMessages.map((msg) => ({
      ...msg,
      reactions: mergeReactions(rawReactions, msg.id, accountId),
      attachments: attachments.filter((att) => att.message_id === msg.id),
    })),
    [rawMessages, rawReactions, attachments, accountId],
  );

  // Catches messages that landed between the history fetch and the realtime
  // join, or while the socket was down or the app was backgrounded.
  const refreshMessages = useCallback(async (tid: string) => {
    if (!isCurrent()) return;
    const generation = threadGeneration.current;
    const recent = await fetchRecentMessages(tid);
    if (!isCurrent() || generation !== threadGeneration.current || !recent || threadIdRef.current !== tid) return;
    setRawMessages((prev) => mergeMessages(prev, recent));
  }, [isCurrent]);

  const subscribeToThread = useCallback((tid: string) => {
    const generation = threadGeneration.current;
    const isLiveThread = () => isCurrent() && generation === threadGeneration.current && threadIdRef.current === tid;
    if (!isLiveThread()) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    channelRef.current = supabase
      .channel(threadChannelTopic(tid, channelInstanceId))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${tid}` },
        (payload) => {
          if (!isLiveThread()) return;
          const msg = payload.new as RawMessage;
          setRawMessages((prev) => mergeMessages(prev, [msg]));
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_attachments', filter: `thread_id=eq.${tid}` },
        (payload) => {
          if (!isLiveThread()) return;
          void signedAttachment(payload.new as RawAttachment).then((att) => {
            if (!isLiveThread()) return;
            setAttachments((prev) => prev.some((x) => x.id === att.id) ? prev : [...prev, att]);
          }).catch(() => { /* A later refresh can retry signing. */ });
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_reactions' },
        (payload) => {
          if (!isLiveThread()) return;
          const r = payload.new as RawReaction;
          setRawReactions((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'message_reactions' },
        (payload) => {
          if (!isLiveThread()) return;
          // With RLS on, DELETE payloads carry only the primary key.
          const removedId = (payload.old as Partial<RawReaction>).id;
          if (removedId) setRawReactions((prev) => prev.filter((x) => x.id !== removedId));
        },
      )
      .subscribe((status) => {
        if (isLiveThread() && status === 'SUBSCRIBED') void refreshMessages(tid);
      });
  }, [channelInstanceId, refreshMessages, isCurrent]);

  const loadThread = useCallback(async (accId: string, cancelled: () => boolean = () => false): Promise<string | null> => {
    if (!isCurrent() || cancelled()) return null;
    const generation = ++threadGeneration.current;
    const isCancelled = () => !isCurrent() || cancelled() || generation !== threadGeneration.current;
    // Retire the old subscription immediately, before waiting for new history.
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    threadIdRef.current = null;
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
    if (isCancelled()) return null;
    if (!tid && readOnly) {
      // Off-plan members only read: if the coach archived the conversation,
      // its replies (e.g. to a situation brief) must stay readable.
      const { data: latest } = await supabase
        .from('threads')
        .select('id')
        .eq('account_id', accId)
        .eq('kind', 'oncall')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      tid = latest?.id as string | undefined;
      if (isCancelled()) return null;
    }
    if (!tid && readOnly) {
      if (!isCancelled()) {
        threadIdRef.current = null;
        setThreadId(null);
        setRawMessages([]);
        setLoading(false);
      }
      return null;
    }
    if (!tid) {
      const { data: created, error } = await supabase
        .from('threads')
        .insert({ account_id: accId, kind: 'oncall' })
        .select('id')
        .single();
      if (isCancelled()) return null;
      if (error?.code === '23505') {
        // Another screen opened the conversation first; use that one.
        const { data: winner } = await supabase
          .from('threads')
          .select('id')
          .eq('account_id', accId)
          .eq('kind', 'oncall')
          .is('archived_at', null)
          .maybeSingle();
        tid = winner?.id;
      } else if (error) {
        throw error;
      } else {
        tid = created?.id;
      }
    }
    if (!tid || isCancelled()) return null;

    const history = await fetchRecentMessages(tid);
    const msgs = history ?? [];
    if (isCancelled()) return null;
    loadedScope.current = scope;
    threadIdRef.current = tid;
    setThreadId(tid);
    setRawMessages(msgs);

    if (msgs.length > 0) {
      const [reactionRes, attachmentRes] = await Promise.all([
        supabase
          .from('message_reactions')
          .select('id, message_id, account_id, reaction')
          .in('message_id', msgs.map((m) => m.id)),
        supabase
          .from('message_attachments')
          .select('id, message_id, thread_id, storage_path, mime_type, file_name, width, height, size_bytes, created_at')
          .eq('thread_id', tid),
      ]);
      if (isCancelled()) return null;
      setRawReactions((reactionRes.data ?? []) as RawReaction[]);
      const signed = await Promise.all(((attachmentRes.data ?? []) as RawAttachment[]).map((att) => signedAttachment(att)));
      if (isCancelled()) return null;
      setAttachments(signed);
    } else {
      setRawReactions([]);
      setAttachments([]);
    }

    // Subscribing after the effect was cleaned up would leak a realtime channel
    // that cleanup can no longer see.
    if (isCancelled()) return null;
    setLoading(false);
    subscribeToThread(tid);
    return tid;
  }, [subscribeToThread, readOnly, scope, isCurrent]);

  useEffect(() => {
    loadedScope.current = null;
    threadIdRef.current = null;
    setThreadId(null);
    setRawMessages([]);
    setRawReactions([]);
    setAttachments([]);
    setSending(false);
    if (!accountId || !enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    loadThread(accountId, () => cancelled).catch(() => {
      if (!cancelled && isCurrent()) setLoading(false);
    });

    const appStateSub = AppState.addEventListener('change', (next) => {
      const tid = threadIdRef.current;
      if (next === 'active' && tid) void refreshMessages(tid);
    });

    return () => {
      cancelled = true;
      threadGeneration.current += 1;
      appStateSub.remove();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [accountId, enabled, loadThread, refreshMessages, isCurrent]);

  /** attachmentOnlyBody: localized text stored when a message is photos only. */
  const send = useCallback(async (body: string, pendingAttachments: PendingAttachment[] = [], attachmentOnlyBody = '📷') => {
    const trimmed = body.trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    if (!isCurrent() || !accountId || !enabled || readOnly) throw new ThreadUnavailableError();

    setSending(true);
    try {
      // The thread may have failed to load (offline on open, or a transient
      // error); try once more rather than dropping the member's message.
      let activeThreadId = (loadedScope.current === scope ? threadId : null) ?? (await loadThread(accountId));
      if (!isCurrent() || !activeThreadId) throw new ThreadUnavailableError();

      let generation = threadGeneration.current;
      const isLiveThread = () => isCurrent() && generation === threadGeneration.current;
      const insertInto = (tid: string) => supabase
        .from('messages')
        .insert({
          thread_id: tid,
          sender_role: 'member',
          body: trimmed || attachmentOnlyBody,
        })
        .select('id, sender_role, body, created_at')
        .single();
      let { data, error } = await insertInto(activeThreadId);
      if (!isCurrent()) return;
      if (!isLiveThread()) throw new ThreadUnavailableError();
      if (error?.code === '42501') {
        // The open thread was archived (by the coach or another device) while
        // this screen stayed mounted: move to the current conversation and
        // send there instead of failing every retry.
        threadIdRef.current = null;
        const current = await loadThread(accountId);
        if (!isCurrent() || !current) throw new ThreadUnavailableError();
        generation = threadGeneration.current;
        activeThreadId = current;
        ({ data, error } = await insertInto(current));
      }
      if (!isCurrent()) return;
      if (!isLiveThread()) throw new ThreadUnavailableError();
      if (error) throw error;

      const msg = data as RawMessage;
      setRawMessages((prev) => mergeMessages(prev, [msg]));

      if (pendingAttachments.length > 0) {
        const results = await Promise.allSettled(
          pendingAttachments.map((att) => uploadAttachment(accountId, activeThreadId as string, msg.id, att, isLiveThread)),
        );
        if (!isCurrent()) return;
        if (!isLiveThread()) throw new ThreadUnavailableError();
        setAttachments((prev) => {
          const next = [...prev];
          for (const result of results) {
            const att = result.status === 'fulfilled' ? result.value : null;
            if (att && !next.some((x) => x.id === att.id)) next.push(att);
          }
          return next;
        });
        const failedAttachments = pendingAttachments.filter((_, index) => results[index].status === 'rejected');
        const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed) throw new AttachmentUploadError(failed.reason, failedAttachments);
      }
    } finally {
      if (isCurrent()) setSending(false);
    }
  }, [threadId, accountId, loadThread, readOnly, enabled, scope, isCurrent]);

  const archive = useCallback(async (): Promise<void> => {
    if (!isCurrent() || loadedScope.current !== scope || !enabled || readOnly || !threadId || !accountId) return;
    // Only drop local state once the server actually archived the thread;
    // otherwise an offline tap hides the conversation without archiving it.
    const generation = threadGeneration.current;
    const { error } = await supabase.rpc('archive_thread', { p_thread_id: threadId });
    if (!isCurrent() || generation !== threadGeneration.current) return;
    if (error) throw error;
    threadIdRef.current = null;
    setThreadId(null);
    setRawMessages([]);
    setRawReactions([]);
    setAttachments([]);
    setLoading(true);
    try {
      await loadThread(accountId);
    } catch (error) {
      if (isCurrent()) setLoading(false);
      throw error;
    }
  }, [threadId, accountId, loadThread, enabled, readOnly, scope, isCurrent]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string): Promise<void> => {
    if (!isCurrent() || !accountId || !enabled || readOnly) throw new ThreadUnavailableError();
    const { error } = await supabase.rpc('toggle_reaction', { p_message_id: messageId, p_reaction: emoji });
    if (error) throw error;
  }, [isCurrent, accountId, enabled, readOnly]);

  const visible = loadedScope.current === scope && !!accountId && enabled;
  return { messages: visible ? messages : [], send, archive, toggleReaction,
    loading, sending: visible && sending, threadId: visible ? threadId : null };
}
