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
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { useThread, type ChatMessage, type PendingAttachment } from '../src/hooks/useThread';
import { useSessions } from '../src/hooks/useSessions';
import { PRIMARY_ON_CALL } from '../src/content/onCall';
import { MAX_CONTENT_WIDTH } from '../src/components/ui/ScreenContainer';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😢', '😮', '👎'] as const;

export default function ChatScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { user, isAttached, entitlements } = useAccount();
  const router = useRouter();
  const canUseTextLine = !!user && entitlements.canMessageOnCallCoach;
  const { messages, send, archive, toggleReaction, loading, sending } = useThread(user?.id ?? null, canUseTextLine);
  const { sessions } = useSessions(user?.id ?? null);
  const [draft, setDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [archiving, setArchiving] = useState(false);
  const [pickerMessageId, setPickerMessageId] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // Coach presence between sessions: the on-call coach and the next live session.
  const coachName = PRIMARY_ON_CALL.firstName;
  const nextSchedule = sessions.find((s) => s.kind === 'group')?.schedule_label ?? null;

  async function handleSend() {
    const body = draft.trim();
    if (!body && pendingAttachments.length === 0) return;
    setDraft('');
    const toSend = pendingAttachments;
    setPendingAttachments([]);
    try {
      await send(body, toSend);
      listRef.current?.scrollToEnd({ animated: true });
    } catch (err) {
      setDraft(body);
      setPendingAttachments(toSend);
      Alert.alert(t('textline.sendErrorTitle'), err instanceof Error ? err.message : t('textline.sendErrorBody'));
    }
  }

  async function pickAttachment() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('textline.photosPermTitle'), t('textline.photosPermBody'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.82,
      allowsMultipleSelection: true,
      selectionLimit: 3,
    });

    if (result.canceled) return;
    const picked = result.assets.slice(0, 3).map((asset, idx) => ({
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileName: asset.fileName ?? `screenshot-${Date.now()}-${idx}.jpg`,
      width: asset.width,
      height: asset.height,
      sizeBytes: asset.fileSize ?? null,
    }));
    setPendingAttachments((prev) => [...prev, ...picked].slice(0, 3));
  }

  function removePendingAttachment(uri: string) {
    setPendingAttachments((prev) => prev.filter((att) => att.uri !== uri));
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

  if (!canUseTextLine) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
        <View style={styles.gatedWrap}>
          <Text style={[styles.gatedTitle, { color: colors.ink }]}>{t('textline.gatedTitle')}</Text>
          <Text style={[styles.gatedBody, { color: colors.inkSoft }]}>{t('textline.gatedBody')}</Text>
          <TouchableOpacity style={[styles.gatedButton, { backgroundColor: colors.primary }]} onPress={() => router.push('/(tabs)/support')}>
            <Text style={styles.gatedButtonText}>{t('textline.viewPlans')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canSend = !!draft.trim() || pendingAttachments.length > 0;

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
              ListEmptyComponent={
                <View style={[styles.presenceCard, { backgroundColor: colors.primaryLight, borderColor: colors.line }]}>
                  <View style={[styles.presenceAvatar, { backgroundColor: colors.primary }]}>
                    <Text style={styles.presenceAvatarText}>{coachName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.presenceTitle, { color: colors.ink }]}>
                    {t('chat.presenceTitle', { coach: coachName })}
                  </Text>
                  <Text style={[styles.presenceBody, { color: colors.inkSoft }]}>
                    {t('chat.presenceBody', { coach: coachName })}
                  </Text>
                  {nextSchedule && (
                    <Text style={[styles.presenceNext, { color: colors.primary }]}>
                      {t('chat.presenceNextSession', { schedule: nextSchedule })}
                    </Text>
                  )}
                </View>
              }
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
                        {item.attachments.length > 0 && (
                          <View style={styles.attachmentGrid}>
                            {item.attachments.map((att) => {
                              const uri = att.localUri ?? att.signedUrl;
                              if (!uri) return null;
                              return (
                                <TouchableOpacity key={att.id} activeOpacity={0.85}>
                                  <Image source={{ uri }} style={styles.attachmentImage} />
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}
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

          {pendingAttachments.length > 0 && (
            <View style={[styles.pendingRow, { borderTopColor: colors.line }]}>
              {pendingAttachments.map((att) => (
                <View key={att.uri} style={styles.pendingThumbWrap}>
                  <Image source={{ uri: att.uri }} style={styles.pendingThumb} />
                  <TouchableOpacity style={styles.removeAttachmentBtn} onPress={() => removePendingAttachment(att.uri)}>
                    <Text style={styles.removeAttachmentText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={[styles.inputRow, { borderTopColor: colors.line }]}>
            <TouchableOpacity
              style={[styles.attachBtn, { borderColor: colors.line }]}
              onPress={() => void pickAttachment()}
              disabled={sending || pendingAttachments.length >= 3}
              activeOpacity={0.8}
            >
              <Text style={[styles.attachText, { color: colors.primary }]}>＋</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
              placeholder={t('messages.placeholder')}
              placeholderTextColor={colors.inkSoft}
              value={draft}
              onChangeText={setDraft}
              multiline
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: canSend && !sending ? colors.primary : colors.line }]}
              onPress={() => void handleSend()}
              disabled={!canSend || sending}
              activeOpacity={0.85}
            >
              {sending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.sendText}>➤</Text>}
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
  gatedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  gatedTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  gatedBody: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 18 },
  gatedButton: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  gatedButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },

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

  presenceCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  presenceAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  presenceAvatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  presenceTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  presenceBody: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  presenceNext: { fontSize: 12.5, fontWeight: '700', marginTop: 4, textAlign: 'center' },

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
  attachmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  attachmentImage: { width: 150, height: 150, borderRadius: 10, backgroundColor: '#ddd' },

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
  pendingRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, backgroundColor: '#fff' },
  pendingThumbWrap: { position: 'relative' },
  pendingThumb: { width: 58, height: 58, borderRadius: 10, backgroundColor: '#ddd' },
  removeAttachmentBtn: { position: 'absolute', top: -7, right: -7, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#142a47' },
  removeAttachmentText: { color: '#fff', fontSize: 17, lineHeight: 20, fontWeight: '800' },
  attachBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  attachText: { fontSize: 24, lineHeight: 26, fontWeight: '600' },
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
