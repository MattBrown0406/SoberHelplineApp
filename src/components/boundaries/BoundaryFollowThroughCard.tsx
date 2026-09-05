import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { boundaryFollowThroughStore as store } from '../../storage/boundaryFollowThrough';
import { isReviewDate, localReviewDate, reviewDue, type BoundaryFollowThrough, type BoundaryResponse } from '../../storage/boundaryFollowThroughCore';
import { ContextualMembershipInvitation } from '../../membershipInvitations/ContextualMembershipInvitation';
import { boundaryFollowThroughCopy } from './followThroughCopy';

/** Parent keys this editor by account + wall, so private drafts never cross accounts. */
export function BoundaryFollowThroughCard({ accountId, wallId }: { accountId: string; wallId: string }) {
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  const copy = boundaryFollowThroughCopy(i18n.language);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<BoundaryFollowThrough>({ communicate: '', action: '', reviewDate: '', response: null, reviewedOn: null });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [neutralSave, setNeutralSave] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    let active = true;
    setLoaded(false); setError(false);
    void store.get(accountId, wallId).then(value => {
      if (!active) return;
      if (value) setPlan(value);
      setLoaded(true);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; alive.current = false; };
  }, [accountId, wallId, attempt]);
  function edit(patch: Partial<BoundaryFollowThrough>) {
    setPlan(prev => ({ ...prev, ...patch })); setSaved(false); setInvalid(false);
  }
  async function save(response?: BoundaryResponse) {
    if (!loaded || busy.current) return;
    if (!plan.communicate.trim() || !plan.action.trim() || !isReviewDate(plan.reviewDate)) { setInvalid(true); return; }
    const next = { ...plan, communicate: plan.communicate.trim(), action: plan.action.trim(),
      ...(response ? { response, reviewedOn: localReviewDate() } : {}) };
    busy.current = true; setSaving(true); setSaved(false); setError(false); setInvalid(false);
    try {
      await store.save(accountId, wallId, next);
      if (alive.current) { setPlan(next); setSaved(true); if (response === undefined) setNeutralSave(true); }
    } catch { if (alive.current) setError(true); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  }
  function button(label: string, onPress: () => void, disabled = false, selected = false) {
    return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
      style={[styles.button, { borderColor: colors.primary, backgroundColor: selected ? colors.primaryLight : colors.cream, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={{ color: colors.primary, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>;
  }
  return <View style={styles.container}>
    <ContextualMembershipInvitation accountId={accountId} placement="boundary-saved" completed={neutralSave} />
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} aria-expanded={open} onPress={() => setOpen(!open)} style={styles.button}>
      <Text style={{ color: colors.primary, fontWeight: '700' }}>{copy.open}</Text>
    </TouchableOpacity>
    {loaded && isReviewDate(plan.reviewDate) && reviewDue(plan) ? <Text style={{ color: colors.primary }}>{copy.due}</Text> : null}
    {open ? <View style={styles.body}>
      <Text style={[styles.title, { color: colors.ink }]}>{copy.title}</Text>
      <Text style={{ color: colors.ink }}>{copy.purpose}</Text>
      <Text style={{ color: colors.inkSoft }}>{copy.privacy}</Text>
      {!loaded && !error ? <Text style={{ color: colors.inkSoft }}>{copy.loading}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.ink }}>{copy.error}</Text> : null}
      {!loaded && error ? button(copy.retry, () => setAttempt(v => v + 1)) : null}
      {loaded ? <>
        {(['communicate', 'action', 'reviewDate'] as const).map(field => <View key={field} style={styles.body}>
          <Text style={{ color: colors.ink }}>{copy[field]}</Text>
          <TextInput accessibilityLabel={copy[field]} value={plan[field]} editable={!saving}
            onChangeText={value => edit(field === 'reviewDate' ? { reviewDate: value, response: null, reviewedOn: null } : { [field]: value })}
            multiline={field !== 'reviewDate'} maxLength={field === 'reviewDate' ? 10 : 2000}
            autoCapitalize={field === 'reviewDate' ? 'none' : 'sentences'}
            placeholder={field === 'reviewDate' ? '2026-09-15' : undefined} placeholderTextColor={colors.inkSoft}
            style={[styles.input, { color: colors.ink, borderColor: colors.line }]} />
        </View>)}
        {invalid ? <Text accessibilityRole="alert" style={{ color: colors.ink }}>{copy.invalid}</Text> : null}
        {button(saving ? copy.saving : copy.save, () => void save(), saving)}
        <Text style={[styles.title, { color: colors.ink }]}>{copy.question}</Text>
        {(['yes', 'not-yet', 'adjust'] as const).map(response => <View key={response}>
          {button(copy[response], () => void save(response), saving, plan.response === response)}
        </View>)}
        {plan.response ? <Text style={{ color: colors.ink }}>{copy[`${plan.response}Message`]}</Text> : null}
        {saved ? <Text accessibilityLiveRegion="polite" style={{ color: colors.ink }}>{copy.saved}</Text> : null}
        {plan.response === 'adjust' ? <>
          {button(copy.coach, () => router.push('/book-coaching'))}
          <Text style={{ color: colors.inkSoft }}>{copy.coachPrivacy}</Text>
        </> : null}
      </> : null}
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { marginTop: 8 }, body: { gap: 10 }, title: { fontSize: 15, fontWeight: '700' },
  button: { minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 8, marginVertical: 4, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, minHeight: 48, fontSize: 15 },
});
