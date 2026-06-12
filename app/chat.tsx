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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { useThread, type ChatMessage } from '../src/hooks/useThread';

export default function ChatScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { user } = useAccount();
  const router = useRouter();
  const { messages, send, loading } = useThread(user?.id ?? null);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  async function handleSend() {
    const body = draft;
    setDraft('');
    await send(body);
    listRef.current?.scrollToEnd({ animated: true });
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={[styles.headerTitle, { color: colors.ink }]}>
            {t('messages.eyebrow')}
          </Text>
          <Text style={[styles.headerSub, { color: colors.inkSoft }]}>
            {t('chat.headerSub')}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
              <Text style={[styles.empty, { color: colors.inkSoft }]}>
                {t('chat.emptyState')}
              </Text>
            }
            renderItem={({ item }) => (
              <View
                style={[
                  styles.bubble,
                  item.sender_role === 'member'
                    ? [styles.bubbleMe, { backgroundColor: colors.primary }]
                    : [styles.bubbleCoach, { backgroundColor: colors.primaryLight }],
                ]}
              >
                <Text
                  style={{
                    color: item.sender_role === 'member' ? '#fff' : colors.ink,
                    fontSize: 14,
                    lineHeight: 20,
                  }}
                >
                  {item.body}
                </Text>
              </View>
            )}
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
            style={[styles.sendBtn, { backgroundColor: colors.primary }]}
            onPress={handleSend}
            disabled={!draft.trim()}
            activeOpacity={0.85}
          >
            <Text style={styles.sendText}>➤</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.crisisNote, { color: colors.inkSoft }]}>
          {t('chat.crisisNote')}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
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
  back: { fontSize: 30, fontWeight: '600', marginTop: -4 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  headerSub: { fontSize: 11.5, marginTop: 1 },
  list: { padding: 16, gap: 8, flexGrow: 1 },
  empty: { textAlign: 'center', fontSize: 13.5, lineHeight: 20, marginTop: 30 },
  bubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleMe: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleCoach: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
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
