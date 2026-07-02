import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { MoodScore } from '../../api/types';

const MOODS: Array<{ score: MoodScore; emoji: string }> = [
  { score: 1, emoji: '😞' },
  { score: 2, emoji: '😕' },
  { score: 3, emoji: '😐' },
  { score: 4, emoji: '🙂' },
  { score: 5, emoji: '😊' },
];

const SUPPORT_THRESHOLD = 3; // low-mood days in the last week before we offer a coach

const MILESTONES = [7, 30, 90];

interface Props {
  completed: boolean;
  selectedMood: MoodScore | null;
  onComplete: (mood: MoodScore) => Promise<void>;
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
  completed,
  selectedMood,
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
  const [pendingMood, setPendingMood] = useState<MoodScore | null>(selectedMood);

  const showSupport = lowMoodDays >= SUPPORT_THRESHOLD && !!onTalkToCoach;

  const privacyNote =
    isAttached && orgName
      ? t('checkIn.privacyAttached', { orgName })
      : t('checkIn.privacyDirect');

  const doneText =
    newStreak > 0
      ? t('checkIn.doneStreak', { count: newStreak })
      : t('checkIn.done');

  const doneCoach =
    isAttached && orgName
      ? ' ' + t('checkIn.doneCoach', { orgFirst: orgName.split(' ')[0] })
      : '';

  function handleComplete() {
    if (pendingMood === null) {
      Alert.alert(t('checkIn.noMoodTitle'), t('checkIn.noMoodMessage'));
      return;
    }
    void onComplete(pendingMood).catch((err: unknown) => {
      console.error('[CheckInCard] saveCheckIn failed:', err);
      Alert.alert(t('checkIn.errorTitle'), t('checkIn.errorMessage'));
    });
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
          <View style={styles.moodRow}>
            {MOODS.map(({ score, emoji }) => (
              <TouchableOpacity
                key={score}
                style={[
                  styles.moodBtn,
                  {
                    borderColor:
                      pendingMood === score ? colors.primary : colors.line,
                    backgroundColor:
                      pendingMood === score ? colors.primaryLight : '#fff',
                  },
                ]}
                onPress={() => setPendingMood(score)}
                activeOpacity={0.8}
              >
                <Text style={styles.moodEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {pendingMood === null && (
            <Text style={[styles.moodHint, { color: colors.inkSoft }]}>
              {t('checkIn.moodHint')}
            </Text>
          )}
          <TouchableOpacity
            style={[
              styles.btn,
              {
                backgroundColor: colors.primary,
                opacity: pendingMood !== null ? 1 : 0.45,
              },
            ]}
            onPress={handleComplete}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>{t('checkIn.completeButton')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View
          style={[
            styles.doneBanner,
            { backgroundColor: colors.greenLight, borderColor: '#cde3d4' },
          ]}
        >
          <Text style={[styles.doneText, { color: colors.green }]}>
            {doneText}{doneCoach}
          </Text>
          {MILESTONES.includes(newStreak) && (
            <Text style={[styles.milestoneText, { color: colors.green }]}>
              {t(`checkIn.milestone${newStreak}`)}
            </Text>
          )}
          {graceUsed && !MILESTONES.includes(newStreak) && (
            <Text style={[styles.milestoneText, { color: colors.green }]}>
              {t('checkIn.graceUsed')}
            </Text>
          )}
        </View>
      )}

      {showSupport && (
        <View style={[styles.supportBlock, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
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
  question: {
    fontSize: 14.5,
    fontWeight: '600',
    marginBottom: 4,
  },
  subtext: {
    fontSize: 12.5,
    marginBottom: 4,
    lineHeight: 18,
  },
  moodRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 12,
  },
  moodBtn: {
    width: 54,
    height: 54,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodEmoji: {
    fontSize: 25,
  },
  moodHint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  btn: {
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  btnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  doneBanner: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 13,
    marginTop: 10,
  },
  doneText: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 20,
  },
  milestoneText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginTop: 8,
  },
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
