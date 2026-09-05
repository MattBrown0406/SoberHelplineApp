import React, { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import {
  CAREGIVER_SUPPORT_NEEDS,
} from '../../lib/caregiverCheckIn';
import type {
  CaregiverCheckInInput,
  CaregiverSupportNeed,
  CheckIn,
  MoodScore,
} from '../../api/types';

const MOODS: Array<{ score: MoodScore; emoji: string }> = [
  { score: 1, emoji: '😞' },
  { score: 2, emoji: '😕' },
  { score: 3, emoji: '😐' },
  { score: 4, emoji: '🙂' },
  { score: 5, emoji: '😊' },
];

const SCORES: MoodScore[] = [1, 2, 3, 4, 5];
const SUPPORT_THRESHOLD = 3;

interface Props {
  checkIn: CheckIn | null;
  onComplete: (input: CaregiverCheckInInput) => Promise<void>;
  newStreak: number;
  /** True when the streak's one-day grace forgave a missed day this run. */
  graceUsed?: boolean;
  isAttached: boolean;
  orgName: string | null;
  /** Low-mood days from my_situation() drivers; ≥3 triggers the coaching offer. */
  lowMoodDays?: number;
  /** Routes to 1:1 coaching. Only provided for self-guided members. */
  onTalkToCoach?: () => void;
}

export function CheckInCard({
  checkIn,
  onComplete,
  newStreak,
  graceUsed = false,
  isAttached,
  orgName,
  lowMoodDays = 0,
  onTalkToCoach,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const router = useRouter();
  const [pendingMood, setPendingMood] = useState<MoodScore | null>(
    checkIn?.moodScore ?? null,
  );
  const [pendingCapacity, setPendingCapacity] = useState<MoodScore | null>(
    checkIn?.capacityScore ?? null,
  );
  const [pendingPressure, setPendingPressure] = useState<MoodScore | null>(
    checkIn?.pressureScore ?? null,
  );
  const [pendingNeed, setPendingNeed] = useState<CaregiverSupportNeed | null>(
    checkIn?.supportNeed ?? null,
  );
  const [note, setNote] = useState(checkIn?.note ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [showNote, setShowNote] = useState(false);
  const stepAnswered = [pendingMood, pendingCapacity, pendingPressure, pendingNeed][step] !== null;

  useEffect(() => {
    if (!checkIn) return;
    setPendingMood(checkIn.moodScore);
    setPendingCapacity(checkIn.capacityScore);
    setPendingPressure(checkIn.pressureScore);
    setPendingNeed(checkIn.supportNeed);
    setNote(checkIn.note ?? '');
  }, [checkIn]);

  const completed = checkIn !== null;
  const isComplete =
    pendingMood !== null &&
    pendingCapacity !== null &&
    pendingPressure !== null &&
    pendingNeed !== null;
  const showSupport = lowMoodDays >= SUPPORT_THRESHOLD && !!onTalkToCoach;

  const privacyNote =
    isAttached && orgName
      ? t('checkIn.privacyAttached', { orgName })
      : t('checkIn.privacyDirect');

  const doneText = t('checkIn.done');

  const doneCoach =
    isAttached && orgName
      ? ' ' + t('checkIn.doneCoach', { orgFirst: orgName.split(' ')[0] })
      : '';

  async function handleComplete() {
    if (isSaving) return;
    if (!isComplete) {
      Alert.alert(t('checkIn.incompleteTitle'), t('checkIn.incompleteMessage'));
      return;
    }
    setIsSaving(true);
    try {
      await onComplete({
        moodScore: pendingMood,
        capacityScore: pendingCapacity,
        pressureScore: pendingPressure,
        supportNeed: pendingNeed,
        note,
      });
    } catch {
      // Do not log provider errors that may contain private check-in values.
      Alert.alert(t('checkIn.errorTitle'), t('checkIn.errorMessage'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
        {t('checkIn.eyebrow')}
      </Text>
      <Text style={[styles.question, { color: colors.ink }]}>
        {t('checkIn.question')}
      </Text>
      <Text style={[styles.subtext, { color: colors.inkSoft }]}>
        {t('checkIn.privacy')}{' '}
        <Text style={{ color: colors.inkSoft }}>{privacyNote}</Text>
      </Text>

      {!completed ? (
        <>
          <Text accessibilityLiveRegion="polite" style={[styles.subtext, { color: colors.inkSoft }]}>
            {t('checkIn.progress', { current: step + 1, total: 4 })}
          </Text>
          {step === 0 && <>
          <Text style={[styles.fieldLabel, { color: colors.ink }]}>
            {t('checkIn.moodQuestion')}
          </Text>
          <View style={styles.moodRow} accessibilityRole="radiogroup">
            {MOODS.map(({ score, emoji }) => (
              <TouchableOpacity
                key={score}
                style={[
                  styles.moodBtn,
                  {
                    borderColor: pendingMood === score ? colors.primary : colors.line,
                    backgroundColor: pendingMood === score ? colors.primaryLight : '#fff',
                  },
                ]}
                accessibilityRole="radio"
                accessibilityLabel={t('checkIn.moodAccessibility', { score })}
                aria-checked={pendingMood === score}
                accessibilityState={{ checked: pendingMood === score, selected: pendingMood === score, disabled: isSaving }}
                disabled={isSaving}
                onPress={() => setPendingMood(score)}
                activeOpacity={0.8}
              >
                <Text style={styles.moodEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
          </>}
          {step === 1 && <ScoreField
            label={t('checkIn.capacityQuestion')}
            lowLabel={t('checkIn.capacityLow')}
            highLabel={t('checkIn.capacityHigh')}
            accessibilityLabel={t('checkIn.capacityAccessibility')}
            value={pendingCapacity}
            disabled={isSaving}
            colors={colors}
            onChange={setPendingCapacity}
          />}

          {step === 2 && <ScoreField
            label={t('checkIn.pressureQuestion')}
            lowLabel={t('checkIn.pressureLow')}
            highLabel={t('checkIn.pressureHigh')}
            accessibilityLabel={t('checkIn.pressureAccessibility')}
            value={pendingPressure}
            disabled={isSaving}
            colors={colors}
            onChange={setPendingPressure}
          />}

          {step === 3 && <>
          <Text style={[styles.fieldLabel, { color: colors.ink }]}>
            {t('checkIn.needsQuestion')}
          </Text>
          <View style={styles.needOptions} accessibilityRole="radiogroup">
            {CAREGIVER_SUPPORT_NEEDS.map((need) => {
              const selected = pendingNeed === need;
              return (
                <TouchableOpacity
                  key={need}
                  accessibilityRole="radio"
                  aria-checked={selected}
                  accessibilityState={{ checked: selected, selected, disabled: isSaving }}
                  disabled={isSaving}
                  onPress={() => setPendingNeed(need)}
                  style={[
                    styles.needOption,
                    {
                      borderColor: selected ? colors.primary : colors.line,
                      backgroundColor: selected ? colors.primaryLight : colors.white,
                    },
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.needOptionText, { color: colors.ink }]}>
                    {t(`checkIn.supportNeeds.${need}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {pendingNeed === 'safety' && (
            <View
              accessibilityRole="alert"
              style={[
                styles.immediateSafety,
                { backgroundColor: colors.coralLight, borderColor: colors.coral },
              ]}
            >
              <Text style={[styles.responseTitle, { color: colors.ink }]}>
                {t('checkIn.responses.safety.title')}
              </Text>
              <Text style={[styles.responseBody, { color: colors.inkSoft }]}>
                {t('checkIn.responses.safety.body')}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.responseBtn, { borderColor: colors.coral }]}
                onPress={() => router.push('/safety-wallet' as never)}
                activeOpacity={0.82}
              >
                <Text style={[styles.responseBtnText, { color: colors.coral }]}>
                  {t('checkIn.responses.safety.cta')}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity accessibilityRole="button" aria-expanded={showNote} accessibilityState={{ expanded: showNote }}
            disabled={isSaving} onPress={() => setShowNote(value => !value)} style={{ minHeight: 44, paddingVertical: 12 }}>
            <Text style={{ color: colors.primary }}>{t(showNote ? 'checkIn.hideNote' : 'checkIn.addNote')}</Text>
          </TouchableOpacity>
          {showNote && <>
          <View style={styles.noteHeader}>
            <Text style={[styles.fieldLabel, styles.noteFieldLabel, { color: colors.ink }]}>
              {t('checkIn.noteLabel')}
            </Text>
            <Text style={[styles.optional, { color: colors.inkSoft }]}>
              {t('checkIn.optional')}
            </Text>
          </View>
          <TextInput
            accessibilityLabel={t('checkIn.noteLabel')}
            value={note}
            onChangeText={setNote}
            editable={!isSaving}
            multiline
            maxLength={280}
            placeholder={t('checkIn.notePlaceholder')}
            placeholderTextColor={colors.inkSoft}
            style={[
              styles.noteInput,
              { color: colors.ink, borderColor: colors.line, backgroundColor: colors.cream },
            ]}
          />
          </>}

          {!isComplete && (
            <Text style={[styles.moodHint, { color: colors.inkSoft }]}>
              {t('checkIn.completionHint')}
            </Text>
          )}
          <TouchableOpacity
            style={[
              styles.btn,
              {
                backgroundColor: colors.primary,
                opacity: isComplete && !isSaving ? 1 : 0.45,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ busy: isSaving, disabled: !isComplete || isSaving }}
            disabled={!isComplete || isSaving}
            onPress={() => void handleComplete()}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>
              {isSaving ? t('checkIn.savingButton') : t('checkIn.completeButton')}
            </Text>
          </TouchableOpacity>
          </>}
          {step < 3 && <TouchableOpacity
            accessibilityRole="button" accessibilityState={{ disabled: !stepAnswered || isSaving }}
            disabled={!stepAnswered || isSaving}
            onPress={() => setStep(value => Math.min(3, value + 1))}
            style={[styles.btn, { backgroundColor: colors.primary, opacity: stepAnswered ? 1 : 0.45 }]}>
            <Text style={styles.btnText}>{t('checkIn.next')}</Text>
          </TouchableOpacity>}
          {step > 0 && <TouchableOpacity accessibilityRole="button" disabled={isSaving}
            accessibilityState={{ disabled: isSaving }}
            onPress={() => setStep(value => Math.max(0, value - 1))}
            style={{ minHeight: 44, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: colors.primary }}>{t('checkIn.back')}</Text>
          </TouchableOpacity>}
        </>
      ) : (
        <>
          <View
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[
              styles.doneBanner,
              { backgroundColor: colors.greenLight, borderColor: '#cde3d4' },
            ]}
          >
            <Text style={[styles.doneText, { color: colors.green }]}>
              {doneText}{doneCoach}
            </Text>
          </View>

        </>
      )}

      {showSupport && (
        <View
          style={[
            styles.supportBlock,
            { backgroundColor: colors.primaryLight, borderColor: colors.primary },
          ]}
        >
          <Text style={[styles.supportTitle, { color: colors.ink }]}>
            {t('checkIn.lowSupportTitle')}
          </Text>
          <Text style={[styles.supportBody, { color: colors.inkSoft }]}>
            {t('checkIn.lowSupportBody', { count: lowMoodDays })}
          </Text>
          <TouchableOpacity
            style={[styles.supportBtn, { borderColor: colors.primary }]}
            onPress={onTalkToCoach}
            activeOpacity={0.85}
          >
            <Text style={[styles.supportBtnText, { color: colors.primary }]}>
              {t('checkIn.lowSupportButton')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

interface ScoreFieldProps {
  label: string;
  lowLabel: string;
  highLabel: string;
  accessibilityLabel: string;
  value: MoodScore | null;
  disabled: boolean;
  colors: ReturnType<typeof useTheme>['colors'];
  onChange: (score: MoodScore) => void;
}

function ScoreField({
  label,
  lowLabel,
  highLabel,
  accessibilityLabel,
  value,
  disabled,
  colors,
  onChange,
}: ScoreFieldProps) {
  return (
    <View style={styles.scoreField}>
      <Text style={[styles.fieldLabel, { color: colors.ink }]}>{label}</Text>
      <View style={styles.scoreRow} accessibilityRole="radiogroup">
        {SCORES.map((score) => {
          const selected = value === score;
          return (
            <TouchableOpacity
              key={score}
              accessibilityRole="radio"
              accessibilityLabel={`${accessibilityLabel} ${score}`}
              aria-checked={selected}
              accessibilityState={{ checked: selected, selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(score)}
              style={[
                styles.scoreButton,
                {
                  borderColor: selected ? colors.primary : colors.line,
                  backgroundColor: selected ? colors.primary : colors.white,
                },
              ]}
              activeOpacity={0.8}
            >
              <Text style={[styles.scoreButtonText, { color: selected ? '#fff' : colors.ink }]}>
                {score}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.scaleLabels}>
        <Text style={[styles.scaleLabel, { color: colors.inkSoft }]}>{lowLabel}</Text>
        <Text style={[styles.scaleLabel, { color: colors.inkSoft }]}>{highLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  question: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  subtext: { fontSize: 12.5, marginBottom: 16, lineHeight: 18 },
  fieldLabel: { fontSize: 13.5, fontWeight: '700', marginBottom: 9 },
  moodRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  moodBtn: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodEmoji: { fontSize: 23 },
  scoreField: { marginBottom: 18 },
  scoreRow: { flexDirection: 'row', gap: 7 },
  scoreButton: {
    flex: 1,
    height: 40,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreButtonText: { fontSize: 13, fontWeight: '700' },
  scaleLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  scaleLabel: { fontSize: 10.5 },
  needOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  needOption: {
    borderWidth: 1.5,
    borderRadius: 99,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  needOptionText: { fontSize: 12, fontWeight: '600' },
  noteHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  noteFieldLabel: { marginBottom: 7 },
  optional: { fontSize: 11, marginBottom: 7 },
  noteInput: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 12,
    padding: 11,
    fontSize: 13,
    lineHeight: 18,
    textAlignVertical: 'top',
  },
  moodHint: { fontSize: 11.5, textAlign: 'center', marginTop: 10 },
  btn: { borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 10 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  doneBanner: { borderRadius: 14, borderWidth: 1, padding: 13, marginTop: 10 },
  doneText: { fontSize: 13.5, fontWeight: '600', lineHeight: 20 },
  milestoneText: { fontSize: 13, fontWeight: '600', lineHeight: 19, marginTop: 8 },
  responseBlock: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 10 },
  immediateSafety: { borderRadius: 14, borderWidth: 1.5, padding: 14, marginBottom: 18 },
  responseTitle: { fontSize: 14.5, fontWeight: '700', marginBottom: 4 },
  responseBody: { fontSize: 12.5, lineHeight: 18 },
  responseBtn: {
    borderRadius: 99,
    borderWidth: 1.5,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 11,
  },
  responseBtnText: { fontSize: 13.5, fontWeight: '700' },
  supportBlock: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    marginTop: 12,
    gap: 6,
  },
  supportTitle: { fontSize: 14.5, fontWeight: '700' },
  supportBody: { fontSize: 12.5, lineHeight: 18 },
  supportBtn: {
    borderRadius: 99,
    borderWidth: 1.5,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 4,
  },
  supportBtnText: { fontSize: 14, fontWeight: '700' },
});
