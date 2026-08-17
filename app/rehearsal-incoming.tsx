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
  Vibration,
  Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { RehearsalDebrief } from '../src/components/rehearsal/RehearsalDebrief';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { Gate } from '../src/components/auth/Gate';
import { useLovedOne } from '../src/hooks/useLovedOne';
import { useRehearsalCount } from '../src/hooks/useRehearsalCount';
import { supabase } from '../src/lib/supabase';
import { finalizeRecording } from '../src/lib/appFlowGuards';
import {
  useRehearsalPartner,
  type PartnerTemperament,
  type PartnerGender,
  type PartnerAge,
  type PartnerRelationship,
  type CrisisPreset,
} from '../src/hooks/useRehearsalPartner';

type Stage = 'ring' | 'call' | 'debrief';

const TEMPERAMENTS: PartnerTemperament[] = ['guarded', 'defensive', 'volatile', 'tearful'];
const PRESETS: CrisisPreset[] = ['late_night_pickup', 'money_urgent', 'relapse_confession', 'crisis_blame'];
const RELATIONSHIPS: PartnerRelationship[] = ['spouse', 'partner', 'son', 'daughter', 'sibling', 'parent', 'friend'];

/** Map the loved-one profile relationship onto the partner options (mirrors rehearsal-live). */
function defaultRelationship(profile: string | null | undefined): PartnerRelationship {
  if (profile && (RELATIONSHIPS as string[]).includes(profile)) return profile as PartnerRelationship;
  return 'son';
}

