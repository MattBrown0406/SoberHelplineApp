import React, { useCallback, useRef, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { useBoundaries } from '../../src/hooks/useBoundaries';
import { CastleSection } from '../../src/components/boundaries/CastleSection';
import { AnchorCard } from '../../src/components/boundaries/AnchorCard';
import { WallBuilder } from '../../src/components/boundaries/WallBuilder';
import { WallsList } from '../../src/components/boundaries/WallsList';
import enContent from '../../src/locales/en/boundaries.json';
import esContent from '../../src/locales/es/boundaries.json';
import { getMockFamilySpace } from '../../src/api/mock';
import type { FamilySpace } from '../../src/api/types';

type BoundariesContent = typeof enContent;

export default function BoundariesScreen() {
  const { colors } = useTheme();
  const { user, isAttached } = useAccount();
  const { t: tCommon, i18n } = useTranslation('common');
  const { t: tAlign } = useTranslation('alignment');
  const router = useRouter();
  const { walls, addWall, removeWall } = useBoundaries(user?.id ?? null);

  const content: BoundariesContent = i18n.language.startsWith('es')
    ? esContent
    : enContent;

  const [prefill, setPrefill] = useState('');
  const [lastAnchorTag, setLastAnchorTag] = useState<string | null>(null);
  const [familySpace, setFamilySpace] = useState<FamilySpace | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const handleSuggestionSelect = useCallback((wallText: string, pillId: string) => {
    setPrefill(wallText);
    setLastAnchorTag(pillId);
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 150);
  }, []);

  const handleSave = useCallback(
    async (text: string, tag: string | null) => {
      await addWall(text, tag);
      setPrefill('');
      setLastAnchorTag(null);
    },
    [addWall],
  );

  const firstName = user?.firstName ?? '';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: colors.ink }]}>
            {tCommon('nav.boundaries')}
          </Text>
          {firstName ? (
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>
                {firstName.charAt(0).toUpperCase()}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Castle Framework */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.frameworkEyebrow, { color: colors.primary }]}>
            {content.frameworkEyebrow}
          </Text>
          {content.castleSections.map((section, i) => (
            <CastleSection
              key={section.id}
              section={section}
              isLast={i === content.castleSections.length - 1}
            />
          ))}
        </View>

        {/* Anchor 1 */}
        <AnchorCard
          anchor={content.anchor1}
          onSuggestionSelect={(wallText, pillId) =>
            handleSuggestionSelect(wallText, pillId)
          }
        />

        {/* Anchor 2 */}
        <AnchorCard
          anchor={content.anchor2}
          onSuggestionSelect={(wallText, pillId) =>
            handleSuggestionSelect(wallText, pillId)
          }
        />

        {/* Builder */}
        <WallBuilder
          prefill={prefill}
          onSave={handleSave}
          lastAnchorTag={lastAnchorTag}
        />

        {/* Saved walls */}
        <WallsList
          walls={walls}
          onDelete={removeWall}
          isAttached={isAttached}
        />

        {/* ── Intervention Letter ──────────────────────────────── */}
        <TouchableOpacity
          style={[styles.letterCard, { borderColor: colors.secondary, backgroundColor: colors.secondaryLight }]}
          onPress={() => router.push('/letter')}
          activeOpacity={0.85}
        >
          <Text style={styles.letterIcon}>✉️</Text>
          <View style={styles.letterBody}>
            <Text style={[styles.letterTitle, { color: colors.ink }]}>
              {i18n.language.startsWith('es') ? 'Carta de intervención' : 'Intervention letter'}
            </Text>
            <Text style={[styles.letterSub, { color: colors.inkSoft }]}>
              {i18n.language.startsWith('es')
                ? 'Estructura guiada de tres párrafos del manual de Matt'
                : 'Matt\'s three-paragraph guided structure'}
            </Text>
          </View>
          <Text style={[styles.letterArrow, { color: colors.secondary }]}>›</Text>
        </TouchableOpacity>

        {/* ── Family Space ─────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
            {tAlign('sectionEyebrow')}
          </Text>

          {familySpace ? (
            <>
              {/* Alignment meter */}
              <View style={styles.alignMeterRow}>
                <Text style={[styles.alignMeterTitle, { color: colors.ink }]}>
                  {tAlign('meterTitle')}
                </Text>
                <Text style={[styles.alignMeterValue, { color: colors.green }]}>
                  {tAlign('meter', {
                    held: familySpace.sharedWalls.filter((w) =>
                      w.commitments.every((c) => c.status === 'committed'),
                    ).length,
                    total: familySpace.sharedWalls.length,
                  })}
                </Text>
              </View>

              {/* Shared walls */}
              {familySpace.sharedWalls.map((sw) => {
                const committed = sw.commitments.filter((c) => c.status === 'committed').length;
                const wavering = sw.commitments.some((c) => c.status === 'wavering');
                return (
                  <View
                    key={sw.id}
                    style={[styles.sharedWall, { borderColor: wavering ? colors.secondary : colors.line }]}
                  >
                    <View style={styles.sharedWallTop}>
                      <Text style={[styles.sharedWallText, { color: colors.ink }]}>{sw.text}</Text>
                      <View style={styles.memberPips}>
                        {sw.commitments.map((c) => (
                          <View
                            key={c.memberId}
                            style={[
                              styles.pip,
                              {
                                backgroundColor:
                                  c.status === 'committed'
                                    ? colors.green
                                    : c.status === 'wavering'
                                    ? colors.secondary
                                    : colors.line,
                              },
                            ]}
                          />
                        ))}
                      </View>
                    </View>
                    <Text style={[styles.commitCount, { color: colors.inkSoft }]}>
                      {committed}/{sw.commitments.length} {tAlign('statusCommitted').toLowerCase()}
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        Alert.alert(tAlign('waveringTitle'), tAlign('waveringBody'))
                      }
                      style={[styles.waveringBtn, { borderColor: colors.secondary }]}
                    >
                      <Text style={[styles.waveringBtnText, { color: colors.secondary }]}>
                        {tAlign('waveringButton')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

              {/* Invite */}
              <View style={[styles.inviteRow, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.inviteCode, { color: colors.primary }]}>
                  {familySpace.inviteCode}
                </Text>
                <Text style={[styles.inviteLabel, { color: colors.inkSoft }]}>
                  {tAlign('inviteCode')}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.noFamilyTitle, { color: colors.ink }]}>
                {tAlign('noFamilyTitle')}
              </Text>
              <Text style={[styles.noFamilyBody, { color: colors.inkSoft }]}>
                {tAlign('noFamilyBody')}
              </Text>
              <TouchableOpacity
                style={[styles.solidBtn, { backgroundColor: colors.primary }]}
                onPress={() => setFamilySpace(getMockFamilySpace())}
                activeOpacity={0.85}
              >
                <Text style={styles.solidBtnText}>{tAlign('createButton')}</Text>
              </TouchableOpacity>

              <View style={styles.joinRow}>
                <TextInput
                  style={[styles.joinInput, { borderColor: colors.line, color: colors.ink }]}
                  placeholder={tAlign('joinPlaceholder')}
                  placeholderTextColor={colors.inkSoft}
                  value={joinCode}
                  onChangeText={setJoinCode}
                  autoCapitalize="characters"
                />
                <TouchableOpacity
                  style={[styles.joinBtn, { backgroundColor: joinCode.trim() ? colors.primary : colors.line }]}
                  disabled={!joinCode.trim()}
                  onPress={() => setFamilySpace(getMockFamilySpace())}
                  activeOpacity={0.85}
                >
                  <Text style={styles.joinBtnText}>{tAlign('joinButton')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  frameworkEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 4,
  },

  // Letter entry card
  letterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  letterIcon: { fontSize: 24 },
  letterBody: { flex: 1 },
  letterTitle: { fontSize: 14, fontWeight: '700' },
  letterSub: { fontSize: 12, marginTop: 2 },
  letterArrow: { fontSize: 22, fontWeight: '300' },

  // Family space card
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  alignMeterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  alignMeterTitle: { fontSize: 14, fontWeight: '700' },
  alignMeterValue: { fontSize: 13, fontWeight: '600' },
  sharedWall: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  sharedWallTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  sharedWallText: { flex: 1, fontSize: 13.5, lineHeight: 20 },
  memberPips: { flexDirection: 'row', gap: 4, paddingTop: 2 },
  pip: { width: 10, height: 10, borderRadius: 5 },
  commitCount: { fontSize: 11, marginBottom: 8 },
  waveringBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  waveringBtnText: { fontSize: 12, fontWeight: '600' },
  inviteRow: {
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    alignItems: 'center',
  },
  inviteCode: { fontSize: 20, fontWeight: '800', letterSpacing: 2 },
  inviteLabel: { fontSize: 11, marginTop: 2 },
  noFamilyTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  noFamilyBody: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  solidBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginBottom: 10 },
  solidBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  joinRow: { flexDirection: 'row', gap: 8 },
  joinInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  joinBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
