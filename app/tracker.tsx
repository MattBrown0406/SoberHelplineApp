import { useToolOpened } from '../src/hooks/useToolOpened';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { ScreenContainer, TAB_SCREEN_BOTTOM_CLEARANCE } from '../src/components/ui/ScreenContainer';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useTracker } from '../src/hooks/useTracker';
import { useSituation } from '../src/hooks/useSituation';
import { INITIAL_TRACKER_SPIKE_MEMORY, nextTrackerSpike, type TrackerSpikeMemory } from '../src/lib/trackerSpike';
import { SituationOffRamp } from '../src/components/situation/SituationOffRamp';
import type { FunnelDoor } from '../src/lib/situation';
import { supabase } from '../src/lib/supabase';
import { appAlert } from '../src/lib/appAlert';
import { WillingnessWindowCard } from '../src/components/tracker/WillingnessWindowCard';
import { Gate } from '../src/components/auth/Gate';
import { FreeTierPaywall } from '../src/components/ui/FreeTierPaywall';

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
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${sign.label}. ${sign.category}`}
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

/**
 * The Tracker (signs to watch), a pushed screen since 4.4: it is no longer a
 * tab. Reached from Today and a tracker push. No tab may be named `tracker`
 * (it would capture `/tracker`). Its membership gate is unchanged.
 */
export default function TrackerScreen() {
  useToolOpened('tracker');
  return (
    <Gate feature="tracker" fallback={<TrackerLocked />}>
      <TrackerContent />
    </Gate>
  );
}

/** The title row: a 44-point Back, then the screen's name. */
function TrackerHeader() {
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('tracker');
  // Opened from a notification or a link there may be nothing to go back to: then Today.
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };
  return (
    <View style={styles.headerRow}>
      <TouchableOpacity
        onPress={goBack}
        accessibilityRole="button"
        accessibilityLabel={t('common:a11y.back')}
        style={styles.backButton}
      >
        <Text accessible={false} style={[styles.backChevron, { color: colors.primary }]}>‹</Text>
      </TouchableOpacity>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>
        {t('common:nav.tracker')}
      </Text>
    </View>
  );
}

// The floating Safety button shows on the Tracker too (SafetyShortcut): the
// last row scrolls clear of it, as on the tabs.
/** Without membership: the same plans card the tab showed, under a way back. */
function TrackerLocked() {
  const { colors } = useTheme();
  return (
    <ScreenContainer backgroundColor={colors.cream} contentContainerStyle={styles.clearSafety}>
      <TrackerHeader />
      <FreeTierPaywall inline />
    </ScreenContainer>
  );
}

function TrackerContent() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user, isAttached } = useAccount();
  const { t, i18n } = useTranslation('tracker');

  const { activeWarning, activeRecovery, toggleSign, warningLevel, recoveryMomentum, isLoading: trackerLoading } =
    useTracker(user?.id ?? null, user?.timezone);
  const { situation, loading: situationLoading, loaded: situationLoaded, refresh: refreshSituation } = useSituation(user?.id ?? null);

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

  // On a warning spike, escalate the loved-one status (never downgrading from
  // crisis/escalating) so the situation reflects it, then re-read the band.
  // Fires once per rising edge.
  async function handleToggle(signId: string, kind: 'warning' | 'recovery') {
    if (!(await toggleSign(signId, kind))) appAlert(t('signSaveError'));
  }

  // Only a spike made now escalates (see nextTrackerSpike): signs already
  // logged when the tracker loads must not re-raise a status the family has
  // since brought down from the Today pathway card.
  const spikeMemoryRef = useRef<TrackerSpikeMemory>(INITIAL_TRACKER_SPIKE_MEMORY);
  // Re-read the band on focus (also on return from Trajectory) so a status changed on the
  // Today pathway card is what a new spike compares against.
  useFocusEffect(useCallback(() => { void refreshSituation(); }, [refreshSituation]));
  useEffect(() => {
    // Until both hooks have hydrated, the current status is unknown: writing
    // 'escalating' against the default would downgrade a real 'crisis'.
    if (trackerLoading || situationLoading || !situationLoaded) return;
    const current = situation.drivers.loved_one_status;
    const { memory, action } = nextTrackerSpike(spikeMemoryRef.current, warnCount, ALERT_THRESHOLD, current);
    spikeMemoryRef.current = memory;
    if (action === 'escalate') {
      void supabase
        .rpc('set_loved_one_status', { p_status: 'escalating' })
        .then(() => refreshSituation());
    } else if (action === 'refresh') {
      void refreshSituation();
    }
  }, [warnCount, trackerLoading, situationLoading, situationLoaded, situation.drivers.loved_one_status, refreshSituation]);

  // A spike always offers at least coaching; sustained crisis offers intervention.
  const spikeDoor: FunnelDoor =
    situation.band === 'crisis' && situation.sustained ? 'intervention' : 'coaching';

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
    <ScreenContainer backgroundColor={colors.cream} contentContainerStyle={styles.clearSafety}>
        <TrackerHeader />
        <WillingnessWindowCard
          accountId={user?.id ?? null}
          onSituationRefresh={refreshSituation}
        />
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
            <>
              <View style={[styles.alertBanner, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
                <Text style={[styles.alertText, { color: colors.coral }]}>
                  {t('warning.alertText')}
                  {isAttached ? t('warning.alertCoachSuffix') : t('warning.alertDirectSuffix')}
                </Text>
              </View>
              {!isAttached && (
                <View style={styles.offRampWrap}>
                  <SituationOffRamp door={spikeDoor} />
                </View>
              )}
            </>
          )}

          <View style={styles.signList}>
            {warningSigns.map((sign) => (
              <SignToggle
                key={sign.id}
                sign={sign}
                active={activeWarning.has(sign.id)}
                color={colors.coral}
                onToggle={() => void handleToggle(sign.id, 'warning')}
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
                onToggle={() => void handleToggle(sign.id, 'recovery')}
              />
            ))}
          </View>
        </View>

        {/* ── Trajectory entry ──────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.trajectoryBtn, { backgroundColor: colors.white, borderColor: colors.line }]}
          onPress={() => router.push('/trajectory')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('trajectory.openButton')}
        >
          <Text style={[styles.trajectoryBtnText, { color: colors.ink }]}>
            {t('trajectory.openButton')}
          </Text>
          <Text accessible={false} style={[styles.trajectoryChevron, { color: colors.primary }]}>›</Text>
        </TouchableOpacity>

        {/* ── Privacy note ──────────────────────────────────────── */}
        <Text style={[styles.privacyNote, { color: colors.inkSoft }]}>{privacyNote}</Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  clearSafety: { paddingBottom: TAB_SCREEN_BOTTOM_CLEARANCE },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  // A full 44-point target; the negative margin keeps the chevron in line with the cards.
  backButton: {
    minWidth: 44,
    minHeight: 44,
    marginLeft: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backChevron: { fontSize: 32, lineHeight: 36, fontWeight: '300' },
  heading: { flex: 1, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
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
  offRampWrap: { marginBottom: 12 },
  alertText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  signList: { gap: 6 },
  signRow: {
    minHeight: 44,
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
  trajectoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 15,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  trajectoryBtnText: { fontSize: 14.5, fontWeight: '700' },
  trajectoryChevron: { fontSize: 22, fontWeight: '700' },
});
