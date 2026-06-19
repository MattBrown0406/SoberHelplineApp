import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { useThread, type ChatMessage } from '../src/hooks/useThread';
import { MAX_CONTENT_WIDTH } from '../src/components/ui/ScreenContainer';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😢', '😮', '👎'] as const;

export default function ChatScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { user } = useAccount();
  const router = useRouter();
  const { messages, send, archive, toggleReaction, loading } = useThread(user?.id ?? null);
  const [draft, setDraft] = useState('');
  const [archiving, setArchiving] = useState(false);
  const [pickerMessageId, setPickerMessageId] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  async function handleSend() {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    await send(body);
    listRef.current?.scrollToEnd({ animated: true });
  }

  function confirmArchive() {
    Alert.alert(
      t('chat.archiveTitle'),
      t('chat.archiveBody'),
      [
        { text: t('chat.archiveCancel'), style: 'cancel' },
        {
          text: t('chat.archiveConfirm'),
          style: 'destructive',
          onPress: async () => {
            setArchiving(true);
            await archive();
            setArchiving(false);
          },
        },
      ],
    );
  }

  async function handleReaction(emoji: string) {
    if (!pickerMessageId) return;
    setPickerMessageId(null);
    await toggleReaction(pickerMessageId, emoji);
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      {/* Reaction picker modal */}
      <Modal
        visible={pickerMessageId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerMessageId(null)}
      >
        <Pressable style={styles.pickerOverlay} onPress={() => setPickerMessageId(null)}>
          <View style={[styles.pickerCard, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <View style={styles.pickerRow}>
              {REACTION_EMOJIS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.pickerEmoji}
                  onPress={() => void handleReaction(emoji)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.pickerEmojiText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setPickerMessageId(null)}>
              <Text style={[styles.pickerDone, { color: colors.inkSoft }]}>
                {t('chat.reactionDone')}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.ink }]}>
            {t('messages.eyebrow')}
          </Text>
          <Text style={[styles.headerSub, { color: colors.inkSoft }]}>
            {t('chat.headerSub')}
          </Text>
        </View>
        <TouchableOpacity
          onPress={confirmArchive}
          hitSlop={12}
          disabled={archiving || loading}
        >
          {archiving
            ? <ActivityIndicator size="small" color={colors.inkSoft} />
            : <Text style={[styles.archiveBtn, { color: colors.inkSoft }]}>
                {t('chat.archiveButton')}
              </Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.chatColumn}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={styles.list}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item }) => {
                const isMe = item.sender_role === 'member';
                return (
                  <View style={[styles.messageWrap, isMe ? styles.messageWrapMe : styles.messageWrapCoach]}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onLongPress={() => setPickerMessageId(item.id)}
                      delayLongPress={350}
                    >
                      <View
                        style={[
                          styles.bubble,
                          isMe
                            ? [styles.bubbleMe, { backgroundColor: colors.primary }]
                            : [styles.bubbleCoach, { backgroundColor: colors.primaryLight }],
                        ]}
                      >
                        <Text
                          style={{
                            color: isMe ? '#fff' : colors.ink,
                            fontSize: 14,
                            lineHeight: 20,
                          }}
                        >
                          {item.body}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {item.reactions.length > 0 && (
                      <View style={[styles.reactionsRow, isMe ? styles.reactionsRowMe : styles.reactionsRowCoach]}>
                        {item.reactions.map(({ emoji, count, byMe }) => (
                          <TouchableOpacity
                            key={emoji}
                            style={[
                              styles.reactionPill,
                              {
                                backgroundColor: byMe ? colors.primaryLight : colors.cream,
                                borderColor: byMe ? colors.primary : colors.line,
                              },
                            ]}
                            onPress={() => void toggleReaction(item.id, emoji)}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.reactionEmoji}>{emoji}</Text>
                            {count > 1 && (
                              <Text style={[styles.reactionCount, { color: byMe ? colors.primary : colors.inkSoft }]}>
                                {count}
                              </Text>
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                );
              }}
            />
          )}

          <View style={[styles.inputRow, { borderTopColor: colors.line }]}>
            <TextInput
              style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
              placeholder={t('messages.placeholder')}
              placeholderTextColor={colors.inkSoft}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: draft.trim() ? colors.primary : colors.line }]}
              onPress={() => void handleSend()}
              disabled={!draft.trim()}
              activeOpacity={0.85}
            >
              <Text style={styles.sendText}>➤</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.crisisNote, { color: colors.inkSoft }]}>
            {t('chat.crisisNote')}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  chatColumn: { flex: 1, alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    backgroundColor: '#fff',
  },
  headerCenter: { flex: 1 },
  back: { fontSize: 30, fontWeight: '600', marginTop: -4 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  headerSub: { fontSize: 11.5, marginTop: 1 },
  archiveBtn: { fontSize: 12, fontWeight: '600' },

  list: { padding: 16, gap: 4, flexGrow: 1 },

  messageWrap: { marginBottom: 6 },
  messageWrapMe: { alignItems: 'flex-end' },
  messageWrapCoach: { alignItems: 'flex-start' },

  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleMe: { borderBottomRightRadius: 4 },
  bubbleCoach: { borderBottomLeftRadius: 4 },

  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionsRowMe: { justifyContent: 'flex-end' },
  reactionsRowCoach: { justifyContent: 'flex-start' },

  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderRadius: 99,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 12, fontWeight: '600' },

  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCard: {
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerRow: { flexDirection: 'row', gap: 6 },
  pickerEmoji: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerEmojiText: { fontSize: 28 },
  pickerDone: { fontSize: 13, fontWeight: '600' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    backgroundColor: '#fff',
  },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 14.5,
    maxHeight: 110,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: '#fff', fontSize: 16 },
  crisisNote: {
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingBottom: 10,
    backgroundColor: '#fff',
  },
});
