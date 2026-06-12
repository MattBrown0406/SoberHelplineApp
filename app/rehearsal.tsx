import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import { useTheme } from '../src/contexts/ThemeContext';
import { useRehearsalCount } from '../src/hooks/useRehearsalCount';

type Phase = 'prompt' | 'recording' | 'playback' | 'selfcheck' | 'done';

const SELF_CHECK_QUESTIONS = ['calm', 'additions', 'pace'] as const;

export default function RehearsalScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('rehearsal');
  const router = useRouter();
  const params = useLocalSearchParams<{ text: string; sourceId: string; sourceType: string }>();

  const text = params.text ?? '';
  const sourceId = params.sourceId ?? 'unknown';

  const { count, increment } = useRehearsalCount(sourceId);

  const [phase, setPhase] = useState<Phase>('prompt');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [soundUri, setSoundUri] = useState<string | null>(null);
  const [checkAnswers, setCheckAnswers] = useState<Record<string, boolean | null>>({});
  const [questionIndex, setQuestionIndex] = useState(0);

  useEffect(() => {
    return () => {
      sound?.unloadAsync();
    };
  }, [sound]);

  async function startRecording() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Microphone access needed', t('privacyNote'));
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      setRecording(rec);
      setPhase('recording');
    } catch {
      // silently fail — simulator has no mic
    }
  }

  async function stopRecording() {
    if (!recording) return;
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      setSoundUri(uri ?? null);
    } catch {}
    setRecording(null);
    setPhase('playback');
  }

  async function playSound() {
    if (!soundUri) return;
    try {
      if (sound) await sound.unloadAsync();
      const { sound: s } = await Audio.Sound.createAsync({ uri: soundUri });
      setSound(s);
      await s.playAsync();
    } catch {}
  }

  function startSelfCheck() {
    setCheckAnswers({});
    setQuestionIndex(0);
    setPhase('selfcheck');
  }

  function answerQuestion(answer: boolean) {
    const key = SELF_CHECK_QUESTIONS[questionIndex];
    const next = { ...checkAnswers, [key]: answer };
    setCheckAnswers(next);
    if (questionIndex < SELF_CHECK_QUESTIONS.length - 1) {
      setQuestionIndex((i) => i + 1);
    } else {
      increment();
      setPhase('done');
    }
  }

  function resetForAnother() {
    setSoundUri(null);
    setCheckAnswers({});
    setQuestionIndex(0);
    setPhase('prompt');
  }

  const currentQuestion = SELF_CHECK_QUESTIONS[questionIndex];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.ink }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <TouchableOpacity onPress={() => router.back()} style={styles.backRow} hitSlop={12}>
          <Text style={[styles.backText, { color: colors.inkSoft }]}>‹ {t('title')}</Text>
        </TouchableOpacity>

        {/* Practice count */}
        {count > 0 && (
          <Text style={[styles.countBadge, { color: colors.inkSoft }]}>
            {t('count', { count })}
          </Text>
        )}

        {/* Teleprompter text */}
        <View style={styles.teleprompterWrap}>
          <Text style={styles.teleprompterText}>{text}</Text>
        </View>

        {/* Privacy note */}
        <Text style={[styles.privacyNote, { color: colors.inkSoft }]}>
          {t('privacyNote')}
        </Text>

        {/* Phase controls */}
        {phase === 'prompt' && (
          <TouchableOpacity
            style={[styles.bigBtn, { backgroundColor: colors.coral }]}
            onPress={startRecording}
            activeOpacity={0.85}
          >
            <Text style={styles.bigBtnText}>{t('recordButton')}</Text>
          </TouchableOpacity>
        )}

        {phase === 'recording' && (
          <TouchableOpacity
            style={[styles.bigBtn, { backgroundColor: colors.coral, opacity: 0.8 }]}
            onPress={stopRecording}
            activeOpacity={0.85}
          >
            <Text style={styles.bigBtnText}>⏹  {t('recordingLabel')}</Text>
          </TouchableOpacity>
        )}

        {phase === 'playback' && (
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.halfBtn, { backgroundColor: colors.primary }]}
              onPress={playSound}
              activeOpacity={0.85}
            >
              <Text style={styles.bigBtnText}>▶  {t('playButton')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.halfBtn, { borderColor: colors.inkSoft, borderWidth: 1 }]}
              onPress={startSelfCheck}
              activeOpacity={0.85}
            >
              <Text style={[styles.bigBtnText, { color: colors.white }]}>
                {t('selfCheck.eyebrow')} →
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'selfcheck' && (
          <View style={[styles.selfCheckCard, { backgroundColor: colors.primaryDark }]}>
            <Text style={[styles.selfCheckEyebrow, { color: colors.inkSoft }]}>
              {t('selfCheck.eyebrow')} {questionIndex + 1}/{SELF_CHECK_QUESTIONS.length}
            </Text>
            <Text style={[styles.selfCheckQ, { color: colors.white }]}>
              {t(`selfCheck.${currentQuestion}`)}
            </Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.halfBtn, { backgroundColor: colors.green }]}
                onPress={() => answerQuestion(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.bigBtnText}>{t('selfCheck.yes')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.halfBtn, { backgroundColor: colors.coral }]}
                onPress={() => answerQuestion(false)}
                activeOpacity={0.85}
              >
                <Text style={styles.bigBtnText}>{t('selfCheck.no')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {phase === 'done' && (
          <View style={[styles.doneCard, { backgroundColor: colors.greenLight }]}>
            <Text style={[styles.doneText, { color: colors.green }]}>
              {t('selfCheck.done')}
            </Text>
            <TouchableOpacity
              style={[styles.bigBtn, { backgroundColor: colors.primary, marginTop: 16 }]}
              onPress={resetForAnother}
              activeOpacity={0.85}
            >
              <Text style={styles.bigBtnText}>{t('selfCheck.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Re-record option during playback */}
        {phase === 'playback' && (
          <TouchableOpacity style={styles.rerecordBtn} onPress={resetForAnother}>
            <Text style={[styles.rerecordText, { color: colors.inkSoft }]}>
              {t('rerecordButton')}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 24, paddingBottom: 60 },
  backRow: { marginBottom: 20 },
  backText: { fontSize: 15 },
  countBadge: { fontSize: 12, marginBottom: 16, textAlign: 'center' },
  teleprompterWrap: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  teleprompterText: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  privacyNote: {
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 16,
  },
  bigBtn: {
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 12,
  },
  bigBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  halfBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  selfCheckCard: {
    borderRadius: 18,
    padding: 24,
    marginBottom: 12,
  },
  selfCheckEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  selfCheckQ: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 28,
    marginBottom: 24,
  },
  doneCard: {
    borderRadius: 18,
    padding: 24,
    marginBottom: 12,
    alignItems: 'center',
  },
  doneText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  rerecordBtn: { alignItems: 'center', paddingVertical: 8 },
  rerecordText: { fontSize: 13 },
});
