import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { isAdminEmail } from '../src/lib/admin';
import { supabase } from '../src/lib/supabase';
import { MAX_CONTENT_WIDTH } from '../src/components/ui/ScreenContainer';

type ThreadMessage = {
  id: string;
  sender_role: 'member' | 'coach' | 'ai' | 'system';
  body: string;
  created_at: string;
};

type Attachment = {
  id: string;
  message_id: string;
  storage_path: string;
  mime_type: string;
  file_name: string | null;
  signedUrl: string | null;
};

type ThreadAccount = { first_name: string | null; last_name: string | null };
type ThreadHeader = {
  id: string;
  status: string | null;
  risk_level: string | null;
  ai_summary: string | null;
  accounts: ThreadAccount | ThreadAccount[] | null;
};

const ATTACHMENT_BUCKET = 'chat-attachments';

async function signAttachment(row: Omit<Attachment, 'signedUrl'>): Promise<Attachment> {
  const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(row.storage_path, 60 * 60);
  return { ...row, signedUrl: data?.signedUrl ?? null };
}

function getThreadAccount(accounts: ThreadHeader['accounts']): ThreadAccount | null {
  if (!accounts) return null;
  return Array.isArray(accounts) ? accounts[0] ?? null : accounts;
}

export default function AdminThreadScreen() {
  const router = useRouter();
  const { threadId } = useLocalSearchParams<{ threadId?: string }>();
  const { user } = useAccount();
  const { colors } = useTheme();
  const isAdmin = isAdminEmail(user?.email);

  const [thread, setThread] = useState<ThreadHeader | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ThreadMessage>>(null);

  useEffect(() => {
    if (user && !isAdmin) router.replace('/');
  }, [user, isAdmin, router]);

  const loadThread = useCallback(async () => {
    if (!threadId) return;
    setLoading(true);

    const { data: threadData, error: threadError } = await supabase
      .from('threads')
      .select('id, status, risk_level, ai_summary, accounts(first_name, last_name)')
      .eq('id', threadId)
      .single();

    if (threadError) {
      setLoading(false);
      Alert.alert('Could not load thread', threadError.message);
      return;
    }

    const { data: messageData, error: messageError } = await supabase
      .from('messages')
      .select('id, sender_role, body, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(300);

    if (messageError) {
      setLoading(false);
      Alert.alert('Could not load messages', messageError.message);
      return;
    }

    const { data: attachmentData } = await supabase
      .from('message_attachments')
      .select('id, message_id, storage_path, mime_type, file_name')
      .eq('thread_id', threadId);

    const signed = await Promise.all(((attachmentData ?? []) as Omit<Attachment, 'signedUrl'>[]).map(signAttachment));

    setThread(threadData as ThreadHeader);
    setMessages((messageData ?? []) as ThreadMessage[]);
    setAttachments(signed);
    await supabase.rpc('admin_mark_thread_read', { p_thread_id: threadId });
    setLoading(false);
  }, [threadId]);

  useEffect(() => { void loadThread(); }, [loadThread]);

  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`admin-thread-${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const msg = payload.new as ThreadMessage;
          setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
          void supabase.rpc('admin_mark_thread_read', { p_thread_id: threadId });
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'message_attachments', filter: `thread_id=eq.${threadId}` },
        (payload) => {
          const row = payload.new as Omit<Attachment, 'signedUrl'>;
          void signAttachment(row).then((att) => {
            setAttachments((prev) => prev.some((x) => x.id === att.id) ? prev : [...prev, att]);
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [threadId]);

  async function sendReply() {
    const body = draft.trim();
    if (!threadId || !body) return;
    setSending(true);
    setDraft('');
    const { error } = await supabase.rpc('admin_send_thread_message', { p_thread_id: threadId, p_body: body });
    setSending(false);
    if (error) {
      setDraft(body);
      Alert.alert('Reply not sent', error.message);
    }
  }

  async function archiveThread() {
    if (!threadId) return;
    Alert.alert('Archive conversation?', 'This archives this thread and starts a fresh one for the member next time they message.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('archive_thread', { p_thread_id: threadId });
          if (error) Alert.alert('Archive failed', error.message);
          else router.back();
        },
      },
    ]);
  }

  if (!user || !isAdmin) return null;

  const account = getThreadAccount(thread?.accounts ?? null);
  const memberName = [account?.first_name, account?.last_name].filter(Boolean).join(' ') || 'Member';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}> 
      <View style={[styles.header, { backgroundColor: colors.white, borderBottomColor: colors.line }]}> 
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.title, { color: colors.ink }]}>{memberName}</Text>
          <Text style={[styles.sub, { color: colors.inkSoft }]}>Emergency Text Line · {thread?.risk_level ?? 'normal'} · {thread?.status ?? 'active'}</Text>
        </View>
        <TouchableOpacity onPress={() => void archiveThread()} hitSlop={12}>
          <Text style={[styles.archive, { color: colors.inkSoft }]}>Archive</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.column}>
          {loading ? (
            <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={styles.list}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item }) => {
                const isMember = item.sender_role === 'member';
                const msgAttachments = attachments.filter((att) => att.message_id === item.id);
                return (
                  <View style={[styles.messageWrap, isMember ? styles.memberWrap : styles.coachWrap]}>
                    <Text style={[styles.role, { color: colors.inkSoft }]}>{isMember ? memberName : item.sender_role === 'ai' ? 'AI draft/system' : 'Admin'}</Text>
                    <View style={[styles.bubble, isMember ? { backgroundColor: colors.primary } : { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1 }]}>
                      <Text style={[styles.body, { color: isMember ? '#fff' : colors.ink }]}>{item.body}</Text>
                      {msgAttachments.length > 0 && (
                        <View style={styles.attachmentGrid}>
                          {msgAttachments.map((att) => att.signedUrl ? (
                            <Image key={att.id} source={{ uri: att.signedUrl }} style={styles.attachmentImage} />
                          ) : null)}
                        </View>
                      )}
                    </View>
                    <Text style={[styles.time, { color: colors.inkSoft }]}>{new Date(item.created_at).toLocaleString()}</Text>
                  </View>
                );
              }}
            />
          )}

          <View style={[styles.inputRow, { backgroundColor: colors.white, borderTopColor: colors.line }]}> 
            <TextInput
              style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
              value={draft}
              onChangeText={setDraft}
              placeholder="Reply as admin..."
              placeholderTextColor={colors.inkSoft}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: draft.trim() && !sending ? colors.primary : colors.line }]}
              disabled={!draft.trim() || sending}
              onPress={() => void sendReply()}
            >
              {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendText}>➤</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  column: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  back: { fontSize: 30, fontWeight: '600', marginTop: -4 },
  headerCenter: { flex: 1 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 11.5, marginTop: 2 },
  archive: { fontSize: 12, fontWeight: '700' },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  messageWrap: { maxWidth: '88%' },
  memberWrap: { alignSelf: 'flex-start' },
  coachWrap: { alignSelf: 'flex-end' },
  role: { fontSize: 11, fontWeight: '700', marginBottom: 3 },
  bubble: { borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14 },
  body: { fontSize: 14, lineHeight: 20 },
  time: { fontSize: 10.5, marginTop: 3 },
  attachmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  attachmentImage: { width: 160, height: 160, borderRadius: 10, backgroundColor: '#ddd' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1 },
  input: { flex: 1, borderWidth: 1.5, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14.5, maxHeight: 120 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 16 },
});
