import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { forecastReasonCopy } from '../../lib/invitationCopy';
import { QUICK_CHECKS, type Forecast, type QuickCheck } from '../../lib/invitationForecast';
import { EngineCard, Kicker } from './ui';

const MAX_REASONS = 3;

/**
 * Receptivity forecast: level, why, and the optional "How are they today?"
 * check. Reasons are the family's own signals in plain words.
 */
export function ForecastCard({
  forecast,
  check,
  onCheck,
  checkSaving,
  checkError,
}: {
  forecast: Forecast;
  check: QuickCheck | null;
  onCheck: (mood: QuickCheck | null) => void;
  checkSaving: boolean;
  checkError: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const tone = forecast.level === 'good' ? 'calm' : forecast.level === 'possible' ? 'warm' : 'plain';
  const levelColor = forecast.level === 'good' ? colors.green : forecast.level === 'possible' ? colors.secondary : colors.inkSoft;

  return (
    <EngineCard tone={tone}>
      <Kicker>{t('forecast.kicker')}</Kicker>
      <View accessibilityLiveRegion="polite" style={styles.levelRow}>
        <View style={[styles.dot, { backgroundColor: levelColor }]} />
        <Text accessibilityRole="header" style={[styles.level, { color: colors.ink }]}>
          {t(`forecast.level.${forecast.level}`)}
        </Text>
      </View>
      <Text style={[styles.body, { color: colors.ink }]}>{t(`forecast.levelBody.${forecast.level}`)}</Text>

      <View style={styles.reasons}>
        {forecast.reasons.slice(0, MAX_REASONS).map((reason) => {
          const copy = forecastReasonCopy(reason);
          const mark = reason.effect === 'up' ? '↑' : reason.effect === 'down' ? '↓' : '·';
          return (
            <View key={reason.code} style={styles.reasonRow}>
              <Text
                accessible={false}
                style={[styles.reasonMark, { color: reason.effect === 'down' ? colors.coral : reason.effect === 'up' ? colors.green : colors.inkSoft }]}
              >
                {mark}
              </Text>
              <Text style={[styles.reasonText, { color: colors.inkSoft }]}>{t(copy.key, copy.params)}</Text>
            </View>
          );
        })}
      </View>

      <Text style={[styles.checkTitle, { color: colors.ink }]}>{t('forecast.checkTitle')}</Text>
      <View accessibilityRole="radiogroup" style={styles.checkRow}>
        {QUICK_CHECKS.map((mood) => {
          const selected = check === mood;
          return (
            <TouchableOpacity
              key={mood}
              accessibilityRole="radio"
              accessibilityLabel={t(`forecast.check.${mood}`)}
              accessibilityState={{ selected, disabled: checkSaving }}
              disabled={checkSaving}
              onPress={() => onCheck(selected ? null : mood)}
              style={[
                styles.checkChip,
                {
                  borderColor: selected ? colors.primary : colors.line,
                  backgroundColor: selected ? colors.primaryLight : colors.white,
                },
              ]}
            >
              <Text style={[styles.checkText, { color: selected ? colors.primary : colors.ink }]}>
                {t(`forecast.check.${mood}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: colors.inkSoft }]}>{t('forecast.checkHint')}</Text>
      {checkError && (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>{t('forecast.checkError')}</Text>
      )}
      <Text style={[styles.promise, { color: colors.inkSoft }]}>{t('common.notPromise')}</Text>
    </EngineCard>
  );
}

const styles = StyleSheet.create({
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  level: { fontSize: 22, lineHeight: 27, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  reasons: { marginTop: 10, gap: 6 },
  reasonRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  reasonMark: { fontSize: 14, fontWeight: '900', width: 14, textAlign: 'center' },
  reasonText: { flex: 1, fontSize: 13, lineHeight: 19 },
  checkTitle: { fontSize: 14, fontWeight: '800', marginTop: 16 },
  checkRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  checkChip: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  checkText: { fontSize: 14, fontWeight: '800' },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 7 },
  error: { fontSize: 12.5, fontWeight: '700', marginTop: 6 },
  promise: { fontSize: 11.5, lineHeight: 16, fontStyle: 'italic', marginTop: 10 },
});
