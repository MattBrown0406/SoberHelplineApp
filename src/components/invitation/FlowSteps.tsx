import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { BackLink } from './ui';
import { FLOW_ROUTES, FLOW_STEPS, flowStepNumber, type FlowState, type FlowStep } from './invitationFlow';

/** The four steps on the engine screen: done ones ticked, the current one highlighted, open ones tappable. */
export function FlowStepList({ state }: { state: FlowState }) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const router = useRouter();
  const total = FLOW_STEPS.length;
  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('flow.title')}</Text>
      {FLOW_STEPS.map((step) => {
        const number = flowStepNumber(step);
        const current = state.current === step;
        const done = state.done.includes(step);
        const open = state.open.includes(step);
        const label = t(`flow.steps.${step}`);
        const status = current ? t('flow.current') : done ? t('flow.done') : '';
        const a11y = [t('flow.stepOf', { step: number, total }), label, status].filter(Boolean).join('. ');
        const row = (
          <>
            <View
              style={[
                styles.badge,
                current
                  ? { backgroundColor: colors.primary, borderColor: colors.primary }
                  : done
                    ? { backgroundColor: colors.greenLight, borderColor: colors.green }
                    : { backgroundColor: colors.white, borderColor: colors.line },
              ]}
            >
              <Text style={[styles.badgeText, { color: current ? '#fff' : done ? colors.green : colors.inkSoft }]}>
                {done && !current ? '✓' : number}
              </Text>
            </View>
            <View style={styles.text}>
              <Text style={[styles.label, { color: open || current ? colors.ink : colors.inkSoft, fontWeight: current ? '900' : '700' }]}>
                {label}
              </Text>
              {status ? (
                <Text style={[styles.status, { color: current ? colors.primary : colors.green }]}>{status}</Text>
              ) : null}
            </View>
          </>
        );
        const rowStyle = [
          styles.row,
          { borderTopColor: colors.line },
          current && { backgroundColor: colors.primaryLight },
        ];
        return open ? (
          <TouchableOpacity
            key={step}
            accessibilityRole="button"
            accessibilityLabel={a11y}
            accessibilityState={{ selected: current }}
            onPress={() => router.push(FLOW_ROUTES[step] as never)}
            activeOpacity={0.75}
            style={rowStyle}
          >
            {row}
          </TouchableOpacity>
        ) : (
          <View key={step} accessible accessibilityLabel={a11y} style={rowStyle}>
            {row}
          </View>
        );
      })}
    </View>
  );
}

/** "Step 2 of 4 · Get ready to ask": the same line at the top of every step screen. */
export function FlowStepLine({ step }: { step: FlowStep }) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  return (
    <Text style={[styles.stepLine, { color: colors.inkSoft }]}>
      {t('flow.stepLine', { step: flowStepNumber(step), total: FLOW_STEPS.length, name: t(`flow.steps.${step}`) })}
    </Text>
  );
}

/**
 * The step screens' way back: to the engine already in the stack (popping
 * this step), or to a fresh engine when she came straight here from Today or
 * a notification.
 */
export function EngineBackLink() {
  const { t } = useTranslation('invitation');
  const router = useRouter();
  return <BackLink label={t('flow.back')} onPress={() => router.dismissTo('/invitation-engine' as never)} />;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 18, paddingTop: 15, paddingHorizontal: 6, paddingBottom: 6, marginBottom: 14 },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '900', paddingHorizontal: 11, marginBottom: 8 },
  // No fixed height: the label wraps at large text sizes and the row grows.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
  },
  badge: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 14, fontWeight: '900' },
  text: { flex: 1 },
  label: { fontSize: 15, lineHeight: 20 },
  status: { fontSize: 12, fontWeight: '800', marginTop: 2 },
  stepLine: { fontSize: 12, fontWeight: '800', marginBottom: 6 },
});
