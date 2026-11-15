import React, { useState } from 'react';
import { guidedStartCopy } from '../../src/content/guidedStartCopy';
import { useGuidedStart } from '../../src/hooks/useGuidedStart';
import { SITUATIONS, type StartSituation } from '../../src/lib/guidedStart';
import { useAccount } from '../../src/contexts/AccountContext';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { AppLogo } from '../../src/components/ui/AppLogo';
import { EmergencyActions } from '../../src/components/safety/EmergencyActions';
import { NavyScreenStatusBar } from '../../src/components/auth/NavyScreenStatusBar';

export default function WelcomeScreen() {
  const { user } = useAccount();
  return <WelcomeContent key={user?.id ?? 'none'} accountId={user?.id ?? null} />;
}
function WelcomeContent({ accountId }: { accountId: string | null }) {
  const [choosing, setChoosing] = useState(true);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('onboarding');
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.primary }]}>
      <NavyScreenStatusBar />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.mark}><AppLogo size={64} /></View>
        <Text style={styles.title}>{t('welcome.title')}</Text>
        <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>

        {choosing ? <StartingPointQuestion accountId={accountId} onContinue={() => setChoosing(false)} /> : <>
        <TouchableOpacity
          accessibilityRole="button"
          style={styles.choiceBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/(onboarding)/invite-code')}
        >
          <Text style={[styles.choiceTitle, { color: colors.primary }]}>
            {t('welcome.providerButton')}
          </Text>
          <Text style={styles.choiceSub}>{t('welcome.providerSub')}</Text>
        </TouchableOpacity>

        {/* Direct path skips coach-sharing consent — per consent-architecture,
            direct users are asked at first coach interaction instead — but
            still gets the loved-one intake (it has its own Skip). */}
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.choiceBtn, styles.choiceBtnOutline]}
          activeOpacity={0.85}
          onPress={() => router.push('/(onboarding)/loved-one')}
        >
          <Text style={[styles.choiceTitle, { color: '#fff' }]}>
            {t('welcome.directButton')}
          </Text>
          <Text style={[styles.choiceSub, { color: 'rgba(255,255,255,0.88)' }]}>
            {t('welcome.directSub')}
          </Text>
        </TouchableOpacity>

        {/* The way back to the first question: a quiet link, not a third choice. */}
        <TouchableOpacity accessibilityRole="button" style={styles.changeLink} onPress={() => setChoosing(true)}>
          <Text style={styles.changeLinkText}>{guidedStartCopy(i18n.language).change}</Text>
        </TouchableOpacity>
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Onboarding's first question, "What brings you here today?". The same answers,
 * device-only saving and rules as Today's starting-point panel
 * (GuidedStartPanel), drawn the way the next onboarding steps are: a chosen
 * answer is filled in, Continue is the one main button, Skip is a quiet link.
 */
