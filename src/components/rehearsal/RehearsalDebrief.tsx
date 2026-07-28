import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { PartnerDebrief } from '../../hooks/useRehearsalPartner';

const SCORE_KEYS = ['love', 'ask', 'boundaries', 'calm'] as const;

interface Props {
  debrief: PartnerDebrief;
  onAgain: () => void;
  onDone: () => void;
}

/**
 * Coach's-feedback view shared by rehearsal-live and rehearsal-incoming.
 * Scores row, what worked / what to tighten, next drill, and the two exits.
 */
export function RehearsalDebrief({ debrief, onAgain, onDone }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('rehearsalLive');

  return (
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

      <Text style={[styles.encouragement, { color: colors.inkSoft }]}>{t('debrief.encouragement')}</Text>

      <TouchableOpacity
        style={[styles.bigBtn, { backgroundColor: colors.coral, marginTop: 20 }]}
        onPress={onAgain}
        activeOpacity={0.85}
      >
        <Text style={styles.bigBtnText}>{t('debrief.againButton')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.finishBtn, { borderColor: colors.inkSoft }]}
        onPress={onDone}
        activeOpacity={0.85}
      >
        <Text style={[styles.finishBtnText, { color: colors.white }]}>{t('debrief.doneButton')}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 24, fontWeight: '700', color: '#fff', marginBottom: 8, lineHeight: 31 },
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
  encouragement: { fontSize: 13, lineHeight: 20, marginTop: 16, textAlign: 'center', fontStyle: 'italic' },
  bigBtn: { borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginBottom: 12 },
  bigBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  finishBtn: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 4,
  },
  finishBtnText: { fontWeight: '700', fontSize: 14 },
});
