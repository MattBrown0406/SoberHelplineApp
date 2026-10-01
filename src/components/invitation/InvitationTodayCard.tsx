import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useInvitationEngine } from '../../hooks/useInvitationEngine';
import { DailyMovesCard } from './DailyMovesCard';
import { PausedCard } from './PausedCard';
import { EngineCard, Kicker, PrimaryButton } from './ui';

/**
 * The Invitation Engine on Today: the free pattern-map hook, the safety-first
 * notice, or — for members who are set up — today's forecast and two moves
 * with one-tap done. One clear next action per state.
 */
export function InvitationTodayCard({ accountId, timezone }: { accountId: string | null; timezone?: string | null }) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const router = useRouter();
  const engine = useInvitationEngine(accountId, timezone);
  const { snapshot, stage, forecast, moves } = engine;

  if (!accountId || !snapshot || !stage) return null;
  const openEngine = () => router.push('/invitation-engine' as never);

  if (stage === 'map') {
    return (
      <EngineCard tone="warm">
        <Kicker>{t('today.kicker')}</Kicker>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('today.hookTitle')}</Text>
        <Text style={[styles.body, { color: colors.ink }]}>{t('today.hookBody')}</Text>
        <PrimaryButton
          label={snapshot.profile.saved ? t('today.continueButton') : t('today.hookButton')}
          onPress={() => router.push('/invitation-setup' as never)}
        />
      </EngineCard>
    );
  }

  if (stage === 'safety') {
    return (
      <EngineCard tone="alert">
        <Kicker color={colors.coral}>{t('today.kicker')}</Kicker>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('today.safetyTitle')}</Text>
        <Text style={[styles.body, { color: colors.ink }]}>{t('today.safetyBody')}</Text>
        <PrimaryButton label={t('today.open')} color={colors.coral} onPress={openEngine} />
      </EngineCard>
    );
  }

  if (stage === 'paywall' || stage === 'finishSetup') {
    return (
      <EngineCard>
        <Kicker>{t('today.kicker')}</Kicker>
        <Text style={[styles.body, { color: colors.ink }]}>
          {stage === 'paywall' ? t('today.paywallBody') : t('today.finishSetupBody')}
        </Text>
        <PrimaryButton
          label={stage === 'paywall' ? t('today.open') : t('today.finishSetup')}
          onPress={stage === 'paywall'
            ? openEngine
            : () => router.push({ pathname: '/invitation-setup', params: { step: 'alerts' } } as never)}
        />
      </EngineCard>
    );
  }

  if (forecast?.paused) {
    return <PausedCard reason={forecast.paused} compact openLabel={t('today.open')} onOpen={openEngine} />;
  }

  const good = forecast?.level === 'good';
  return (
    <EngineCard tone={good ? 'calm' : 'plain'}>
      <Kicker>{t('today.kicker')}</Kicker>
      {forecast && (
        <View accessibilityLiveRegion="polite">
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {t('today.forecastLabel', { level: t(`forecast.level.${forecast.level}`) })}
          </Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t(`forecast.levelBody.${forecast.level}`)}</Text>
        </View>
      )}
      {moves && (
        <DailyMovesCard
          compact
          moves={moves}
          movesDone={snapshot.today.movesDone}
          onToggle={(moveId) => { void engine.toggleMove(moveId); }}
          busyMove={engine.busyMove}
          error={engine.actionError === 'move'}
          familyScope={snapshot.plan.scope === 'family'}
          ownProfile={null}
          localDate={snapshot.localDate}
        />
      )}
      <PrimaryButton
        label={good ? t('today.prepare') : t('today.open')}
        color={good ? colors.green : undefined}
        onPress={good ? () => router.push('/invitation-kit' as never) : openEngine}
      />
    </EngineCard>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 19, lineHeight: 24, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 6 },
});