export function StartingPointQuestion({ accountId, onContinue }: { accountId: string | null; onContinue: () => void }) {
  const state = useGuidedStart(accountId);
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  const c = guidedStartCopy(i18n.language);
  const [urgent, setUrgent] = useState(false);
  const [selection, setSelection] = useState<StartSituation | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const choose = async (situation: StartSituation) => {
    setSelection(situation);
    // Urgent support is inline and never waits for IO, consent, or membership.
    if (situation === 'urgent') { setUrgent(true); return; }
    setUrgent(false);
    try { await state.edit(v => ({ ...v, situation })); } catch { /* visible storage error */ }
  };
  // Continue only for an answer that is saved; Skip always moves on.
  const continueDisabled = state.busy || !state.ready || selection === 'urgent' ||
    (selection !== null && selection !== state.value.situation) || (!selection && !state.value.situation);
  const quietButton = (label: string, onPress: () => void, disabled = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={[styles.quietBtn, { borderColor: colors.primary, opacity: disabled ? 0.5 : 1 }]}>
      <Text style={[styles.quietBtnText, { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.question, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text accessibilityRole="header" style={[styles.questionTitle, { color: colors.ink }]}>{c.title}</Text>
      <Text style={[styles.questionHint, { color: colors.inkSoft }]}>{c.optional}</Text>
      <View accessibilityRole="radiogroup" style={styles.answers}>
        {SITUATIONS.map((s) => {
          const selected = selection === s || (!selection && state.value.situation === s);
          const disabled = s !== 'urgent' && (!state.ready || state.busy);
          return (
            <TouchableOpacity
              key={s}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              aria-checked={selected}
              disabled={disabled}
              onPress={() => void choose(s)}
              activeOpacity={0.8}
              style={[styles.answer, {
                backgroundColor: selected ? colors.primary : colors.white,
                borderColor: selected ? colors.primary : colors.line,
                opacity: disabled ? 0.5 : 1,
              }]}
            >
              <Text style={[styles.answerText, { color: selected ? colors.white : colors.ink }]}>{c.situations[s]}</Text>
              {selected ? <Text accessible={false} importantForAccessibility="no" style={[styles.answerTick, { color: colors.white }]}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {urgent && (
        <View style={styles.urgent}>
          <Text accessibilityRole="alert" style={[styles.urgentText, { color: colors.ink }]}>{c.disclaimer}</Text>
          <EmergencyActions prominent />
          {quietButton(c.back, () => setUrgent(false))}
        </View>
      )}
      {!state.ready && !state.error && <Text style={[styles.questionNote, { color: colors.inkSoft }]}>{c.loading}</Text>}
      {state.error && <>
        <Text accessibilityRole="alert" style={[styles.urgentText, { color: colors.coral }]}>{c.error}</Text>
        {quietButton(c.retry, () => void state.retry(), state.busy)}
      </>}
      <Text style={[styles.questionNote, { color: colors.inkSoft }]}>{c.local}</Text>
      {state.error && quietButton(c.reset, () => setConfirmClear(true), state.busy)}
      {confirmClear && <>
        <Text style={[styles.urgentText, { color: colors.ink }]}>{c.confirmReset}</Text>
        {quietButton(c.reset, () => { void state.reset().then(() => { setConfirmClear(false); setSelection(null); }).catch(() => {}); }, state.busy)}
        {quietButton(c.cancel, () => setConfirmClear(false))}
      </>}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled: continueDisabled }}
        disabled={continueDisabled}
        onPress={onContinue}
        activeOpacity={0.85}
        style={[styles.continueBtn, { backgroundColor: colors.primary, opacity: continueDisabled ? 0.45 : 1 }]}
      >
        <Text style={[styles.continueText, { color: colors.white }]}>{c.continue}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={styles.skipBtn} onPress={onContinue}>
        <Text style={[styles.skipText, { color: colors.inkSoft }]}>{c.skip}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flexGrow: 1, justifyContent: 'center', padding: 28, alignSelf: 'center', width: '100%', maxWidth: 480 },
  mark: { marginBottom: 14 },
  title: { color: '#fff', fontSize: 27, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    marginBottom: 36,
  },
  choiceBtn: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  // A second choice, plainly available: a solid white outline and white words
  // (a faint fill and border read as switched off).
  choiceBtnOutline: {
    backgroundColor: 'transparent',
  },
  choiceTitle: { fontSize: 16, fontWeight: '700' },
  choiceSub: { fontSize: 12.5, color: '#5c6b6a', marginTop: 4, lineHeight: 18 },
  changeLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
  changeLinkText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center', textDecorationLine: 'underline' },
  question: { borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 16 },
  questionTitle: { fontSize: 21, fontWeight: '700' },
  questionHint: { fontSize: 14, lineHeight: 20, marginTop: 8, marginBottom: 4 },
  questionNote: { fontSize: 12, lineHeight: 18, marginTop: 12 },
  answers: { marginTop: 4 },
  // The loved-one step's chosen-chip treatment, on full-width rows: filled in when chosen.
  answer: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderRadius: 12,
    marginTop: 8,
  },
  answerText: { flex: 1, fontSize: 15, fontWeight: '600' },
  answerTick: { fontSize: 15, fontWeight: '800' },
  urgent: { marginTop: 16 },
  urgentText: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  quietBtn: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1.5, borderRadius: 99, marginTop: 8 },
  quietBtnText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  // The same main button and quiet Skip as the loved-one and reminders steps.
  continueBtn: { borderRadius: 99, minHeight: 48, paddingVertical: 15, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  continueText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  skipBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 6 },
  skipText: { fontSize: 14, fontWeight: '600' },
});
