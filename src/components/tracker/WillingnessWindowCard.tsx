import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useTreatmentActionPlan } from '../../hooks/useTreatmentActionPlan';
import { useWillingnessWindow } from '../../hooks/useWillingnessWindow';
import { treatmentActionProgress } from '../../lib/treatmentActionPlan';
import {
  CONSEQUENCE_EVENT_TYPES,
  willingnessWindowState,
  type ConsequenceEventType,
  type ConsequenceTiming,
} from '../../lib/willingnessWindow';

const TIMINGS: ConsequenceTiming[] = ['now', 'earlier_today', 'yesterday', 'two_days_ago'];

export function WillingnessWindowCard({
  accountId,
  onSituationRefresh,
}: {
  accountId: string | null;
  onSituationRefresh: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('tracker');
  const router = useRouter();
  const windowData = useWillingnessWindow(accountId);
  const actionPlan = useTreatmentActionPlan(accountId);
  const [selectedType, setSelectedType] = useState<ConsequenceEventType | null>(null);
  const [timing, setTiming] = useState<ConsequenceTiming>('now');
  const [showLogger, setShowLogger] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const state = willingnessWindowState(windowData.latestEvent?.occurredAt ?? null, clock);
  const progress = useMemo(
    () => treatmentActionProgress(actionPlan.plan),
    [actionPlan.plan],
  );
  const planGreen = actionPlan.loadState === 'ready'
    && actionPlan.saveState === 'saved'
    && progress.ready;

  async function submitEvent() {
    if (!selectedType) return;
    const saved = await windowData.logEvent(selectedType, timing);
    if (!saved) return;
    setSelectedType(null);
    setTiming('now');
    setShowLogger(false);
    await onSituationRefresh();
  }

  function confirmRemove() {
    Alert.alert(t('window.removeTitle'), t('window.removeBody'), [
      { text: t('window.cancel'), style: 'cancel' },
      {
        text: t('window.removeConfirm'),
        style: 'destructive',
        onPress: async () => {
          const removed = await windowData.removeLatestEvent();
          if (removed) await onSituationRefresh();
        },
      },
    ]);
  }

  if (windowData.loading) {
    return (
      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <ActivityIndicator color={colors.primary} />
        <SafetyNote />
      </View>
    );
  }

  if (windowData.loadError) {
    return (
      <View accessibilityRole="alert" style={[styles.card, { backgroundColor: colors.white, borderColor: colors.coral }]}>
        <Text style={[styles.title, { color: colors.ink }]}>{t('window.loadErrorTitle')}</Text>
        <Text style={[styles.body, { color: colors.inkSoft }]}>{t('window.loadErrorBody')}</Text>
        <SafetyNote />
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
          onPress={() => void windowData.retry()}
        >
          <Text style={styles.primaryButtonText}>{t('window.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const activeEvent = state.active ? windowData.latestEvent : null;
  return (
    <View
      accessibilityRole={activeEvent ? 'summary' : undefined}
      style={[
        styles.card,
        {
          backgroundColor: activeEvent ? colors.secondaryLight : colors.white,
          borderColor: activeEvent ? colors.secondary : colors.line,
        },
      ]}
    >
      {activeEvent ? (
        <>
          <Text style={[styles.kicker, { color: colors.coral }]}>{t('window.openKicker')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('window.openTitle')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('window.openBody')}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.metaBadge, { color: colors.primary, borderColor: colors.primary }]}>
              {t(`window.types.${activeEvent.eventType}` as never)}
            </Text>
            <Text accessibilityLiveRegion="polite" style={[styles.hours, { color: colors.coral }]}>
              {t('window.hoursRemaining', { count: state.hoursRemaining })}
            </Text>
          </View>

          <SafetyNote />

          <View style={[styles.sayBox, { backgroundColor: colors.white, borderColor: colors.secondary }]}>
            <Text style={[styles.sayLabel, { color: colors.inkSoft }]}>{t('window.sayLabel')}</Text>
            <Text style={[styles.sayText, { color: colors.ink }]}>{t('window.sayText')}</Text>
          </View>

          <View style={[styles.readiness, { borderColor: planGreen ? colors.green : colors.coral }]}>
            <Text style={[styles.readinessTitle, { color: planGreen ? colors.green : colors.coral }]}>
              {actionPlan.loadState === 'loading'
                ? t('window.readinessChecking')
                : actionPlan.loadState === 'error'
                  ? t('window.readinessUnavailable')
                  : actionPlan.saveState === 'saving'
                    ? t('window.readinessSaving')
                    : actionPlan.saveState === 'error'
                      ? t('window.readinessUnsaved')
                      : planGreen
                  ? t('window.readinessReady')
                  : t('window.readinessNotReady', { percentage: progress.percentage })}
            </Text>
            <Text style={[styles.readinessBody, { color: colors.inkSoft }]}>
              {actionPlan.loadState === 'loading'
                ? t('window.readinessChecking')
                : actionPlan.loadState === 'error'
                  ? t('window.readinessUnavailableBody')
                  : actionPlan.saveState === 'saving'
                    ? t('window.readinessSavingBody')
                    : actionPlan.saveState === 'error'
                      ? t('window.readinessUnsavedBody')
                      : planGreen
                        ? t('window.readinessReadyBody')
                        : t('window.readinessBody')}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.primaryButton, { backgroundColor: planGreen ? colors.green : colors.primary }]}
              onPress={() => router.push('/treatment-action-plan' as never)}
            >
              <Text style={styles.primaryButtonText}>{t('window.openPlan')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.linkRow}>
            <TouchableOpacity accessibilityRole="button" onPress={() => setShowLogger((value) => !value)}>
              <Text style={[styles.linkText, { color: colors.primary }]}>{t('window.logAnother')}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={confirmRemove}>
              <Text style={[styles.linkText, { color: colors.coral }]}>{t('window.remove')}</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <>
          <Text style={[styles.kicker, { color: colors.inkSoft }]}>{t('window.closedKicker')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('window.closedTitle')}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('window.closedBody')}</Text>
          <SafetyNote />
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={() => setShowLogger(true)}
          >
            <Text style={styles.primaryButtonText}>{t('window.logButton')}</Text>
          </TouchableOpacity>
        </>
      )}

      {showLogger && (
        <View style={[styles.logger, { borderTopColor: colors.line }]}>
          <Text style={[styles.loggerTitle, { color: colors.ink }]}>{t('window.chooseType')}</Text>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {CONSEQUENCE_EVENT_TYPES.map((type) => {
              const selected = selectedType === type;
              return (
                <TouchableOpacity
                  key={type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected ? colors.primary : colors.line,
                      backgroundColor: selected ? colors.primaryLight : colors.white,
                    },
                  ]}
                  onPress={() => setSelectedType(type)}
                >
                  <Text style={[styles.chipText, { color: selected ? colors.primary : colors.ink }]}>
                    {t(`window.types.${type}` as never)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={[styles.loggerTitle, { color: colors.ink }]}>{t('window.chooseTiming')}</Text>
          <View accessibilityRole="radiogroup" style={styles.chips}>
            {TIMINGS.map((option) => {
              const selected = timing === option;
              return (
                <TouchableOpacity
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    {
                      borderColor: selected ? colors.primary : colors.line,
                      backgroundColor: selected ? colors.primaryLight : colors.white,
                    },
                  ]}
                  onPress={() => setTiming(option)}
                >
                  <Text style={[styles.chipText, { color: selected ? colors.primary : colors.ink }]}>
                    {t(`window.timings.${option}` as never)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {windowData.operationError && (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.coral }]}>{t('window.saveError')}</Text>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: !selectedType || windowData.saving }}
            disabled={!selectedType || windowData.saving}
            style={[
              styles.primaryButton,
              { backgroundColor: !selectedType || windowData.saving ? colors.inkSoft : colors.coral },
            ]}
            onPress={() => void submitEvent()}
          >
            <Text style={styles.primaryButtonText}>
              {windowData.saving ? t('window.saving') : t('window.startWindow')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function SafetyNote() {
  const { colors } = useTheme();
  const { t } = useTranslation('tracker');
  return (
    <View accessibilityRole="alert" style={[styles.safety, { borderLeftColor: colors.coral }]}>
      <Text style={[styles.safetyText, { color: colors.ink }]}>{t('window.safety')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1.5, padding: 18, marginBottom: 14 },
  kicker: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { fontSize: 21, lineHeight: 26, fontWeight: '900', marginTop: 6 },
  body: { fontSize: 14, lineHeight: 21, marginTop: 7 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 14 },
  metaBadge: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5, fontSize: 11, fontWeight: '800' },
  hours: { fontSize: 13, fontWeight: '900' },
  sayBox: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 14 },
  sayLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  sayText: { fontSize: 16, lineHeight: 23, fontWeight: '700', marginTop: 6 },
  readiness: { borderWidth: 1.5, borderRadius: 14, padding: 14, marginTop: 14 },
  readinessTitle: { fontSize: 15, fontWeight: '900' },
  readinessBody: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  primaryButton: { borderRadius: 99, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', marginTop: 14 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  safety: { borderLeftWidth: 4, paddingLeft: 11, marginTop: 14 },
  safetyText: { fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 15 },
  linkText: { fontSize: 12.5, fontWeight: '800' },
  logger: { borderTopWidth: 1, marginTop: 18, paddingTop: 16 },
  loggerTitle: { fontSize: 13, fontWeight: '800', marginBottom: 8, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 8 },
  chipText: { fontSize: 12, fontWeight: '700' },
  error: { fontSize: 12.5, fontWeight: '700', marginTop: 6 },
});
