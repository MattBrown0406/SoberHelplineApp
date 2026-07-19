import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { useLovedOne } from '../src/hooks/useLovedOne';
import { useRehearsalCount } from '../src/hooks/useRehearsalCount';
import {
  useRehearsalPartner,
  type PartnerTemperament,
} from '../src/hooks/useRehearsalPartner';

type Stage = 'setup' | 'chat' | 'debrief';

const TEMPERAMENTS: PartnerTemperament[] = ['guarded', 'defensive', 'volatile', 'tearful'];

const SCORE_KEYS = ['love', 'iStatements', 'calm', 'ask'] as const;

export default function RehearsalLiveScreen() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('rehearsalLive');
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string; sourceId?: string }>();
  const { user } = useAccount();
  const { lovedOne } = useLovedOne(user?.id ?? null);
  const { increment } = useRehearsalCount(params.sourceId ?? 'live-rehearsal');

  const [stage, setStage] = useState<Stage>('setup');
  const [temperament, setTemperament] = useState<PartnerTemperament>('guarded');
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  const language = i18n.language?.startsWith('es') ? 'es' : 'en';
  const partnerName = lovedOne?.first_name?.trim() || t('defaultName');

  const {
    messages,
    sending,
    error,
    safetyBreak,
    debrief,
    debriefLoading,
    turnsLeft,
    send,
    requestDebrief,
    reset,
  } = useRehearsalPartner({
    relationship: lovedOne?.relationship ?? undefined,
    name: lovedOne?.first_name ?? undefined,
    substances: lovedOne?.substances ?? undefined,
    temperament,
    scriptText: typeof params.text === 'string' ? params.text : undefined,
    language,
  });

  useEffect(() => {
    // Keep the newest message in view.
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(id);
  }, [messages.length, sending]);

  useEffect(() => {
    if (debrief) {
      increment();
      setStage('debrief');
    }
  }, [debrief, increment]);

  function handleSend() {
    const text = draft;
    setDraft('');
    void send(text);
  }

  function handleFinish() {
    void requestDebrief();
  }

  function handleAgain() {
    reset();
    setStage('setup');
  }

  return (
    <ScreenContainer backgroundColor={colors.ink}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {/* Back */}
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={12}>
          <Text style={[styles.backText, { color: colors.inkSoft }]}>‹ {t('title')}</Text>
        </TouchableOpacity>

        {/* ---------- SETUP ---------- */}
        {stage === 'setup' && (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.heading}>{t('setup.heading', { name: partnerName })}</Text>
            <Text style={[styles.subheading, { color: colors.inkSoft }]}>{t('setup.body')}</Text>

            <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>
              {t('setup.temperamentLabel')}
            </Text>
            {TEMPERAMENTS.map((key) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.temperamentCard,
                  {
                    backgroundColor: temperament === key ? colors.primary : colors.primaryDark,
                    borderColor: temperament === key ? colors.coral : 'transparent',
                  },
                ]}
                onPress={() => setTemperament(key)}
                activeOpacity={0.85}
              >
                <Text style={styles.temperamentTitle}>{t(`temperaments.${key}.title`)}</Text>
                <Text style={[styles.temperamentDesc, { color: colors.inkSoft }]}>
                  {t(`temperaments.${key}.desc`)}
                </Text>
              </TouchableOpacity>
            ))}

            <Text style={[styles.reassurance, { color: colors.inkSoft }]}>{t('setup.reassurance')}</Text>

            <TouchableOpacity
              style={[styles.bigBtn, { backgroundColor: colors.coral }]}
              onPress={() => setStage('chat')}
              activeOpacity={0.85}
            >
              <Text style={styles.bigBtnText}>{t('setup.startButton')}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ---------- CHAT ---------- */}
        {stage === 'chat' && (
          <View style={styles.flex}>
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={styles.chatContent}
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.chatIntro, { color: colors.inkSoft }]}>
                {t('chat.intro', { name: partnerName })}
              </Text>

              {messages.map((m, i) => (
                <View
                  key={i}
                  style={[
                    styles.bubble,
                    m.role === 'user'
                      ? [styles.bubbleUser, { backgroundColor: colors.primary }]
                      : [styles.bubblePartner, { backgroundColor: colors.primaryDark }],
                  ]}
                >
                  <Text style={styles.bubbleText}>{m.text}</Text>
                </View>
              ))}

              {sending && (
                <View style={[styles.bubble, styles.bubblePartner, { backgroundColor: colors.primaryDark }]}>
                  <ActivityIndicator color={colors.inkSoft} size="small" />
                </View>
              )}

              {safetyBreak && (
                <TouchableOpacity
                  style={[styles.safetyCard, { backgroundColor: colors.coralLight }]}
                  onPress={() => router.push('/crisis-mode')}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.safetyTitle, { color: colors.coral }]}>{t('chat.safetyTitle')}</Text>
                  <Text style={[styles.safetyBody, { color: colors.ink }]}>{t('chat.safetyBody')}</Text>
                </TouchableOpacity>
              )}

              {error && (
                <Text style={[styles.errorText, { color: colors.coral }]}>{t('chat.error')}</Text>
              )}
            </ScrollView>

            <Text style={[styles.turnsNote, { color: colors.inkSoft }]}>
              {turnsLeft > 0 ? t('chat.turnsLeft', { count: turnsLeft }) : t('chat.turnsDone')}
            </Text>

            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.primaryDark, color: colors.white }]}
                placeholder={t('chat.placeholder')}
                placeholderTextColor={colors.inkSoft}
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={600}
                editable={!sending && turnsLeft > 0 && !safetyBreak}
              />
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  {
                    backgroundColor: colors.coral,
                    opacity: draft.trim() && !sending && turnsLeft > 0 && !safetyBreak ? 1 : 0.4,
                  },
                ]}
                onPress={handleSend}
                disabled={!draft.trim() || sending || turnsLeft === 0 || safetyBreak}
                activeOpacity={0.85}
              >
                <Text style={styles.sendBtnText}>{t('chat.send')}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.finishBtn,
                { borderColor: colors.inkSoft, opacity: messages.length > 0 && !debriefLoading ? 1 : 0.4 },
              ]}
              onPress={handleFinish}
              disabled={messages.length === 0 || debriefLoading}
              activeOpacity={0.85}
            >
              {debriefLoading ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={[styles.finishBtnText, { color: colors.white }]}>{t('chat.finishButton')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ---------- DEBRIEF ---------- */}
        {stage === 'debrief' && debrief && (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.heading}>{t('debrief.heading')}</Text>

            <View style={[styles.scoreRow]}>
              {SCORE_KEYS.map((key) => (
                <View key={key} style={[styles.scorePill, { backgroundColor: colors.primaryDark }]}>
                  <Text style={[styles.scoreValue, { color: colors.white }]}>
                    {debrief.scores?.[key] ?? '–'}/5
                  </Text>
                  <Text style={[styles.scoreLabel, { color: colors.inkSoft }]}>
                    {t(`debrief.scores.${key}`)}
                  </Text>
                </View>
              ))}
            </View>

            <Text style={[styles.debriefSection, { color: colors.green }]}>{t('debrief.wentWell')}</Text>
            {debrief.wentWell?.map((item, i) => (
              <Text key={i} style={[styles.debriefItem, { color: colors.white }]}>
                •  {item}
              </Text>
            ))}

            <Text style={[styles.debriefSection, { color: colors.coral }]}>{t('debrief.workOn')}</Text>
            {debrief.workOn?.map((item, i) => (
              <Text key={i} style={[styles.debriefItem, { color: colors.white }]}>
                •  {item}
              </Text>
            ))}

            {!!debrief.drill && (
              <View style={[styles.drillCard, { backgroundColor: colors.primaryDark }]}>
                <Text style={[styles.drillLabel, { color: colors.inkSoft }]}>{t('debrief.drillLabel')}</Text>
                <Text style={[styles.drillText, { color: colors.white }]}>{debrief.drill}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.bigBtn, { backgroundColor: colors.coral, marginTop: 20 }]}
              onPress={handleAgain}
              activeOpacity={0.85}
            >
              <Text style={styles.bigBtnText}>{t('debrief.againButton')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.finishBtn, { borderColor: colors.inkSoft }]}
              onPress={() => router.back()}
              activeOpacity={0.85}
            >
              <Text style={[styles.finishBtnText, { color: colors.white }]}>{t('debrief.doneButton')}</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* Privacy / reality note */}
        <Text style={[styles.privacyNote, { color: colors.inkSoft }]}>{t('privacyNote')}</Text>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backRow: { marginBottom: 16 },
  backText: { fontSize: 15 },
  heading: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 8, lineHeight: 31 },
  subheading: { fontSize: 15, lineHeight: 22, marginBottom: 24 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  temperamentCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 10,
  },
  temperamentTitle: { color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  temperamentDesc: { fontSize: 13, lineHeight: 18 },
  reassurance: { fontSize: 12, lineHeight: 18, marginTop: 12, marginBottom: 16 },
  bigBtn: { borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginBottom: 12 },
  bigBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  chatContent: { paddingBottom: 12 },
  chatIntro: { fontSize: 13, lineHeight: 19, marginBottom: 16, textAlign: 'center' },
  bubble: { borderRadius: 16, padding: 12, marginBottom: 8, maxWidth: '85%' },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubblePartner: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  safetyCard: { borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 8 },
  safetyTitle: { fontWeight: '700', fontSize: 14, marginBottom: 4 },
  safetyBody: { fontSize: 13, lineHeight: 19 },
  errorText: { fontSize: 12, textAlign: 'center', marginTop: 6 },
  turnsNote: { fontSize: 11, textAlign: 'center', marginBottom: 6 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 8 },
  input: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 110,
  },
  sendBtn: { borderRadius: 14, paddingHorizontal: 18, paddingVertical: 13 },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  finishBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 4,
  },
  finishBtnText: { fontWeight: '700', fontSize: 14 },
  scoreRow: { flexDirection: 'row', gap: 8, marginBottom: 20, marginTop: 8 },
  scorePill: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  scoreValue: { fontWeight: '700', fontSize: 16 },
  scoreLabel: { fontSize: 10, marginTop: 2, textAlign: 'center' },
  debriefSection: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 14,
    marginBottom: 8,
  },
  debriefItem: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
  drillCard: { borderRadius: 14, padding: 16, marginTop: 14 },
  drillLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  drillText: { fontSize: 15, lineHeight: 22 },
  privacyNote: { fontSize: 10, textAlign: 'center', lineHeight: 15, marginTop: 6 },
});
