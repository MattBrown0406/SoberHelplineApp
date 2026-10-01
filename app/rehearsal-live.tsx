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
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { RehearsalDebrief } from '../src/components/rehearsal/RehearsalDebrief';
import { useSpeechCapture } from '../src/components/rehearsal/useSpeechCapture';
import { PracticeHandoffPaywall } from '../src/components/rehearsal/PracticeHandoffPaywall';
import { SafetyBreakCard } from '../src/components/rehearsal/SafetyBreakCard';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { Gate } from '../src/components/auth/Gate';
import { RouteActivationGate } from '../src/contexts/RouteActivationContext';
import { useLovedOne } from '../src/hooks/useLovedOne';
import { useLovedOneProfile } from '../src/hooks/useLovedOneProfile';
import { useRehearsalCount } from '../src/hooks/useRehearsalCount';
import { appAlert } from '../src/lib/appAlert';
import { loadRecentRehearsalScores, saveRehearsalSession } from '../src/lib/rehearsalSessions';
import { practiceRelationship, toPracticeProfile, type PracticeProfile } from '../src/lib/practiceProfile';
import { peekPracticeText, releasePracticeText } from '../src/lib/practiceHandoffAuth';
import {
  activeFamilySpeakers,
  addSpeaker,
  memberRelationshipFor,
  MAX_FAMILY_SPEAKERS,
  removeSpeaker,
  SPEAKER_NAME_MAX,
  SPEAKER_RELATIONSHIPS,
  updateSpeaker,
  type FamilySpeaker,
} from '../src/lib/practiceFamily';
import { analyzeDelivery, clipsForText, type DeliveryReport, type VoiceClip } from '../src/lib/practiceDelivery';
import {
  recommendDifficulty,
  sessionScoresFromRows,
  suggestedStartingLevel,
  type DifficultyAdvice,
  type SessionScore,
} from '../src/lib/practiceDifficulty';
import { transcriptBeforeUserTurn } from '../src/lib/practiceReplay';
import { leavesConversation, stageAfterSafetyBreak } from '../src/lib/practiceSafety';
import {
  clampLine,
  cleanUrlText,
  formatCountdown,
  MAX_CLIP_MS,
  MAX_LINE_CHARS,
  MAX_READ_ALOUD_MS,
  parsePracticeParams,
  PARTNER_TEMPERAMENTS,
  PRACTICE_SITUATIONS,
  WARMUP_MAX_USER_TURNS,
  WARMUP_SECONDS,
  warmupShouldFinish,
  type PracticeSituation,
} from '../src/lib/practiceScenarios';
import {
  useRehearsalPartner,
  type PartnerDebrief,
  type PartnerTemperament,
  type PartnerGender,
  type PartnerAge,
  type PartnerRelationship,
} from '../src/hooks/useRehearsalPartner';

type Stage = 'setup' | 'chat' | 'debrief';

/** Everything that defines the partner for one session, frozen when it starts. */
type SessionSetup = {
  relationship: PartnerRelationship;
  gender: PartnerGender;
  age: PartnerAge;
  voiceOn: boolean;
  temperament: PartnerTemperament;
  warmup: boolean;
  whisper: boolean;
  name: string;
  partnerName: string;
  substances?: string[];
  profile?: PracticeProfile;
  situation?: PracticeSituation;
  speakers: FamilySpeaker[];
};

const TEMPERAMENTS: readonly PartnerTemperament[] = PARTNER_TEMPERAMENTS;
const RELATIONSHIPS: PartnerRelationship[] = ['spouse', 'partner', 'son', 'daughter', 'sibling', 'parent', 'friend'];
const GENDERS: PartnerGender[] = ['male', 'female'];
const AGES: PartnerAge[] = ['young', 'middle', 'older'];

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
  return <RouteActivationGate><Gate feature="aiRehearsal" fallback={<PracticeHandoffPaywall />}><RehearsalLiveContent /></Gate></RouteActivationGate>;
}

