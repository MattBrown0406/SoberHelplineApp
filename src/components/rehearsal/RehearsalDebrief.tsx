import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { PartnerDebrief } from '../../hooks/useRehearsalPartner';
import type { DeliveryReport } from '../../lib/practiceDelivery';
import type { DifficultyAdvice } from '../../lib/practiceDifficulty';
import type { PartnerTemperament } from '../../lib/practiceScenarios';
import { workOnTurnFor } from '../../lib/practiceReplay';
import { SCORE_KEYS } from '../../lib/practiceTrends';
import { DeliverySummary } from './DeliverySummary';

interface Props {
  debrief: PartnerDebrief;
  onAgain: () => void;
  onDone: () => void;
  /** "Redo from here": rewind to just before the user turn a workOn item is about. */
  onRedo?: (userTurnIndex: number, item: string) => void;
  /** User turns in the session — redo targets are validated against it. */
  userTurnCount?: number;
  delivery?: DeliveryReport | null;
  difficulty?: DifficultyAdvice | null;
  onChangeDifficulty?: (level: PartnerTemperament) => void;
  variant?: 'standard' | 'warmup';
}

/**
 * Coach's-feedback view shared by rehearsal-live and rehearsal-incoming.
 * Scores row, what worked / what to tighten (each with "Redo from here"),
 * delivery, the next drill, the difficulty suggestion, and the two exits.
 */
export function RehearsalDebrief({
  debrief,
  onAgain,
  onDone,
  onRedo,
  userTurnCount = 0,
  delivery,
  difficulty,
  onChangeDifficulty,
  variant = 'standard',
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('rehearsalLive');
  const warmup = variant === 'warmup';

  const levelName = (level: PartnerTemperament) => t(`temperaments.${level}.title`);
  const difficultyCard = (() => {
    if (!difficulty || warmup) return null;
    const vars = { current: levelName(difficulty.current), level: levelName(difficulty.suggested) };
    if (difficulty.action === 'up') {
      return { title: t('debrief.difficulty.upTitle'), body: t('debrief.difficulty.upBody', vars), button: t('debrief.difficulty.upButton', vars) };
    }
    if (difficulty.action === 'down') {
      return { title: t('debrief.difficulty.downTitle'), body: t('debrief.difficulty.downBody', vars), button: t('debrief.difficulty.downButton', vars) };
    }
    if (difficulty.reason === 'top') {
      return { title: t('debrief.difficulty.topTitle'), body: t('debrief.difficulty.topBody', vars), button: null };
    }
    return { title: t('debrief.difficulty.stayTitle'), body: t('debrief.difficulty.stayBody', vars), button: null };
  })();

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>{warmup ? t('warmup.debriefHeading') : t('debrief.heading')}</Text>

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
      {debrief.workOn?.map((item, i) => {
        const turn = onRedo ? workOnTurnFor(debrief, i, userTurnCount) : null;
        return (
          <View key={i} style={styles.workOnItem}>
            <Text style={[styles.debriefItem, { color: colors.white }]}>•  {item}</Text>
            {turn !== null && (
              <TouchableOpacity
                style={[styles.redoBtn, { borderColor: colors.coral }]}
                onPress={() => onRedo?.(turn, item)}
                accessibilityRole="button"
                accessibilityLabel={t('debrief.redoLabel')}
                hitSlop={6}
                activeOpacity={0.85}
              >
                <Text style={[styles.redoText, { color: colors.coral }]}>{t('debrief.redoButton')}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      {!!debrief.drill && (
        <View style={[styles.drillCard, { backgroundColor: colors.primaryDark }]}>
          <Text style={[styles.drillLabel, { color: colors.inkSoft }]}>{t('debrief.drillLabel')}</Text>
          <Text style={[styles.drillText, { color: colors.white }]}>{debrief.drill}</Text>
        </View>
      )}

      {delivery && <DeliverySummary report={delivery} />}

      {difficultyCard && (
        <View style={[styles.levelCard, { borderColor: colors.inkSoft }]}>
          <Text style={[styles.levelTitle, { color: colors.white }]}>{difficultyCard.title}</Text>
          <Text style={[styles.levelBody, { color: colors.inkSoft }]}>{difficultyCard.body}</Text>
          {difficultyCard.button && difficulty && onChangeDifficulty && (
            <TouchableOpacity
              style={[styles.levelBtn, { backgroundColor: colors.primary }]}
              onPress={() => onChangeDifficulty(difficulty.suggested)}
              accessibilityRole="button"
              activeOpacity={0.85}
            >
              <Text style={styles.levelBtnText}>{difficultyCard.button}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Text style={[styles.encouragement, { color: colors.inkSoft }]}>
        {warmup ? t('warmup.encouragement') : t('debrief.encouragement')}
      </Text>

      <TouchableOpacity
        style={[styles.bigBtn, { backgroundColor: colors.coral, marginTop: 20 }]}
        onPress={onAgain}
        accessibilityRole="button"
        activeOpacity={0.85}
      >
        <Text style={styles.bigBtnText}>{warmup ? t('warmup.againButton') : t('debrief.againButton')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.finishBtn, { borderColor: colors.inkSoft }]}
        onPress={onDone}
        accessibilityRole="button"
        activeOpacity={0.85}
      >
        <Text style={[styles.finishBtnText, { color: colors.white }]}>
          {warmup ? t('warmup.readyButton') : t('debrief.doneButton')}
        </Text>
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
  workOnItem: { marginBottom: 4 },
  redoBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginLeft: 16,
    marginBottom: 10,
  },
  redoText: { fontSize: 12, fontWeight: '700' },
  drillCard: { borderRadius: 14, padding: 16, marginTop: 14 },
  drillLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  drillText: { fontSize: 15, lineHeight: 22 },
  levelCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginTop: 16 },
  levelTitle: { fontSize: 15, fontWeight: '700', marginBottom: 4 },
  levelBody: { fontSize: 13, lineHeight: 19 },
  levelBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  levelBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
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
