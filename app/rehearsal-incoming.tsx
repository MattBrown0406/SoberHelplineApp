import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
  Vibration,
  Animated,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { RehearsalDebrief } from '../src/components/rehearsal/RehearsalDebrief';
import { useSpeechCapture } from '../src/components/rehearsal/useSpeechCapture';
import { SafetyBreakCard } from '../src/components/rehearsal/SafetyBreakCard';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { Gate } from '../src/components/auth/Gate';
import { RouteActivationGate } from '../src/contexts/RouteActivationContext';
import { useLovedOne } from '../src/hooks/useLovedOne';
import { useLovedOneProfile } from '../src/hooks/useLovedOneProfile';
import { useRehearsalCount } from '../src/hooks/useRehearsalCount';
import { supabase } from '../src/lib/supabase';
import { appAlert } from '../src/lib/appAlert';
import { saveRehearsalSession } from '../src/lib/rehearsalSessions';
import { practiceRelationship, toPracticeProfile, type PracticeProfile } from '../src/lib/practiceProfile';
import { analyzeDelivery, clipsForText, type DeliveryReport, type VoiceClip } from '../src/lib/practiceDelivery';
import { transcriptBeforeUserTurn } from '../src/lib/practiceReplay';
import { leavesConversation, stageAfterSafetyBreak } from '../src/lib/practiceSafety';
import { clampLine, INCOMING_PRESETS, MAX_LINE_CHARS, PARTNER_TEMPERAMENTS } from '../src/lib/practiceScenarios';
import {
  useRehearsalPartner,
  type PartnerDebrief,
  type PartnerTemperament,
  type PartnerGender,
  type PartnerAge,
  type PartnerRelationship,
  type CrisisPreset,
} from '../src/hooks/useRehearsalPartner';

type Stage = 'ring' | 'call' | 'debrief';

/** Who is calling — frozen when the call is answered so a late-loading profile can't swap the caller mid-call. */
type CallPersona = {
  relationship: PartnerRelationship;
  gender: PartnerGender;
  name: string;
  profile?: PracticeProfile;
};

const TEMPERAMENTS: PartnerTemperament[] = [...PARTNER_TEMPERAMENTS];
const PRESETS: CrisisPreset[] = [...INCOMING_PRESETS];
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
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  return <RouteActivationGate><Gate feature="aiRehearsal"><RehearsalIncomingContent key={eventId ?? 'manual'} /></Gate></RouteActivationGate>;
}