/** Genders are guessed from nothing — default by relationship where implied. */
function defaultGender(relationship: PartnerRelationship): PartnerGender {
  if (relationship === 'daughter') return 'female';
  return 'male';
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Route params can pin temperament/preset for testing; otherwise random per call — that's the point. */
function pinnedParam<T extends string>(value: string | undefined, allowed: T[]): T | null {
  return value && (allowed as string[]).includes(value) ? (value as T) : null;
}

export default function RehearsalIncomingScreen() {
  return <Gate feature="aiRehearsal"><RehearsalIncomingContent /></Gate>;
}

function RehearsalIncomingContent() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation(['rehearsalIncoming', 'rehearsalLive']);
  const router = useRouter();
  const params = useLocalSearchParams<{ temperament?: string; crisisPreset?: string; eventId?: string }>();
  const { user } = useAccount();
  const { lovedOne } = useLovedOne(user?.id ?? null);
  const { increment } = useRehearsalCount('incoming-call');

  const [stage, setStage] = useState<Stage>('ring');
  const [declined, setDeclined] = useState(false);
  const answeringRef = useRef(false);
  // Scenario is rolled once per call attempt — no setup screen, that's the ambush.
  const [roll, setRoll] = useState(() => ({
    temperament: pinnedParam(params.temperament, TEMPERAMENTS) ?? pickRandom(TEMPERAMENTS),
    crisisPreset: pinnedParam(params.crisisPreset, PRESETS) ?? pickRandom(PRESETS),
  }));
  const relationship = defaultRelationship(lovedOne?.relationship);
  const gender = defaultGender(relationship);
  const age: PartnerAge = 'middle';
  const [draft, setDraft] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  const language = i18n.language?.startsWith('es') ? 'es' : 'en';
  const partnerName = lovedOne?.first_name?.trim() || t('rehearsalLive:defaultName');

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
    open,
    requestDebrief,
    reset,
  } = useRehearsalPartner({
    relationship,
    name: lovedOne?.first_name ?? undefined,
    substances: lovedOne?.substances ?? undefined,
    temperament: roll.temperament,
    language,
    voice: { gender, age },
    mode: 'incoming_call',
    crisisPreset: roll.crisisPreset,
  }, typeof params.eventId === 'string' ? params.eventId : undefined);

  // Ring: pulse the answer button and loop the vibration pattern until
  // answered or declined. Vibration only — no new native deps, OTA-safe.
  useEffect(() => {
    if (stage !== 'ring') {
      Vibration.cancel();
      return;
    }
    Vibration.vibrate([0, 900, 600], true);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      Vibration.cancel();
      loop.stop();
    };
  }, [stage, pulse]);

  const savedSessionRef = useRef(false);
  useEffect(() => {
    if (!debrief) return;
    increment();
    setStage('debrief');
    // Save the session once so the family can review their reps later.
    if (!savedSessionRef.current && user?.id) {
      savedSessionRef.current = true;
      void supabase.from('rehearsal_sessions').insert({
        account_id: user.id,
        source_id: null,
        scenario: {
          relationship,
          temperament: roll.temperament,
          gender,
          age,
          language,
          partnerName,
          mode: 'incoming_call',
          crisisPreset: roll.crisisPreset,
        },
        transcript: messages.map(({ role, text }) => ({ role, text })),
        debrief,
      });
    }
  }, [debrief, increment, user?.id, relationship, roll, gender, age, language, partnerName, messages]);

  useEffect(() => {
    // Prime the audio session once so the opening line speaks without delay,
    // even with the iPhone mute switch on.
    void Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    return () => {
      void soundRef.current?.unloadAsync();
      const active = recordingRef.current;
      recordingRef.current = null;
      if (active) void active.stopAndUnloadAsync().catch(() => undefined);
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => undefined);
    };
  }, []);

  const clipCounter = useRef(0);
  const playAudio = useCallback(async (audioB64: string) => {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      clipCounter.current += 1;
      const path = `${FileSystem.cacheDirectory}rehearsal-reply-${clipCounter.current}.mp3`;
      await FileSystem.writeAsStringAsync(path, audioB64, { encoding: FileSystem.EncodingType.Base64 });
      if (soundRef.current) await soundRef.current.unloadAsync();
      const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
      soundRef.current = sound;
    } catch {
      // Voice is a layer, never a blocker — the text is already on screen.
    }
  }, []);

  // Speak each partner line the moment it lands — this is a call, voice-first.
  const lastSpokenIndex = useRef(-1);
  useEffect(() => {
    if (stage !== 'call' || messages.length === 0) return;
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    if (last.role === 'partner' && last.audio && lastIndex > lastSpokenIndex.current) {
      lastSpokenIndex.current = lastIndex;
      void playAudio(last.audio);
    }
  }, [messages, stage, playAudio]);

  async function handleAnswer() {
    if (answeringRef.current) return;
    answeringRef.current = true;
    const eventId = typeof params.eventId === 'string' ? params.eventId : '';
    if (eventId) {
      const validEventId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId);
      if (!validEventId) {
        answeringRef.current = false;
        Alert.alert(t('rehearsalIncoming:ring.unavailableTitle'), t('rehearsalIncoming:ring.unavailableBody'));
        return;
      }
      const { data: claimed, error } = await supabase.rpc('claim_practice_push_event', {
        p_event_id: eventId,
      });
      if (error) {
        answeringRef.current = false;
        Alert.alert(t('rehearsalIncoming:ring.tryAgainTitle'), t('rehearsalIncoming:ring.tryAgainBody'));
        return;
      }
      if (claimed !== true) {
        answeringRef.current = false;
        Alert.alert(t('rehearsalIncoming:ring.unavailableTitle'), t('rehearsalIncoming:ring.unavailableBody'));
        return;
      }
    }
    setStage('call');
    // The durable event claim above is the exactly-once boundary. Only now may
    // the authenticated rehearsal backend generate the character's opening.
    await open();
  }

  function handleDecline() {
    setDeclined(true);
  }

  function handleRering() {
    setDeclined(false);
    setRoll({
      temperament: pinnedParam(params.temperament, TEMPERAMENTS) ?? pickRandom(TEMPERAMENTS),
      crisisPreset: pinnedParam(params.crisisPreset, PRESETS) ?? pickRandom(PRESETS),
    });
  }

  async function handleSend(text?: string) {
    const outgoing = (text ?? draft).trim();
    if (!outgoing) return;
    setDraft('');
    const result = await send(outgoing);
    // If the send failed, put their words back — never make someone retype
    // a sentence that was hard to say the first time.
    if (!result.ok) setDraft((prev) => (prev ? prev : outgoing));
  }

  async function startTalking() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('rehearsalLive:chat.micPermissionTitle'), t('rehearsalLive:chat.micPermissionBody'));
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = rec;
      setRecording(rec);
    } catch {
      // no mic (simulator) — typing still works
    }
  }

  async function stopTalking() {
    const active = recordingRef.current ?? recording;
    if (!active) return;
    let result;
    let durationMillis = 0;
    try {
      const status = await active.getStatusAsync();
      durationMillis = status.durationMillis ?? 0;
      result = await finalizeRecording(
        () => active.stopAndUnloadAsync(),
        () => active.getURI(),
        () => Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }),
      );
    } catch {
      Alert.alert(t('rehearsalLive:chat.recordingErrorTitle'), t('rehearsalLive:chat.recordingErrorBody'));
      return;
    }
    recordingRef.current = null;
    setRecording(null);
    if (result.restoreError) {
      Alert.alert(t('rehearsalLive:chat.recordingErrorTitle'), t('rehearsalLive:chat.recordingErrorBody'));
    }
    if (!result.uri) return;
    // A slipped finger produces a fraction-of-a-second clip of near-silence.
    // Whisper hallucinates filler ("Thank you", "You") on clips like that —
    // don't even send them.
    if (durationMillis < 700) return;
    try {
      const b64 = await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 });
      const format = result.uri.split('.').pop() ?? 'm4a';
      const text = await transcribeClip(b64, format);
      if (text) setDraft((prev) => (prev ? `${prev} ${text}` : text));
    } catch {
      // transcription failed — the error state from the hook shows the message
    }
  }

  function handleHangUp() {
    if (messages.some((m) => m.role === 'user')) {
      void requestDebrief();
    } else {
      // Answered but never spoke — nothing to coach; leave quietly.
      router.back();
    }
  }

  function handleAgain() {
    savedSessionRef.current = false;
    lastSpokenIndex.current = -1;
    reset();
    setRoll({
      temperament: pinnedParam(params.temperament, TEMPERAMENTS) ?? pickRandom(TEMPERAMENTS),
      crisisPreset: pinnedParam(params.crisisPreset, PRESETS) ?? pickRandom(PRESETS),
    });
    setDeclined(false);
    setStage('ring');
  }

  const inputLocked = sending || turnsLeft === 0 || safetyBreak;
  const lastPartner = [...messages].reverse().find((m) => m.role === 'partner');
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');


  return (
    <ScreenContainer backgroundColor={colors.ink}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {/* ---------- RING ---------- */}
        {stage === 'ring' && (
          <View style={styles.ringWrap}>
            {!declined ? (
              <>
                <Text style={[styles.practiceBadge, { color: colors.primary, borderColor: colors.primary }]}>
                  {t('rehearsalIncoming:ring.badge')}
                </Text>
                <Text style={[styles.ringLabel, { color: colors.inkSoft }]}>{t('rehearsalIncoming:ring.label')}</Text>
                <Text style={styles.ringName}>{partnerName}</Text>
                <Text style={[styles.ringSub, { color: colors.inkSoft }]}>{t('rehearsalIncoming:ring.mobile')}</Text>

                <View style={styles.ringButtons}>
                  <View style={styles.ringButtonCol}>
                    <TouchableOpacity
                      style={[styles.callBtn, { backgroundColor: colors.coral }]}
                      onPress={handleDecline}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.callBtnIcon}>✕</Text>
                    </TouchableOpacity>
                    <Text style={[styles.callBtnLabel, { color: colors.inkSoft }]}>
                      {t('rehearsalIncoming:ring.decline')}
                    </Text>
                  </View>
                  <View style={styles.ringButtonCol}>
                    <Animated.View style={{ transform: [{ scale: pulse }] }}>
                      <TouchableOpacity
                        style={[styles.callBtn, { backgroundColor: colors.green }]}
                        onPress={() => void handleAnswer()}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.callBtnIcon}>📞</Text>
                      </TouchableOpacity>
                    </Animated.View>
                    <Text style={[styles.callBtnLabel, { color: colors.inkSoft }]}>
                      {t('rehearsalIncoming:ring.answer')}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.ringHint, { color: colors.inkSoft }]}>{t('rehearsalIncoming:ring.hint')}</Text>
              </>
            ) : (
              <>
                <Text style={styles.ringName}>{t('rehearsalIncoming:declined.title')}</Text>
                <Text style={[styles.declinedBody, { color: colors.inkSoft }]}>
                  {t('rehearsalIncoming:declined.body')}
                </Text>
                <TouchableOpacity
                  style={[styles.bigBtn, { backgroundColor: colors.coral }]}
                  onPress={handleRering}
                  activeOpacity={0.85}
                >
                  <Text style={styles.bigBtnText}>{t('rehearsalIncoming:declined.rering')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.declinedBack}>
                  <Text style={[styles.backText, { color: colors.inkSoft }]}>{t('rehearsalIncoming:declined.leave')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* ---------- LIVE CALL ---------- */}
        {stage === 'call' && (
          <View style={styles.flex}>
            <View style={styles.callHeader}>
              <Text style={styles.callName}>{partnerName}</Text>
              <Text style={[styles.callStatus, { color: colors.inkSoft }]}>
                {sending && messages.length === 0
                  ? t('rehearsalIncoming:call.connecting')
                  : t('rehearsalIncoming:call.onCall', { count: turnsLeft })}
              </Text>
            </View>

            <ScrollView style={styles.flex} contentContainerStyle={styles.callContent} showsVerticalScrollIndicator={false}>
              {/* Minimal transcript — like a call, not a chat */}
              {lastPartner && (
                <View style={[styles.lineCard, { backgroundColor: colors.primaryDark }]}>
                  <Text style={[styles.lineSpeaker, { color: colors.inkSoft }]}>{partnerName}</Text>
                  <Text style={styles.lineText}>{lastPartner.text}</Text>
                  {lastPartner.audio && (
                    <TouchableOpacity onPress={() => void playAudio(lastPartner.audio!)} hitSlop={8}>
                      <Text style={[styles.replayText, { color: colors.inkSoft }]}>{t('rehearsalLive:chat.replay')}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {sending && (
                <View style={[styles.lineCard, { backgroundColor: colors.primaryDark }]}>
                  <ActivityIndicator color={colors.inkSoft} size="small" />
                </View>
              )}
              {lastUser && (
                <View style={[styles.lineCard, styles.lineCardUser, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.lineSpeaker, { color: colors.primaryLight }]}>{t('rehearsalIncoming:call.you')}</Text>
                  <Text style={styles.lineText}>{lastUser.text}</Text>
                </View>
              )}

              {safetyBreak && (
                <TouchableOpacity
                  style={[styles.safetyCard, { backgroundColor: colors.coralLight }]}
                  onPress={() => router.push('/crisis-mode')}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.safetyTitle, { color: colors.coral }]}>{t('rehearsalLive:chat.safetyTitle')}</Text>
                  <Text style={[styles.safetyBody, { color: colors.ink }]}>{t('rehearsalLive:chat.safetyBody')}</Text>
                </TouchableOpacity>
              )}

              {error && (
                <Text style={[styles.errorText, { color: colors.coral }]}>{t('rehearsalLive:chat.error')}</Text>
              )}

              {/* Full transcript toggle */}
              <TouchableOpacity onPress={() => setShowTranscript((v) => !v)} hitSlop={8} style={styles.transcriptToggle}>
                <Text style={[styles.transcriptToggleText, { color: colors.inkSoft }]}>
                  {showTranscript ? t('rehearsalIncoming:call.hideTranscript') : t('rehearsalIncoming:call.showTranscript')}
                </Text>
              </TouchableOpacity>
              {showTranscript &&
                messages.map((m, i) => (
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
            </ScrollView>

            {/* Typed fallback — same affordance as rehearsal-live */}
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.primaryDark, color: colors.white }]}
                placeholder={recording ? t('rehearsalLive:chat.listening') : t('rehearsalIncoming:call.placeholder')}
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
                <Text style={styles.sendBtnText}>{t('rehearsalLive:chat.send')}</Text>
              </TouchableOpacity>
            </View>

            {/* Hold to speak — pinned to the bottom where the thumb lives */}
            <TouchableOpacity
              style={[
                styles.holdBar,
                {
                  backgroundColor: recording ? colors.coral : colors.primaryDark,
                  borderColor: colors.coral,
                  opacity: inputLocked || transcribing ? 0.4 : 1,
                },
              ]}
              onPressIn={startTalking}
              onPressOut={stopTalking}
              disabled={inputLocked || transcribing}
              activeOpacity={0.9}
              pressRetentionOffset={{ top: 200, bottom: 200, left: 200, right: 200 }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              {transcribing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.holdBarText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {recording ? `●  ${t('rehearsalLive:chat.releaseWhenDone')}` : `🎤  ${t('rehearsalLive:chat.holdToSpeak')}`}
                </Text>
              )}
            </TouchableOpacity>

            {/* Hang up */}
            <TouchableOpacity
              style={[styles.hangupBtn, { backgroundColor: colors.coral, opacity: debriefLoading ? 0.5 : 1 }]}
              onPress={handleHangUp}
              disabled={debriefLoading}
              activeOpacity={0.85}
            >
              {debriefLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.hangupText}>{t('rehearsalIncoming:call.hangUp')}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ---------- DEBRIEF ---------- */}
        {stage === 'debrief' && debrief && (
          <RehearsalDebrief debrief={debrief} onAgain={handleAgain} onDone={() => router.back()} />
        )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backText: { fontSize: 15 },
  // Ring
  ringWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  practiceBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 12 },
  ringLabel: { fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 18 },
  ringName: { fontSize: 34, fontWeight: '700', color: '#fff', textAlign: 'center', lineHeight: 42 },
  ringSub: { fontSize: 15, marginTop: 6 },
  ringButtons: { flexDirection: 'row', gap: 72, marginTop: 64 },
  ringButtonCol: { alignItems: 'center', gap: 10 },
  callBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtnIcon: { fontSize: 28, color: '#fff' },
  callBtnLabel: { fontSize: 13, fontWeight: '600' },
  ringHint: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 48, paddingHorizontal: 24, fontStyle: 'italic' },
  declinedBody: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 12, marginBottom: 28, paddingHorizontal: 16 },
  bigBtn: { borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, alignItems: 'center', alignSelf: 'stretch' },
  bigBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  declinedBack: { marginTop: 18, paddingVertical: 8 },
  // Call
  callHeader: { alignItems: 'center', paddingVertical: 12 },
  callName: { fontSize: 22, fontWeight: '700', color: '#fff' },
  callStatus: { fontSize: 12, marginTop: 3 },
  callContent: { paddingBottom: 12, paddingTop: 8 },
  lineCard: { borderRadius: 16, padding: 14, marginBottom: 10 },
  lineCardUser: { opacity: 0.92 },
  lineSpeaker: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 },
  lineText: { color: '#fff', fontSize: 16, lineHeight: 23 },
  replayText: { fontSize: 11, marginTop: 6 },
  bubble: { borderRadius: 16, padding: 12, marginBottom: 8, maxWidth: '85%' },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubblePartner: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  safetyCard: { borderRadius: 14, padding: 16, marginTop: 8, marginBottom: 8 },
  safetyTitle: { fontWeight: '700', fontSize: 14, marginBottom: 4 },
  safetyBody: { fontSize: 13, lineHeight: 19 },
  errorText: { fontSize: 12, textAlign: 'center', marginTop: 6 },
  transcriptToggle: { alignItems: 'center', paddingVertical: 10 },
  transcriptToggleText: { fontSize: 12, fontWeight: '600' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 4 },
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
  holdBar: {
    borderRadius: 16,
    borderWidth: 1.5,
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  holdBarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  hangupBtn: { borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  hangupText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
