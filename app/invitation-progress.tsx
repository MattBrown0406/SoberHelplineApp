import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Gate } from '../src/components/auth/Gate';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useInvitationProgress } from '../src/hooks/useInvitationProgress';
import { BackLink, EngineCard, Kicker, PrimaryButton } from '../src/components/invitation/ui';
import { formatLocalDate } from '../src/lib/invitationCopy';
import { learningSummary, progressSummary, type LearningRow } from '../src/lib/invitationOutcomes';

export default function InvitationProgressScreen() {
  const { user } = useAccount();
  return (
    <Gate feature="invitationEngine">
      <InvitationProgressContent key={user?.id ?? 'signed-out'} />
    </Gate>
  );
}

const FORECAST_DAYS = 14;

/** Member progress: moves, invitations and outcomes, forecast history, and what's working. */
function InvitationProgressContent() {
  const { user } = useAccount();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('invitation');
  const router = useRouter();
  const { data, learning, loading, error, reload } = useInvitationProgress(user?.id ?? null);

  const summary = useMemo(
    () => (data ? progressSummary(data.attempts, data.moveDates, data.forecasts) : null),
    [data],
  );
  const lessons = useMemo(() => learningSummary(learning), [learning]);
  const familyRows = learning.some((row) => !row.mine);
  const levelColor = { low: colors.line, possible: colors.secondary, good: colors.green } as const;

  function row<K extends string>(item: LearningRow<K>, label: string) {
    return (
      <View key={item.key} style={[styles.learnRow, { borderBottomColor: colors.line }]}>
        <Text style={[styles.learnLabel, { color: colors.ink }]}>{label}</Text>
        <Text style={[styles.learnCounts, { color: colors.inkSoft }]}>
          {t('progress.row', { asks: item.asks, yes: item.yes, notYet: item.notYet, angry: item.angry })}
        </Text>
      </View>
    );
  }

  return (
    <ScreenContainer contentContainerStyle={styles.wrap}>
      <BackLink label={t('common.back')} onPress={() => router.back()} />
      <Kicker>{t('progress.kicker')}</Kicker>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('progress.title')}</Text>
      <Text style={[styles.body, { color: colors.ink }]}>{t('progress.body')}</Text>

      {loading && !data && <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>}

      {error && !data && (
        <EngineCard tone="alert" style={styles.section}>
          <Text accessibilityRole="alert" style={[styles.body, { color: colors.coral }]}>{t('progress.loadError')}</Text>
          <PrimaryButton label={t('common.retry')} onPress={() => { void reload(); }} />
        </EngineCard>
      )}

      {summary && data && (
        <>
          <View style={[styles.stats, styles.section]}>
            {([
              ['movesDone', summary.movesDone],
              ['moveDays', summary.moveDays],
              ['attempts', summary.attempts],
              ['yes', summary.outcomes.yes],
              ['goodDays', summary.goodDays],
            ] as const).map(([key, value]) => (
              <View key={key} style={[styles.stat, { backgroundColor: colors.white, borderColor: colors.line }]}>
                <Text style={[styles.statValue, { color: colors.primary }]}>{value}</Text>
                <Text style={[styles.statLabel, { color: colors.inkSoft }]}>{t(`progress.stats.${key}`)}</Text>
              </View>
            ))}
          </View>

          <EngineCard>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('progress.attemptsTitle')}</Text>
            {data.attempts.length === 0 ? (
              <Text style={[styles.body, { color: colors.inkSoft }]}>{t('progress.attemptsNone')}</Text>
            ) : data.attempts.slice(0, 10).map((attempt) => (
              <View key={attempt.createdAt} style={[styles.attempt, { borderBottomColor: colors.line }]}>
                <Text style={[styles.attemptOutcome, { color: attempt.outcome === 'yes' ? colors.green : attempt.outcome === 'angry' ? colors.coral : colors.ink }]}>
                  {t(`progress.outcome.${attempt.outcome}`)}
                </Text>
                <Text style={[styles.attemptDate, { color: colors.inkSoft }]}>{formatLocalDate(attempt.localDate, i18n.language)}</Text>
                {attempt.note && <Text style={[styles.attemptNote, { color: colors.ink }]}>{attempt.note}</Text>}
              </View>
            ))}
          </EngineCard>

          <EngineCard>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('progress.forecastTitle')}</Text>
            {data.forecasts.length === 0 ? (
              <Text style={[styles.body, { color: colors.inkSoft }]}>{t('progress.forecastNone')}</Text>
            ) : (
              <View style={styles.forecastRow}>
                {[...data.forecasts].slice(0, FORECAST_DAYS).reverse().map((forecast) => {
                  const date = formatLocalDate(forecast.localDate, i18n.language);
                  const level = t(`forecast.level.${forecast.level}`);
                  return (
                    <View
                      key={forecast.localDate}
                      accessible
                      accessibilityLabel={`${t('progress.forecastA11y', { date, level })}${forecast.pushed ? `. ${t('progress.pushedNote')}` : ''}`}
                      style={styles.forecastDay}
                    >
                      <View style={[styles.forecastBar, {
                        backgroundColor: levelColor[forecast.level],
                        height: forecast.level === 'good' ? 36 : forecast.level === 'possible' ? 24 : 12,
                        borderWidth: forecast.pushed ? 2 : 0,
                        borderColor: colors.primary,
                      }]} />
                      <Text style={[styles.forecastDate, { color: colors.inkSoft }]}>{forecast.localDate.slice(8)}</Text>
                    </View>
                  );
                })}
              </View>
            )}
            <View style={styles.legend}>
              {(['good', 'possible', 'low'] as const).map((level) => (
                <View key={level} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: levelColor[level] }]} />
                  <Text style={[styles.legendText, { color: colors.inkSoft }]}>{t(`forecast.level.${level}`)}</Text>
                </View>
              ))}
            </View>
          </EngineCard>

          <EngineCard tone="warm">
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('progress.learningTitle')}</Text>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('progress.learningBody')}</Text>
            {lessons.asks === 0 ? (
              <Text style={[styles.body, { color: colors.ink }]}>{t('progress.learningNone')}</Text>
            ) : (
              <>
                <Text style={[styles.subhead, { color: colors.ink }]}>{t('progress.bySource')}</Text>
                {lessons.bySource.map((item) => row(item, t(`progress.sources.${item.key}`)))}
                {lessons.byStyle.length > 0 && (
                  <>
                    <Text style={[styles.subhead, { color: colors.ink }]}>{t('progress.byStyle')}</Text>
                    {lessons.byStyle.map((item) => row(item, t(`outcome.style.${item.key}`)))}
                  </>
                )}
              </>
            )}
            {familyRows && <Text style={[styles.family, { color: colors.inkSoft }]}>{t('progress.learningFamily')}</Text>}
          </EngineCard>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 64 },
  loading: { paddingVertical: 40 },
  title: { fontSize: 25, lineHeight: 31, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  section: { marginTop: 14 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  stat: { borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, minWidth: 96, flexGrow: 1 },
  statValue: { fontSize: 24, fontWeight: '900' },
  statLabel: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  cardTitle: { fontSize: 17, lineHeight: 22, fontWeight: '900' },
  attempt: { paddingVertical: 10, borderBottomWidth: 1 },
  attemptOutcome: { fontSize: 15, fontWeight: '800' },
  attemptDate: { fontSize: 12, marginTop: 2 },
  attemptNote: { fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  forecastRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, marginTop: 14, minHeight: 56 },
  forecastDay: { alignItems: 'center', flex: 1 },
  forecastBar: { width: '100%', maxWidth: 18, borderRadius: 4 },
  forecastDate: { fontSize: 10, marginTop: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12 },
  subhead: { fontSize: 13.5, fontWeight: '900', marginTop: 14 },
  learnRow: { paddingVertical: 9, borderBottomWidth: 1 },
  learnLabel: { fontSize: 14, fontWeight: '800' },
  learnCounts: { fontSize: 12.5, marginTop: 2 },
  family: { fontSize: 12, fontStyle: 'italic', marginTop: 10 },
});
