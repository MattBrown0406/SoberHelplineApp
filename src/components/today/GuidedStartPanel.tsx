import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useAccount } from '../../contexts/AccountContext';
import { useGuidedStart } from '../../hooks/useGuidedStart';
import { guidedStartCopy } from '../../content/guidedStartCopy';
import { SITUATIONS, situationRoute, type StartSituation } from '../../lib/guidedStart';
import { EmergencyActions } from '../safety/EmergencyActions';

export function GuidedButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 48, justifyContent: 'center', padding: 12, borderWidth: 1, borderColor: colors.primary, borderRadius: 12, marginTop: 8, opacity: disabled ? 0.5 : 1 }}>
    <Text style={{ color: colors.primary, fontSize: 15, fontWeight: '600' }}>{label}</Text>
  </TouchableOpacity>;
}
export function GuidedStartPanel({ onContinue }: { onContinue?: () => void }) {
  const { user } = useAccount();
  return <Panel key={user?.id ?? 'none'} accountId={user?.id ?? null} onContinue={onContinue} />;
}
function Panel({ accountId, onContinue }: { accountId: string | null; onContinue?: () => void }) {
  const state = useGuidedStart(accountId);
  const { colors } = useTheme(); const { i18n } = useTranslation(); const c = guidedStartCopy(i18n.language); const router = useRouter();
  const [editing, setEditing] = useState(!!onContinue);
  const [urgent, setUrgent] = useState(false);
  const [selection, setSelection] = useState<StartSituation | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const choose = async (situation: StartSituation) => {
    setSelection(situation);
    // Urgent support is inline and never waits for IO, consent, or membership.
    if (situation === 'urgent') { setUrgent(true); return; }
    setUrgent(false);
    try { await state.edit(v => ({ ...v, situation })); if (!onContinue) setEditing(false); } catch { /* visible storage error */ }
  };
  return <View style={{ backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 16 }}>
    <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 21, fontWeight: '700' }}>{editing ? c.title : c.next}</Text>
    {editing && <>
      <Text style={{ color: colors.inkSoft, marginVertical: 8 }}>{c.optional}</Text>
      {SITUATIONS.map(s => <GuidedButton key={s} label={`${selection === s || (!selection && state.value.situation === s) ? '✓ ' : ''}${c.situations[s]}`}
        disabled={s !== 'urgent' && (!state.ready || state.busy)} onPress={() => void choose(s)} />)}
    </>}
    {!editing && state.ready && state.value.situation && <GuidedButton label={c.actions[state.value.situation]} onPress={() => router.push(situationRoute(state.value.situation!))} />}
    {!editing && <>
      <GuidedButton label={c.change} onPress={() => setEditing(true)} />
      <GuidedButton label={state.value.completed.length ? c.resume : c.start} onPress={() => router.push('/guided-journey')} />
    </>}
    {urgent && <View style={{ marginTop: 16 }}><Text accessibilityRole="alert" style={{ color: colors.ink, marginBottom: 12 }}>{c.disclaimer}</Text><EmergencyActions prominent />
      <GuidedButton label={c.back} onPress={() => setUrgent(false)} /></View>}
    {!state.ready && !state.error && <Text style={{ color: colors.inkSoft }}>{c.loading}</Text>}
    {state.error && <><Text accessibilityRole="alert" style={{ color: colors.coral }}>{c.error}</Text><GuidedButton label={c.retry} disabled={state.busy} onPress={() => void state.retry()} /></>}
    <Text style={{ color: colors.inkSoft, fontSize: 12, lineHeight: 18, marginTop: 12 }}>{c.local}</Text>
    {(state.error || (!onContinue && editing)) && <GuidedButton label={c.reset} disabled={state.busy} onPress={() => setConfirmClear(true)} />}
    {confirmClear && <><Text style={{ color: colors.ink }}>{c.confirmReset}</Text><GuidedButton label={c.reset} disabled={state.busy} onPress={() => { void state.reset().then(() => { setConfirmClear(false); setSelection(null); }).catch(() => {}); }} /><GuidedButton label={c.cancel} onPress={() => setConfirmClear(false)} /></>}
    {onContinue ? <>
      <GuidedButton label={c.continue} disabled={state.busy || !state.ready || selection === 'urgent' || (selection !== null && selection !== state.value.situation) || (!selection && !state.value.situation)} onPress={onContinue} />
      <GuidedButton label={c.skip} onPress={onContinue} />
    </> : editing && <GuidedButton label={c.skip} onPress={() => setEditing(false)} />}
  </View>;
}
