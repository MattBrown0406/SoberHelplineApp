import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { reminderCopy } from '../src/reminders/copy';
import { REMINDER_CATEGORIES, type ReminderCategory } from '../src/reminders/personalReminders';
import { usePersonalReminders } from '../src/reminders/usePersonalReminders';

export default function PersonalRemindersScreen() {
  const { user, isLoading } = useAccount();
  return <ReminderContent key={user?.id ?? 'signed-out'} accountId={user?.id ?? null} loadingAccount={isLoading} />;
}

function ReminderContent({ accountId, loadingAccount }: { accountId: string | null; loadingAccount: boolean }) {
  const { colors } = useTheme();
  const router = useRouter();
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith('es') ? 'es' : 'en';
  const copy = reminderCopy[locale];
  const state = usePersonalReminders(accountId);
  const [category, setCategory] = useState<ReminderCategory>('boundary');
  const [time, setTime] = useState('09:00');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'permission' | 'failure' | 'invalid' | null>(null);
  const locked = busy || !state.ready || loadingAccount;
  const selected = state.items.find(r => r.category === category);
  async function run(action: () => Promise<void>) {
    if (busy || state.service.snapshot().accountId !== accountId) return;
    setBusy(true); setMessage(null);
    try { await action(); }
    catch (error) { setMessage(error instanceof Error && error.message === 'permission' ? 'permission' : 'failure'); }
    finally { setBusy(false); }
  }
  function enable() {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { setMessage('invalid'); return; }
    const [hour, minute] = time.split(':').map(Number);
    void run(() => state.service.enable(category, hour, minute, locale));
  }
  function button(label: string, onPress: () => void, disabled = false, selected = false) {
    return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
      style={[styles.button, { backgroundColor: selected ? colors.primary : colors.white, borderColor: colors.primary, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[styles.buttonText, { color: selected ? colors.white : colors.primary }]}>{label}</Text>
    </Pressable>;
  }
  return <ScreenContainer>
    {button(copy.back, () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/support'); })}
    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{copy.title}</Text>
    <Text style={[styles.body, { color: colors.ink }]}>{copy.intro}</Text>
    <Text style={[styles.body, { color: colors.inkSoft }]}>{copy.privacy}</Text>
    {!state.supported ? <Text style={[styles.body, { color: colors.ink }]}>{copy.web}</Text>
      : loadingAccount ? <ActivityIndicator accessibilityLabel={copy.loading} />
      : !accountId ? <Text style={[styles.body, { color: colors.ink }]}>{copy.signIn}</Text>
      : <>
        {(!state.ready && !state.error) && <ActivityIndicator accessibilityLabel={copy.loading} />}
        {(message || state.error) && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.body, { color: colors.coral }]}>{copy[message ?? 'failure']}</Text>}
        {state.error && button(copy.retry, () => { void run(() => state.service.setAccount(accountId)); }, busy)}
        {state.ready && <>
          <View style={styles.section}>
            {REMINDER_CATEGORIES.map(value => <View key={value}>{button(copy.categories[value], () => {
              setCategory(value); const item = state.items.find(r => r.category === value);
              setTime(item ? `${String(item.hour).padStart(2, '0')}:${String(item.minute).padStart(2, '0')}` : '09:00');
            }, locked, category === value)}</View>)}
            <Text style={[styles.body, { color: colors.ink }]}>{copy.time}</Text>
            <TextInput accessibilityLabel={copy.time} accessibilityHint={copy.timeHint} value={time} onChangeText={setTime}
              editable={!locked && !selected?.enabled} maxLength={5} placeholder="09:00" autoCorrect={false}
              style={[styles.input, { color: colors.ink, borderColor: colors.inkSoft, backgroundColor: colors.white }]} />
            <Text style={[styles.body, { color: colors.inkSoft }]}>{copy.timeHint}</Text>
            {button(selected ? copy.resume : copy.enable, enable, locked || !!selected?.enabled)}
          </View>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{copy.manage}</Text>
          {state.items.length === 0 && <Text style={[styles.body, { color: colors.ink }]}>{copy.empty}</Text>}
          {state.items.map(item => <View key={item.category} style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text accessibilityRole="header" style={[styles.itemTitle, { color: colors.ink }]}>{copy.categories[item.category]}</Text>
            <Text style={[styles.body, { color: colors.ink }]}>{item.enabled ? copy.active : copy.paused} · {String(item.hour).padStart(2, '0')}:{String(item.minute).padStart(2, '0')}</Text>
            {item.enabled ? button(copy.pause, () => { void run(() => state.service.pause(item.category)); }, locked)
              : button(copy.resume, () => { void run(() => state.service.enable(item.category, item.hour, item.minute, locale)); }, locked)}
            {button(copy.remove, () => { void run(() => state.service.remove(item.category)); }, locked)}
          </View>)}
        </>}
        {busy && <ActivityIndicator accessibilityLabel={copy.loading} />}
      </>}
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', marginVertical: 16 },
  body: { fontSize: 16, lineHeight: 24, marginBottom: 12 },
  itemTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  section: { marginVertical: 16, gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 14 },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 10, padding: 12, justifyContent: 'center', marginBottom: 8 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 18 },
});
