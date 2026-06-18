import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
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
import { useFamilySpace } from '../../src/hooks/useFamilySpace';

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

  const { space: familySpace, create: createFamilySpace, joinByCode } = useFamilySpace(user?.id ?? null);
  const [prefill, setPrefill] = useState('');
  const [lastAnchorTag, setLastAnchorTag] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // ── Daily challenge + streak bar ──────────────────────────────────────────
  const now = new Date();
  const doy = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const isMonday = now.getDay() === 1;
  const challengeText = isMonday
    ? content.challenge.monday
    : content.challenge.daily[doy % content.challenge.daily.length];

  const [checkinDates, setCheckinDates] = useState<Set<string>>(new Set());

  // ── Enabling assessment ───────────────────────────────────────────────────
  const isoWeek = (() => {
    const d = new Date();
    const jan4 = new Date(d.getFullYear(), 0, 4);
    const wk = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${wk}`;
  })();
  const enablingStorageKey = `enabling_${user?.id ?? 'anon'}_${isoWeek}`;
  const enablingSetIndex = parseInt(isoWeek.split('W')[1] ?? '0') % 3;
  const enablingQuestions = content.enabling.sets[enablingSetIndex] ?? content.enabling.sets[0];

  const [enablingAnswers, setEnablingAnswers] = useState<(boolean | null)[]>(
    () => Array(6).fill(null),
  );
  const [enablingLoaded, setEnablingLoaded] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(enablingStorageKey).then((raw) => {
      if (raw) setEnablingAnswers(JSON.parse(raw) as (boolean | null)[]);
      setEnablingLoaded(true);
    }).catch(() => setEnablingLoaded(true));
  }, [enablingStorageKey]);

  const handleEnablingAnswer = useCallback((idx: number, val: boolean) => {
    setEnablingAnswers((prev) => {
      const next = [...prev];
      next[idx] = val;
      void AsyncStorage.setItem(enablingStorageKey, JSON.stringify(next));
      return next;
    });
  }, [enablingStorageKey]);

  const resetEnabling = useCallback(() => {
    const blank = Array(6).fill(null);
    setEnablingAnswers(blank);
    void AsyncStorage.removeItem(enablingStorageKey);
  }, [enablingStorageKey]);

  const enablingComplete = enablingAnswers.every((a) => a !== null);
  const enablingYesCount = enablingAnswers.filter((a) => a === true).length;
  const enablingResultKey =
    enablingYesCount === 0 ? 'r0'
    : enablingYesCount <= 2 ? 'low'
    : enablingYesCount <= 4 ? 'mid'
    : 'high';

  // ── Family journal ────────────────────────────────────────────────────────
  type JournalEntry = { id: string; note: string; created_at: string; account_id: string; accounts: { first_name: string } | null };
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalNote, setJournalNote] = useState('');
  const [journalPosting, setJournalPosting] = useState(false);

  const loadJournal = useCallback(async (spaceId: string) => {
    const { data } = await supabase
      .from('family_journal_entries')
      .select('id, account_id, note, created_at, accounts(first_name)')
      .eq('family_space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (data) setJournalEntries(data as unknown as JournalEntry[]);
  }, []);

  const postJournalNote = useCallback(async () => {
    if (!journalNote.trim() || !familySpace?.id || !user?.id) return;
    setJournalPosting(true);
    await supabase.from('family_journal_entries').insert({
      family_space_id: familySpace.id,
      account_id: user.id,
      note: journalNote.trim(),
    });
    setJournalNote('');
    await loadJournal(familySpace.id);
    setJournalPosting(false);
  }, [journalNote, familySpace?.id, user?.id, loadJournal]);

  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      const since = new Date(Date.now() - 7 * 86400000).toISOString();
      void supabase
        .from('checkins')
        .select('created_at')
        .eq('account_id', user.id)
        .gte('created_at', since)
        .then(({ data }) => {
          if (data) setCheckinDates(new Set(data.map((r) => r.created_at.slice(0, 10))));
        });
      if (familySpace?.id) void loadJournal(familySpace.id);
    }, [user?.id, familySpace?.id, loadJournal]),
  );

  const streakDots = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return {
      label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()],
      filled: checkinDates.has(d.toISOString().slice(0, 10)),
      isToday: i === 6,
    };
  });

  const copyInviteCode = useCallback(async (code: string) => {
    await Clipboard.setStringAsync(code);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  }, []);

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
    <ScreenContainer scrollRef={scrollRef} backgroundColor={colors.cream} keyboardShouldPersistTaps="handled">
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

        {/* ── Daily Challenge ──────────────────────────────────────── */}
        <View style={[styles.card, styles.challengeCard, { borderColor: isMonday ? colors.secondary : colors.primary, backgroundColor: isMonday ? colors.secondaryLight : colors.primaryLight }]}>
          <Text style={[styles.challengeEyebrow, { color: isMonday ? colors.secondary : colors.primary }]}>
            {content.challenge.eyebrow}
          </Text>
          <Text style={[styles.challengeText, { color: colors.ink }]}>{challengeText}</Text>
        </View>

        {/* ── Check-in Streak Bar ──────────────────────────────────── */}
        <View style={[styles.card, styles.streakCard, { borderColor: colors.line }]}>
          <Text style={[styles.streakEyebrow, { color: colors.inkSoft }]}>
            {content.challenge.streakEyebrow}
          </Text>
          <View style={styles.dotsRow}>
            {streakDots.map((dot, i) => (
              <View key={i} style={styles.dotCol}>
                <View
                  style={[
                    styles.dot,
                    dot.filled
                      ? { backgroundColor: colors.green }
                      : { backgroundColor: colors.line },
                    dot.isToday && !dot.filled && { borderWidth: 2, borderColor: colors.primary },
                  ]}
                />
                <Text style={[styles.dotLabel, { color: colors.inkSoft }]}>{dot.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Enabling Assessment ──────────────────────────────────── */}
        {enablingLoaded && (
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.challengeEyebrow, { color: colors.inkSoft }]}>
              {content.enabling.eyebrow}
            </Text>
            <Text style={[styles.challengeText, { color: colors.ink, marginBottom: 2 }]}>
              {content.enabling.heading}
            </Text>
            <Text style={[styles.enablingSub, { color: colors.inkSoft }]}>
              {content.enabling.sub}
            </Text>

            {!enablingComplete ? (
              enablingQuestions.map((q, idx) => (
                <View key={idx} style={styles.enablingRow}>
                  <Text style={[styles.enablingQ, { color: colors.ink }]}>
                    {`${idx + 1}. ${q}`}
                  </Text>
                  <View style={styles.enablingBtns}>
                    <TouchableOpacity
                      style={[
                        styles.enablingBtn,
                        enablingAnswers[idx] === true && { backgroundColor: colors.coral, borderColor: colors.coral },
                        enablingAnswers[idx] !== true && { borderColor: colors.line },
                      ]}
                      onPress={() => handleEnablingAnswer(idx, true)}
                    >
                      <Text style={[styles.enablingBtnText, { color: enablingAnswers[idx] === true ? '#fff' : colors.inkSoft }]}>
                        {content.enabling.yes}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.enablingBtn,
                        enablingAnswers[idx] === false && { backgroundColor: colors.green, borderColor: colors.green },
                        enablingAnswers[idx] !== false && { borderColor: colors.line },
                      ]}
                      onPress={() => handleEnablingAnswer(idx, false)}
                    >
                      <Text style={[styles.enablingBtnText, { color: enablingAnswers[idx] === false ? '#fff' : colors.inkSoft }]}>
                        {content.enabling.no}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            ) : (
              <View style={[styles.enablingResult, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
                <Text style={[styles.enablingResultText, { color: colors.ink }]}>
                  {content.enabling.results[enablingResultKey as keyof typeof content.enabling.results]}
                </Text>
                <TouchableOpacity onPress={resetEnabling} style={styles.enablingRetake}>
                  <Text style={[styles.enablingRetakeText, { color: colors.inkSoft }]}>
                    {content.enabling.retake}
                  </Text>
                </TouchableOpacity>
                <Text style={[styles.enablingDone, { color: colors.inkSoft }]}>
                  {content.enabling.done}
                </Text>
              </View>
            )}
          </View>
        )}

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
              <TouchableOpacity
                style={[styles.inviteRow, { backgroundColor: codeCopied ? colors.greenLight : colors.primaryLight }]}
                activeOpacity={0.7}
                onPress={() => void copyInviteCode(familySpace.inviteCode)}
              >
                <Text style={[styles.inviteCode, { color: codeCopied ? colors.green : colors.primary }]}>
                  {familySpace.inviteCode}
                </Text>
                <Text style={[styles.inviteLabel, { color: colors.inkSoft }]}>
                  {codeCopied ? tAlign('inviteCodeCopied') : tAlign('inviteCode')}
                </Text>
              </TouchableOpacity>

              {/* Family Journal */}
              <View style={[styles.journalSection, { borderTopColor: colors.line }]}>
                <Text style={[styles.eyebrow, { color: colors.inkSoft, marginBottom: 10, marginTop: 4 }]}>
                  {content.journal.eyebrow}
                </Text>

                {journalEntries.length === 0 ? (
                  <Text style={[styles.enablingSub, { color: colors.inkSoft, marginBottom: 10 }]}>
                    {content.journal.empty}
                  </Text>
                ) : (
                  journalEntries.map((entry) => (
                    <View key={entry.id} style={[styles.journalEntry, { borderColor: colors.line }]}>
                      <Text style={[styles.journalAuthor, { color: colors.primary }]}>
                        {entry.account_id === user?.id
                          ? content.journal.you
                          : (entry.accounts?.first_name ?? 'Family member')}
                      </Text>
                      <Text style={[styles.journalNote, { color: colors.ink }]}>{entry.note}</Text>
                      <Text style={[styles.journalDate, { color: colors.inkSoft }]}>
                        {new Date(entry.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                  ))
                )}

                <View style={[styles.journalInputRow, { borderColor: colors.line }]}>
                  <TextInput
                    style={[styles.journalInput, { color: colors.ink }]}
                    placeholder={content.journal.placeholder}
                    placeholderTextColor={colors.inkSoft}
                    value={journalNote}
                    onChangeText={setJournalNote}
                    multiline
                    maxLength={280}
                  />
                  <TouchableOpacity
                    style={[
                      styles.journalPostBtn,
                      { backgroundColor: journalNote.trim() ? colors.primary : colors.line },
                    ]}
                    disabled={!journalNote.trim() || journalPosting}
                    onPress={() => void postJournalNote()}
                  >
                    {journalPosting
                      ? <ActivityIndicator color="#fff" size="small" />
                      : <Text style={styles.journalPostText}>{content.journal.post}</Text>}
                  </TouchableOpacity>
                </View>
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
                onPress={() => {
                  void createFamilySpace(firstName || 'My').catch((err: unknown) => {
                    console.error('[BoundariesScreen] createFamilySpace failed:', err);
                    Alert.alert(tAlign('createErrorTitle'), tAlign('createErrorMessage'));
                  });
                }}
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
                  onPress={async () => {
                    const ok = await joinByCode(joinCode);
                    if (!ok) Alert.alert(tAlign('joinError'));
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.joinBtnText}>{tAlign('joinButton')}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
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

  // Daily challenge card
  challengeCard: { borderWidth: 1.5 },
  challengeEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 8 },
  challengeText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },

  // Streak bar
  streakCard: { paddingVertical: 14 },
  streakEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 },
  dotsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dotCol: { alignItems: 'center', gap: 4 },
  dot: { width: 28, height: 28, borderRadius: 14 },
  dotLabel: { fontSize: 10, fontWeight: '600' },

  // Enabling assessment
  enablingSub: { fontSize: 13, lineHeight: 18, marginBottom: 14 },
  enablingRow: { marginBottom: 14 },
  enablingQ: { fontSize: 13.5, lineHeight: 20, marginBottom: 8 },
  enablingBtns: { flexDirection: 'row', gap: 10 },
  enablingBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 18,
  },
  enablingBtnText: { fontSize: 14, fontWeight: '600' },
  enablingResult: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginTop: 4,
  },
  enablingResultText: { fontSize: 14, lineHeight: 21, marginBottom: 12 },
  enablingRetake: { marginBottom: 8 },
  enablingRetakeText: { fontSize: 13, textDecorationLine: 'underline' },
  enablingDone: { fontSize: 12, fontStyle: 'italic' },

  // Family journal
  journalSection: { borderTopWidth: 1, paddingTop: 14, marginTop: 8 },
  journalEntry: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  journalAuthor: { fontSize: 12, fontWeight: '700', marginBottom: 3 },
  journalNote: { fontSize: 13.5, lineHeight: 20 },
  journalDate: { fontSize: 11, marginTop: 4 },
  journalInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 8,
    marginTop: 4,
  },
  journalInput: { flex: 1, fontSize: 14, minHeight: 38, maxHeight: 80 },
  journalPostBtn: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 52,
  },
  journalPostText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
