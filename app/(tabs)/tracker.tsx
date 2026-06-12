import React, { useMemo } from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../src/contexts/AccountContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useTracker } from '../../src/hooks/useTracker';

const ALERT_THRESHOLD = 3;

interface Sign {
  id: string;
  label: string;
  category: string;
}

function MeterBar({
  pct,
  color,
  label,
}: {
  pct: number;
  color: string;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.meterWrapper}>
      <View style={[styles.meterTrack, { backgroundColor: colors.line }]}>
        <View
          style={[
            styles.meterFill,
            { width: `${Math.max(pct, 2)}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={[styles.meterLabel, { color: colors.inkSoft }]}>{label}</Text>
    </View>
  );
}

function SignToggle({
  sign,
  active,
  color,
  onToggle,
}: {
  sign: Sign;
  active: boolean;
  color: string;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.75}
      style={[
        styles.signRow,
        {
          backgroundColor: active ? color + '18' : 'transparent',
          borderColor: active ? color : colors.line,
        },
      ]}
    >
      <View
        style={[
          styles.signCheck,
          { borderColor: active ? color : colors.line, backgroundColor: active ? color : 'transparent' },
        ]}
      >
        {active ? <Text style={styles.signCheckMark}>✓</Text> : null}
      </View>
      <View style={styles.signTextWrap}>
        <Text style={[styles.signLabel, { color: colors.ink }]}>{sign.label}</Text>
        <Text style={[styles.signCategory, { color: colors.inkSoft }]}>{sign.category}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function TrackerScreen() {
  const { colors } = useTheme();
  const { user, isAttached } = useAccount();
  const { t, i18n } = useTranslation('tracker');

  const { activeWarning, activeRecovery, toggleSign, warningLevel, recoveryMomentum } =
    useTracker(user?.id ?? null);

  const warningSigns: Sign[] = useMemo(
    () => t('warning.signs', { returnObjects: true }) as Sign[],
    [i18n.language],
  );
  const recoverySigns: Sign[] = useMemo(
    () => t('recovery.signs', { returnObjects: true }) as Sign[],
    [i18n.language],
  );

  const warnCount = activeWarning.size;
  const recovCount = activeRecovery.size;
  const showWarningAlert = warnCount >= ALERT_THRESHOLD;
  const showRecoveryAlert = recovCount >= ALERT_THRESHOLD;

  const warningMeterLabel =
    warningLevel === 0
      ? t('warning.riskLow')
      : warningLevel <= 50
      ? t('warning.riskMid')
      : t('warning.riskHigh');

  const recoveryMeterLabel =
    recoveryMomentum === 0
      ? t('recovery.momentumLow')
      : recoveryMomentum <= 60
      ? t('recovery.momentumMid')
      : t('recovery.momentumHigh');

  const privacyNote =
    t('privacyNote') + (isAttached ? t('privacyNoteCoach') : t('privacyNoteDirect'));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Warning signs ─────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
            {t('warning.eyebrow')}
          </Text>

          <MeterBar
            pct={warningLevel}
            color={colors.coral}
            label={warningMeterLabel}
          />

          {showWarningAlert && (
            <View style={[styles.alertBanner, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
              <Text style={[styles.alertText, { color: colors.coral }]}>
                {t('warning.alertText')}
                {isAttached ? t('warning.alertCoachSuffix') : t('warning.alertDirectSuffix')}
              </Text>
            </View>
          )}

          <View style={styles.signList}>
            {warningSigns.map((sign) => (
              <SignToggle
                key={sign.id}
                sign={sign}
                active={activeWarning.has(sign.id)}
                color={colors.coral}
                onToggle={() => toggleSign(sign.id, 'warning')}
              />
            ))}
          </View>
        </View>

        {/* ── Recovery signs ────────────────────────────────────── */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
            {t('recovery.eyebrow')}
          </Text>

          <MeterBar
            pct={recoveryMomentum}
            color={colors.green}
            label={recoveryMeterLabel}
          />

          {showRecoveryAlert && (
            <View style={[styles.alertBanner, { backgroundColor: colors.greenLight, borderColor: colors.green }]}>
              <Text style={[styles.alertText, { color: colors.green }]}>
                {t('recovery.alertText')}
              </Text>
            </View>
          )}

          <View style={styles.signList}>
            {recoverySigns.map((sign) => (
              <SignToggle
                key={sign.id}
                sign={sign}
                active={activeRecovery.has(sign.id)}
                color={colors.green}
                onToggle={() => toggleSign(sign.id, 'recovery')}
              />
            ))}
          </View>
        </View>

        {/* ── Privacy note ──────────────────────────────────────── */}
        <Text style={[styles.privacyNote, { color: colors.inkSoft }]}>{privacyNote}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
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
    marginBottom: 12,
  },
  meterWrapper: { marginBottom: 12 },
  meterTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  meterFill: {
    height: 8,
    borderRadius: 4,
  },
  meterLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  alertBanner: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  alertText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  signList: { gap: 6 },
  signRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 10,
  },
  signCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signCheckMark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  signTextWrap: { flex: 1 },
  signLabel: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  signCategory: {
    fontSize: 11,
    marginTop: 1,
  },
  privacyNote: {
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
});
