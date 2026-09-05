import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { ContextualMembershipInvitation } from '../src/membershipInvitations/ContextualMembershipInvitation';
import { content } from '../src/samplePractice/content';
import { advance, back, loadPractice, resetPractice, savePractice, type Practice, type Language } from '../src/samplePractice/model';

export default function FreePracticeRoute() {
  const { user } = useAccount();
  const { i18n } = useTranslation();
  const language: Language = i18n.language.startsWith('es') ? 'es' : 'en';
  return <FreePracticeScreen key={user?.id ?? 'signed-out'} userId={user?.id ?? null} language={language} />;
}

/** Default route keys this screen by account; hydration never triggers an invitation. */
export function FreePracticeScreen({ userId, language }: {
  userId: string | null; language: Language;
}) {
  const c = content[language];
  const { colors } = useTheme();
  const router = useRouter();
  const [practice, setPractice] = useState<Practice | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [completedHere, setCompletedHere] = useState(false);
  const retry = useRef<() => Promise<void>>(async () => undefined);
  const mounted = useRef(true);
  const locked = useRef(false);
  async function run(task: () => Promise<Practice>, completing = false) {
    if (!mounted.current || locked.current) return;
    locked.current = true;
    setBusy(true); setError(false);
    retry.current = () => run(task, completing);
    try {
      const next = await task();
      if (mounted.current) { setPractice(next); setDraft(next.wording[next.step] ?? ''); if (completing) setCompletedHere(true); retry.current = async () => { if (userId) await run(() => loadPractice(AsyncStorage, userId)); }; }
    } catch { if (mounted.current) setError(true); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    if (userId) void run(() => loadPractice(AsyncStorage, userId));
    return () => { mounted.current = false; };
  }, [userId]);
  function persist(next: Practice) {
    if (userId) void run(async () => { return await savePractice(AsyncStorage, userId, next); }, next.completed && !practice?.completed);
  }
  function withDraft(): Practice {
    const next = { ...practice!, wording: [...practice!.wording] };
    if (next.step < 3) next.wording[next.step] = draft;
    return next;
  }
  const button = (label: string, onPress: () => void, disabled = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={[styles.button, { backgroundColor: colors.primaryLight, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[styles.buttonText, { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
  const body = (text: string) => <Text style={[styles.body, { color: colors.ink }]}>{text}</Text>;
  const step = practice && practice.step < 3 ? c.steps[practice.step] : null;
  const selected = step && practice ? step.options[practice.choices[practice.step] ?? -1] : null;
  return <ScreenContainer scroll contentContainerStyle={styles.screen}>
    {button(c.exit, () => router.back())}
    <Text style={[styles.kicker, { color: colors.primary }]}>{c.kicker}</Text>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{c.title}</Text>
    {body(c.intro)}
    <View style={[styles.card, { backgroundColor: colors.coralLight }]}>
      {button(c.urgent, () => router.push('/crisis-mode'))}{body(c.safety)}
    </View>
    <Text style={[styles.small, { color: colors.inkSoft }]}>{c.privacy}</Text>
    {!userId ? body(c.signIn) : <>
      {busy && <><ActivityIndicator color={colors.primary} />{body(practice ? c.saving : c.loading)}</>}
      {error && <View accessibilityRole="alert" style={[styles.card, { backgroundColor: colors.coralLight }]}>
        {body(c.error)}{button(c.retry, () => void retry.current(), busy)}
        {button(language === 'es' ? 'Recargar lo guardado (descartar cambios sin guardar)' : 'Reload saved practice (discard unsaved edits)', () => { setCompletedHere(false); void run(() => loadPractice(AsyncStorage, userId)); }, busy)}
      </View>}
      {practice && !error && <>
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1 }]}>
          {step ? <>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.primary }]}>{step.title}</Text>
            {body(step.prompt)}
            {step.options.map((option, index) => <TouchableOpacity key={index} accessibilityRole="radio"
              aria-checked={practice.choices[practice.step] === index} accessibilityState={{ checked: practice.choices[practice.step] === index, disabled: busy }} disabled={busy}
              onPress={() => { const next = withDraft(); next.choices = [...next.choices]; next.choices[next.step] = index; persist(next); }}
              style={[styles.choice, { borderColor: practice.choices[practice.step] === index ? colors.primary : colors.line, backgroundColor: practice.choices[practice.step] === index ? colors.primaryLight : colors.white }]}>
              {body(`${practice.choices[practice.step] === index ? '● ' : '○ '}${option.reply}`)}
            </TouchableOpacity>)}
            {selected && <View style={[styles.card, { backgroundColor: colors.greenLight }]}>
              <Text style={[styles.heading, { color: colors.ink }]}>{c.explanation}</Text>{body(selected.why)}
              <Text style={[styles.heading, { color: colors.ink }]}>{c.reply}</Text>{body(selected.response)}
            </View>}
            {body(c.optional)}
            <TextInput accessibilityLabel={c.optional} multiline maxLength={1000} editable={!busy} value={draft} onChangeText={setDraft}
              placeholder={c.placeholder} placeholderTextColor={colors.inkSoft} style={[styles.input, { color: colors.ink, borderColor: colors.line }]} />
            {button(c.save, () => persist(withDraft()), busy)}
            {button(practice.step === 2 ? c.finish : c.next, () => persist(advance(withDraft())), busy || !selected)}
            {practice.step > 0 && button(c.back, () => persist(back(withDraft())), busy)}
            {practice.completed && button(c.completed, () => persist({ ...withDraft(), step: 3 }), busy)}
          </> : <>
            <Text accessibilityRole="header" style={[styles.heading, { color: colors.green }]}>{c.completed}</Text>
            {body(c.summary)}
            {c.steps.map((item, index) => <View key={index} style={styles.takeaway}>
              <Text style={[styles.heading, { color: colors.primary }]}>{item.title}</Text>
              {body(item.options[practice.choices[index]!].reply)}
              {practice.wording[index] ? body(`${c.optional}: ${practice.wording[index]}`) : null}
              {body(item.options[practice.choices[index]!].why)}
            </View>)}
            {body(c.saved)}{button(c.review, () => persist({ ...practice, step: 0 }), busy)}
          </>}
        </View>
      </>}
      <ContextualMembershipInvitation accountId={userId} placement="practice-completed" completed={completedHere && !busy && !error && practice?.step === 3} />
      {button(c.reset, () => setResetConfirm(true), busy)}
      {resetConfirm && <View style={[styles.card, { backgroundColor: colors.coralLight }]}>
        {body(c.confirm)}{button(c.cancel, () => setResetConfirm(false), busy)}
        {button(c.reset, () => { setResetConfirm(false); setCompletedHere(false); void run(() => resetPractice(AsyncStorage, userId)); }, busy)}
      </View>}
    </>}
  </ScreenContainer>;
}
const styles = StyleSheet.create({
  screen: { padding: 20, gap: 16, paddingBottom: 48 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 1.3 },
  title: { fontSize: 32, fontWeight: '800', lineHeight: 39 },
  heading: { fontSize: 20, fontWeight: '700', lineHeight: 28 },
  body: { fontSize: 16, lineHeight: 25 }, small: { fontSize: 13, lineHeight: 20 },
  card: { padding: 18, borderRadius: 20, gap: 14 },
  button: { padding: 14, borderRadius: 12, minHeight: 48 }, buttonText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  choice: { padding: 16, borderWidth: 2, borderRadius: 14 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 110, fontSize: 16, textAlignVertical: 'top' },
  takeaway: { gap: 10, paddingVertical: 12 },
});