function RehearsalIncomingContent() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation(['rehearsalIncoming', 'rehearsalLive']);
  const router = useRouter();
  const params = useLocalSearchParams<{ temperament?: string; crisisPreset?: string; eventId?: string }>();
  const { user } = useAccount();
  const { lovedOne } = useLovedOne(user?.id ?? null);
  // An ambush has no setup screen: when the family has described their loved
  // one, the caller is always *their* person.
  const { profile } = useLovedOneProfile(user?.id ?? null);
  const practiceProfile = useMemo(() => toPracticeProfile(profile), [profile]);
  const { increment } = useRehearsalCount('incoming-call');

  const [stage, setStage] = useState<Stage>('ring');
  const [declined, setDeclined] = useState(false);
  const answeringRef = useRef(false);
  // A push event is claimed exactly once and backs only the first answered
  // call. "Again" is a fresh manual call: reusing the event would replay its
  // cached opening under a newly rolled crisis, or 409 once it expires.
  const claimedEventIdRef = useRef<string | null>(null);
  const [sessionEventId, setSessionEventId] = useState<string | undefined>(
    typeof params.eventId === 'string' ? params.eventId : undefined,
  );
  // Scenario is rolled once per call attempt — no setup screen, that's the ambush.
  const [roll, setRoll] = useState(() => ({
    temperament: pinnedParam(params.temperament, TEMPERAMENTS) ?? pickRandom(TEMPERAMENTS),
    crisisPreset: pinnedParam(params.crisisPreset, PRESETS) ?? pickRandom(PRESETS),
  }));
  const liveRelationship = defaultRelationship(practiceRelationship(practiceProfile?.relationship) ?? lovedOne?.relationship);
  const livePersona: CallPersona = {
    relationship: liveRelationship,
    gender: defaultGender(liveRelationship),
    name: practiceProfile?.name || lovedOne?.first_name?.trim() || '',
    profile: practiceProfile ?? undefined,
  };
  const [persona, setPersona] = useState<CallPersona | null>(null);
  const caller = persona ?? livePersona;
  const relationship = caller.relationship;
  const gender = caller.gender;
  const age: PartnerAge = 'middle';
  const [draft, setDraft] = useState('');
  const [lineTrimmed, setLineTrimmed] = useState(false);
  const draftRef = useRef('');
  draftRef.current = draft;
  const [showTranscript, setShowTranscript] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryReport | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  // Voice clips recorded since the last send; attached to the line they became.
  const pendingClipsRef = useRef<VoiceClip[]>([]);
  const redoFromRef = useRef<number | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  const language = i18n.language?.startsWith('es') ? 'es' : 'en';
  const realName = caller.name;
  const partnerName = realName || t('rehearsalLive:defaultName');

  const {
    messages,
    sending,
    transcribing,
    error,
    safetyBreak,
    safetyKind,
    canKeepPracticing,
    hadSafetyBreak,
    keepPracticing,
    debrief,
    debriefLoading,
    turnsLeft,
    send,
    transcribeClip,
    open,
    requestDebrief,
    reset,
    restore,
  } = useRehearsalPartner({
    relationship,
    name: realName || undefined,
    substances: lovedOne?.substances ?? undefined,
    temperament: roll.temperament,
    language,
    voice: { gender, age },
    persona: { gender, age },
    mode: 'incoming_call',
    crisisPreset: roll.crisisPreset,
    profile: caller.profile,
  }, sessionEventId);

  // Ring: pulse the answer button and loop the vibration pattern until
  // answered or declined. Vibration only — no new native deps, OTA-safe.
  useEffect(() => {
    if (stage !== 'ring' || declined) {
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
  }, [stage, declined, pulse]);

  // Each debrief is handled exactly once: count the rep, compute delivery,
  // show it, and save it so the family can review their reps later.
  const handledDebriefRef = useRef<PartnerDebrief | null>(null);
  useEffect(() => {
    if (!debrief || handledDebriefRef.current === debrief) return;
    // Never coach — or save — a call that hit a crisis break.
    if (safetyBreak) return;
    handledDebriefRef.current = debrief;
    void increment();
    const report = analyzeDelivery(
      messages.filter((m) => m.role === 'user').map((m) => ({ text: m.text, clips: m.clips })),
      language,
    );
    setDelivery(report);
    setStage('debrief');
    if (user?.id) {
      void saveRehearsalSession({
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
          ...(caller.profile ? { profileUsed: true } : {}),
          ...(redoFromRef.current !== null ? { redoFromTurn: redoFromRef.current } : {}),
        },
        transcript: messages.map(({ role, text }) => ({ role, text })),
        debrief: { ...debrief, delivery: report },
      });
    }
  }, [debrief]); // once per debrief: the session state it reads is final by then

  useEffect(() => {
    // Prime the audio session once so the opening line speaks without delay,
    // even with the iPhone mute switch on.
    void Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    return () => {
      void soundRef.current?.unloadAsync();
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(() => undefined);
    };
  }, []);

  const clipCounter = useRef(0);
  const playAudio = useCallback(async (audioB64: string) => {
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      let uri: string;
      if (Platform.OS === 'web') {
        // No file system on web: play the clip straight from memory.
        uri = `data:audio/mpeg;base64,${audioB64}`;
      } else {
        clipCounter.current += 1;
        uri = `${FileSystem.cacheDirectory}rehearsal-reply-${clipCounter.current}.mp3`;
        await FileSystem.writeAsStringAsync(uri, audioB64, { encoding: FileSystem.EncodingType.Base64 });
      }
      if (soundRef.current) await soundRef.current.unloadAsync();
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
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
    const eventId = sessionEventId ?? '';
    if (eventId && claimedEventIdRef.current !== eventId) {
      const validEventId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId);
      if (!validEventId) {
        answeringRef.current = false;
        appAlert(t('rehearsalIncoming:ring.unavailableTitle'), t('rehearsalIncoming:ring.unavailableBody'));
        return;
      }
      const { data: claimed, error } = await supabase.rpc('claim_practice_push_event', {
        p_event_id: eventId,
      });
      if (error) {
        answeringRef.current = false;
        appAlert(t('rehearsalIncoming:ring.tryAgainTitle'), t('rehearsalIncoming:ring.tryAgainBody'));
        return;
      }
      if (claimed !== true) {
        answeringRef.current = false;
        appAlert(t('rehearsalIncoming:ring.unavailableTitle'), t('rehearsalIncoming:ring.unavailableBody'));
        return;
      }
      claimedEventIdRef.current = eventId;
    }
    setPersona(livePersona);
    setStage('call');
    // The durable event claim above is the exactly-once boundary. Only now may
    // the authenticated rehearsal backend generate the character's opening.
    await open();
  }

  function handleDecline() {
    setDeclined(true);
  }

  function handleRering() {
    answeringRef.current = false;
    setDeclined(false);
    setRoll({
      temperament: pinnedParam(params.temperament, TEMPERAMENTS) ?? pickRandom(TEMPERAMENTS),
      crisisPreset: pinnedParam(params.crisisPreset, PRESETS) ?? pickRandom(PRESETS),
    });
  }

  const capture = useSpeechCapture({
    transcribe: transcribeClip,
    onPermissionDenied: () => appAlert(t('rehearsalLive:chat.micPermissionTitle'), t('rehearsalLive:chat.micPermissionBody')),
    onRecordingError: () => appAlert(t('rehearsalLive:chat.recordingErrorTitle'), t('rehearsalLive:chat.recordingErrorBody')),
    onAutoStop: (clip) => handleClip(clip),
    onUnavailable: () => appAlert(t('rehearsalLive:chat.voiceUnavailableTitle'), t('rehearsalLive:chat.voiceUnavailableBody')),
    onTooLong: () => appAlert(t('rehearsalLive:chat.recordingTooLongTitle'), t('rehearsalLive:chat.recordingTooLongBody')),
  });

  // Leaving the call (coaching appears): no live mic, no stray transcript, no
  // leftover draft — the hold bar may unmount mid-press without a release.
  useEffect(() => {
    if (!leavesConversation(stage, 'call')) return;
    void capture.cancel();
    pendingClipsRef.current = [];
    setDraft('');
    setLineTrimmed(false);
  }, [stage]); // capture.cancel is stable

  // A pause that lands while coaching is showing brings the crisis card back.
  useEffect(() => {
    const next = stageAfterSafetyBreak(stage, safetyBreak, 'debrief', 'call');
    if (next !== stage) setStage(next);
  }, [safetyBreak, stage]);

  async function handleSend() {
    const outgoing = draft.trim();
    if (!outgoing) return;
    const pending = pendingClipsRef.current;
    pendingClipsRef.current = [];
    setDraft('');
    setLineTrimmed(false);
    const result = await send(outgoing, { clips: clipsForText(pending, outgoing) });
    // If the send failed, put their words back — never make someone retype
    // a sentence that was hard to say the first time.
    if (!result.ok) {
      setDraft((prev) => (prev ? prev : outgoing));
      pendingClipsRef.current = pending;
    }
  }

  function handleClip(clip: VoiceClip) {
    pendingClipsRef.current.push(clip);
    // A long recording can run past one line: keep the first part and say so.
    // (The server already screened the whole transcript when it was made.)
    const current = draftRef.current;
    const fitted = clampLine(current ? `${current} ${clip.transcript}` : clip.transcript, MAX_LINE_CHARS);
    if (fitted.clamped) setLineTrimmed(true);
    setDraft(fitted.text);
  }

  async function startTalking() {
    await capture.start();
  }

  async function stopTalking() {
    const clip = await capture.stop();
    if (clip) handleClip(clip);
  }

  function handleHangUp() {
    // After a crisis break the call just ends — no coaching on a disclosure.
    if (safetyBreak) {
      router.back();
      return;
    }
    // A last line still being answered or transcribed may yet be a crisis disclosure.
    if (hangUpBlocked) return;
    if (messages.some((m) => m.role === 'user')) {
      void requestDebrief();
    } else {
      // Answered but never spoke — nothing to coach; leave quietly.
      router.back();
    }
  }

  /** "Redo from here": back onto the call just before the line the coaching is about. */
  function handleRedo(userTurnIndex: number) {
    const before = transcriptBeforeUserTurn(messages, userTurnIndex);
    if (!before) return;
    pendingClipsRef.current = [];
    // Lines already heard are not replayed when the call resumes.
    lastSpokenIndex.current = before.length - 1;
    redoFromRef.current = userTurnIndex;
    restore(before);
    setDraft('');
    setDelivery(null);
    setStage('call');
  }

  /** "I'm safe — keep practicing": the flagged line leaves the call and input reopens. */
  function handleKeepPracticing() {
    const kept = keepPracticing();
    if (kept === null) return;
    lastSpokenIndex.current = kept - 1;
    pendingClipsRef.current = [];
    setLineTrimmed(false);
  }

  function handleAgain() {
    // A crisis break is never cleared out from under the member: back to the card.
    if (safetyBreak) {
      setStage('call');
      return;
    }
    answeringRef.current = false;
    lastSpokenIndex.current = -1;
    redoFromRef.current = null;
    pendingClipsRef.current = [];
    setDelivery(null);
    setLineTrimmed(false);
    setPersona(null);
    setSessionEventId(undefined);
    reset();
    setRoll({
      temperament: pinnedParam(params.temperament, TEMPERAMENTS) ?? pickRandom(TEMPERAMENTS),
      crisisPreset: pinnedParam(params.crisisPreset, PRESETS) ?? pickRandom(PRESETS),
    });
    setDeclined(false);
    setStage('ring');
  }

  // Nothing new can be said while the coach is reading the call.
  const inputLocked = sending || turnsLeft === 0 || safetyBreak || debriefLoading;
  const recording = capture.recording;
  const hangUpBlocked = !safetyBreak && (sending || transcribing || recording || debriefLoading);
  // The opening never arrived (network, quota): the claimed push call can be
  // retried — the server replays its cached opening or generates it again.
  const openingFailed = stage === 'call' && messages.length === 0 && !sending && !!error && !safetyBreak;
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
                <SafetyBreakCard kind={safetyKind} onKeepPracticing={canKeepPracticing ? handleKeepPracticing : undefined} />
              )}

              {error && (
                <Text style={[styles.errorText, { color: colors.coral }]}>{error === 'daily_limit_reached' ? t('rehearsalLive:chat.dailyLimit') : t('rehearsalLive:chat.error')}</Text>
              )}
              {openingFailed && error !== 'daily_limit_reached' && (
                <TouchableOpacity
                  style={[styles.retryBtn, { borderColor: colors.coral }]}
                  onPress={() => void open()}
                  accessibilityRole="button"
                  activeOpacity={0.85}
                >
                  <Text style={[styles.retryText, { color: colors.coral }]}>{t('rehearsalIncoming:call.retryOpening')}</Text>
                </TouchableOpacity>
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

            {lineTrimmed && (
              <Text style={[styles.lineNotice, { color: colors.secondary }]} accessibilityLiveRegion="polite">
                {t('rehearsalLive:chat.lineTrimmed')}
              </Text>
            )}

            {/* After a pause she chose to continue from, help stays one tap away. */}
            {hadSafetyBreak && !safetyBreak && (
              <TouchableOpacity onPress={() => router.push('/crisis-mode')} style={styles.getHelp} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.getHelpText, { color: colors.coral }]}>{t('rehearsalLive:chat.getHelpNow')} →</Text>
              </TouchableOpacity>
            )}

            {/* Typed fallback — same affordance as rehearsal-live */}
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.primaryDark, color: colors.white }]}
                placeholder={recording ? t('rehearsalLive:chat.listening') : t('rehearsalIncoming:call.placeholder')}
                placeholderTextColor={colors.inkSoft}
                value={draft}
                onChangeText={(value) => {
                  if (!value.trim()) pendingClipsRef.current = [];
                  if (lineTrimmed) setLineTrimmed(false);
                  setDraft(value);
                }}
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

            {recording && capture.nearLimit && (
              <Text style={[styles.lineNotice, { color: colors.secondary, textAlign: 'center' }]} accessibilityLiveRegion="polite">
                {t('rehearsalLive:chat.thirtySecondsLeft')}
              </Text>
            )}

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
              onPressIn={() => void startTalking()}
              onPressOut={() => void stopTalking()}
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
              style={[styles.hangupBtn, { backgroundColor: colors.coral, opacity: hangUpBlocked ? 0.5 : 1 }]}
              onPress={handleHangUp}
              disabled={hangUpBlocked}
              accessibilityRole="button"
              activeOpacity={0.85}
            >
              {debriefLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.hangupText}>
                  {safetyBreak ? t('rehearsalIncoming:call.endCall') : t('rehearsalIncoming:call.hangUp')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ---------- DEBRIEF ---------- */}
        {stage === 'debrief' && debrief && (
          <RehearsalDebrief
            debrief={debrief}
            onAgain={handleAgain}
            onDone={() => router.back()}
            onRedo={safetyBreak ? undefined : handleRedo}
            userTurnCount={messages.filter((m) => m.role === 'user').length}
            delivery={delivery}
          />
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
  lineNotice: { fontSize: 12, lineHeight: 17, marginBottom: 6 },
  getHelp: { alignItems: 'center', paddingBottom: 6 },
  getHelpText: { fontSize: 12, fontWeight: '700' },
  retryBtn: { alignSelf: 'center', borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9, marginTop: 10 },
  retryText: { fontSize: 14, fontWeight: '700' },
});
