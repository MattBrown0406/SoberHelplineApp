import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useTreatmentActionPlan } from '../../hooks/useTreatmentActionPlan';
import type { Situation } from '../../lib/situation';
import { treatmentActionProgress } from '../../lib/treatmentActionPlan';
import { willingnessWindowState } from '../../lib/willingnessWindow';

export function WillingnessWindowAlert({
  accountId,
  situation,
}: {
  accountId: string | null;
  situation: Situation;
}) {
  const initialState = willingnessWindowState(
    situation.drivers.latest_consequence_at ?? null,
    new Date(),
  );

  // my_situation() is the positive posture authority. Splitting the active
  // content into a child prevents protected plan reads during ordinary Today use.
  if (!accountId || !situation.drivers.willingness_window_active || !initialState.active) {
    return null;
  }

  return (
    <ActiveWillingnessWindow
      accountId={accountId}
      occurredAt={situation.drivers.latest_consequence_at ?? null}
    />
  );
}

function ActiveWillingnessWindow({
  accountId,
  occurredAt,
}: {
  accountId: string;
  occurredAt: string | null;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('tracker');
  const router = useRouter();
  const actionPlan = useTreatmentActionPlan(accountId);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Local time can close stale UI between server refreshes, but cannot open it.
  const windowState = willingnessWindowState(occurredAt, clock);
  const progress = useMemo(
    () => treatmentActionProgress(actionPlan.plan),
    [actionPlan.plan],
  );
  const planGreen = actionPlan.loadState === 'ready'
    && actionPlan.saveState === 'saved'
    && progress.ready;

  if (!windowState.active) return null;

  const readinessTitle = actionPlan.loadState === 'loading'
    ? t('window.readinessChecking')
    : actionPlan.loadState === 'error'
      ? t('window.readinessUnavailable')
      : actionPlan.saveState === 'saving'
        ? t('window.readinessSaving')
        : actionPlan.saveState === 'error'
          ? t('window.readinessUnsaved')
          : planGreen
            ? t('window.readinessReady')
            : t('window.readinessNotReady', { percentage: progress.percentage });
  const readinessBody = actionPlan.loadState === 'loading'
    ? t('window.readinessChecking')
    : actionPlan.loadState === 'error'
      ? t('window.readinessUnavailableBody')
      : actionPlan.saveState === 'saving'
        ? t('window.readinessSavingBody')
        : actionPlan.saveState === 'error'
          ? t('window.readinessUnsavedBody')
          : planGreen
            ? t('window.readinessReadyBody')
            : t('window.readinessBody');

  return (
    <View
      accessibilityRole="summary"
      style={[styles.card, { backgroundColor: colors.secondaryLight, borderColor: colors.coral }]}
    >
      <Text style={[styles.kicker, { color: colors.coral }]}>{t('window.openKicker')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('window.openTitle')}
      </Text>
      <Text style={[styles.countdown, { color: colors.coral }]} accessibilityLiveRegion="polite">
        {t('window.closesIn', { count: windowState.hoursRemaining })}
      </Text>
      <Text style={[styles.body, { color: colors.ink }]}>{t('window.openBody')}</Text>

      <View accessibilityRole="alert" style={[styles.safety, { borderLeftColor: colors.coral }]}>
        <Text style={[styles.safetyText, { color: colors.ink }]}>{t('window.safety')}</Text>
      </View>

      <View style={[styles.sayBox, { backgroundColor: colors.white, borderColor: colors.secondary }]}>
        <Text style={[styles.sayLabel, { color: colors.inkSoft }]}>{t('window.sayLabel')}</Text>
        <Text style={[styles.sayText, { color: colors.ink }]}>{t('window.sayText')}</Text>
      </View>

      <View style={[styles.readiness, { borderColor: planGreen ? colors.green : colors.coral }]}>
        <Text style={[styles.readinessTitle, { color: planGreen ? colors.green : colors.coral }]}>
          {readinessTitle}
        </Text>
        <Text style={[styles.readinessBody, { color: colors.inkSoft }]}>{readinessBody}</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('window.openTracker')}
          style={[styles.primaryButton, { backgroundColor: colors.coral }]}
          onPress={() => router.push('/(tabs)/tracker' as never)}
        >
          <Text style={styles.primaryButtonText}>{t('window.openTracker')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.secondaryButton, { borderColor: colors.primary }]}
          onPress={() => router.push('/treatment-action-plan' as never)}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>{t('window.openPlan')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 2,
    padding: 18,
    marginBottom: 14,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
    marginTop: 5,
  },
  countdown: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '900',
    marginTop: 6,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 7,
  },
  safety: {
    borderLeftWidth: 4,
    paddingLeft: 11,
    marginTop: 12,
  },
  safetyText: {
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '600',
  },
  sayBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 14,
  },
  sayLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sayText: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
    marginTop: 6,
  },
  readiness: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  readinessTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '900',
  },
  readinessBody: {
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 4,
  },
  actions: {
    marginTop: 14,
    gap: 9,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 99,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 99,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
});
