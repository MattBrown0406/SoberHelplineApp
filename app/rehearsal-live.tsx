import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { useLovedOne } from '../src/hooks/useLovedOne';
import { useRehearsalCount } from '../src/hooks/useRehearsalCount';
import {
  useRehearsalPartner,
  type PartnerTemperament,
  type PartnerGender,
  type PartnerAge,
  type PartnerRelationship,
} from '../src/hooks/useRehearsalPartner';

type Stage = 'setup' | 'chat' | 'debrief';

const TEMPERAMENTS: PartnerTemperament[] = ['guarded', 'defensive', 'volatile', 'tearful'];
const RELATIONSHIPS: PartnerRelationship[] = ['spouse', 'partner', 'son', 'daughter', 'sibling', 'parent', 'friend'];
const GENDERS: PartnerGender[] = ['male', 'female'];
const AGES: PartnerAge[] = ['young', 'middle', 'older'];

const SCORE_KEYS = ['love', 'iStatements', 'calm', 'ask'] as const;

/** Map the loved-one profile relationship onto the picker's options. */
function defaultRelationship(profile: string | null | undefined): PartnerRelationship {
  if (profile && (RELATIONSHIPS as string[]).includes(profile)) return profile as PartnerRelationship;
  return 'son';
}

/** Genders are guessed from nothing — default by relationship where implied. */
function defaultGender(relationship: PartnerRelationship): PartnerGender {
  if (relationship === 'daughter') return 'female';
  return 'male';
}

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
  const [relationship, setRelationship] = useState<PartnerRelationship>(
    defaultRelationship(lovedOne?.relationship),
  );
  const [gender, setGender] = useState<PartnerGender>(defaultGender(defaultRelationship(lovedOne?.relationship)));
  const [age, setAge] = useState<PartnerAge>('middle');
  const [voiceOn, setVoiceOn] = useState(true);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Follow the profile once it loads (the hooks load async).
  useEffect(() => {
    if (lovedOne?.relationship) {
      const rel = defaultRelationship(lovedOne.relationship);
      setRelationship(rel);
      setGender(defaultGender(rel));
    }
  }, [lovedOne?.relationship]);

  const language = i18n.language?.startsWith('es') ? 'es' : 'en';
  const partnerName = lovedOne?.first_name?.trim() || t('defaultName');

  const {
    messages,
    sending,
    transcribing,
    error,
    safetyBreak,
    debrief,
    debriefLoading,
    turnsLeft,
    send,
    transcribeClip,
    requestDebrief,
    reset,
  } = useRehearsalPartner({
    relationship,
    name: lovedOne?.first_name ?? undefined,
    substances: lovedOne?.substances ?? undefined,
    temperament,
    scriptText: typeof params.text === 'string' ? params.text : undefined,
    language,
    voice: voiceOn ? { gender, age } : undefined,
  });

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(id);
  }, [messages.length, sending]);

  useEffect(() => {
    if (debrief) {
      increment();
      setStage('debrief');
    }
  }, [debrief, increment]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync();
    };
  }, []);

  const playAudio = useCallback(async (audioB64: string) => {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const path = `${FileSystem.cacheDirectory}rehearsal-reply.mp3`;
      await FileSystem.writeAsStringAsync(path, audioB64, { encoding: FileSystem.EncodingType.Base64 });
      if (soundRef.current) await soundRef.current.unloadAsync();
      const { sound } = await Audio.Sound.createAsync({ uri: path });
      soundRef.current = sound;
      await sound.playAsync();
    } catch {
      // Voice is a layer, never a blocker — the text is already on screen.
    }
  }, []);

  async function handleSend(text?: string) {
    const outgoing = (text ?? draft).trim();
    if (!outgoing) return;
    setDraft('');
    const audio = await send(outgoing);
    if (audio && voiceOn) void playAudio(audio);
  }

  async function startTalking() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('chat.micPermissionTitle'), t('chat.micPermissionBody'));
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      setRecording(rec);
    } catch {
      // no mic (simulator) — typing still works
    }
  }

  async function stopTalking() {
    if (!recording) return;
    let uri: string | null = null;
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      uri = recording.getURI();
    } catch {}
    setRecording(null);
    if (!uri) return;
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const format = uri.split('.').pop() ?? 'm4a';
      const text = await transcribeClip(b64, format);
      if (text) setDraft((prev) => (prev ? `${prev} ${text}` : text));
    } catch {
      // transcription failed — the error state from the hook shows the message
    }
  }

  function handleFinish() {
    void requestDebrief();
  }

  function handleAgain() {
    reset();
    setStage('setup');
  }

  const inputLocked = sending || turnsLeft === 0 || safetyBreak;

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

            {/* Relationship */}
            <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>{t('setup.relationshipLabel')}</Text>
            <View style={styles.chipWrap}>
              {RELATIONSHIPS.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: relationship === key ? colors.primary : colors.primaryDark,
                      borderColor: relationship === key ? colors.coral : 'transparent',
                    },
                  ]}
                  onPress={() => {
                    setRelationship(key);
                    setGender(defaultGender(key));
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.chipText}>{t(`relationships.${key}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Voice: gender + age */}
            <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>{t('setup.voiceLabel')}</Text>
            <View style={styles.chipWrap}>
              {GENDERS.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: gender === key ? colors.primary : colors.primaryDark,
                      borderColor: gender === key ? colors.coral : 'transparent',
                    },
                  ]}
                  onPress={() => setGender(key)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.chipText}>{t(`genders.${key}`)}</Text>
                </TouchableOpacity>
              ))}
              {AGES.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: age === key ? colors.primary : colors.primaryDark,
                      borderColor: age === key ? colors.coral : 'transparent',
                    },
                  ]}
                  onPress={() => setAge(key)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.chipText}>{t(`ages.${key}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Voice on/off */}
            <TouchableOpacity
              style={[styles.voiceToggle, { backgroundColor: colors.primaryDark }]}
              onPress={() => setVoiceOn((v) => !v)}
              activeOpacity={0.85}
            >
              <Text style={[styles.voiceToggleText, { color: colors.white }]}>
                {voiceOn ? t('setup.voiceOn') : t('setup.voiceOff')}
              </Text>
            </TouchableOpacity>

            {/* Temperament */}
            <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>{t('setup.temperamentLabel')}</Text>
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
                  {m.role === 'partner' && m.audio && (
                    <TouchableOpacity onPress={() => void playAudio(m.audio!)} hitSlop={8}>
                      <Text style={[styles.replayText, { color: colors.inkSoft }]}>{t('chat.replay')}</Text>
                    </TouchableOpacity>
                  )}
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
              {/* Hold to talk */}
              <TouchableOpacity
                style={[
                  styles.micBtn,
                  {
                    backgroundColor: recording ? colors.coral : colors.primaryDark,
                    opacity: inputLocked || transcribing ? 0.4 : 1,
                  },
                ]}
                onPressIn={startTalking}
                onPressOut={stopTalking}
                disabled={inputLocked || transcribing}
                activeOpacity={0.85}
              >
                {transcribing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.micBtnText}>{recording ? '●' : '🎤'}</Text>
                )}
              </TouchableOpacity>

              <TextInput
                style={[styles.input, { backgroundColor: colors.primaryDark, color: colors.white }]}
                placeholder={recording ? t('chat.listening') : t('chat.placeholder')}
                placeholderTextColor={colors.inkSoft}
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={600}
                editable={!inputLocked}
              />
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  { backgroundColor: colors.coral, opacity: draft.trim() && !inputLocked ? 1 : 0.4 },
                ]}
                onPress={() => void handleSend()}
                disabled={!draft.trim() || inputLocked}
                activeOpacity={0.85}
              >
                <Text style={styles.sendBtnText}>{t('chat.send')}</Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.micHint, { color: colors.inkSoft }]}>{t('chat.micHint')}</Text>

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
  subheading: { fontSize: 15, lineHeight: 22, marginBottom: 20 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 6,
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  voiceToggle: { borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginBottom: 14 },
  voiceToggleText: { fontSize: 13, fontWeight: '600' },
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
  replayText: { fontSize: 11, marginTop: 6 },
  safetyCard: { borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 8 },
  safetyTitle: { fontWeight: '700', fontSize: 14, marginBottom: 4 },
  safetyBody: { fontSize: 13, lineHeight: 19 },
  errorText: { fontSize: 12, textAlign: 'center', marginTop: 6 },
  turnsNote: { fontSize: 11, textAlign: 'center', marginBottom: 6 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 4 },
  micBtn: {
    borderRadius: 14,
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnText: { fontSize: 18, color: '#fff' },
  micHint: { fontSize: 10, textAlign: 'center', marginBottom: 8 },
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
