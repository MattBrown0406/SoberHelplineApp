import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { FreeTierPaywall } from '../src/components/ui/FreeTierPaywall';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { useInvitationEngine } from '../src/hooks/useInvitationEngine';
import { useLovedOneProfile } from '../src/hooks/useLovedOneProfile';
import { registerForPushNotifications } from '../src/hooks/usePushNotifications';
import { DailyMovesCard } from '../src/components/invitation/DailyMovesCard';
import { ForecastCard } from '../src/components/invitation/ForecastCard';
import { PausedCard } from '../src/components/invitation/PausedCard';
import { SafetyFirstPanel } from '../src/components/invitation/SafetyFirstPanel';
import {
  BackLink,
  EngineCard,
  Kicker,
  PrimaryButton,
  SecondaryButton,
  TextLink,
} from '../src/components/invitation/ui';
import { formatLocalDate } from '../src/lib/invitationCopy';

/**
 * Invitation Engine overview. Not wrapped in a paid Gate: the pattern map is
 * the free hook and the safety-first path is never paywalled. Paid stages are
 * chosen by the canAccessInvitationEngine entitlement (engineStage).
 */
export default function InvitationEngineScreen() {
  const { user } = useAccount();
  return <InvitationEngineContent key={user?.id ?? 'signed-out'} />;
}