function RehearsalLiveContent() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('rehearsalLive');
  const router = useRouter();
  const params = useLocalSearchParams<{
    text?: string;
    sourceId?: string;
    temperament?: string;
    practiceText?: string;
    source?: string;
    warmup?: string;
    situation?: string;
    handoff?: string;
  }>();
  const { user } = useAccount();
  // Long practice text (the letter) arrives through an in-memory handoff, not
  // the URL — only for the account that stashed it. Read once, then released.
  const [handoff] = useState(() => peekPracticeText(params.handoff, user?.id));
  useEffect(() => {
    releasePracticeText(params.handoff);
  }, [params.handoff]);
  // Route params are untrusted strings (deep links, other screens): URL text is
  // capped and flattened to plain words before it can reach a prompt.
  const route = useMemo(
    () => parsePracticeParams(params, handoff),
    [params.practiceText, params.source, params.warmup, params.situation, params.temperament, handoff],
  );
  const scriptLine = useMemo(() => cleanUrlText(params.text).text, [params.text]);
  const { lovedOne } = useLovedOne(user?.id ?? null);
  const { profile } = useLovedOneProfile(user?.id ?? null);
  const practiceProfile = useMemo(() => toPracticeProfile(profile), [profile]);
  const { increment } = useRehearsalCount(params.sourceId ?? 'live-rehearsal');

  const [stage, setStage] = useState<Stage>('setup');
  const [warmup, setWarmup] = useState(route.warmup);
  const [whyExpanded, setWhyExpanded] = useState(false);
  // Scripts can suggest the mood that best matches their situation (e.g. the
  // relapse script opens against a Guilt-ridden partner). Still user-changeable.
  const [temperament, setTemperament] = useState<PartnerTemperament>(route.temperament ?? 'guarded');
  const [relationship, setRelationship] = useState<PartnerRelationship>(
    defaultRelationship(lovedOne?.relationship),
  );
  const [gender, setGender] = useState<PartnerGender>(defaultGender(defaultRelationship(lovedOne?.relationship)));
  const [age, setAge] = useState<PartnerAge>('middle');
  const [voiceOn, setVoiceOn] = useState(true);
  // "Use what I've told you about <name>" — on by default whenever a profile exists.
  const [useProfile, setUseProfile] = useState(true);
  const [situation, setSituation] = useState<PracticeSituation | null>(route.situation);
  const [familyOn, setFamilyOn] = useState(false);
  const [speakerDrafts, setSpeakerDrafts] = useState<FamilySpeaker[]>([]);
  const [currentSpeaker, setCurrentSpeaker] = useState(0);
  const [whisperOn, setWhisperOn] = useState(false);
  // Frozen at Start: who the partner is (persona, profile, voice, family) can't
  // change mid-session, e.g. when the profile finishes loading after Start.
  const [session, setSession] = useState<SessionSetup | null>(null);
  const [recentSessions, setRecentSessions] = useState<SessionScore[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(WARMUP_SECONDS);
  const [redo, setRedo] = useState<{ turn: number; item: string } | null>(null);
  const [delivery, setDelivery] = useState<DeliveryReport | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyAdvice | null>(null);
  const [recordTarget, setRecordTarget] = useState<'draft' | 'practice'>('draft');
  const [draft, setDraft] = useState('');
  const [lineTrimmed, setLineTrimmed] = useState(false);
  // A letter read aloud in more than one recording (the time limit paused her).
  const practicePartsRef = useRef<VoiceClip[]>([]);
  const [practiceParts, setPracticeParts] = useState(0);
  const draftRef = useRef('');
  draftRef.current = draft;
  const scrollRef = useRef<ScrollView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const recordTargetRef = useRef<'draft' | 'practice'>('draft');
  // Voice clips recorded since the last send; attached to the line they became.
  const pendingClipsRef = useRef<VoiceClip[]>([]);
  const redoFromRef = useRef<number | null>(null);
  const autoFinishRef = useRef(false);

  const profileActive = useProfile && !!practiceProfile;
  const profileRelationship = practiceRelationship(practiceProfile?.relationship);
  const preferredRelationship = (profileActive ? profileRelationship : null) ?? lovedOne?.relationship ?? null;

  // Follow the profile once it loads (the hooks load async) — setup only.
  useEffect(() => {
    if (preferredRelationship && stage === 'setup') {
      const rel = defaultRelationship(preferredRelationship);
      setRelationship(rel);
      setGender(defaultGender(rel));
    }
  }, [preferredRelationship]); // only the profile's arrival re-defaults the picker

  // Recent full sessions drive the difficulty suggestion (best-effort).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void loadRecentRehearsalScores(user.id).then((rows) => {
      if (!cancelled) setRecentSessions(sessionScoresFromRows(rows));
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  const language = i18n.language?.startsWith('es') ? 'es' : 'en';
  const realName = (profileActive ? practiceProfile?.name : undefined) || lovedOne?.first_name?.trim() || '';
  const profileName = practiceProfile?.name || lovedOne?.first_name?.trim() || t('defaultName');
  const practiceText = route.practiceText;
  const startSuggestion = useMemo(
    () => (route.temperament ? null : suggestedStartingLevel(recentSessions)),
    [route.temperament, recentSessions],
  );

  /** The setup as currently chosen on screen. */
  function currentSetup(speakers: FamilySpeaker[] = []): SessionSetup {
    return {
      relationship,
      gender,
      age,
      voiceOn,
      temperament,
      warmup,
      whisper: whisperOn,
      name: realName,
      partnerName: realName || t('defaultName'),
      substances: lovedOne?.substances ?? undefined,
      profile: profileActive && practiceProfile ? practiceProfile : undefined,
      situation: situation ?? undefined,
      speakers,
    };
  }
  // Before Start nothing is sent, so the live setup stands in; from Start on, the frozen one.
  const active = session ?? currentSetup();
  const partnerName = active.partnerName;
  const familyActive = active.speakers.length >= 2;
  const sessionSpeakers = active.speakers;

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
    hint,
    send,
    transcribeClip,
    requestDebrief,
    reset,
    restore,
  } = useRehearsalPartner(
    {
      relationship: active.relationship,
      name: active.name || undefined,
      substances: active.substances,
      temperament: active.temperament,
      scriptText: scriptLine ?? undefined,
      language,
      voice: active.voiceOn ? { gender: active.gender, age: active.age } : undefined,
      // The character keeps the chosen age and gender even when it isn't spoken.
      persona: { gender: active.gender, age: active.age },
      situation: active.situation,
      profile: active.profile,
      speakers: familyActive ? active.speakers : undefined,
      practiceText: practiceText ?? undefined,
      practiceSource: route.source ?? undefined,
      warmup: active.warmup,
    },
    undefined,
    { maxUserTurns: active.warmup ? WARMUP_MAX_USER_TURNS : undefined, whisper: active.whisper },
  );

  const userTurns = messages.filter((m) => m.role === 'user');
  const userTurnCount = userTurns.length;

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(id);
  }, [messages.length, sending]);

  async function persistSession(finished: PartnerDebrief, report: DeliveryReport | null) {
    if (!user?.id) return;
    // Save the session so the family can review their reps later.
    await saveRehearsalSession({
      account_id: user.id,
      source_id: typeof params.sourceId === 'string' ? params.sourceId : null,
      scenario: {
        relationship: active.relationship,
        temperament: active.temperament,
        gender: active.gender,
        age: active.age,
        language,
        partnerName: active.partnerName,
        ...(active.situation ? { situation: active.situation } : {}),
        ...(active.profile ? { profileUsed: true } : {}),
        ...(familyActive ? { speakers: active.speakers } : {}),
        ...(practiceText ? { practiceSource: route.source ?? 'script' } : {}),
        ...(active.warmup ? { warmup: true } : {}),
        ...(active.whisper ? { whisper: true } : {}),
        ...(redoFromRef.current !== null ? { redoFromTurn: redoFromRef.current } : {}),
      },
      transcript: messages.map(({ role, text, speaker }) =>
        role === 'user' && familyActive && typeof speaker === 'number'
          ? { role, text, speaker: active.speakers[speaker]?.name ?? '' }
          : { role, text }),
      debrief: { ...finished, delivery: report },
    });
  }

  // Each debrief is handled exactly once: count the rep, compute delivery and
  // the difficulty suggestion, show it, and save it.
  const handledDebriefRef = useRef<PartnerDebrief | null>(null);
  useEffect(() => {
    if (!debrief || handledDebriefRef.current === debrief) return;
    // Never coach — or save — a conversation that hit a crisis break.
    if (safetyBreak) return;
    handledDebriefRef.current = debrief;
    void increment();
    const spoken = messages.filter((m) => m.role === 'user');
    const report = analyzeDelivery(
      spoken.map((m) => ({ text: m.text, clips: m.clips })),
      language,
      { deliveredFirst: !!practiceText && spoken[0]?.text === practiceText.trim() },
    );
    setDelivery(report);
    if (active.warmup) {
      setDifficulty(null);
    } else {
      const current: SessionScore = { temperament: active.temperament, scores: debrief.scores };
      setDifficulty(recommendDifficulty(active.temperament, [current, ...recentSessions]));
      setRecentSessions((prev) => [current, ...prev]);
    }
    // Invalidate before the stage update commits (including pending creates).
    audioBlocked.current = true;
    stopAudio();
    setStage('debrief');
    void persistSession(debrief, report);
  }, [debrief]); // once per debrief: the session state it reads is final by then

  const audioGeneration = useRef(0);
  const audioActive = useRef(true);
  // Gate retained callbacks as well as the effect that starts each reply.
  const playbackBlocked = safetyBreak || stage !== 'chat' || !active.voiceOn;
  const audioBlocked = useRef(playbackBlocked);
  audioBlocked.current = playbackBlocked;
  const stopAudio = useCallback(() => {
    audioGeneration.current += 1;
    const sound = soundRef.current;
    soundRef.current = null;
    if (sound) void sound.unloadAsync().catch(() => undefined);
  }, []);
  useEffect(() => {
    audioActive.current = true;
    return () => {
      audioActive.current = false;
      stopAudio();
    };
  }, [stopAudio]);
  useEffect(() => {
    if (playbackBlocked) stopAudio();
  }, [playbackBlocked, stopAudio]);

  const clipCounter = useRef(0);
  const playAudio = useCallback(async (audioB64: string) => {
    if (!audioActive.current || audioBlocked.current) return;
    const generation = ++audioGeneration.current;
    const current = () => audioActive.current && !audioBlocked.current && generation === audioGeneration.current;
    let created: Audio.Sound | null = null;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      if (!current()) return;
      let uri: string;
      if (Platform.OS === 'web') {
        uri = `data:audio/mpeg;base64,${audioB64}`;
      } else {
        clipCounter.current += 1;
        uri = `${FileSystem.cacheDirectory}rehearsal-reply-${clipCounter.current}.mp3`;
        await FileSystem.writeAsStringAsync(uri, audioB64, { encoding: FileSystem.EncodingType.Base64 });
      }
      if (!current()) return;
      const previous = soundRef.current;
      soundRef.current = null;
      if (previous) await previous.unloadAsync();
      if (!current()) return;
      // Never autoplay: native loading can finish after teardown or a crisis break.
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: false });
      created = sound;
      if (!current()) { await sound.unloadAsync(); return; }
      soundRef.current = sound;
      await sound.playAsync();
      if (!current()) await sound.unloadAsync();
    } catch {
      if (created) {
        if (soundRef.current === created) soundRef.current = null;
        await created.unloadAsync().catch(() => undefined);
      }
      // Voice is a layer, never a blocker — the text is already on screen.
    }
  }, []);

  // Speak each partner reply the moment it lands on screen — this is a dialogue.
  // (The whisper coach's hint is text-only and never spoken.)
  const lastSpokenIndex = useRef(-1);
  useEffect(() => {
    if (safetyBreak || stage !== 'chat' || !active.voiceOn || messages.length === 0) return;
    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    if (last.role === 'partner' && last.audio && lastIndex > lastSpokenIndex.current) {
      lastSpokenIndex.current = lastIndex;
      void playAudio(last.audio);
    }
  }, [messages, stage, active.voiceOn, playAudio, safetyBreak]);

  // Warm-up: a 90-second clock that ends the rep on its own — stopped for good
  // by a crisis break, so the crisis card stays on screen.
  useEffect(() => {
    if (!active.warmup || stage !== 'chat' || safetyBreak) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [active.warmup, stage, safetyBreak]);

  const capture = useSpeechCapture({
    // A clip recorded from the practice card is the member reading their letter.
    transcribe: (b64, format) => transcribeClip(b64, format, recordTargetRef.current === 'practice' ? 'delivery' : undefined),
    onPermissionDenied: () => appAlert(t('chat.micPermissionTitle'), t('chat.micPermissionBody')),
    onRecordingError: () => appAlert(t('chat.recordingErrorTitle'), t('chat.recordingErrorBody')),
    onAutoStop: (clip) => handleClip(clip, true),
    onUnavailable: () => appAlert(t('chat.voiceUnavailableTitle'), t('chat.voiceUnavailableBody')),
    onTooLong: () => appAlert(t('chat.recordingTooLongTitle'), t('chat.recordingTooLongBody')),
  });

  // Leaving the chat (coaching appears): no live mic, no stray transcript, no
  // leftover draft — the hold bar may unmount mid-press without a release.
  useEffect(() => {
    if (!leavesConversation(stage, 'chat')) return;
    void capture.cancel();
    pendingClipsRef.current = [];
    practicePartsRef.current = [];
    setPracticeParts(0);
    setDraft('');
    setLineTrimmed(false);
  }, [stage]); // capture.cancel is stable

  // A pause that lands while coaching is showing brings the crisis card back.
  useEffect(() => {
    const next = stageAfterSafetyBreak(stage, safetyBreak, 'debrief', 'chat');
    if (next !== stage) setStage(next);
  }, [safetyBreak, stage]);

  const lastRole = messages.length ? messages[messages.length - 1].role : null;
  useEffect(() => {
    if (!active.warmup || stage !== 'chat' || autoFinishRef.current) return;
    const busy = sending || transcribing || capture.recording || debriefLoading || draft.trim().length > 0;
    if (warmupShouldFinish({ secondsLeft, userTurns: userTurnCount, lastRole, busy, safetyBreak })) {
      autoFinishRef.current = true;
      void requestDebrief();
    }
  }, [active.warmup, stage, secondsLeft, userTurnCount, lastRole, sending, transcribing, capture.recording, debriefLoading, draft, safetyBreak, requestDebrief]);

  function speakerMeta(): { speaker?: number } {
    return familyActive ? { speaker: Math.min(currentSpeaker, sessionSpeakers.length - 1) } : {};
  }

  async function handleSend() {
    const outgoing = draft.trim();
    if (!outgoing) return;
    const pending = pendingClipsRef.current;
    pendingClipsRef.current = [];
    setDraft('');
    setLineTrimmed(false);
    setRedo(null);
    const result = await send(outgoing, { ...speakerMeta(), clips: clipsForText(pending, outgoing) });
    // If the send failed, put their words back — never make someone retype
    // a sentence that was hard to say the first time.
    if (!result.ok) {
      setDraft((prev) => (prev ? prev : outgoing));
      pendingClipsRef.current = pending;
    }
  }

  /**
   * The prepared letter/invitation goes out exactly as written. When it was
   * read aloud, what was actually said rides along as screening-only text, so
   * anything said mid-reading is still checked for a crisis.
   */
  async function deliverPracticeText(clips: VoiceClip[] = []) {
    if (!practiceText) return;
    setRedo(null);
    const spoken = clips.map((c) => c.transcript).join(' ').trim();
    const result = await send(practiceText, { ...speakerMeta(), clips, ...(spoken ? { screeningText: spoken } : {}) });
    if (result.ok) {
      practicePartsRef.current = [];
      setPracticeParts(0);
    }
  }

  /**
   * "Done — send it": every part she has read so far goes out together. The
   * last part is kept first, so a failed send never loses what she just read.
   */
  function deliverReadParts(lastClip?: VoiceClip) {
    if (lastClip) {
      practicePartsRef.current = [...practicePartsRef.current, lastClip];
      setPracticeParts(practicePartsRef.current.length);
    }
    void deliverPracticeText([...practicePartsRef.current]);
  }

  function handleClip(clip: VoiceClip, autoStopped = false) {
    if (recordTargetRef.current === 'practice') {
      if (autoStopped) {
        // The time limit cut her off mid-reading: keep what she read as a part
        // and let her carry on. Nothing is sent until she taps Done.
        practicePartsRef.current = [...practicePartsRef.current, clip];
        setPracticeParts(practicePartsRef.current.length);
        return;
      }
      deliverReadParts(clip);
      return;
    }
    pendingClipsRef.current.push(clip);
    // A long recording can run past one line: keep the first part and say so.
    // (The server already screened the whole transcript when it was made.)
    const current = draftRef.current;
    const fitted = clampLine(current ? `${current} ${clip.transcript}` : clip.transcript, MAX_LINE_CHARS);
    if (fitted.clamped) setLineTrimmed(true);
    setDraft(fitted.text);
  }

  async function startTalking(target: 'draft' | 'practice' = 'draft') {
    recordTargetRef.current = target;
    setRecordTarget(target);
    await capture.start(target === 'practice' ? MAX_READ_ALOUD_MS : MAX_CLIP_MS);
  }

  async function stopTalking() {
    const clip = await capture.stop();
    if (clip) handleClip(clip);
  }

  function handleStart() {
    const speakers = familyOn ? activeFamilySpeakers(speakerDrafts) : [];
    if (familyOn && speakers.length < 2) {
      appAlert(t('family.needTwoTitle'), t('family.needTwo'));
      return;
    }
    setSession(currentSetup(speakers));
    setCurrentSpeaker(0);
    setSecondsLeft(WARMUP_SECONDS);
    autoFinishRef.current = false;
    redoFromRef.current = null;
    setStage('chat');
  }

  function toggleFamily() {
    if (!familyOn && speakerDrafts.length === 0) {
      setSpeakerDrafts([
        { name: user?.firstName?.trim() || t('family.me'), relationship: memberRelationshipFor(relationship) },
        { name: '', relationship: 'other' },
      ]);
    }
    setFamilyOn((on) => !on);
  }

  // Coaching only once nothing is in flight: a last line still being answered
  // or transcribed may yet turn out to be a crisis disclosure.
  const finishBlocked = safetyBreak || sending || transcribing || capture.recording || debriefLoading;

  function handleFinish() {
    if (finishBlocked) return;
    void requestDebrief();
  }

  function clearSessionState() {
    stopAudio();
    // New session: its replies start at index 1 again and must be voiced.
    lastSpokenIndex.current = -1;
    redoFromRef.current = null;
    pendingClipsRef.current = [];
    autoFinishRef.current = false;
    setRedo(null);
    setDelivery(null);
    setDifficulty(null);
    setDraft('');
    setLineTrimmed(false);
    practicePartsRef.current = [];
    setPracticeParts(0);
    setSecondsLeft(WARMUP_SECONDS);
    setCurrentSpeaker(0);
    reset();
  }

  /**
   * "I'm safe — keep practicing": the flagged line leaves the conversation,
   * input reopens, and replies already heard aren't replayed.
   */
  function handleKeepPracticing() {
    const kept = keepPracticing();
    if (kept === null) return;
    lastSpokenIndex.current = kept - 1;
    pendingClipsRef.current = [];
    autoFinishRef.current = false;
    setLineTrimmed(false);
  }

  function handleAgain() {
    // A crisis break is never cleared out from under the member: back to the card.
    if (safetyBreak) {
      setStage('chat');
      return;
    }
    clearSessionState();
    setSession(null);
    setStage('setup');
  }

  /** "Ready for a tougher conversation?" — same setup, new level, straight back in. */
  function handleChangeDifficulty(level: PartnerTemperament) {
    if (safetyBreak) {
      setStage('chat');
      return;
    }
    clearSessionState();
    setTemperament(level);
    setSession((s) => ({ ...(s ?? currentSetup()), temperament: level }));
    setStage('chat');
  }

  /** "Redo from here": rewind to just before the line the coaching is about. */
  function handleRedo(userTurnIndex: number, item: string) {
    const before = transcriptBeforeUserTurn(messages, userTurnIndex);
    if (!before) return;
    stopAudio();
    const original = messages.filter((m) => m.role === 'user')[userTurnIndex];
    pendingClipsRef.current = [];
    autoFinishRef.current = false;
    // Replies already heard are not replayed when the conversation resumes.
    lastSpokenIndex.current = before.length - 1;
    redoFromRef.current = userTurnIndex;
    restore(before);
    practicePartsRef.current = [];
    setPracticeParts(0);
    setRedo({ turn: userTurnIndex, item });
    setDraft('');
    setLineTrimmed(false);
    setDelivery(null);
    setDifficulty(null);
    if (active.warmup) setSecondsLeft(WARMUP_SECONDS);
    if (familyActive && typeof original?.speaker === 'number') setCurrentSpeaker(original.speaker);
    setStage('chat');
  }

  // Nothing new can be said while the coach is reading the conversation.
  const inputLocked = sending || turnsLeft === 0 || safetyBreak || debriefLoading;
  const practiceRecording = capture.recording && recordTarget === 'practice';
  const showPracticeCard = !!practiceText && userTurnCount === 0 && !safetyBreak;
  const practiceLabel = route.source === 'letter'
    ? t('practice.letterLabel')
    : route.source === 'invitation'
      ? t('practice.invitationLabel')
      : t('practice.textLabel');

  const chip = (selected: boolean) => [
    styles.chip,
    { backgroundColor: selected ? colors.primary : colors.primaryDark, borderColor: selected ? colors.coral : 'transparent' },
  ];

  return (
    <ScreenContainer backgroundColor={colors.ink}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {/* Back */}
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={12} accessibilityRole="button">
          <Text style={[styles.backText, { color: colors.inkSoft }]}>‹ {t('title')}</Text>
        </TouchableOpacity>

        {/* ---------- SETUP: WARM-UP ---------- */}
        {stage === 'setup' && warmup && (
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.heading}>{t('warmup.heading')}</Text>
            <Text style={[styles.subheading, { color: colors.inkSoft }]}>{t('warmup.body', { name: partnerName })}</Text>

            {practiceProfile && (
              <TouchableOpacity
                style={[styles.voiceToggle, { backgroundColor: profileActive ? colors.primary : colors.primaryDark }]}
                onPress={() => setUseProfile((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: profileActive }}
                activeOpacity={0.85}
              >
                <Text style={[styles.voiceToggleText, { color: colors.white }]}>
                  {profileActive ? t('setup.profileToggleOn', { name: profileName }) : t('setup.profileToggleOff', { name: profileName })}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.bigBtn, { backgroundColor: colors.coral, marginTop: 12 }]}
              onPress={handleStart}
              accessibilityRole="button"
              activeOpacity={0.85}
            >
              <Text style={styles.bigBtnText}>{t('warmup.start')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setWarmup(false)} style={styles.historyLink} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.historyLinkText, { color: colors.inkSoft }]}>{t('setup.fullPracticeLink')} →</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ---------- SETUP ---------- */}
        {stage === 'setup' && !warmup && (
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>{t('setup.heading', { name: partnerName })}</Text>
            <Text style={[styles.subheading, { color: colors.inkSoft }]}>{t('setup.body')}</Text>
            <TouchableOpacity onPress={() => setWarmup(true)} style={styles.historyLink} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.historyLinkText, { color: colors.inkSoft }]}>{t('setup.warmupLink')} →</Text>
            </TouchableOpacity>


            {/* Their loved one, in their own words */}
            {practiceProfile && (
              <TouchableOpacity
                style={[styles.profileCard, { backgroundColor: profileActive ? colors.primary : colors.primaryDark, borderColor: profileActive ? colors.coral : 'transparent' }]}
                onPress={() => setUseProfile((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: profileActive }}
                activeOpacity={0.85}
              >
                <Text style={[styles.profileTitle, { color: colors.white }]}>
                  {profileActive ? t('setup.profileToggleOn', { name: profileName }) : t('setup.profileToggleOff', { name: profileName })}
                </Text>
                <Text style={[styles.profileHint, { color: colors.inkSoft }]}>{t('setup.profileToggleHint')}</Text>
              </TouchableOpacity>
            )}

            {/* What they'll practice delivering */}
            {practiceText && (
              <View style={[styles.openingCard, { backgroundColor: colors.primaryDark, borderLeftColor: colors.coral }]}>
                <Text style={[styles.openingLabel, { color: colors.inkSoft }]}>{practiceLabel}</Text>
                <Text style={[styles.openingText, { color: colors.white }]} numberOfLines={4}>{practiceText}</Text>
                {route.practiceTextTruncated && (
                  <Text style={[styles.truncatedNote, { color: colors.secondary }]}>{t('practice.truncated')}</Text>
                )}
              </View>
            )}

            {/* Relationship */}
            <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>{t('setup.relationshipLabel')}</Text>
            <View style={styles.chipWrap}>
              {RELATIONSHIPS.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={chip(relationship === key)}
                  onPress={() => {
                    setRelationship(key);
                    setGender(defaultGender(key));
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: relationship === key }}
                  aria-checked={relationship === key}
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
                  style={chip(gender === key)}
                  onPress={() => setGender(key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: gender === key }}
                  aria-checked={gender === key}
                  activeOpacity={0.85}
                >
                  <Text style={styles.chipText}>{t(`genders.${key}`)}</Text>
                </TouchableOpacity>
              ))}
              {AGES.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={chip(age === key)}
                  onPress={() => setAge(key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: age === key }}
                  aria-checked={age === key}
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
              accessibilityRole="switch"
              accessibilityState={{ checked: voiceOn }}
              activeOpacity={0.85}
            >
              <Text style={[styles.voiceToggleText, { color: colors.white }]}>
                {voiceOn ? t('setup.voiceOn') : t('setup.voiceOff')}
              </Text>
            </TouchableOpacity>

            {/* Temperament — the difficulty ladder */}
            <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>{t('setup.temperamentLabel')}</Text>
            {startSuggestion && startSuggestion.suggested !== temperament && (
              <TouchableOpacity
                onPress={() => setTemperament(startSuggestion.suggested)}
                style={[styles.suggestion, { borderColor: colors.coral }]}
                accessibilityRole="button"
                activeOpacity={0.85}
              >
                <Text style={[styles.suggestionText, { color: colors.white }]}>
                  {t('setup.suggestedLevel', { level: t(`temperaments.${startSuggestion.suggested}.title`) })}
                </Text>
              </TouchableOpacity>
            )}
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
                accessibilityRole="radio"
                accessibilityState={{ checked: temperament === key }}
                aria-checked={temperament === key}
                activeOpacity={0.85}
              >
                <Text style={styles.temperamentTitle}>{t(`temperaments.${key}.title`)}</Text>
                <Text style={[styles.temperamentDesc, { color: colors.inkSoft }]}>
                  {t(`temperaments.${key}.desc`)}
                </Text>
              </TouchableOpacity>
            ))}

            {/* Situation */}
            <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>{t('setup.situationLabel')}</Text>
            <View style={styles.chipWrap}>
              <TouchableOpacity
                style={chip(situation === null)}
                onPress={() => setSituation(null)}
                accessibilityRole="radio"
                accessibilityState={{ checked: situation === null }}
                aria-checked={situation === null}
                activeOpacity={0.85}
              >
                <Text style={styles.chipText}>{t('situations.none')}</Text>
              </TouchableOpacity>
              {PRACTICE_SITUATIONS.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={chip(situation === key)}
                  onPress={() => setSituation(key)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: situation === key }}
                  aria-checked={situation === key}
                  activeOpacity={0.85}
                >
                  <Text style={styles.chipText}>{t(`situations.${key}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.situationDesc, { color: colors.inkSoft }]}>
              {t(`situationDesc.${situation ?? 'none'}`)}
            </Text>

            {/* Family rehearsal */}
            <TouchableOpacity
              style={[styles.voiceToggle, { backgroundColor: familyOn ? colors.primary : colors.primaryDark }]}
              onPress={toggleFamily}
              accessibilityRole="switch"
              accessibilityState={{ checked: familyOn }}
              activeOpacity={0.85}
            >
              <Text style={[styles.voiceToggleText, { color: colors.white }]}>
                {familyOn ? t('setup.familyToggleOn') : t('setup.familyToggleOff')}
              </Text>
            </TouchableOpacity>
            {familyOn && (
              <View style={[styles.familyCard, { backgroundColor: colors.primaryDark }]}>
                <Text style={[styles.familyHeading, { color: colors.white }]}>{t('family.heading')}</Text>
                <Text style={[styles.familyBody, { color: colors.inkSoft }]}>{t('family.body', { name: partnerName })}</Text>
                {speakerDrafts.map((speaker, index) => (
                  <View key={index} style={[styles.speakerRow, { borderTopColor: colors.ink }]}>
                    <View style={styles.speakerNameRow}>
                      <TextInput
                        style={[styles.speakerInput, { backgroundColor: colors.ink, color: colors.white }]}
                        value={speaker.name}
                        onChangeText={(name) => setSpeakerDrafts((list) => updateSpeaker(list, index, { name }))}
                        placeholder={t('family.namePlaceholder')}
                        placeholderTextColor={colors.inkSoft}
                        maxLength={SPEAKER_NAME_MAX}
                        accessibilityLabel={t('family.nameLabel', { number: index + 1 })}
                      />
                      {speakerDrafts.length > 1 && (
                        <TouchableOpacity
                          onPress={() => setSpeakerDrafts((list) => removeSpeaker(list, index))}
                          accessibilityRole="button"
                          accessibilityLabel={t('family.removeLabel', { name: speaker.name || t('family.namePlaceholder') })}
                          style={styles.removeButton}
                          hitSlop={8}
                        >
                          <Text style={[styles.removeText, { color: colors.coral }]}>{t('family.remove')}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.chipWrapTight}>
                      {SPEAKER_RELATIONSHIPS.map((key) => (
                        <TouchableOpacity
                          key={key}
                          style={[styles.smallChip, { backgroundColor: speaker.relationship === key ? colors.primary : colors.ink, borderColor: speaker.relationship === key ? colors.coral : 'transparent' }]}
                          onPress={() => setSpeakerDrafts((list) => updateSpeaker(list, index, { relationship: key }))}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: speaker.relationship === key }}
                          aria-checked={speaker.relationship === key}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.smallChipText}>{t(`family.relationships.${key}`)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
                {speakerDrafts.length < MAX_FAMILY_SPEAKERS && (
                  <TouchableOpacity
                    onPress={() => setSpeakerDrafts((list) => addSpeaker(list, { name: '', relationship: 'other' }))}
                    style={styles.addSpeaker}
                    accessibilityRole="button"
                    hitSlop={8}
                  >
                    <Text style={[styles.addSpeakerText, { color: colors.coral }]}>{t('family.add')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Whisper coach */}
            <TouchableOpacity
              style={[styles.voiceToggle, { backgroundColor: whisperOn ? colors.primary : colors.primaryDark }]}
              onPress={() => setWhisperOn((v) => !v)}
              accessibilityRole="switch"
              accessibilityState={{ checked: whisperOn }}
              activeOpacity={0.85}
            >
              <Text style={[styles.voiceToggleText, { color: colors.white }]}>
                {whisperOn ? t('setup.whisperToggleOn') : t('setup.whisperToggleOff')}
              </Text>
            </TouchableOpacity>

            {/* Why practice works — the heart of the tool */}
            <View style={[styles.whyCard, { backgroundColor: colors.primaryDark, borderLeftColor: colors.coral }]}>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: whyExpanded }} aria-expanded={whyExpanded} onPress={() => setWhyExpanded((value) => !value)} style={styles.disclosureButton}>
                <Text style={[styles.whyTitle, { color: colors.white }]}>{t('setup.whyTitle')} {whyExpanded ? '−' : '+'}</Text>
              </TouchableOpacity>
              {whyExpanded && <Text style={[styles.whyBody, { color: colors.inkSoft }]}>{t('setup.whyBody')}</Text>}
            </View>

            <Text style={[styles.reassurance, { color: colors.inkSoft }]}>{t('setup.reassurance')}</Text>

            <TouchableOpacity
              style={[styles.bigBtn, { backgroundColor: colors.coral }]}
              onPress={handleStart}
              accessibilityRole="button"
              activeOpacity={0.85}
            >
              <Text style={styles.bigBtnText}>{t('setup.startButton')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/rehearsal-history')} style={styles.historyLink} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.historyLinkText, { color: colors.inkSoft }]}>{t('setup.pastSessions')} →</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* ---------- CHAT ---------- */}
        {stage === 'chat' && (
          <View style={styles.flex}>
            {active.warmup && (
              <Text
                style={[styles.timer, { color: secondsLeft > 0 ? colors.white : colors.coral }]}
                accessibilityLiveRegion="polite"
              >
                {secondsLeft > 0 ? t('warmup.timer', { time: formatCountdown(secondsLeft) }) : t('warmup.timeUp')}
              </Text>
            )}
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={styles.chatContent}
              showsVerticalScrollIndicator={false}
            >
              {redo && (
                <View style={[styles.redoBanner, { backgroundColor: colors.primaryDark, borderLeftColor: colors.green }]}>
                  <Text style={[styles.openingLabel, { color: colors.inkSoft }]}>{t('chat.redoLabel')}</Text>
                  <Text style={[styles.redoBannerText, { color: colors.white }]}>{redo.item}</Text>
                </View>
              )}
              {!!scriptLine && (
                <TouchableOpacity
                  style={[styles.openingCard, { backgroundColor: colors.primaryDark, borderLeftColor: colors.coral }]}
                  onPress={() => setDraft(scriptLine)}
                  accessibilityRole="button"
                  activeOpacity={0.85}
                >
                  <Text style={[styles.openingLabel, { color: colors.inkSoft }]}>{t('chat.openingLabel')}</Text>
                  <Text style={[styles.openingText, { color: colors.white }]}>"{scriptLine}"</Text>
                </TouchableOpacity>
              )}

              {/* Rehearse the real thing: deliver the exact words */}
              {showPracticeCard && practiceText && (
                <View style={[styles.practiceCard, { backgroundColor: colors.primaryDark, borderLeftColor: colors.coral }]}>
                  <Text style={[styles.openingLabel, { color: colors.inkSoft }]}>{practiceLabel}</Text>
                  <ScrollView style={styles.practiceScroll} nestedScrollEnabled>
                    <Text style={[styles.practiceText, { color: colors.white }]}>{practiceText}</Text>
                  </ScrollView>
                  {route.practiceTextTruncated && (
                    <Text style={[styles.practiceHelp, { color: colors.secondary }]}>{t('practice.truncated')}</Text>
                  )}
                  <Text style={[styles.practiceHelp, { color: colors.inkSoft }]}>
                    {practiceParts > 0 ? t('practice.paused') : t('practice.instructions', { name: partnerName })}
                  </Text>
                  {practiceRecording && capture.nearLimit && (
                    <Text style={[styles.practiceHelp, { color: colors.secondary }]} accessibilityLiveRegion="polite">
                      {t('chat.thirtySecondsLeft')}
                    </Text>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.practiceBtn,
                      { backgroundColor: practiceRecording ? colors.coral : colors.primary, opacity: inputLocked || (transcribing && recordTarget === 'practice') ? 0.5 : 1 },
                    ]}
                    onPress={() => void (practiceRecording ? stopTalking() : startTalking('practice'))}
                    disabled={inputLocked || transcribing || (capture.recording && !practiceRecording)}
                    accessibilityRole="button"
                    activeOpacity={0.85}
                  >
                    {transcribing && recordTarget === 'practice' ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.practiceBtnText}>
                        {practiceRecording
                          ? t('practice.doneReading')
                          : practiceParts > 0 ? t('practice.keepReading') : t('practice.readAloud')}
                      </Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => (practiceParts > 0 ? deliverReadParts() : void deliverPracticeText())}
                    disabled={inputLocked || capture.recording || transcribing}
                    style={styles.practiceSecondary}
                    accessibilityRole="button"
                    hitSlop={8}
                  >
                    <Text style={[styles.historyLinkText, { color: colors.inkSoft }]}>
                      {practiceParts > 0 ? t('practice.doneSendParts') : t('practice.sendAsWritten')}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={[styles.chatIntro, { color: colors.inkSoft }]}>
                {familyActive ? t('chat.introFamily', { name: partnerName }) : t('chat.intro', { name: partnerName })}
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
                  {m.role === 'user' && familyActive && typeof m.speaker === 'number' && (
                    <Text style={[styles.speakerTag, { color: colors.primaryLight }]}>
                      {sessionSpeakers[m.speaker]?.name}
                    </Text>
                  )}
                  <Text style={styles.bubbleText}>{m.text}</Text>
                  {m.role === 'partner' && m.audio && (
                    <TouchableOpacity onPress={() => void playAudio(m.audio!)} hitSlop={8} accessibilityRole="button">
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
                <SafetyBreakCard kind={safetyKind} onKeepPracticing={canKeepPracticing ? handleKeepPracticing : undefined} />
              )}

              {error && (
                <Text style={[styles.errorText, { color: colors.coral }]}>{error === 'daily_limit_reached' ? t('chat.dailyLimit') : t('chat.error')}</Text>
              )}
            </ScrollView>

            <Text style={[styles.turnsNote, { color: colors.inkSoft }]}>
              {turnsLeft > 0 ? t('chat.turnsLeft', { count: turnsLeft }) : t('chat.turnsDone')}
            </Text>

            {/* After a pause she chose to continue from, help stays one tap away. */}
            {hadSafetyBreak && !safetyBreak && (
              <TouchableOpacity onPress={() => router.push('/crisis-mode')} style={styles.getHelp} accessibilityRole="button" hitSlop={8}>
                <Text style={[styles.getHelpText, { color: colors.coral }]}>{t('chat.getHelpNow')} →</Text>
              </TouchableOpacity>
            )}

            {/* Whisper coach — quiet, text only, never spoken */}
            {active.whisper && !!hint && !safetyBreak && (
              <Text
                style={[styles.hint, { color: colors.inkSoft, borderLeftColor: colors.secondary }]}
                accessibilityLiveRegion="polite"
              >
                <Text style={styles.hintLabel}>{t('chat.coachHintLabel')} </Text>
                {hint}
              </Text>
            )}

            {lineTrimmed && (
              <Text style={[styles.lineNotice, { color: colors.secondary }]} accessibilityLiveRegion="polite">
                {t('chat.lineTrimmed')}
              </Text>
            )}

            {/* Family rehearsal: who is speaking this line */}
            {familyActive && (
              <View style={styles.speakerBar}>
                <Text style={[styles.speakerBarLabel, { color: colors.inkSoft }]}>{t('family.speaking')}</Text>
                {sessionSpeakers.map((speaker, index) => (
                  <TouchableOpacity
                    key={`${speaker.name}-${index}`}
                    style={[styles.smallChip, { backgroundColor: currentSpeaker === index ? colors.primary : colors.primaryDark, borderColor: currentSpeaker === index ? colors.coral : 'transparent' }]}
                    onPress={() => setCurrentSpeaker(index)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: currentSpeaker === index }}
                    aria-checked={currentSpeaker === index}
                    accessibilityLabel={t('family.speakerLabel', { name: speaker.name })}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.smallChipText}>{speaker.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, { backgroundColor: colors.primaryDark, color: colors.white }]}
                placeholder={capture.recording && !practiceRecording ? t('chat.listening') : t('chat.placeholder')}
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
                accessibilityLabel={t('chat.placeholder')}
              />
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  { backgroundColor: colors.coral, opacity: draft.trim() && !inputLocked ? 1 : 0.4 },
                ]}
                onPress={() => void handleSend()}
                disabled={!draft.trim() || inputLocked}
                accessibilityRole="button"
                activeOpacity={0.85}
              >
                <Text style={styles.sendBtnText}>{t('chat.send')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[
                styles.finishBtn,
                { borderColor: colors.inkSoft, opacity: userTurnCount > 0 && !finishBlocked ? 1 : 0.4 },
              ]}
              onPress={handleFinish}
              // After a crisis break there is no coaching: the crisis card stays the focus.
              disabled={userTurnCount === 0 || finishBlocked}
              accessibilityRole="button"
              activeOpacity={0.85}
            >
              {debriefLoading ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={[styles.finishBtnText, { color: colors.white }]}>{t('chat.finishButton')}</Text>
              )}
            </TouchableOpacity>

            {capture.recording && !practiceRecording && capture.nearLimit && (
              <Text style={[styles.lineNotice, { color: colors.secondary, textAlign: 'center' }]} accessibilityLiveRegion="polite">
                {t('chat.thirtySecondsLeft')}
              </Text>
            )}

            {/* Hold to speak — pinned to the bottom where the thumb lives */}
            <TouchableOpacity
              style={[
                styles.holdBar,
                {
                  backgroundColor: capture.recording && !practiceRecording ? colors.coral : colors.primaryDark,
                  borderColor: colors.coral,
                  opacity: inputLocked || transcribing || practiceRecording ? 0.4 : 1,
                },
              ]}
              onPressIn={() => void startTalking('draft')}
              onPressOut={() => void stopTalking()}
              disabled={inputLocked || transcribing || practiceRecording}
              accessibilityRole="button"
              accessibilityLabel={t('chat.holdToSpeak')}
              activeOpacity={0.9}
              pressRetentionOffset={{ top: 200, bottom: 200, left: 200, right: 200 }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              {transcribing && recordTarget === 'draft' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.holdBarText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                  {capture.recording && !practiceRecording ? `●  ${t('chat.releaseWhenDone')}` : `🎤  ${t('chat.holdToSpeak')}`}
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
            userTurnCount={userTurnCount}
            delivery={delivery}
            difficulty={difficulty}
            onChangeDifficulty={handleChangeDifficulty}
            variant={active.warmup ? 'warmup' : 'standard'}
          />
        )}

        {/* Privacy / reality note (setup and debrief — the chat keeps the bar at the very bottom) */}
        {stage !== 'chat' && (
          <Text style={[styles.privacyNote, { color: colors.inkSoft }]}>{t('privacyNote')}</Text>
        )}
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backRow: { minHeight: 44, minWidth: 44, justifyContent: 'center', marginBottom: 16 },
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
  disclosureButton: { minHeight: 44, justifyContent: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chipWrapTight: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { minHeight: 44, justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  smallChip: { minHeight: 44, justifyContent: 'center', borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 5 },
  smallChipText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  voiceToggle: { minHeight: 44, justifyContent: 'center', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', marginBottom: 14 },
  voiceToggleText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  profileCard: { borderRadius: 14, borderWidth: 1.5, padding: 14, marginBottom: 16 },
  profileTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  profileHint: { fontSize: 12, lineHeight: 17 },
  suggestion: { minHeight: 44, justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', paddingVertical: 9, paddingHorizontal: 12, marginBottom: 10 },
  suggestionText: { fontSize: 13, fontWeight: '600' },
  situationDesc: { fontSize: 12, lineHeight: 18, marginTop: -6, marginBottom: 16 },
  familyCard: { borderRadius: 14, padding: 14, marginTop: -6, marginBottom: 14 },
  familyHeading: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  familyBody: { fontSize: 12, lineHeight: 17, marginBottom: 6 },
  speakerRow: { borderTopWidth: 1, paddingTop: 10, marginTop: 8 },
  speakerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  speakerInput: { flex: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  removeButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  removeText: { fontSize: 12, fontWeight: '600' },
  addSpeaker: { minHeight: 44, justifyContent: 'center', paddingTop: 12, alignItems: 'flex-start' },
  addSpeakerText: { fontSize: 13, fontWeight: '700' },
  temperamentCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 10,
  },
  temperamentTitle: { color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  temperamentDesc: { fontSize: 13, lineHeight: 18 },
  reassurance: { fontSize: 12, lineHeight: 18, marginTop: 12, marginBottom: 16 },
  bigBtn: { minHeight: 44, justifyContent: 'center', borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginBottom: 12 },
  bigBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  timer: { fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  chatContent: { paddingBottom: 12 },
  chatIntro: { fontSize: 13, lineHeight: 19, marginBottom: 16, textAlign: 'center' },
  openingCard: {
    borderRadius: 14,
    borderLeftWidth: 3,
    padding: 14,
    marginBottom: 12,
  },
  openingLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  openingText: { fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  redoBanner: { borderRadius: 14, borderLeftWidth: 3, padding: 12, marginBottom: 12 },
  redoBannerText: { fontSize: 13, lineHeight: 19 },
  practiceCard: { borderRadius: 14, borderLeftWidth: 3, padding: 14, marginBottom: 12 },
  practiceScroll: { maxHeight: 220, marginBottom: 8 },
  practiceText: { fontSize: 15, lineHeight: 23 },
  practiceHelp: { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  practiceBtn: { borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  practiceBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  practiceSecondary: { alignItems: 'center', paddingTop: 10 },
  bubble: { borderRadius: 16, padding: 12, marginBottom: 8, maxWidth: '85%' },
  bubbleUser: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubblePartner: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  speakerTag: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 3 },
  replayText: { fontSize: 11, marginTop: 6 },
  errorText: { fontSize: 12, textAlign: 'center', marginTop: 6 },
  turnsNote: { fontSize: 11, textAlign: 'center', marginBottom: 6 },
  lineNotice: { fontSize: 12, lineHeight: 17, marginBottom: 6 },
  getHelp: { alignItems: 'center', paddingBottom: 6 },
  getHelpText: { fontSize: 12, fontWeight: '700' },
  truncatedNote: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  hint: { fontSize: 12, lineHeight: 17, fontStyle: 'italic', borderLeftWidth: 2, paddingLeft: 8, marginBottom: 6 },
  hintLabel: { fontWeight: '700', fontStyle: 'normal' },
  speakerBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 6 },
  speakerBarLabel: { fontSize: 11, fontWeight: '700' },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 4 },
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
  whyCard: {
    borderRadius: 14,
    borderLeftWidth: 3,
    padding: 16,
    marginTop: 4,
    marginBottom: 4,
  },
  whyTitle: { fontWeight: '700', fontSize: 15, marginBottom: 6 },
  whyBody: { fontSize: 13, lineHeight: 20 },
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
  privacyNote: { fontSize: 10, textAlign: 'center', lineHeight: 15, marginTop: 6 },
  historyLink: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingVertical: 10 },
  historyLinkText: { fontSize: 13, fontWeight: '600' },
});
