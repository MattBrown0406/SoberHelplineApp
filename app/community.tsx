import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { openEmergencyLink } from '../src/lib/emergencyLinks';
import { appAlert } from '../src/lib/appAlert';
import { Gate } from '../src/components/auth/Gate';
import { useCommunity, CrisisContentError, PostRateLimitedError, type CommunityPost } from '../src/hooks/useCommunity';
import { MAX_CONTENT_WIDTH } from '../src/components/ui/ScreenContainer';


function relativeTime(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return t('community.timeNow');
  if (mins < 60) return t('community.timeMinutes', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('community.timeHours', { count: hrs });
  return t('community.timeDays', { count: Math.floor(hrs / 24) });
}

export default function CommunityScreen() {
  return <Gate feature="community"><CommunityContent /></Gate>;
}

function CommunityContent() {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { user } = useAccount();
  const router = useRouter();
  const {
    posts, belonging, blocks, loading, createPost, reportPost, deletePost, supportPost, blockAuthor, unblock,
  } = useCommunity(user?.id ?? null);

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [crisisOpen, setCrisisOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  // The author's own post mentioned suicide, self-harm or an overdose.
  const [showResources, setShowResources] = useState(false);

  const authorName = (name: string | null | undefined) =>
    !name || name === 'A family member' ? t('community.anonymousAuthor') : name;


  async function handlePost(past = false) {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      const { safetyResources } = await createPost(body, past);
      setDraft('');
      setCrisisOpen(false);
      setShowResources(safetyResources);
    } catch (err) {
      if (err instanceof CrisisContentError) {
        setCrisisOpen(true);
      } else if (err instanceof PostRateLimitedError) {
        appAlert(t('community.postRateLimited'));
      } else {
        appAlert(t('community.postError'));
      }
    } finally {
      setPosting(false);
    }
  }

  function confirmReport(post: CommunityPost) {
    appAlert(t('community.reportConfirmTitle'), t('community.reportConfirmBody'), [
      { text: t('community.cancel'), style: 'cancel' },
      {
        text: t('community.reportConfirm'),
        style: 'destructive',
        onPress: async () => {
          if (!(await reportPost(post.id))) appAlert(t('community.actionError'));
        },
      },
    ]);
  }

  function confirmBlock(post: CommunityPost) {
    appAlert(
      t('community.blockConfirmTitle', { name: authorName(post.author_display) }),
      t('community.blockConfirmBody'),
      [
        { text: t('community.cancel'), style: 'cancel' },
        {
          text: t('community.blockConfirm'),
          style: 'destructive',
          onPress: async () => {
            if (!(await blockAuthor(post))) appAlert(t('community.actionError'));
          },
        },
      ],
    );
  }

  function confirmUnblock(blockId: string, name: string) {
    appAlert(t('community.unblockConfirmTitle', { name: authorName(name) }), t('community.unblockConfirmBody'), [
      { text: t('community.cancel'), style: 'cancel' },
      {
        text: t('community.unblock'),
        onPress: async () => {
          if (!(await unblock(blockId))) appAlert(t('community.actionError'));
        },
      },
    ]);
  }

  function confirmDelete(post: CommunityPost) {
    appAlert(t('community.deleteConfirmTitle'), '', [
      { text: t('community.cancel'), style: 'cancel' },
      {
        text: t('community.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!(await deletePost(post.id))) appAlert(t('community.actionError'));
        },
      },
    ]);
  }

  const belongingText =
    belonging.count > 0 && belonging.schedule_label
      ? t('community.belonging', { count: belonging.count, schedule: belonging.schedule_label })
      : belonging.count > 0
      ? t('community.belongingNoSchedule', { count: belonging.count })
      : t('community.belongingZero');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      {/* Crisis routing — never a dead end (docs/legal/crisis-protocol.md) */}
      <Modal visible={crisisOpen} transparent animationType="fade" onRequestClose={() => setCrisisOpen(false)}>
        <View style={styles.crisisOverlay}>
          <View style={[styles.crisisCard, { backgroundColor: colors.white }]}>
            <Text style={[styles.crisisTitle, { color: colors.ink }]}>{t('community.crisisTitle')}</Text>
            <Text style={[styles.crisisBody, { color: colors.inkSoft }]}>{t('community.crisisBody')}</Text>
            <TouchableOpacity
              style={[styles.crisisBtn, { backgroundColor: colors.primary }]}
              onPress={() => openEmergencyLink('tel:988')}
            >
              <Text style={styles.crisisBtnText}>{t('community.crisisCall988')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.crisisBtn, { backgroundColor: colors.coral }]}
              onPress={() => openEmergencyLink('tel:911')}
            >
              <Text style={styles.crisisBtnText}>{t('community.crisisCall911')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.crisisBtnOutline, { borderColor: colors.primary }]}
              onPress={() => { setCrisisOpen(false); router.push('/chat'); }}
            >
              <Text style={[styles.crisisBtnOutlineText, { color: colors.primary }]}>
                {t('community.crisisMessageCoach')}
              </Text>
            </TouchableOpacity>
            {/* A story about the past, or venting, can still be shared (with resources). */}
            <TouchableOpacity
              onPress={() => { void handlePost(true); }}
              disabled={posting}
              style={styles.crisisClose}
              accessibilityRole="button"
            >
              <Text style={[styles.crisisCloseText, { color: colors.primary }]}>{t('community.crisisPostPast')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCrisisOpen(false)} style={styles.crisisClose}>
              <Text style={[styles.crisisCloseText, { color: colors.inkSoft }]}>{t('community.crisisClose')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* People this member blocked, with a way to unblock (App Store 1.2). */}
      <Modal visible={blockedOpen} transparent animationType="fade" onRequestClose={() => setBlockedOpen(false)}>
        <View style={styles.crisisOverlay}>
          <View style={[styles.crisisCard, { backgroundColor: colors.white }]}>
            <Text style={[styles.crisisTitle, { color: colors.ink }]}>{t('community.blockedTitle')}</Text>
            {blocks.length === 0 ? (
              <Text style={[styles.crisisBody, { color: colors.inkSoft }]}>{t('community.blockedEmpty')}</Text>
            ) : (
              blocks.map((b) => (
                <View key={b.block_id} style={[styles.blockedRow, { borderBottomColor: colors.line }]}>
                  <Text style={[styles.blockedName, { color: colors.ink }]} numberOfLines={1}>
                    {authorName(b.display_name)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => confirmUnblock(b.block_id, b.display_name)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('community.unblockA11y', { name: authorName(b.display_name) })}
                  >
                    <Text style={[styles.postActionText, { color: colors.primary }]}>{t('community.unblock')}</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
            <TouchableOpacity onPress={() => setBlockedOpen(false)} style={styles.crisisClose}>
              <Text style={[styles.crisisCloseText, { color: colors.inkSoft }]}>{t('community.crisisClose')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.ink }]}>{t('community.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.column}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={posts}
              keyExtractor={(p) => p.id}
              contentContainerStyle={styles.list}
              ListHeaderComponent={
                <View>
                  <View style={[styles.belongingCard, { backgroundColor: colors.primaryLight, borderColor: colors.line }]}>
                    <Text style={[styles.belongingText, { color: colors.ink }]}>{belongingText}</Text>
                  </View>
                  <Text style={[styles.guidelines, { color: colors.inkSoft }]}>{t('community.guidelines')}</Text>
                  {blocks.length > 0 ? (
                    <TouchableOpacity onPress={() => setBlockedOpen(true)} hitSlop={8} accessibilityRole="button">
                      <Text style={[styles.blockedLink, { color: colors.primary }]}>
                        {t('community.blockedLink', { count: blocks.length })}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              }
              ListEmptyComponent={
                <Text style={[styles.empty, { color: colors.inkSoft }]}>{t('community.empty')}</Text>
              }
              renderItem={({ item }) => (
                <View style={[styles.postCard, { backgroundColor: colors.white, borderColor: colors.line }]}>
                  <View style={styles.postHead}>
                    <Text style={[styles.postAuthor, { color: colors.ink }]}>
                      {authorName(item.author_display)}
                    </Text>
                    <Text style={[styles.postTime, { color: colors.inkSoft }]}>
                      {relativeTime(item.created_at, t)}
                    </Text>
                  </View>
                  <Text style={[styles.postBody, { color: colors.ink }]}>{item.body}</Text>
                  <View style={styles.postFooter}>
                    {!item.mine ? (
                      <TouchableOpacity
                        style={styles.supportBtn}
                        onPress={() => void supportPost(item.id)}
                        disabled={item.supported}
                        hitSlop={8}
                      >
                        <Text style={styles.supportHeart}>{item.supported ? '💙' : '🤍'}</Text>
                        <Text style={[styles.supportText, { color: item.supported ? colors.primary : colors.inkSoft }]}>
                          {item.supported ? t('community.supported') : t('community.support')}
                          {item.support_count > 0 ? ` · ${item.support_count}` : ''}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={[styles.supportText, { color: colors.inkSoft }]}>
                        {item.support_count > 0
                          ? `💙 ${t('community.supportReceived', { count: item.support_count })}`
                          : ''}
                      </Text>
                    )}
                    {item.mine ? (
                      <TouchableOpacity style={styles.postAction} onPress={() => confirmDelete(item)} hitSlop={8}>
                        <Text style={[styles.postActionText, { color: colors.inkSoft }]}>{t('community.delete')}</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.postActions}>
                        <TouchableOpacity style={styles.postAction} onPress={() => confirmReport(item)} hitSlop={8}>
                          <Text style={[styles.postActionText, { color: colors.inkSoft }]}>{t('community.report')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.postAction} onPress={() => confirmBlock(item)} hitSlop={8}>
                          <Text style={[styles.postActionText, { color: colors.inkSoft }]}>{t('community.block')}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              )}
            />
          )}

          {/* Her post mentioned suicide, self-harm or an overdose: resources, right where she is. */}
          {showResources ? (
            <View style={[styles.resourceNote, { backgroundColor: colors.primaryLight, borderColor: colors.line }]}>
              <Text style={[styles.resourceText, { color: colors.ink }]}>{t('community.resourceNoteBody')}</Text>
              <View style={styles.resourceActions}>
                <TouchableOpacity
                  style={[styles.resourceBtn, { backgroundColor: colors.primary }]}
                  onPress={() => openEmergencyLink('tel:988')}
                >
                  <Text style={styles.resourceBtnText}>{t('community.crisisCall988')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.resourceBtn, { backgroundColor: colors.coral }]}
                  onPress={() => openEmergencyLink('tel:911')}
                >
                  <Text style={styles.resourceBtnText}>{t('community.crisisCall911')}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setShowResources(false)} hitSlop={8} style={styles.resourceDismiss}>
                <Text style={[styles.crisisCloseText, { color: colors.inkSoft }]}>{t('community.resourceNoteDismiss')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Composer */}
          <View style={[styles.composer, { borderTopColor: colors.line }]}>
            <TextInput
              style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
              placeholder={t('community.composerPlaceholder')}
              placeholderTextColor={colors.inkSoft}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.postBtn, { backgroundColor: draft.trim() && !posting ? colors.primary : colors.line }]}
              onPress={() => void handlePost()}
              disabled={!draft.trim() || posting}
              activeOpacity={0.85}
            >
              <Text style={styles.postBtnText}>{t('community.postButton')}</Text>
            </TouchableOpacity>
          </View>

          {/* Always-present safety line (per crisis protocol) */}
          <TouchableOpacity onPress={() => openEmergencyLink('tel:988')} style={styles.safetyFooter}>
            <Text style={[styles.safetyText, { color: colors.inkSoft }]}>{t('community.safetyFooter')}</Text>
          </TouchableOpacity>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  back: { fontSize: 30, fontWeight: '600', marginTop: -4 },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  belongingCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8 },
  belongingText: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  guidelines: { fontSize: 11.5, lineHeight: 17, marginBottom: 6, paddingHorizontal: 2 },
  empty: { fontSize: 13.5, textAlign: 'center', marginTop: 24, lineHeight: 20 },
  postCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  postHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  postAuthor: { fontSize: 13.5, fontWeight: '700' },
  postTime: { fontSize: 11.5 },
  postBody: { fontSize: 14.5, lineHeight: 21 },
  postFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  supportBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  supportHeart: { fontSize: 13 },
  supportText: { fontSize: 12, fontWeight: '600' },
  postAction: {},
  postActions: { flexDirection: 'row', gap: 16 },
  postActionText: { fontSize: 12, fontWeight: '600' },
  blockedLink: { fontSize: 12, fontWeight: '600', marginBottom: 6, paddingHorizontal: 2 },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 12,
  },
  blockedName: { flex: 1, fontSize: 14, fontWeight: '600' },
  resourceNote: { marginHorizontal: 12, marginTop: 8, borderRadius: 14, borderWidth: 1, padding: 12, gap: 8 },
  resourceText: { fontSize: 13, lineHeight: 19 },
  resourceActions: { flexDirection: 'row', gap: 8 },
  resourceBtn: { flex: 1, borderRadius: 99, paddingVertical: 10, alignItems: 'center' },
  resourceBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  resourceDismiss: { alignItems: 'center' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
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
  postBtn: { borderRadius: 18, paddingHorizontal: 18, paddingVertical: 11, alignItems: 'center' },
  postBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  safetyFooter: { alignItems: 'center', paddingBottom: 10, paddingTop: 2 },
  safetyText: { fontSize: 11.5, fontWeight: '600' },
  crisisOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  crisisCard: { width: '100%', maxWidth: 380, borderRadius: 20, padding: 24, gap: 10 },
  crisisTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  crisisBody: { fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginBottom: 6 },
  crisisBtn: { borderRadius: 99, paddingVertical: 14, alignItems: 'center' },
  crisisBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  crisisBtnOutline: { borderRadius: 99, borderWidth: 1.5, paddingVertical: 13, alignItems: 'center' },
  crisisBtnOutlineText: { fontSize: 14.5, fontWeight: '700' },
  crisisClose: { alignItems: 'center', marginTop: 4 },
  crisisCloseText: { fontSize: 13, fontWeight: '600' },
});