function InvitationEngineContent() {
  const { user } = useAccount();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('invitation');
  const router = useRouter();
  const accountId = user?.id ?? null;
  const engine = useInvitationEngine(accountId, user?.timezone);
  const { profile } = useLovedOneProfile(accountId);
  const { snapshot, stage, forecast, moves } = engine;
  const [noDevice, setNoDevice] = useState(false);
  // True from the first tap until the permission prompt and the save settle,
  // so a quick on→off can't race the prompt and end up on.
  const [alertsPending, setAlertsPending] = useState(false);

  const name = profile?.name?.trim() ?? '';

  async function toggleAlerts(enabled: boolean) {
    if (alertsPending) return;
    setAlertsPending(true);
    setNoDevice(false);
    try {
      if (enabled && accountId && Platform.OS !== 'web') {
        const registered = await registerForPushNotifications(accountId).catch(() => false);
        if (!registered) setNoDevice(true);
      }
      await engine.setWindowPushEnabled(enabled);
    } finally {
      setAlertsPending(false);
    }
  }

  return (
    <ScreenContainer contentContainerStyle={styles.wrap}>
      <BackLink label={t('common.back')} onPress={() => router.back()} />
      <View style={[styles.hero, { backgroundColor: colors.primaryDark }]}>
        <Text style={styles.heroKicker}>{t('engine.kicker')}</Text>
        <Text accessibilityRole="header" style={styles.heroTitle}>
          {name ? t('engine.titleNamed', { name }) : t('engine.title')}
        </Text>
        <Text style={styles.heroBody}>{t('engine.subtitle')}</Text>
        {snapshot?.plan.scope === 'family' && (
          <Text style={styles.heroNote}>{t('engine.familyPlan', { count: snapshot.plan.members })}</Text>
        )}
      </View>

      {!snapshot && engine.loading && (
        <View style={styles.loading} accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      {!snapshot && !engine.loading && engine.loadError && (
        <EngineCard tone="alert">
          <Text accessibilityRole="alert" style={[styles.cardTitle, { color: colors.coral }]}>{t('common.loadErrorTitle')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('common.loadErrorBody')}</Text>
          <PrimaryButton label={t('common.retry')} onPress={() => { void engine.reload(); }} />
        </EngineCard>
      )}

      {snapshot && stage === 'map' && (
        <EngineCard tone="warm">
          <Kicker>{t('setup.kicker')}</Kicker>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('engine.introTitle')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('engine.introBody')}</Text>
          <Text style={[styles.evidence, { color: colors.inkSoft }]}>{t('engine.evidence')}</Text>
          <PrimaryButton
            label={snapshot.profile.saved ? t('engine.continueMap') : t('engine.startMap')}
            onPress={() => router.push('/invitation-setup' as never)}
          />
        </EngineCard>
      )}

      {snapshot && stage === 'safety' && (
        <>
          <SafetyFirstPanel />
          {engine.hasAccess && moves && (
            <DailyMovesCard
              moves={moves}
              movesDone={snapshot.today.movesDone}
              onToggle={(moveId) => { void engine.toggleMove(moveId); }}
              busyMove={engine.busyMove}
              error={engine.actionError === 'move'}
              familyScope={false}
              ownProfile={profile}
              localDate={snapshot.localDate}
            />
          )}
          <TextLink label={t('engine.editMap')} onPress={() => router.push('/invitation-setup' as never)} />
        </>
      )}

      {snapshot && stage === 'paywall' && (
        <>
          <EngineCard>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('engine.paywallTitle')}</Text>
            <Text style={[styles.body, { color: colors.ink }]}>{t('engine.paywallBody')}</Text>
          </EngineCard>
          <FreeTierPaywall inline />
          <TextLink label={t('engine.editMap')} onPress={() => router.push('/invitation-setup' as never)} />
        </>
      )}

      {snapshot && stage === 'finishSetup' && (
        <EngineCard tone="warm">
          <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('engine.finishSetupTitle')}</Text>
          <Text style={[styles.body, { color: colors.ink }]}>{t('engine.finishSetupBody')}</Text>
          <PrimaryButton
            label={t('engine.finishSetupButton')}
            onPress={() => router.push({ pathname: '/invitation-setup', params: { step: 'alerts' } } as never)}
          />
        </EngineCard>
      )}

      {snapshot && stage === 'active' && forecast && (
        <>
          {forecast.paused ? (
            <PausedCard reason={forecast.paused} />
          ) : (
            <ForecastCard
              forecast={forecast}
              check={snapshot.today.check}
              onCheck={(mood) => { void engine.setCheck(mood); }}
              checkSaving={engine.checkSaving}
              checkError={engine.actionError === 'check'}
            />
          )}

          {!forecast.paused && forecast.level === 'good' && (
            <PrimaryButton
              label={t('engine.prepare')}
              color={colors.green}
              onPress={() => router.push('/invitation-kit' as never)}
            />
          )}

          {moves && (
            <View style={styles.section}>
              <DailyMovesCard
                moves={moves}
                movesDone={snapshot.today.movesDone}
                onToggle={(moveId) => { void engine.toggleMove(moveId); }}
                busyMove={engine.busyMove}
                error={engine.actionError === 'move'}
                familyScope={snapshot.plan.scope === 'family'}
                ownProfile={profile}
                localDate={snapshot.localDate}
              />
            </View>
          )}

          {!forecast.paused && forecast.level !== 'good' && (
            <SecondaryButton label={t('engine.prepare')} onPress={() => router.push('/invitation-kit' as never)} />
          )}
          {!forecast.paused && (
            <SecondaryButton label={t('engine.logOutcome')} onPress={() => router.push('/invitation-outcome' as never)} />
          )}

          {snapshot.lastAttempt && (
            <EngineCard style={styles.section}>
              <Text style={[styles.body, { color: colors.ink }]}>{t(`engine.lastAttempt.${snapshot.lastAttempt.outcome}`)}</Text>
              {snapshot.lastAttempt.nextWindowDate && snapshot.lastAttempt.nextWindowDate >= snapshot.localDate && (
                <Text style={[styles.body, { color: colors.primary, fontWeight: '800' }]}>
                  {t('engine.nextWindow', { date: formatLocalDate(snapshot.lastAttempt.nextWindowDate, i18n.language) })}
                </Text>
              )}
            </EngineCard>
          )}

          <EngineCard style={styles.section}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('engine.alertsTitle')}</Text>
            <Text style={[styles.body, { color: colors.inkSoft }]}>{t('engine.alertsBody')}</Text>
            <View style={styles.switchRow}>
              <Text style={[styles.switchLabel, { color: colors.ink }]}>{t('engine.alertsToggle')}</Text>
              <Switch
                accessibilityLabel={t('engine.alertsToggle')}
                value={snapshot.state.windowPushOptIn}
                disabled={engine.pushSaving || alertsPending}
                onValueChange={(value) => { void toggleAlerts(value); }}
                trackColor={{ true: colors.green, false: colors.line }}
              />
            </View>
            {noDevice && <Text style={[styles.note, { color: colors.inkSoft }]}>{t('engine.alertsNoDevice')}</Text>}
            {engine.actionError === 'push' && (
              <Text accessibilityRole="alert" style={[styles.note, { color: colors.coral }]}>{t('engine.alertsError')}</Text>
            )}
          </EngineCard>

          <View style={styles.links}>
            <TextLink label={t('engine.progress')} onPress={() => router.push('/invitation-progress' as never)} />
            <TextLink label={t('engine.editMap')} onPress={() => router.push('/invitation-setup' as never)} />
          </View>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 64 },
  hero: { borderRadius: 22, padding: 20, marginBottom: 14 },
  heroKicker: { color: '#f0bd78', fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 },
  heroTitle: { color: '#fff', fontSize: 26, lineHeight: 31, fontWeight: '900' },
  heroBody: { color: '#e6edf4', fontSize: 14.5, lineHeight: 21, marginTop: 9 },
  heroNote: { color: '#f0bd78', fontSize: 12, fontWeight: '800', marginTop: 10 },
  loading: { paddingVertical: 40 },
  cardTitle: { fontSize: 18, lineHeight: 23, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  evidence: { fontSize: 12.5, lineHeight: 18, marginTop: 10, fontStyle: 'italic' },
  section: { marginTop: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 12 },
  switchLabel: { flex: 1, fontSize: 14, fontWeight: '800' },
  note: { fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 8 },
});
