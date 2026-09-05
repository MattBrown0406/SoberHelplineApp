import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { GuidedButton } from '../src/components/today/GuidedStartPanel';
import { useGuidedStart } from '../src/hooks/useGuidedStart';
import { guidedStartCopy } from '../src/content/guidedStartCopy';
import { JOURNEY_STEPS, JOURNEY_ROUTES, completeJourneyStep } from '../src/lib/guidedStart';
export default function GuidedJourneyScreen() {
  const { user } = useAccount();
  return <Journey key={user?.id ?? 'none'} accountId={user?.id ?? null} />;
}
function Journey({ accountId }: { accountId: string | null }) {
  const state = useGuidedStart(accountId); const router = useRouter(); const { colors } = useTheme();
  const { i18n } = useTranslation(); const c = guidedStartCopy(i18n.language); const [confirm, setConfirm] = useState(false);
  const current = JOURNEY_STEPS[state.value.completed.length];
  return <ScreenContainer backgroundColor={colors.cream}>
    <GuidedButton label={c.back} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} />
    <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '700', color: colors.ink, marginVertical: 16 }}>{c.journey}</Text>
    <Text style={{ color: colors.inkSoft, lineHeight: 21 }}>{c.pace}</Text>
    <GuidedButton label={c.urgent} onPress={() => router.push('/safety-wallet')} />
    {!state.ready && !state.error && <Text style={{ color: colors.inkSoft }}>{c.loading}</Text>}
    {state.ready && JOURNEY_STEPS.map(step => <View key={step} style={{ borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, padding: 16, borderRadius: 14, marginTop: 14 }}>
      <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 18, fontWeight: '700' }}>{c.steps[step]}{state.value.completed.includes(step) ? ` · ${c.done}` : ''}</Text>
      <Text style={{ color: colors.inkSoft, lineHeight: 21, marginTop: 8 }}>{c.descriptions[step]}</Text>
      <GuidedButton label={c.open} onPress={() => router.push(JOURNEY_ROUTES[step])} />
      {step === current && <GuidedButton label={c.complete} disabled={state.busy} onPress={() => { void state.edit(v => completeJourneyStep(v, step)).catch(() => {}); }} />}
    </View>)}
    {state.ready && !current && <Text accessibilityLiveRegion="polite" style={{ color: colors.ink, marginVertical: 16 }}>{c.finished}</Text>}
    {state.error && <><Text accessibilityRole="alert" style={{ color: colors.coral }}>{c.error}</Text><GuidedButton label={c.retry} disabled={state.busy} onPress={() => void state.retry()} /></>}
    <Text style={{ color: colors.inkSoft, lineHeight: 18, fontSize: 12, marginVertical: 16 }}>{c.local}</Text>
    <GuidedButton label={c.reset} disabled={state.busy} onPress={() => setConfirm(true)} />
    {confirm && <><Text style={{ color: colors.ink }}>{c.confirmReset}</Text><GuidedButton label={c.reset} disabled={state.busy} onPress={() => { void state.reset().then(() => setConfirm(false)).catch(() => {}); }} /><GuidedButton label={c.cancel} onPress={() => setConfirm(false)} /></>}
  </ScreenContainer>;
}
