import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import type { MoodScore } from '../../api/types';

const MOODS: Array<{ score: MoodScore; emoji: string }> = [
  { score: 1, emoji: '😞' },
  { score: 2, emoji: '😕' },
  { score: 3, emoji: '😐' },
  { score: 4, emoji: '🙂' },
  { score: 5, emoji: '😊' },
];

interface Props {
  completed: boolean;
  selectedMood: MoodScore | null;
  onComplete: (mood: MoodScore) => void;
  /** Streak count after today's check-in completes — shown in done banner. */
  newStreak: number;
  isAttached: boolean;
  orgName: string | null;
}

export function CheckInCard({
  completed,
  selectedMood,
  onComplete,
  newStreak,
  isAttached,
  orgName,
}: Props) {
  const { colors } = useTheme();
  const [pendingMood, setPendingMood] = useState<MoodScore | null>(selectedMood);

  const privacyNote =
    isAttached && orgName
      ? `Patterns are shared only with your ${orgName} coach.`
      : 'Patterns stay private unless you choose to share them with a coach.';

  function handleComplete() {
    if (pendingMood !== null) onComplete(pendingMood);
  }

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>Daily check-in</Text>
      <Text style={[styles.question, { color: colors.ink }]}>
        How are you holding up today?
      </Text>
      <Text style={[styles.subtext, { color: colors.inkSoft }]}>
        Your answers are private.{' '}
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
          <TouchableOpacity
            style={[
              styles.btn,
              { backgroundColor: colors.primary, opacity: pendingMood ? 1 : 0.45 },
            ]}
            onPress={handleComplete}
            disabled={pendingMood === null}
            activeOpacity={0.8}
          >
            <Text style={styles.btnText}>Complete check-in</Text>
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
            {'✓ Check-in complete'}
            {newStreak > 0 ? ` — ${newStreak}-day streak!` : '!'}
            {isAttached && orgName
              ? ` ${orgName.split(' ')[0]} will see your update.`
              : ''}
          </Text>
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
  btn: {
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginTop: 10,
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
});
